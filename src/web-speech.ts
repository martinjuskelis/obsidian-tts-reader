import type { TTSEngine, VoiceOption } from "./types";

/**
 * TTS engine backed by the browser/OS Web Speech API.
 *
 * Speaks one utterance at a time. Each call to speak() returns a Promise
 * that resolves when the utterance finishes (or rejects on error/cancel).
 *
 * Handles two platform quirks:
 * - Chrome/Electron: speechSynthesis.speak() silently fails if called too
 *   long after user interaction. Workaround: cancel() before each speak().
 * - Android: getVoices() returns [] until the "voiceschanged" event fires.
 */
export class WebSpeechEngine implements TTSEngine {
	private utterance: SpeechSynthesisUtterance | null = null;
	private _speaking = false;
	private _paused = false;
	private selectedVoiceURI = "";
	private currentSpeed = 1.0;
	private resolveSpeak: (() => void) | null = null;
	private rejectSpeak: ((reason: unknown) => void) | null = null;

	/** Chrome bug workaround: periodic pause/resume keeps long text alive. */
	private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

	get speaking(): boolean {
		return this._speaking;
	}
	get paused(): boolean {
		return this._paused;
	}

	setVoice(voiceURI: string): void {
		this.selectedVoiceURI = voiceURI;
	}

	setSpeed(speed: number): void {
		this.currentSpeed = speed;
		// Speed can't be changed mid-utterance with Web Speech API,
		// but it will apply to the next sentence.
	}

	async speak(text: string, speed: number): Promise<void> {
		// Cancel any in-progress utterance (also works around Chrome bug)
		speechSynthesis.cancel();
		this.clearKeepAlive();

		return new Promise<void>((resolve, reject) => {
			this.resolveSpeak = resolve;
			this.rejectSpeak = reject;

			const utterance = new SpeechSynthesisUtterance(text);
			utterance.rate = speed;

			// Find the selected voice
			if (this.selectedVoiceURI) {
				const voices = speechSynthesis.getVoices();
				const voice = voices.find(
					(v) => v.voiceURI === this.selectedVoiceURI,
				);
				if (voice) utterance.voice = voice;
			}

			utterance.onend = () => {
				this.clearKeepAlive();
				this._speaking = false;
				this._paused = false;
				this.resolveSpeak?.();
				this.resolveSpeak = null;
				this.rejectSpeak = null;
			};

			utterance.onerror = (event) => {
				this.clearKeepAlive();
				this._speaking = false;
				this._paused = false;
				// "interrupted" and "canceled" are normal when we call stop/skip
				if (
					event.error === "interrupted" ||
					event.error === "canceled"
				) {
					this.resolveSpeak?.();
				} else {
					this.rejectSpeak?.(
						new Error(`Speech synthesis error: ${event.error}`),
					);
				}
				this.resolveSpeak = null;
				this.rejectSpeak = null;
			};

			this.utterance = utterance;
			this._speaking = true;
			this._paused = false;
			speechSynthesis.speak(utterance);

			// Chrome/Electron: keep the synthesis alive by periodic pause/resume
			this.keepAliveTimer = setInterval(() => {
				if (speechSynthesis.speaking && !speechSynthesis.paused) {
					speechSynthesis.pause();
					speechSynthesis.resume();
				}
			}, 10_000);
		});
	}

	pause(): void {
		if (this._speaking && !this._paused) {
			speechSynthesis.pause();
			this._paused = true;
		}
	}

	resume(): void {
		if (this._speaking && this._paused) {
			speechSynthesis.resume();
			this._paused = false;
		}
	}

	stop(): void {
		this.clearKeepAlive();
		speechSynthesis.cancel();
		this._speaking = false;
		this._paused = false;
		// resolve is handled by the onerror/onend handler with "canceled"
	}

	async getVoices(): Promise<VoiceOption[]> {
		if (typeof speechSynthesis === "undefined") return [];

		let voices = speechSynthesis.getVoices();
		if (voices.length === 0) {
			voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
				const onVoices = () => resolve(speechSynthesis.getVoices());
				speechSynthesis.addEventListener("voiceschanged", onVoices, {
					once: true,
				});
				setTimeout(() => resolve(speechSynthesis.getVoices()), 2000);
			});
		}

		return voices.map((v) => ({
			id: v.voiceURI,
			name: v.name,
			lang: v.lang,
		}));
	}

	private clearKeepAlive(): void {
		if (this.keepAliveTimer !== null) {
			clearInterval(this.keepAliveTimer);
			this.keepAliveTimer = null;
		}
	}
}
