import { MarkdownView, Notice, Platform, Plugin, type WorkspaceLeaf } from "obsidian";
import { EditorView } from "@codemirror/view";
import {
	DEFAULT_SETTINGS,
	SPEED_MIN,
	SPEED_MAX,
	SPEED_STEP,
	type SentenceInfo,
	type TTSReaderSettings,
	type TTSEngine,
} from "./types";
import { TTSReaderSettingTab } from "./settings";
import { extractSentences } from "./text-extractor";
import { buildSentenceOffsets, findSentenceAtOffset } from "./position-map";
import { ttsLineField, updateTTSLineIndicator } from "./editor-line-indicator";
import { WebSpeechEngine } from "./web-speech";
import { DeepInfraEngine } from "./deepinfra";
import { Highlighter } from "./highlighter";
import { PlaybackController } from "./playback";
import { Toolbar } from "./toolbar";

export default class TTSReaderPlugin extends Plugin {
	settings: TTSReaderSettings = DEFAULT_SETTINGS;
	private controller: PlaybackController | null = null;
	private toolbar: Toolbar | null = null;
	private webSpeechEngine: WebSpeechEngine | null = null;
	private deepInfraEngine: DeepInfraEngine | null = null;
	private highlighter: Highlighter | null = null;
	private clickHandler: ((e: MouseEvent) => void) | null = null;
	private clickTarget: HTMLElement | null = null;
	private editorClickHandler: ((e: MouseEvent) => void) | null = null;
	private editorClickTarget: HTMLElement | null = null;
	private editorCmView: EditorView | null = null;
	private sentenceOffsets: number[] = [];
	private playbackLeaf: WorkspaceLeaf | null = null;
	private playbackFilePath: string | null = null;

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
				const view =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (view) {
					this.startPlayback(view);
				} else {
					new Notice("TTS Reader: Open a document first.");
				}
			}
		});

		// Only stop playback when the user opens a DIFFERENT FILE in the
		// original pane. Clicking other panels, sidebars, extensions,
		// or even other MarkdownView panes does NOT stop playback.
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (!this.playbackLeaf || !this.playbackFilePath) return;
				// Only care if the original playback pane now shows a different file
				const currentFile = (
					this.playbackLeaf.view as MarkdownView
				)?.file?.path;
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
				const view =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) return false;
				if (checking) return true;
				this.startPlayback(view);
			},
		});

		this.addCommand({
			id: "toggle-reading",
			name: "Toggle reading aloud",
			callback: () => {
				if (this.controller && this.controller.state !== "idle") {
					this.stopPlayback();
				} else {
					const view =
						this.app.workspace.getActiveViewOfType(MarkdownView);
					if (view) this.startPlayback(view);
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

				if (view.getMode() !== "preview") {
					const cursor = view.editor.getCursor();
					const offset = view.editor.posToOffset(cursor);
					this.startPlayback(view, offset);
				} else {
					this.startPlayback(view);
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
	}

	// --- Playback lifecycle ---

	private async startPlayback(
		view: MarkdownView,
		startOffset?: number,
	): Promise<void> {
		this.stopPlayback();

		const mode = view.getMode();
		const isEditorMode = mode !== "preview";

		const markdown = view.getViewData();
		const sentences = extractSentences(
			markdown,
			this.settings.skipCodeBlocks,
			this.settings.skipFrontmatter,
		);
		if (sentences.length === 0) {
			new Notice("TTS Reader: No readable text found in this document.");
			return;
		}

		// Determine start index — build offset map once if in editor mode
		let startIndex = 0;
		const offsets =
			isEditorMode || startOffset != null
				? buildSentenceOffsets(markdown, sentences)
				: [];

		if (startOffset != null) {
			startIndex = findSentenceAtOffset(offsets, startOffset);
		} else if (isEditorMode) {
			const cursor = view.editor.getCursor();
			const cursorOffset = view.editor.posToOffset(cursor);
			startIndex = findSentenceAtOffset(offsets, cursorOffset);
		}

		const engine = await this.getEngine();
		if (!engine) return;

		// Set up highlighter — only attach to DOM in Reading View
		this.highlighter = new Highlighter();
		const previewEl = isEditorMode
			? null
			: (view.contentEl.querySelector(
					".markdown-preview-view",
				) as HTMLElement | null);
		if (previewEl) {
			this.highlighter.setContainer(previewEl);
		}

		this.controller = new PlaybackController(
			engine,
			this.highlighter,
			this.settings.autoScroll,
		);
		this.controller.setBufferAhead(this.settings.bufferAhead);

		this.playbackLeaf = view.leaf;
		this.playbackFilePath = view.file?.path ?? null;
		this.toolbar = new Toolbar(
			view.contentEl,
			this.settings.speed,
			this.settings.toolbarPadding,
		);
		this.wireToolbar();
		this.wireController();

		if (isEditorMode) {
			this.setupEditorClickToJump(view);
			if (this.settings.editorLineIndicator) {
				this.editorCmView =
					(view.editor as any).cm ?? null;
				this.sentenceOffsets = offsets;
			}
		} else if (previewEl) {
			this.setupClickToJump(previewEl);
		}

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
		this.playbackLeaf = null;
		this.playbackFilePath = null;
		this.clearEditorIndicator();
		this.teardownClickToJump();
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
			this.deepInfraEngine.voice = this.settings.deepinfraVoice;
			return this.deepInfraEngine;
		}

		if (typeof speechSynthesis === "undefined") {
			new Notice(
				"TTS Reader: Web Speech API is not available on this platform. On Android, use the DeepInfra backend instead (Settings > TTS Reader).",
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
			this.highlighter?.scrollToCurrent();
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
			this.updateEditorIndicator(index);
		};

		this.controller.onError = (msg) => {
			new Notice(`TTS Reader: ${msg}`, 10000);
			this.stopPlayback();
		};

		this.controller.onComplete = () => {
			new Notice("TTS Reader: Finished reading.");
			this.clearEditorIndicator();
			this.teardownClickToJump();
			if (this.toolbar) {
				this.toolbar.destroy();
				this.toolbar = null;
			}
			this.controller = null;
			this.highlighter = null;
		};
	}

	// --- Click-to-jump ---

	private setupClickToJump(previewEl: HTMLElement): void {
		this.clickHandler = (e: MouseEvent) => {
			if (!this.controller || this.controller.state === "idle") return;
			if ((e.target as HTMLElement)?.closest(".tts-reader-toolbar"))
				return;

			const sentences = this.controller.sentences;

			// Estimate click position as a fraction of the document.
			// Used to disambiguate when the same text appears multiple times.
			const clickProgress = this.estimateClickProgress(
				e.target as HTMLElement,
				previewEl,
			);

			// Use caretRangeFromPoint to get a text snippet at the click
			const caretRange = document.caretRangeFromPoint(
				e.clientX,
				e.clientY,
			);
			if (
				caretRange &&
				caretRange.startContainer.nodeType === Node.TEXT_NODE
			) {
				const clickedNode = caretRange.startContainer as Text;
				const clickOffset = caretRange.startOffset;
				const nodeText = clickedNode.textContent ?? "";
				const ctxStart = Math.max(0, clickOffset - 10);
				const ctxEnd = Math.min(nodeText.length, clickOffset + 10);
				const snippet = nodeText
					.substring(ctxStart, ctxEnd)
					.trim();

				if (snippet.length >= 3) {
					// Find all sentences matching the snippet
					const matchingIndices: number[] = [];
					for (let i = 0; i < sentences.length; i++) {
						if (sentences[i].text.includes(snippet)) {
							matchingIndices.push(i);
						}
					}

					if (matchingIndices.length === 1) {
						// Unique — jump directly
						this.controller.jumpTo(
							matchingIndices[0],
							this.settings.speed,
						);
						return;
					}

					if (matchingIndices.length > 1 && this.highlighter) {
						// Duplicate text — ask the highlighter which
						// occurrence contains the click position
						const sentText = sentences[matchingIndices[0]].text;
						const occ = this.highlighter.getOccurrenceAt(
							sentText,
							clickedNode,
							clickOffset,
						);
						if (occ >= 0) {
							// Find the sentence with this occurrence
							for (const idx of matchingIndices) {
								if (sentences[idx].occurrence === occ) {
									this.controller.jumpTo(
										idx,
										this.settings.speed,
									);
									return;
								}
							}
						}
						// Fallback: use position estimate
						const idx = this.findClosestSentence(
							sentences,
							snippet,
							clickProgress,
						);
						if (idx >= 0) {
							this.controller.jumpTo(
								idx,
								this.settings.speed,
							);
							return;
						}
					}
				}
			}

			// Fallback: match by block element text
			const target = e.target as HTMLElement;
			const block = target.closest(
				"p, h1, h2, h3, h4, h5, h6, li, td, th, dt, dd, blockquote",
			);
			if (!block) return;

			const blockText = block.textContent ?? "";
			if (blockText.trim().length === 0) return;

			const idx = this.findClosestSentence(
				sentences,
				blockText,
				clickProgress,
			);
			if (idx >= 0) {
				this.controller.jumpTo(idx, this.settings.speed);
			}
		};

		this.clickTarget = previewEl;
		previewEl.addEventListener("click", this.clickHandler);
	}

	/**
	 * Estimate where in the document the user clicked, as a 0–1 ratio.
	 * Uses the element's visual position relative to the scroll container.
	 */
	private estimateClickProgress(
		target: HTMLElement,
		container: HTMLElement,
	): number {
		const scrollContainer =
			container.closest(".markdown-preview-view") ?? container;
		const scrollEl = scrollContainer as HTMLElement;
		const totalHeight = scrollEl.scrollHeight;
		if (totalHeight === 0) return 0;

		const rect = target.getBoundingClientRect();
		const containerRect = scrollEl.getBoundingClientRect();
		const docPosition =
			scrollEl.scrollTop + rect.top - containerRect.top;
		return Math.max(0, Math.min(1, docPosition / totalHeight));
	}

	/**
	 * Find all sentences containing `snippet`, then pick the one whose
	 * expected position (index/total) is closest to `clickProgress`.
	 */
	private findClosestSentence(
		sentences: readonly SentenceInfo[],
		snippet: string,
		clickProgress: number,
	): number {
		const matches: number[] = [];
		for (let i = 0; i < sentences.length; i++) {
			if (sentences[i].text.includes(snippet)) {
				matches.push(i);
			}
		}
		if (matches.length === 0) return -1;
		if (matches.length === 1) return matches[0];

		// Use cumulative character length for more accurate position mapping
		let totalChars = 0;
		const charPos: number[] = [];
		for (let i = 0; i < sentences.length; i++) {
			charPos.push(totalChars);
			totalChars += sentences[i].text.length;
		}

		let best = matches[0];
		let bestDist = Math.abs(
			charPos[matches[0]] / totalChars - clickProgress,
		);
		for (let i = 1; i < matches.length; i++) {
			const dist = Math.abs(
				charPos[matches[i]] / totalChars - clickProgress,
			);
			if (dist < bestDist) {
				best = matches[i];
				bestDist = dist;
			}
		}
		return best;
	}

	// --- Editor line indicator ---

	private updateEditorIndicator(index: number): void {
		if (!this.editorCmView || this.sentenceOffsets.length === 0) return;

		const from = this.sentenceOffsets[index];
		// Use next sentence offset (or estimate) to cover multi-line sentences
		const to =
			index + 1 < this.sentenceOffsets.length
				? this.sentenceOffsets[index + 1] - 1
				: from +
					(this.controller?.sentences[index]?.text.length ?? 0);

		try {
			updateTTSLineIndicator(this.editorCmView, { from, to });
		} catch {
			// EditorView may be destroyed
		}
	}

	private clearEditorIndicator(): void {
		if (this.editorCmView) {
			try {
				updateTTSLineIndicator(this.editorCmView, null);
			} catch {
				// EditorView may be destroyed
			}
		}
		this.editorCmView = null;
		this.sentenceOffsets = [];
	}

	// --- Editor click-to-jump (Ctrl+Alt+Click / Cmd+Alt+Click) ---

	private setupEditorClickToJump(view: MarkdownView): void {
		this.editorClickHandler = (e: MouseEvent) => {
			if (!this.controller || this.controller.state === "idle") return;
			if ((e.target as HTMLElement)?.closest(".tts-reader-toolbar"))
				return;

			// Ctrl+Alt (Win/Linux) or Cmd+Alt (Mac)
			const modKey = Platform.isMacOS ? e.metaKey : e.ctrlKey;
			if (!modKey || !e.altKey) return;

			e.preventDefault();
			e.stopImmediatePropagation();

			const caretRange = document.caretRangeFromPoint(
				e.clientX,
				e.clientY,
			);
			if (
				!caretRange ||
				caretRange.startContainer.nodeType !== Node.TEXT_NODE
			)
				return;

			const clickedNode = caretRange.startContainer as Text;
			const clickOffset = caretRange.startOffset;
			const nodeText = clickedNode.textContent ?? "";

			// Extract a snippet around the click point
			const ctxStart = Math.max(0, clickOffset - 20);
			const ctxEnd = Math.min(nodeText.length, clickOffset + 20);
			const snippet = nodeText.substring(ctxStart, ctxEnd).trim();
			if (snippet.length < 3) return;

			const markdown = view.getViewData();
			const sentences = this.controller.sentences;
			const offsets = buildSentenceOffsets(markdown, sentences);

			// Try to find the snippet in the raw markdown
			const snippetPos = markdown.indexOf(snippet);
			if (snippetPos >= 0) {
				const idx = findSentenceAtOffset(offsets, snippetPos);
				this.controller.jumpTo(idx, this.settings.speed);
				return;
			}

			// Fallback: match snippet against sentence text
			for (let i = 0; i < sentences.length; i++) {
				if (sentences[i].text.includes(snippet)) {
					this.controller.jumpTo(i, this.settings.speed);
					return;
				}
			}
		};

		const editorEl = view.contentEl.querySelector(
			".cm-editor",
		) as HTMLElement | null;
		if (editorEl) {
			this.editorClickTarget = editorEl;
			editorEl.addEventListener(
				"mousedown",
				this.editorClickHandler,
				true,
			);
		}
	}

	private teardownClickToJump(): void {
		if (this.clickHandler && this.clickTarget) {
			this.clickTarget.removeEventListener("click", this.clickHandler);
		}
		this.clickHandler = null;
		this.clickTarget = null;

		if (this.editorClickHandler && this.editorClickTarget) {
			this.editorClickTarget.removeEventListener(
				"mousedown",
				this.editorClickHandler,
				true,
			);
		}
		this.editorClickHandler = null;
		this.editorClickTarget = null;
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
