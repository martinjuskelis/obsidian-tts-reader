import type { TTSEngine, VoiceOption } from "./types";

/**
 * TTS engine backed by the browser/OS Web Speech API.
 *
 * Each call to speak() creates a self-contained Promise whose
 * resolve/reject are captured in a closure tied to that specific
 * utterance — no shared slots that a later call can clobber.
 *
 * An AbortController provides a reliable "force-resolve" path:
 * when stop() or a new speak() is called, the abort signal fires
 * and the pending promise resolves immediately, even if the browser
 * never dispatches onend/onerror for the cancelled utterance.
 */
export class WebSpeechEngine implements TTSEngine {
	private _speaking = false;
	private _paused = false;
	private selectedVoiceURI = "";
	private currentUtterance: SpeechSynthesisUtterance | null = null;
	private ac: AbortController | null = null;

	get speaking(): boolean {
		return this._speaking;
	}
	get paused(): boolean {
		return this._paused;
	}

	setVoice(voiceURI: string): void {
		this.selectedVoiceURI = voiceURI;
	}

	setSpeed(_speed: number): void {
		// Web Speech API rate is set per-utterance at speak() time.
	}

	async speak(text: string, speed: number): Promise<void> {
		// 1. Kill anything still in the queue / in progress.
		speechSynthesis.cancel();
		this.ac?.abort(); // force-resolve the previous promise

		// 2. Fresh abort controller for THIS utterance.
		const ac = new AbortController();
		this.ac = ac;

		return new Promise<void>((resolve, reject) => {
			// ---- settled guard: first callback wins ----
			let settled = false;
			const finish = () => {
				if (settled) return;
				settled = true;
				if (this.currentUtterance === utterance) {
					this._speaking = false;
					this._paused = false;
					this.currentUtterance = null;
				}
				resolve();
			};

			// If stop()/skip() aborts us, resolve immediately.
			ac.signal.addEventListener("abort", finish, { once: true });

			const utterance = new SpeechSynthesisUtterance(text);
			utterance.rate = speed;

			// Pick voice
			if (this.selectedVoiceURI) {
				const voices = speechSynthesis.getVoices();
				const v = voices.find(
					(v) => v.voiceURI === this.selectedVoiceURI,
				);
				if (v) utterance.voice = v;
			}

			utterance.onend = finish;

			utterance.onerror = (event) => {
				if (settled) return;
				if (
					event.error === "interrupted" ||
					event.error === "canceled"
				) {
					finish();
				} else {
					settled = true;
					if (this.currentUtterance === utterance) {
						this._speaking = false;
						this._paused = false;
						this.currentUtterance = null;
					}
					reject(
						new Error(`Speech synthesis error: ${event.error}`),
					);
				}
			};

			this.currentUtterance = utterance;
			this._speaking = true;
			this._paused = false;
			speechSynthesis.speak(utterance);
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
		speechSynthesis.cancel();
		this.ac?.abort();
		this.ac = null;
		this._speaking = false;
		this._paused = false;
		this.currentUtterance = null;
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
}
