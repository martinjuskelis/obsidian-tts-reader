import type { TTSEngine, SentenceInfo, PlaybackState } from "./types";
import type { Highlighter } from "./highlighter";
import type { DeepInfraEngine } from "./deepinfra";

/**
 * Orchestrates TTS playback: drives the engine sentence-by-sentence,
 * highlights the current sentence, and handles user controls.
 */
export class PlaybackController {
	private sentences: SentenceInfo[] = [];
	private currentIndex = -1;
	private _state: PlaybackState = "idle";
	private engine: TTSEngine;
	private highlighter: Highlighter;
	private autoScroll: boolean;
	private stopped = false;

	/** Fired when play/pause/idle state changes */
	onStateChange?: (state: PlaybackState) => void;
	/** Fired when advancing to a new sentence */
	onSentenceChange?: (index: number, total: number) => void;
	/** Fired when playback reaches the end or is stopped */
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
		return this.sentences.length;
	}

	/** Start playback from the beginning (or a specific sentence index). */
	async start(
		sentences: SentenceInfo[],
		startIndex = 0,
		speed = 1.0,
	): Promise<void> {
		this.sentences = sentences;
		this.currentIndex = startIndex;
		this.stopped = false;
		this.setState("playing");
		this.engine.setSpeed(speed);
		await this.speakCurrent(speed);
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
		this.stopped = true;
		this.engine.stop();
		this.highlighter.clear();
		this.currentIndex = -1;
		this.sentences = [];
		this.setState("idle");
		this.onComplete?.();
	}

	/** Skip to the next sentence. */
	async skipForward(speed: number): Promise<void> {
		if (this.sentences.length === 0) return;
		if (this.currentIndex < this.sentences.length - 1) {
			this.engine.stop();
			this.currentIndex++;
			this.stopped = false;
			this.setState("playing");
			await this.speakCurrent(speed);
		}
	}

	/** Skip to the previous sentence. */
	async skipBackward(speed: number): Promise<void> {
		if (this.sentences.length === 0) return;
		if (this.currentIndex > 0) {
			this.engine.stop();
			this.currentIndex--;
			this.stopped = false;
			this.setState("playing");
			await this.speakCurrent(speed);
		}
	}

	/** Update speed (applies to the next sentence for Web Speech, immediately for DeepInfra). */
	setSpeed(speed: number): void {
		this.engine.setSpeed(speed);
	}

	setAutoScroll(enabled: boolean): void {
		this.autoScroll = enabled;
	}

	// --- Internal ---

	private async speakCurrent(speed: number): Promise<void> {
		while (
			this.currentIndex < this.sentences.length &&
			!this.stopped
		) {
			const sentence = this.sentences[this.currentIndex];

			// Notify UI
			this.onSentenceChange?.(
				this.currentIndex,
				this.sentences.length,
			);

			// Highlight
			this.highlighter.highlight(sentence, this.autoScroll);

			// Pre-buffer next sentences for DeepInfra
			this.preBufferNext();

			// Speak this sentence
			try {
				await this.engine.speak(sentence.text, speed);
			} catch (err) {
				console.error("TTS speak error:", err);
				// Don't stop on individual sentence errors; skip to next
			}

			if (this.stopped || this._state === "idle") return;

			// Advance to next sentence
			this.currentIndex++;
		}

		// Reached the end
		if (!this.stopped) {
			this.highlighter.clear();
			this.setState("idle");
			this.onComplete?.();
		}
	}

	private preBufferNext(): void {
		// Only applies to DeepInfra engine
		const engine = this.engine as DeepInfraEngine;
		if (typeof engine.preBuffer !== "function") return;

		const upcoming: string[] = [];
		for (
			let i = this.currentIndex + 1;
			i < Math.min(this.currentIndex + 3, this.sentences.length);
			i++
		) {
			upcoming.push(this.sentences[i].text);
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
