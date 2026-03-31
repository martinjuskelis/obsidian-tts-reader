import type { TTSEngine, SentenceInfo, PlaybackState } from "./types";
import type { Highlighter } from "./highlighter";
import type { DeepInfraEngine } from "./deepinfra";

/**
 * Orchestrates TTS playback: drives the engine sentence-by-sentence,
 * highlights the current sentence, and handles user controls.
 *
 * Uses a generation counter to prevent concurrent speakCurrent loops
 * when the user skips forward/backward while a sentence is playing.
 */
export class PlaybackController {
	private _sentences: SentenceInfo[] = [];
	private currentIndex = -1;
	private _state: PlaybackState = "idle";
	private engine: TTSEngine;
	private highlighter: Highlighter;
	private autoScroll: boolean;
	private generation = 0;

	onStateChange?: (state: PlaybackState) => void;
	onSentenceChange?: (index: number, total: number) => void;
	onComplete?: () => void;

	constructor(
		engine: TTSEngine,
		highlighter: Highlighter,
		autoScroll: boolean,
	) {
		this.engine = engine;
		this.highlighter = highlighter;
		this.autoScroll = autoScroll;
	}

	get state(): PlaybackState {
		return this._state;
	}

	get sentenceIndex(): number {
		return this.currentIndex;
	}

	get sentenceCount(): number {
		return this._sentences.length;
	}

	get sentences(): readonly SentenceInfo[] {
		return this._sentences;
	}

	async start(
		sentences: SentenceInfo[],
		startIndex = 0,
		speed = 1.0,
	): Promise<void> {
		this._sentences = sentences;
		this.currentIndex = startIndex;
		this.engine.setSpeed(speed);
		this.setState("playing");
		await this.runLoop(speed);
	}

	async pause(): Promise<void> {
		if (this._state === "playing") {
			this.engine.pause();
			this.setState("paused");
		}
	}

	async resume(speed: number): Promise<void> {
		if (this._state === "paused") {
			this.engine.setSpeed(speed);
			this.engine.resume();
			this.setState("playing");
		}
	}

	async togglePlayPause(speed: number): Promise<void> {
		if (this._state === "playing") {
			await this.pause();
		} else if (this._state === "paused") {
			await this.resume(speed);
		}
	}

	stop(): void {
		this.generation++; // kill any running loop
		this.engine.stop();
		this.highlighter.clear();
		this.currentIndex = -1;
		this._sentences = [];
		this.setState("idle");
		this.onComplete?.();
	}

	async skipForward(speed: number): Promise<void> {
		if (this._sentences.length === 0) return;
		if (this.currentIndex < this._sentences.length - 1) {
			this.generation++; // kill the current loop
			this.engine.stop();
			this.currentIndex++;
			this.setState("playing");
			await this.runLoop(speed);
		}
	}

	async skipBackward(speed: number): Promise<void> {
		if (this._sentences.length === 0) return;
		if (this.currentIndex > 0) {
			this.generation++;
			this.engine.stop();
			this.currentIndex--;
			this.setState("playing");
			await this.runLoop(speed);
		}
	}

	/** Jump to an arbitrary sentence index (e.g. from click-to-read). */
	async jumpTo(index: number, speed: number): Promise<void> {
		if (index < 0 || index >= this._sentences.length) return;
		this.generation++;
		this.engine.stop();
		this.currentIndex = index;
		this.setState("playing");
		await this.runLoop(speed);
	}

	setSpeed(speed: number): void {
		this.engine.setSpeed(speed);
	}

	setAutoScroll(enabled: boolean): void {
		this.autoScroll = enabled;
	}

	// --- Internal ---

	/**
	 * Main playback loop. Captures the current generation so it can
	 * bail out if a newer loop has been started (by skip/jump/stop).
	 */
	private async runLoop(speed: number): Promise<void> {
		const gen = ++this.generation;

		while (
			this.currentIndex < this._sentences.length &&
			gen === this.generation
		) {
			const sentence = this._sentences[this.currentIndex];

			this.onSentenceChange?.(this.currentIndex, this._sentences.length);
			this.highlighter.highlight(sentence, this.autoScroll);
			this.preBufferNext();

			try {
				await this.engine.speak(sentence.text, speed);
			} catch (err) {
				console.error("TTS speak error:", err);
			}

			// If a newer generation started (skip/stop), exit silently
			if (gen !== this.generation) return;

			this.currentIndex++;
		}

		// Reached the end naturally
		if (gen === this.generation) {
			this.highlighter.clear();
			this.setState("idle");
			this.onComplete?.();
		}
	}

	private preBufferNext(): void {
		const engine = this.engine as DeepInfraEngine;
		if (typeof engine.preBuffer !== "function") return;

		const upcoming: string[] = [];
		for (
			let i = this.currentIndex + 1;
			i < Math.min(this.currentIndex + 3, this._sentences.length);
			i++
		) {
			upcoming.push(this._sentences[i].text);
		}
		if (upcoming.length > 0) {
			engine.preBuffer(upcoming);
		}
	}

	private setState(state: PlaybackState): void {
		if (this._state !== state) {
			this._state = state;
			this.onStateChange?.(state);
		}
	}
}
