import { MarkdownView, Notice, Plugin } from "obsidian";
import {
	DEFAULT_SETTINGS,
	SPEED_MIN,
	SPEED_MAX,
	SPEED_STEP,
	type TTSReaderSettings,
} from "./types";
import { TTSReaderSettingTab } from "./settings";
import { extractSentences } from "./text-extractor";
import { WebSpeechEngine } from "./web-speech";
import { DeepInfraEngine } from "./deepinfra";
import { Highlighter } from "./highlighter";
import { PlaybackController } from "./playback";
import { Toolbar } from "./toolbar";
import type { TTSEngine } from "./types";

export default class TTSReaderPlugin extends Plugin {
	settings: TTSReaderSettings = DEFAULT_SETTINGS;
	private controller: PlaybackController | null = null;
	private toolbar: Toolbar | null = null;
	private webSpeechEngine: WebSpeechEngine | null = null;
	private deepInfraEngine: DeepInfraEngine | null = null;
	private highlighter: Highlighter | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new TTSReaderSettingTab(this.app, this));
		this.registerCommands();
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
		// Stop any existing playback
		this.stopPlayback();

		// Must be in Reading View
		const mode = view.getMode();
		if (mode !== "preview") {
			new Notice(
				"TTS Reader: Please switch to Reading View first.\n" +
					"(Click the book icon or use the command palette)",
			);
			return;
		}

		// Get the rendered content container
		const previewEl = view.contentEl.querySelector(
			".markdown-preview-view",
		) as HTMLElement | null;
		if (!previewEl) {
			new Notice("TTS Reader: Could not find the document content.");
			return;
		}

		// Extract sentences
		const sentences = extractSentences(
			previewEl,
			this.settings.skipCodeBlocks,
			this.settings.skipFrontmatter,
		);
		if (sentences.length === 0) {
			new Notice("TTS Reader: No readable text found in this document.");
			return;
		}

		// Create engine
		const engine = this.getEngine();
		if (!engine) return;

		// Create highlighter and controller
		this.highlighter = new Highlighter();
		this.controller = new PlaybackController(
			engine,
			this.highlighter,
			this.settings.autoScroll,
		);

		// Create toolbar
		this.toolbar = new Toolbar(view.contentEl, this.settings.speed);
		this.wireToolbar();
		this.wireController();

		// Start
		new Notice(`Reading ${sentences.length} sentences...`);
		await this.controller.start(sentences, 0, this.settings.speed);
	}

	private stopPlayback(): void {
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

		// Web Speech
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
		toolbar.onStop = () => this.stopPlayback();
		toolbar.onPrev = () => controller.skipBackward(this.settings.speed);
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
			this.stopPlayback();
		};
	}

	private changeSpeed(delta: number): void {
		let newSpeed =
			Math.round((this.settings.speed + delta) * 100) / 100;
		newSpeed = Math.max(SPEED_MIN, Math.min(SPEED_MAX, newSpeed));
		this.settings.speed = newSpeed;
		this.saveSettings();
		this.controller?.setSpeed(newSpeed);
		this.toolbar?.updateSpeed(newSpeed);
		new Notice(`Speed: ${newSpeed}x`);
	}
}
