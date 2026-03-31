import { Notice } from "obsidian";
import type { TTSEngine, VoiceOption } from "./types";

/**
 * Local TTS engine using Piper (WASM).
 *
 * Runs entirely in the browser — no cloud API, no API key.
 * Downloads the voice model (~63 MB) on first use from HuggingFace,
 * caches it via OPFS for subsequent sessions.
 *
 * Uses @mintplex-labs/piper-tts-web which loads ONNX Runtime
 * and Piper phonemize WASM from CDN at runtime.
 */

// Lazy-imported to avoid loading WASM until actually needed
let tts: typeof import("@mintplex-labs/piper-tts-web") | null = null;

async function getTts() {
	if (!tts) {
		tts = await import("@mintplex-labs/piper-tts-web");
	}
	return tts;
}

export const PIPER_VOICES: { id: string; name: string }[] = [
	{ id: "en_US-hfc_male-medium", name: "HFC Male (American)" },
	{ id: "en_US-lessac-medium", name: "Lessac (American)" },
	{ id: "en_US-joe-medium", name: "Joe (American)" },
	{ id: "en_US-bryce-medium", name: "Bryce (American)" },
	{ id: "en_US-john-medium", name: "John (American)" },
	{ id: "en_US-kusal-medium", name: "Kusal (American)" },
	{ id: "en_GB-northern_english_male-medium", name: "Northern Male (British)" },
	{ id: "en_GB-alan-medium", name: "Alan (British)" },
	{ id: "en_US-lessac-low", name: "Lessac Low (American, faster)" },
	{ id: "en_US-hfc_female-medium", name: "HFC Female (American)" },
	{ id: "en_US-amy-medium", name: "Amy (American)" },
];

export class PiperEngine implements TTSEngine {
	private audio: HTMLAudioElement | null = null;
	private _speaking = false;
	private _paused = false;
	private ac: AbortController | null = null;
	private modelReady = false;
	voice = "en_US-hfc_male-medium";
	debug = false;

	get speaking(): boolean {
		return this._speaking;
	}
	get paused(): boolean {
		return this._paused;
	}

	setSpeed(speed: number): void {
		if (this.audio) {
			this.audio.playbackRate = speed;
		}
	}

	async speak(text: string, speed: number): Promise<void> {
		this.ac?.abort();
		const ac = new AbortController();
		this.ac = ac;

		try {
			const piperTts = await getTts();

			// Download model on first use
			if (!this.modelReady) {
				new Notice(
					"TTS Reader: Downloading Piper voice model (~63 MB, first time only)...",
					10000,
				);
				try {
					await piperTts.download(this.voice, (progress) => {
						if (this.debug && progress.total > 0) {
							const pct = Math.round(
								(progress.loaded / progress.total) * 100,
							);
							console.log(`Piper model download: ${pct}%`);
						}
					});
				} catch {
					// download() may fail if model is already cached
					// or if OPFS isn't available — predict() will try anyway
				}
				this.modelReady = true;
			}

			if (ac.signal.aborted) return;

			// Generate WAV blob
			const wav = await piperTts.predict({
				text,
				voiceId: this.voice,
			});

			if (ac.signal.aborted) return;

			return this.playBlob(wav, speed, ac.signal);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error("Piper TTS error:", msg);
			if (msg.includes("dynamically imported module") || msg.includes("no available backend")) {
				new Notice(
					"TTS Reader: Piper can't load on this platform (WASM blocked). " +
						"Switch to DeepInfra in Settings > TTS Reader.",
					10000,
				);
			} else if (this.debug) {
				new Notice(`TTS Reader: Piper error: ${msg}`);
			}
			throw e;
		}
	}

	pause(): void {
		if (this.audio && this._speaking && !this._paused) {
			this.audio.pause();
			this._paused = true;
		}
	}

	resume(): void {
		if (this.audio && this._speaking && this._paused) {
			this.audio.play();
			this._paused = false;
		}
	}

	stop(): void {
		this.ac?.abort();
		this.ac = null;
		if (this.audio) {
			this.audio.pause();
			this.audio.src = "";
			this.audio = null;
		}
		this._speaking = false;
		this._paused = false;
	}

	async getVoices(): Promise<VoiceOption[]> {
		return PIPER_VOICES.map((v) => ({
			id: v.id,
			name: v.name,
			lang: "en",
		}));
	}

	/** Reset model readiness when voice changes. */
	setVoice(voiceId: string): void {
		if (voiceId !== this.voice) {
			this.voice = voiceId;
			this.modelReady = false;
		}
	}

	private playBlob(
		blob: Blob,
		speed: number,
		signal: AbortSignal,
	): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const url = URL.createObjectURL(blob);
			let settled = false;

			const finish = () => {
				if (settled) return;
				settled = true;
				audio.pause();
				audio.src = "";
				URL.revokeObjectURL(url);
				this._speaking = false;
				this._paused = false;
				this.audio = null;
				resolve();
			};

			signal.addEventListener("abort", finish, { once: true });

			const audio = new Audio(url);
			audio.playbackRate = speed;
			this.audio = audio;
			this._speaking = true;
			this._paused = false;

			audio.onended = finish;

			audio.onerror = () => {
				if (settled) return;
				settled = true;
				audio.pause();
				audio.src = "";
				URL.revokeObjectURL(url);
				this._speaking = false;
				this._paused = false;
				this.audio = null;
				reject(new Error("Piper audio playback failed"));
			};

			audio.play().catch((err) => {
				if (settled) return;
				settled = true;
				URL.revokeObjectURL(url);
				this._speaking = false;
				this.audio = null;
				reject(err);
			});
		});
	}
}
