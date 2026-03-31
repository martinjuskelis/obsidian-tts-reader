import { requestUrl } from "obsidian";
import type { TTSEngine, VoiceOption } from "./types";

const API_BASE = "https://api.deepinfra.com/v1/inference";

/**
 * TTS engine backed by DeepInfra's hosted TTS models.
 *
 * Uses an AbortController so that stop()/skip() reliably resolves
 * the pending speak() promise (HTMLAudioElement doesn't fire onended
 * when you pause+remove it).
 */
export class DeepInfraEngine implements TTSEngine {
	private audio: HTMLAudioElement | null = null;
	private _speaking = false;
	private _paused = false;
	private apiKey: string;
	private model: string;
	private ac: AbortController | null = null;

	/** Pre-fetched audio blobs keyed by sentence text */
	private preBufferCache = new Map<string, Blob>();

	constructor(apiKey: string, model: string) {
		this.apiKey = apiKey;
		this.model = model;
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

	/** Queue sentences for pre-buffering. */
	preBuffer(sentences: string[]): void {
		for (const text of sentences) {
			if (!this.preBufferCache.has(text)) {
				this.fetchAudioBlob(text).then((blob) => {
					if (blob) this.preBufferCache.set(text, blob);
				});
			}
		}
	}

	async speak(text: string, speed: number): Promise<void> {
		this.ac?.abort();
		const ac = new AbortController();
		this.ac = ac;

		// Use pre-buffered audio if available
		let blob: Blob | null = this.preBufferCache.get(text) ?? null;
		this.preBufferCache.delete(text);

		if (!blob) {
			blob = await this.fetchAudioBlob(text);
		}

		if (!blob || ac.signal.aborted) return;

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
			this.audio = null;
		}
		this._speaking = false;
		this._paused = false;
		this.preBufferCache.clear();
	}

	async getVoices(): Promise<VoiceOption[]> {
		return [{ id: "default", name: "Default", lang: "en" }];
	}

	updateConfig(apiKey: string, model: string): void {
		this.apiKey = apiKey;
		this.model = model;
		this.preBufferCache.clear();
	}

	// --- Private ---

	private async fetchAudioBlob(text: string): Promise<Blob | null> {
		if (!this.apiKey) return null;

		try {
			const payload: Record<string, unknown> = {
				text,
				output_format: "mp3",
			};

			if (this.model === "hexgrad/Kokoro-82M") {
				payload.preset_voice = "af_heart";
			}

			const response = await requestUrl({
				url: `${API_BASE}/${this.model}`,
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(payload),
			});

			const contentType =
				response.headers["content-type"] || "application/json";

			if (contentType.includes("audio/")) {
				return new Blob([response.arrayBuffer], { type: contentType });
			}

			let json: Record<string, unknown>;
			try {
				json = response.json;
			} catch {
				return new Blob([response.arrayBuffer], { type: "audio/mp3" });
			}

			if (typeof json.audio === "string") {
				const binaryStr = atob(json.audio);
				const bytes = new Uint8Array(binaryStr.length);
				for (let i = 0; i < binaryStr.length; i++) {
					bytes[i] = binaryStr.charCodeAt(i);
				}
				return new Blob([bytes], {
					type: (json.content_type as string) || "audio/wav",
				});
			}

			if (typeof json.audio_url === "string") {
				const audioResp = await requestUrl({
					url: json.audio_url as string,
				});
				return new Blob([audioResp.arrayBuffer], { type: "audio/mp3" });
			}

			return new Blob([response.arrayBuffer], { type: "audio/mp3" });
		} catch (e) {
			console.error("DeepInfra TTS fetch failed:", e);
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
				URL.revokeObjectURL(url);
				this._speaking = false;
				this._paused = false;
				this.audio = null;
				resolve();
			};

			// Abort signal: resolve immediately when stop/skip fires
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
