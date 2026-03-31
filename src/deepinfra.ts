import { Notice, requestUrl } from "obsidian";
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
	debug = false;
	voice = "af_heart";
	voiceParam = "preset_voice";

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

		if (ac.signal.aborted) return;

		if (!blob) {
			if (this.debug) {
				new Notice("TTS Reader: DeepInfra returned no audio. Check the developer console (Ctrl+Shift+I) for details.");
			}
			return;
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
			};

			// Use the model-specific voice parameter name
			if (this.voice && this.voiceParam) {
				payload[this.voiceParam] = this.voice;
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

			// Direct binary audio response
			if (contentType.includes("audio/")) {
				return new Blob([response.arrayBuffer], { type: contentType });
			}

			// JSON response — try multiple fields where audio data might live
			let json: Record<string, unknown>;
			try {
				json = response.json;
			} catch {
				// Not valid JSON — treat entire response as audio
				return new Blob([response.arrayBuffer], { type: "audio/wav" });
			}

			// Check string fields that might contain audio data
			const audioStr =
				typeof json.audio === "string"
					? json.audio
					: typeof json.output === "string"
						? json.output
						: null;

			if (audioStr) {
				return this.decodeAudioString(
					audioStr,
					(json.content_type as string) || "audio/wav",
				);
			}

			// URL to audio file
			if (typeof json.audio_url === "string") {
				const audioResp = await requestUrl({
					url: json.audio_url as string,
				});
				return new Blob([audioResp.arrayBuffer], { type: "audio/mp3" });
			}

			if (typeof json.output_url === "string") {
				const audioResp = await requestUrl({
					url: json.output_url as string,
				});
				return new Blob([audioResp.arrayBuffer], { type: "audio/mp3" });
			}

			if (this.debug) {
				console.error(
					"DeepInfra TTS: unexpected response format.",
					"Content-Type:", contentType,
					"Response keys:", Object.keys(json),
					"Response (first 500 chars):", JSON.stringify(json).substring(0, 500),
				);
				new Notice("TTS Reader: Unexpected response from DeepInfra. See console for details.");
			}
			return null;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error("DeepInfra TTS fetch failed:", msg);
			// Always show API errors (auth failures, network, etc.)
			new Notice(`TTS Reader: DeepInfra error: ${msg}`);
			return null;
		}
	}

	/**
	 * Decode an audio string which may be:
	 * - A data URI: data:audio/wav;base64,AAAA...
	 * - Raw base64: AAAA...
	 * - A URL: https://...
	 */
	private async decodeAudioString(
		str: string,
		fallbackType: string,
	): Promise<Blob | null> {
		// Data URI (e.g., data:audio/wav;base64,...)
		const dataUriMatch = str.match(
			/^data:([^;]+);base64,(.+)$/s,
		);
		if (dataUriMatch) {
			const mime = dataUriMatch[1];
			const b64 = dataUriMatch[2];
			return this.base64ToBlob(b64, mime);
		}

		// URL
		if (str.startsWith("http://") || str.startsWith("https://")) {
			const resp = await requestUrl({ url: str });
			return new Blob([resp.arrayBuffer], { type: "audio/mp3" });
		}

		// Raw base64
		return this.base64ToBlob(str, fallbackType);
	}

	private base64ToBlob(b64: string, mime: string): Blob | null {
		try {
			const binaryStr = atob(b64);
			const bytes = new Uint8Array(binaryStr.length);
			for (let i = 0; i < binaryStr.length; i++) {
				bytes[i] = binaryStr.charCodeAt(i);
			}
			return new Blob([bytes], { type: mime });
		} catch (e) {
			console.error("Failed to decode base64 audio:", e);
			if (this.debug) {
				console.error(
					"Audio string preview (first 200 chars):",
					b64.substring(0, 200),
				);
			}
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
