import { MarkdownView, Notice, Plugin } from "obsidian";
import {
	DEFAULT_SETTINGS,
	SPEED_MIN,
	SPEED_MAX,
	SPEED_STEP,
	type TTSReaderSettings,
	type TTSEngine,
} from "./types";
import { TTSReaderSettingTab } from "./settings";
import { extractSentences } from "./text-extractor";
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

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new TTSReaderSettingTab(this.app, this));
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

		// Stop playback when the user navigates away or switches views
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.stopPlayback();
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
	}

	// --- Playback lifecycle ---

	private async startPlayback(view: MarkdownView): Promise<void> {
		this.stopPlayback();

		const mode = view.getMode();
		if (mode !== "preview") {
			new Notice(
				"TTS Reader: Please switch to Reading View first.\n" +
					"(Click the book icon or use the command palette)",
			);
			return;
		}

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

		const engine = this.getEngine();
		if (!engine) return;

		const previewEl = view.contentEl.querySelector(
			".markdown-preview-view",
		) as HTMLElement | null;

		this.highlighter = new Highlighter();
		if (previewEl) {
			this.highlighter.setContainer(previewEl);
		}

		this.controller = new PlaybackController(
			engine,
			this.highlighter,
			this.settings.autoScroll,
		);

		this.toolbar = new Toolbar(view.contentEl, this.settings.speed);
		this.wireToolbar();
		this.wireController();
		if (previewEl) this.setupClickToJump(previewEl);

		new Notice(`Reading ${sentences.length} sentences...`);
		await this.controller.start(sentences, 0, this.settings.speed);
	}

	private stopPlayback(): void {
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

	private getEngine(): TTSEngine | null {
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
			return this.deepInfraEngine;
		}

		if (typeof speechSynthesis === "undefined") {
			new Notice(
				"TTS Reader: Web Speech API is not available on this platform.",
			);
			return null;
		}
		if (!this.webSpeechEngine) {
			this.webSpeechEngine = new WebSpeechEngine();
		}
		this.webSpeechEngine.setVoice(this.settings.webSpeechVoice);
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
	}

	private wireController(): void {
		if (!this.controller || !this.toolbar) return;
		const toolbar = this.toolbar;

		this.controller.onStateChange = (state) => {
			toolbar.updateState(state);
		};

		this.controller.onSentenceChange = (index, total) => {
			toolbar.updateProgress(index, total);
		};

		this.controller.onComplete = () => {
			new Notice("TTS Reader: Finished reading.");
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

			// Use caretRangeFromPoint to get the exact click position,
			// extract a text snippet, and find the sentence containing it.
			const caretRange = document.caretRangeFromPoint(
				e.clientX,
				e.clientY,
			);
			if (
				caretRange &&
				caretRange.startContainer.nodeType === Node.TEXT_NODE
			) {
				const nodeText = caretRange.startContainer.textContent ?? "";
				const offset = caretRange.startOffset;

				// Grab ~20 chars around the click point as a search key
				const ctxStart = Math.max(0, offset - 10);
				const ctxEnd = Math.min(nodeText.length, offset + 10);
				const snippet = nodeText.substring(ctxStart, ctxEnd).trim();

				if (snippet.length >= 3) {
					for (let i = 0; i < sentences.length; i++) {
						if (sentences[i].text.includes(snippet)) {
							this.highlighter?.resetSearchPosition();
							this.controller.jumpTo(
								i,
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

			for (let i = 0; i < sentences.length; i++) {
				if (blockText.includes(sentences[i].text)) {
					this.highlighter?.resetSearchPosition();
					this.controller.jumpTo(i, this.settings.speed);
					return;
				}
			}
		};

		this.clickTarget = previewEl;
		previewEl.addEventListener("click", this.clickHandler);
	}

	private teardownClickToJump(): void {
		if (this.clickHandler && this.clickTarget) {
			this.clickTarget.removeEventListener("click", this.clickHandler);
		}
		this.clickHandler = null;
		this.clickTarget = null;
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
