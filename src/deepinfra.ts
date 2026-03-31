import { requestUrl } from "obsidian";
import type { TTSEngine, VoiceOption } from "./types";

const API_BASE = "https://api.deepinfra.com/v1/inference";

/**
 * TTS engine backed by DeepInfra's hosted TTS models.
 *
 * Fetches audio for each sentence via the DeepInfra inference API, then
 * plays it through an HTMLAudioElement. Supports pre-buffering the next
 * sentence(s) while the current one is playing.
 */
export class DeepInfraEngine implements TTSEngine {
	private audio: HTMLAudioElement | null = null;
	private _speaking = false;
	private _paused = false;
	private currentSpeed = 1.0;
	private apiKey: string;
	private model: string;
	private aborted = false;

	/** Pre-fetched audio blobs keyed by sentence text */
	private preBufferCache = new Map<string, Blob>();
	/** Sentences queued for pre-buffering */
	private preBufferQueue: string[] = [];

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
		this.currentSpeed = speed;
		if (this.audio) {
			this.audio.playbackRate = speed;
		}
	}

	/** Queue sentences for pre-buffering. Call this with upcoming sentences. */
	preBuffer(sentences: string[]): void {
		this.preBufferQueue = sentences;
		for (const text of sentences) {
			if (!this.preBufferCache.has(text)) {
				this.fetchAudioBlob(text).then((blob) => {
					if (blob) this.preBufferCache.set(text, blob);
				});
			}
		}
	}

	async speak(text: string, speed: number): Promise<void> {
		this.aborted = false;

		// Use pre-buffered audio if available
		let blob: Blob | null = this.preBufferCache.get(text) ?? null;
		this.preBufferCache.delete(text);

		if (!blob) {
			blob = await this.fetchAudioBlob(text);
		}

		if (!blob || this.aborted) {
			return;
		}

		return this.playBlob(blob, speed);
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
		this.aborted = true;
		if (this.audio) {
			this.audio.pause();
			this.audio.removeAttribute("src");
			this.audio.load();
			this.audio = null;
		}
		this._speaking = false;
		this._paused = false;
		this.preBufferCache.clear();
	}

	async getVoices(): Promise<VoiceOption[]> {
		// DeepInfra models have model-specific voice options;
		// return a sensible default list per model.
		return [
			{ id: "default", name: "Default", lang: "en" },
		];
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

			// Model-specific parameters
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

			// Response format varies by model. Handle common cases:
			const contentType =
				response.headers["content-type"] || "application/json";

			if (contentType.includes("audio/")) {
				// Direct binary audio response
				return new Blob([response.arrayBuffer], { type: contentType });
			}

			// JSON response — look for base64-encoded audio
			let json: Record<string, unknown>;
			try {
				json = response.json;
			} catch {
				// If JSON parsing fails, treat as binary audio
				return new Blob([response.arrayBuffer], { type: "audio/mp3" });
			}

			if (typeof json.audio === "string") {
				const binaryStr = atob(json.audio);
				const bytes = new Uint8Array(binaryStr.length);
				for (let i = 0; i < binaryStr.length; i++) {
					bytes[i] = binaryStr.charCodeAt(i);
				}
				const audioType =
					(json.content_type as string) || "audio/wav";
				return new Blob([bytes], { type: audioType });
			}

			if (typeof json.audio_url === "string") {
				const audioResp = await requestUrl({
					url: json.audio_url as string,
				});
				return new Blob([audioResp.arrayBuffer], {
					type: "audio/mp3",
				});
			}

			// Try treating the whole response as audio
			return new Blob([response.arrayBuffer], { type: "audio/mp3" });
		} catch (e) {
			console.error("DeepInfra TTS fetch failed:", e);
			return null;
		}
	}

	private playBlob(blob: Blob, speed: number): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const url = URL.createObjectURL(blob);
			const audio = new Audio(url);
			audio.playbackRate = speed;
			this.audio = audio;
			this._speaking = true;
			this._paused = false;

			audio.onended = () => {
				URL.revokeObjectURL(url);
				this._speaking = false;
				this._paused = false;
				this.audio = null;
				resolve();
			};

			audio.onerror = () => {
				URL.revokeObjectURL(url);
				this._speaking = false;
				this._paused = false;
				this.audio = null;
				reject(new Error("Audio playback failed"));
			};

			audio.play().catch((err) => {
				URL.revokeObjectURL(url);
				this._speaking = false;
				this.audio = null;
				reject(err);
			});
		});
	}
}
