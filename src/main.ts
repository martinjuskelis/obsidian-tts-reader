import { MarkdownView, Notice, Platform, Plugin, TFile, type FileView, type WorkspaceLeaf } from "obsidian";
import {
	DEFAULT_SETTINGS,
	OPENAI_MODELS,
	SPEED_MIN,
	SPEED_MAX,
	SPEED_STEP,
	getActiveModelId,
	getModelSetting,
	type SentenceInfo,
	type TTSReaderSettings,
	type TTSEngine,
} from "./types";
import { TTSReaderSettingTab } from "./settings";
import { ttsLineField } from "./editor-line-indicator";
import { WebSpeechEngine } from "./web-speech";
import { DeepInfraEngine } from "./deepinfra";
import { OpenAIEngine } from "./openai-tts";
import { GeminiTTSEngine } from "./gemini-tts";
import { exportToMp3 } from "./mp3-export";
import { Highlighter } from "./highlighter";
import { PlaybackController } from "./playback";
import { Toolbar } from "./toolbar";
import type { Reader, SentenceContext } from "./reader";
import { MarkdownReader } from "./markdown-reader";

export default class TTSReaderPlugin extends Plugin {
	settings: TTSReaderSettings = DEFAULT_SETTINGS;
	private controller: PlaybackController | null = null;
	private toolbar: Toolbar | null = null;
	private webSpeechEngine: WebSpeechEngine | null = null;
	private deepInfraEngine: DeepInfraEngine | null = null;
	private openaiEngine: OpenAIEngine | null = null;
	private geminiEngine: GeminiTTSEngine | null = null;
	private highlighter: Highlighter | null = null;
	private reader: Reader | null = null;
	private readerTeardown: (() => void) | null = null;
	private playbackLeaf: WorkspaceLeaf | null = null;
	private playbackFilePath: string | null = null;
	private savePositionTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Set sensible mobile default on first load
		if (Platform.isMobile && this.settings.toolbarPadding === 0) {
			this.settings.toolbarPadding = 80;
			await this.saveSettings();
		}

		this.addSettingTab(new TTSReaderSettingTab(this.app, this));
		this.registerEditorExtension(ttsLineField);
		this.registerCommands();

		// Ribbon icon — toggles playback on/off
		this.addRibbonIcon("headphones", "Read aloud", () => {
			if (this.controller && this.controller.state !== "idle") {
				this.stopPlayback();
			} else {
				const reader = this.createReaderForActiveView();
				if (reader) {
					this.startPlayback(reader);
				} else {
					new Notice("TTS Reader: Open a document first.");
				}
			}
		});

