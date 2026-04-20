import type { TTSEngine, SentenceInfo, PlaybackState } from "./types";
import type { Highlighter } from "./highlighter";
import type { DeepInfraEngine } from "./deepinfra";
import type { SentenceContext } from "./reader";

export class PlaybackController {
	private _sentences: SentenceInfo[] = [];
	private currentIndex = -1;
	private _state: PlaybackState = "idle";
	private engine: TTSEngine;
	private highlighter: Highlighter;
	private autoScroll: boolean;
	private generation = 0;
	private resumeResolve: (() => void) | null = null;
	private _speed = 1.0;
	private _bufferAhead = 5;
	private consecutiveErrors = 0;
	private static readonly MAX_CONSECUTIVE_ERRORS = 3;

	onStateChange?: (state: PlaybackState) => void;
	onSentenceChange?: (index: number, total: number) => void;
	onComplete?: () => void;
	onError?: (message: string) => void;
	/**
	 * Fires before each sentence is highlighted. Returning a Promise pauses
	 * the loop until the handler settles — readers use this to navigate
	 * (e.g. scroll a PDF page in, await textlayerrendered) before the
	 * Highlighter runs.
	 */
	onBeforeSentence?: (ctx: SentenceContext) => Promise<void> | void;

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
		this._speed = speed;
		this.engine.setSpeed(speed);
		this.setState("playing");
		await this.runLoop();
	}

	async pause(): Promise<void> {
		if (this._state === "playing") {
			this.engine.pause();
			this.setState("paused");
		}
	}

	async resume(speed: number): Promise<void> {
		if (this._state === "paused") {
			this._speed = speed;
			this.engine.setSpeed(speed);
			this.engine.resume();
			this.setState("playing");
			this.resumeResolve?.();
			this.resumeResolve = null;
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
		this.generation++;
		this.engine.stop();
		this.highlighter.clear();
		this.currentIndex = -1;
		this._sentences = [];
		this.resumeResolve?.();
		this.resumeResolve = null;
		this.setState("idle");
	}

	async skipForward(speed: number): Promise<void> {
		if (this._sentences.length === 0) return;
		if (this.currentIndex < this._sentences.length - 1) {
			this.generation++;
			this.engine.stop();
			this.currentIndex++;
			this._speed = speed;
			this.resumeResolve?.();
			this.resumeResolve = null;
			this.setState("playing");
			await this.runLoop();
		}
	}

	async skipBackward(speed: number): Promise<void> {
		if (this._sentences.length === 0) return;
		if (this.currentIndex > 0) {
			this.generation++;
			this.engine.stop();
			this.currentIndex--;
			this._speed = speed;
			this.resumeResolve?.();
			this.resumeResolve = null;
			this.setState("playing");
			await this.runLoop();
		}
	}

	async jumpTo(index: number, speed: number): Promise<void> {
		if (index < 0 || index >= this._sentences.length) return;
		this.generation++;
		this.engine.stop();
		this.currentIndex = index;
		this._speed = speed;
		this.resumeResolve?.();
		this.resumeResolve = null;
		this.setState("playing");
		await this.runLoop();
	}

	/** Update speed — applies to the NEXT sentence and all subsequent ones. */
	setSpeed(speed: number): void {
		this._speed = speed;
		this.engine.setSpeed(speed);
	}

	setAutoScroll(enabled: boolean): void {
		this.autoScroll = enabled;
	}

	setBufferAhead(n: number): void {
		this._bufferAhead = n;
	}

	// --- Internal ---

	private async runLoop(): Promise<void> {
		const gen = ++this.generation;

		while (
			this.currentIndex < this._sentences.length &&
			gen === this.generation
		) {
			const sentence = this._sentences[this.currentIndex];

			if (this.onBeforeSentence) {
				try {
					await this.onBeforeSentence({
						index: this.currentIndex,
						sentence,
					});
				} catch (err) {
					console.error("TTS Reader: onBeforeSentence error:", err);
				}
				if (gen !== this.generation) return;
			}

			this.onSentenceChange?.(this.currentIndex, this._sentences.length);
			this.highlighter.setProgress(this.currentIndex, this._sentences.length);
			this.highlighter.highlight(sentence, this.autoScroll);
			this.preBufferNext();

			try {
				await this.engine.speak(sentence.text, this._speed);
				this.consecutiveErrors = 0; // success resets counter
			} catch (err) {
				this.consecutiveErrors++;
				console.error(
					`TTS speak error (${this.consecutiveErrors}/${PlaybackController.MAX_CONSECUTIVE_ERRORS}):`,
					err,
				);
				if (
					this.consecutiveErrors >=
					PlaybackController.MAX_CONSECUTIVE_ERRORS
				) {
					this.onError?.(
						`Stopped after ${this.consecutiveErrors} consecutive errors. Check your TTS settings.`,
					);
					this.highlighter.clear();
					this.setState("idle");
					this.onComplete?.();
					return;
				}
			}

			if (gen !== this.generation) return;

			if (this._state === "paused") {
				await new Promise<void>((resolve) => {
					this.resumeResolve = resolve;
				});
				if (gen !== this.generation) return;
			}

			this.currentIndex++;
		}

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
		// Scale buffer with speed — at 3x you need ~3x more buffered
		const speedFactor = Math.max(1, Math.ceil(this._speed));
		const lookAhead = this._bufferAhead * speedFactor + 1;
		for (
			let i = this.currentIndex + 1;
			i < Math.min(this.currentIndex + lookAhead, this._sentences.length);
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
