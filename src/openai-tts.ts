import { requestUrl } from "obsidian";
import type { TTSEngine, VoiceOption } from "./types";

/**
 * TTS engine backed by OpenAI's /v1/audio/speech endpoint.
 * Supports tts-1, tts-1-hd, and gpt-4o-mini-tts.
 * Returns MP3 audio directly.
 */
export class OpenAIEngine implements TTSEngine {
	private audio: HTMLAudioElement | null = null;
	private _speaking = false;
	private _paused = false;
	private ac: AbortController | null = null;
	debug = false;

	private apiKey: string;
	model = "tts-1";
	voice = "nova";

	private preBufferCache = new Map<string, Blob>();

	constructor(apiKey: string) {
		this.apiKey = apiKey;
	}

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

	preBuffer(sentences: string[]): void {
		for (const text of sentences) {
			if (!this.preBufferCache.has(text)) {
				this.fetchAudio(text).then((blob) => {
					if (blob) this.preBufferCache.set(text, blob);
				});
			}
		}
	}

	async speak(text: string, speed: number): Promise<void> {
		this.ac?.abort();
		const ac = new AbortController();
		this.ac = ac;

		let blob: Blob | null = this.preBufferCache.get(text) ?? null;
		this.preBufferCache.delete(text);

		if (!blob) {
			blob = await this.fetchAudio(text);
		}

		if (ac.signal.aborted) return;

		if (!blob) {
			throw new Error("OpenAI TTS returned no audio");
		}

		return this.playBlob(blob, speed, ac.signal);
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
		this.preBufferCache.clear();
	}

	async getVoices(): Promise<VoiceOption[]> {
		return [{ id: "default", name: "Default", lang: "en" }];
	}

	updateConfig(apiKey: string): void {
		this.apiKey = apiKey;
		this.preBufferCache.clear();
	}

	// --- Private ---

	private async fetchAudio(text: string): Promise<Blob | null> {
		if (!this.apiKey) return null;

		try {
			const response = await requestUrl({
				url: "https://api.openai.com/v1/audio/speech",
				method: "POST",
				headers: {
					"Authorization": `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: this.model,
					input: text,
					voice: this.voice,
					response_format: "mp3",
				}),
			});

			return new Blob([response.arrayBuffer], { type: "audio/mpeg" });
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error("OpenAI TTS fetch failed:", msg);
			return null;
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
				audio.src = "";
				URL.revokeObjectURL(url);
				this._speaking = false;
				this._paused = false;
				this.audio = null;
				reject(new Error("Audio playback failed"));
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