		// File menu: Export as MP3
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, abstractFile) => {
				if (abstractFile instanceof TFile && abstractFile.extension === "md") {
					menu.addItem((item) => {
						item.setTitle("Export as MP3")
							.setIcon("download")
							.onClick(async () => {
								const leaf = this.app.workspace.getLeaf(false);
								await leaf.openFile(abstractFile);
								const view = this.app.workspace.getActiveViewOfType(MarkdownView);
								if (view) this.runMp3Export(view);
							});
					});
				}
			})
		);

		// Only stop playback when the user opens a DIFFERENT FILE in the
		// original pane. Clicking other panels, sidebars, extensions,
		// or even other same-type panes does NOT stop playback.
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				if (!this.playbackLeaf || !this.playbackFilePath) return;
				const currentFile =
					(this.playbackLeaf.view as FileView | undefined)?.file?.path;
				if (currentFile && currentFile !== this.playbackFilePath) {
					this.stopPlayback();
				}
			}),
		);
	}

	onunload(): void {
		this.stopPlayback();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Public so the settings tab can stop playback for disruptive changes. */
	stopPlaybackPublic(): void {
		this.stopPlayback();
	}

	// --- Commands ---

	private registerCommands(): void {
		this.addCommand({
			id: "start-reading",
			name: "Start reading aloud",
			checkCallback: (checking) => {
				const reader = this.createReaderForActiveView();
				if (!reader) return false;
				if (checking) return true;
				this.startPlayback(reader);
			},
		});

		this.addCommand({
			id: "toggle-reading",
			name: "Toggle reading aloud",
			callback: () => {
				if (this.controller && this.controller.state !== "idle") {
					this.stopPlayback();
				} else {
					const reader = this.createReaderForActiveView();
					if (reader) this.startPlayback(reader);
					else new Notice("TTS Reader: Open a document first.");
				}
			},
		});

		this.addCommand({
			id: "stop-reading",
			name: "Stop reading",
			checkCallback: (checking) => {
				if (!this.controller || this.controller.state === "idle")
					return false;
				if (checking) return true;
				this.stopPlayback();
			},
		});

		this.addCommand({
			id: "pause-resume",
			name: "Pause / Resume",
			checkCallback: (checking) => {
				if (!this.controller || this.controller.state === "idle")
					return false;
				if (checking) return true;
				this.controller.togglePlayPause(this.settings.speed);
			},
		});

		this.addCommand({
			id: "skip-forward",
			name: "Skip to next sentence",
			checkCallback: (checking) => {
				if (!this.controller || this.controller.state === "idle")
					return false;
				if (checking) return true;
				this.controller.skipForward(this.settings.speed);
			},
		});

		this.addCommand({
			id: "skip-backward",
			name: "Skip to previous sentence",
			checkCallback: (checking) => {
				if (!this.controller || this.controller.state === "idle")
					return false;
				if (checking) return true;
				this.controller.skipBackward(this.settings.speed);
			},
		});

		this.addCommand({
			id: "speed-up",
			name: "Increase speed",
			checkCallback: (checking) => {
				if (!this.controller || this.controller.state === "idle")
					return false;
				if (this.settings.speed >= SPEED_MAX) return false;
				if (checking) return true;
				this.changeSpeed(SPEED_STEP);
			},
		});

		this.addCommand({
			id: "speed-down",
			name: "Decrease speed",
			checkCallback: (checking) => {
				if (!this.controller || this.controller.state === "idle")
					return false;
				if (this.settings.speed <= SPEED_MIN) return false;
				if (checking) return true;
				this.changeSpeed(-SPEED_STEP);
			},
		});

		this.addCommand({
			id: "read-from-cursor",
			name: "Read from cursor position",
			checkCallback: (checking) => {
				const view =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) return false;
				if (checking) return true;

				const reader = new MarkdownReader(view, this.markdownReaderOptions());
				if (view.getMode() !== "preview") {
					const cursor = view.editor.getCursor();
					const offset = view.editor.posToOffset(cursor);
					this.startPlayback(reader, offset);
				} else {
					this.startPlayback(reader);
				}
			},
		});

		this.addCommand({
			id: "open-settings",
			name: "Open TTS Reader settings",
			callback: () => {
				(this.app as any).setting?.open?.();
				(this.app as any).setting?.openTabById?.(this.manifest.id);
			},
		});

		this.addCommand({
			id: "export-mp3",
			name: "Export as MP3",
			checkCallback: (checking) => {
				const view =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view || !view.file) return false;
				if (checking) return true;
				this.runMp3Export(view);
			},
		});
	}

	// --- Reader construction ---

	/** Build a reader for the active view, or null if it isn't a supported type. */
	private createReaderForActiveView(): Reader | null {
		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (mdView) {
			return new MarkdownReader(mdView, this.markdownReaderOptions());
		}
		return null;
	}

	private markdownReaderOptions() {
		return {
			skipCodeBlocks: this.settings.skipCodeBlocks,
			skipFrontmatter: this.settings.skipFrontmatter,
			stripFootnoteRefs: this.settings.stripFootnoteRefs,
			maxChunkChars: this.getMaxChunkChars(),
			editorLineIndicator: this.settings.editorLineIndicator,
		};
	}

	// --- MP3 Export ---

	private async runMp3Export(view: MarkdownView): Promise<void> {
		const file = view.file;
		if (!file) return;
		try {
			const markdown = view.getViewData();
			const msg = await exportToMp3(
				file,
				markdown,
				this.settings,
				this.app.vault,
			);
			new Notice(`TTS Reader: ${msg}`, 10000);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`TTS Reader export failed: ${msg}`, 10000);
			console.error("TTS Reader: MP3 export error", err);
		}
	}

	// --- Playback lifecycle ---

	private async startPlayback(
		reader: Reader,
		startOffset?: number,
	): Promise<void> {
		this.stopPlayback();

		const sentences = await reader.extractChunks();
		if (sentences.length === 0) {
			new Notice("TTS Reader: No readable text found in this document.");
			return;
		}

		const resumeIndex = this.getResumeIndex(reader.filePath, sentences);
		const startIndex = reader.resolveStartIndex(
			sentences,
			startOffset,
			resumeIndex,
		);

		const engine = await this.getEngine();
		if (!engine) return;

		this.highlighter = new Highlighter();

		this.controller = new PlaybackController(
			engine,
			this.highlighter,
			this.settings.autoScroll,
		);
		this.controller.setBufferAhead(this.getBufferAhead());

		this.reader = reader;
		this.playbackLeaf = reader.leaf;
		this.playbackFilePath = reader.filePath;

		// Per-sentence: let the reader prep the DOM (page scroll, layer render),
		// then hand the Highlighter the right container for the sentence.
		this.controller.onBeforeSentence = async (ctx) => {
			await reader.prepareForSentence(ctx);
			const container = reader.getHighlightContainer(ctx);
			if (container) {
				this.highlighter?.setContainer(container);
			}
		};

		// Seed the container now so the first highlight doesn't race against
		// an unset container (markdown case: preview element is stable).
		const seedContainer = reader.getHighlightContainer({
			index: startIndex,
			sentence: sentences[startIndex] ?? sentences[0],
		});
		if (seedContainer) this.highlighter.setContainer(seedContainer);

		// Toolbar is hosted in the reader's view content element.
		const viewContentEl = (reader.leaf.view as any)?.contentEl as
			| HTMLElement
			| undefined;
		if (!viewContentEl) {
			new Notice("TTS Reader: View has no content element.");
			return;
		}
		this.toolbar = new Toolbar(
			viewContentEl,
			this.settings.speed,
			this.settings.toolbarPadding,
		);
		this.wireToolbar();
		this.wireController();

		this.readerTeardown = reader.setupClickToJump(
			this.controller,
			this.highlighter,
			() => this.settings.speed,
		);

		if (startIndex > 0) {
			new Notice(
				`Reading from sentence ${startIndex + 1} of ${sentences.length}...`,
			);
		} else {
			new Notice(`Reading ${sentences.length} sentences...`);
		}
		await this.controller.start(sentences, startIndex, this.settings.speed);
	}

	private stopPlayback(): void {
		// Persist the bookmark before we drop the reader reference.
		this.flushReadingPosition();
		this.playbackLeaf = null;
		this.playbackFilePath = null;
		if (this.readerTeardown) {
			try {
				this.readerTeardown();
			} catch (err) {
				console.error("TTS Reader: reader teardown error:", err);
			}
			this.readerTeardown = null;
		}
		if (this.reader) {
			try {
				this.reader.destroy();
			} catch (err) {
				console.error("TTS Reader: reader.destroy error:", err);
			}
			this.reader = null;
		}
		if (this.controller) {
			this.controller.stop();
			this.controller = null;
		}
		if (this.toolbar) {
			this.toolbar.destroy();
			this.toolbar = null;
		}
		this.highlighter = null;
	}

	private async getEngine(): Promise<TTSEngine | null> {
		if (this.settings.backend === "deepinfra") {
			if (!this.settings.deepinfraApiKey) {
				new Notice(
					"TTS Reader: DeepInfra API key not set. " +
						"Please configure it in Settings > TTS Reader.",
				);
				return null;
			}
			if (!this.deepInfraEngine) {
				this.deepInfraEngine = new DeepInfraEngine(
					this.settings.deepinfraApiKey,
					this.settings.deepinfraModel,
				);
			} else {
				this.deepInfraEngine.updateConfig(
					this.settings.deepinfraApiKey,
					this.settings.deepinfraModel,
				);
			}
			this.deepInfraEngine.debug = this.settings.debug;
			this.deepInfraEngine.voice = getModelSetting(this.settings, this.settings.deepinfraModel, "voice");
			return this.deepInfraEngine;
		}

		if (this.settings.backend === "openai") {
			if (!this.settings.openaiApiKey) {
				new Notice(
					"TTS Reader: OpenAI API key not set. " +
						"Please configure it in Settings > TTS Reader.",
				);
				return null;
			}
			if (!this.openaiEngine) {
				this.openaiEngine = new OpenAIEngine(
					this.settings.openaiApiKey,
				);
			} else {
				this.openaiEngine.updateConfig(this.settings.openaiApiKey);
			}
			this.openaiEngine.model = this.settings.openaiModel;
			this.openaiEngine.voice = getModelSetting(this.settings, this.settings.openaiModel, "voice");
			this.openaiEngine.debug = this.settings.debug;
			return this.openaiEngine;
		}

		if (this.settings.backend === "gemini") {
			if (!this.settings.geminiApiKey) {
				new Notice(
					"TTS Reader: Gemini API key not set. " +
						"Get one from aistudio.google.com and configure it in Settings > TTS Reader.",
				);
				return null;
			}
			if (!this.geminiEngine) {
				this.geminiEngine = new GeminiTTSEngine(
					this.settings.geminiApiKey,
				);
			} else {
				this.geminiEngine.updateConfig(this.settings.geminiApiKey);
			}
			this.geminiEngine.voice = getModelSetting(this.settings, "gemini-2.5-flash-preview-tts", "voice");
			this.geminiEngine.debug = this.settings.debug;
			return this.geminiEngine;
		}

		// webspeech fallback
		if (typeof speechSynthesis === "undefined") {
			new Notice(
				"TTS Reader: Web Speech API is not available on this platform. On Android, use a cloud backend instead (Settings > TTS Reader).",
				10000,
			);
			return null;
		}
		if (!this.webSpeechEngine) {
			this.webSpeechEngine = new WebSpeechEngine();
		}
		this.webSpeechEngine.setVoice(this.settings.webSpeechVoice);

		// Check if voices are available (Android WebView may have none)
		const voices = speechSynthesis.getVoices();
		if (voices.length === 0) {
			// Wait briefly for async voice loading
			await new Promise<void>((resolve) => {
				speechSynthesis.addEventListener("voiceschanged", () => resolve(), { once: true });
				setTimeout(resolve, 2000);
			});
			if (speechSynthesis.getVoices().length === 0) {
				new Notice(
					"TTS Reader: No voices found. On Android, install Google Text-to-Speech from the Play Store and set it as default in Settings > System > Language > Text-to-speech output.",
					10000,
				);
			}
		}

		return this.webSpeechEngine;
	}

	private wireToolbar(): void {
		if (!this.toolbar || !this.controller) return;
		const toolbar = this.toolbar;
		const controller = this.controller;

		toolbar.onPlay = () => {
			if (controller.state === "paused") {
				controller.resume(this.settings.speed);
			}
		};
		toolbar.onPause = () => controller.pause();
		toolbar.onClose = () => this.stopPlayback();
		toolbar.onPrev = () => {
			this.highlighter?.resetSearchPosition();
			controller.skipBackward(this.settings.speed);
		};
		toolbar.onNext = () => controller.skipForward(this.settings.speed);
		toolbar.onSpeedChange = (speed) => {
			this.settings.speed = speed;
			this.saveSettings();
			controller.setSpeed(speed);
		};
		toolbar.onToggleAutoScroll = () => {
			this.settings.autoScroll = !this.settings.autoScroll;
			this.saveSettings();
			controller.setAutoScroll(this.settings.autoScroll);
		};
		toolbar.onLocate = () => {
			if (!this.reader || !this.highlighter) return;
			const idx = controller.sentenceIndex;
			const sentence = controller.sentences[idx];
			const ctx: SentenceContext | null =
				idx >= 0 && sentence ? { index: idx, sentence } : null;
			this.reader.locateCurrent(ctx, this.highlighter);
		};
		toolbar.updateAutoScroll(this.settings.autoScroll);
	}

	private wireController(): void {
		if (!this.controller || !this.toolbar) return;
		const toolbar = this.toolbar;

		this.controller.onStateChange = (state) => {
			toolbar.updateState(state);
		};

		this.controller.onSentenceChange = (index, total) => {
			toolbar.updateProgress(index, total);
			this.scheduleSaveReadingPosition(index);
			const sentence = this.controller?.sentences[index];
			if (sentence && this.reader) {
				this.reader.onSentenceChanged(
					{ index, sentence },
					this.settings.autoScroll,
				);
			}
		};

		this.controller.onError = (msg) => {
			new Notice(`TTS Reader: ${msg}`, 10000);
			this.stopPlayback();
		};

		this.controller.onComplete = () => {
			new Notice("TTS Reader: Finished reading.");
			this.clearReadingPosition(this.playbackFilePath);
			if (this.readerTeardown) {
				try { this.readerTeardown(); } catch {}
				this.readerTeardown = null;
			}
			if (this.reader) {
				try { this.reader.destroy(); } catch {}
				this.reader = null;
			}
			this.playbackLeaf = null;
			this.playbackFilePath = null;
			if (this.toolbar) {
				this.toolbar.destroy();
				this.toolbar = null;
			}
			this.controller = null;
			this.highlighter = null;
		};
	}

	// --- Resume bookmark ---

	private scheduleSaveReadingPosition(index: number): void {
		const path = this.playbackFilePath;
		if (!path) return;
		const sentence = this.controller?.sentences[index];
		if (!sentence) return;

		// Update in-memory immediately so stopPlayback can flush reliably.
		this.settings.readingPositions[path] = {
			sentenceIndex: index,
			sentenceText: sentence.text.slice(0, 100),
			updatedAt: Date.now(),
		};

		// Debounce the disk write — scrubbing prev/next fires many times.
		if (this.savePositionTimer !== null) {
			window.clearTimeout(this.savePositionTimer);
		}
		this.savePositionTimer = window.setTimeout(() => {
			this.savePositionTimer = null;
			this.saveSettings();
		}, 1500);
	}

	private flushReadingPosition(): void {
		if (this.savePositionTimer === null) return;
		window.clearTimeout(this.savePositionTimer);
		this.savePositionTimer = null;
		this.saveSettings();
	}

	private clearReadingPosition(path: string | null): void {
		if (this.savePositionTimer !== null) {
			window.clearTimeout(this.savePositionTimer);
			this.savePositionTimer = null;
		}
		if (!path || !this.settings.readingPositions[path]) return;
		delete this.settings.readingPositions[path];
		this.saveSettings();
	}

	/**
	 * Find where to resume reading. Looks up the saved bookmark for this
	 * file and re-anchors against the current sentence list (by text, then
	 * by index) so resume survives minor edits.
	 */
	private getResumeIndex(
		path: string | null,
		sentences: readonly SentenceInfo[],
	): number {
		if (!path) return 0;
		const saved = this.settings.readingPositions[path];
		if (!saved) return 0;

		const savedText = saved.sentenceText;
		if (savedText && savedText.length > 0) {
			// Exact match at saved index — fast path, covers unedited files.
			const atIndex = sentences[saved.sentenceIndex];
			if (atIndex && atIndex.text.startsWith(savedText)) {
				return saved.sentenceIndex;
			}
			// Fall back to text search. Use the single match if there is one;
			// if duplicates, pick the one closest to saved.sentenceIndex.
			let bestIdx = -1;
			let bestDist = Infinity;
			for (let i = 0; i < sentences.length; i++) {
				if (sentences[i].text.startsWith(savedText)) {
					const dist = Math.abs(i - saved.sentenceIndex);
					if (dist < bestDist) {
						bestDist = dist;
						bestIdx = i;
					}
				}
			}
			if (bestIdx >= 0) return bestIdx;
		}

		// Text anchor gone — clamp saved index and hope for the best.
		return Math.min(saved.sentenceIndex, Math.max(0, sentences.length - 1));
	}

	/** Max chars per TTS chunk. 0 = sentence-level (DeepInfra/WebSpeech). */
	private getMaxChunkChars(): number {
		const modelId = getActiveModelId(this.settings);
		if (!modelId) return 0;
		const chunkSize = getModelSetting(this.settings, modelId, "chunkSize");
		// Enforce API hard limits
		if (this.settings.backend === "openai") {
			const modelDef = OPENAI_MODELS.find((m) => m.id === modelId);
			if (modelDef) return Math.min(chunkSize, modelDef.maxChars);
		}
		return chunkSize;
	}

	private getBufferAhead(): number {
		const modelId = getActiveModelId(this.settings);
		if (!modelId) return 5;
		return getModelSetting(this.settings, modelId, "bufferAhead");
	}

	private changeSpeed(delta: number): void {
		let newSpeed = Math.round((this.settings.speed + delta) * 100) / 100;
		newSpeed = Math.max(SPEED_MIN, Math.min(SPEED_MAX, newSpeed));
		this.settings.speed = newSpeed;
		this.saveSettings();
		this.controller?.setSpeed(newSpeed);
		this.toolbar?.updateSpeed(newSpeed);
		new Notice(`Speed: ${newSpeed}x`);
	}
}
