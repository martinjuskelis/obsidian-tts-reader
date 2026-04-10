import { requestUrl } from "obsidian";
import type { TTSEngine, VoiceOption } from "./types";

const GEMINI_TTS_URL =
	"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent";

/**
 * TTS engine backed by Google Gemini 2.5 Flash TTS.
 * Uses the Gemini API (simple API key from AI Studio).
 * Returns base64 PCM audio (16-bit LE, 24kHz, mono) which we wrap in WAV.
 */
export class GeminiTTSEngine implements TTSEngine {
	private audio: HTMLAudioElement | null = null;
	private _speaking = false;
	private _paused = false;
	private ac: AbortController | null = null;
	debug = false;

	private apiKey: string;
	voice = "Kore";

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
			throw new Error("Gemini TTS returned no audio");
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
				url: `${GEMINI_TTS_URL}?key=${this.apiKey}`,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					contents: [
						{
							parts: [{ text }],
						},
					],
					generationConfig: {
						responseModalities: ["AUDIO"],
						speechConfig: {
							voiceConfig: {
								prebuiltVoiceConfig: {
									voiceName: this.voice,
								},
							},
						},
					},
				}),
			});

			const data = response.json;
			const b64Audio =
				data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
			if (!b64Audio) {
				const errMsg =
					data?.error?.message ||
					"No audio data in response";
				console.error("Gemini TTS: " + errMsg);
				return null;
			}

			// Decode base64 PCM and wrap in WAV header
			const pcm = base64ToArrayBuffer(b64Audio);
			const wav = pcmToWav(pcm, 24000, 1, 16);
			return new Blob([wav], { type: "audio/wav" });
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error("Gemini TTS fetch failed:", msg);
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

// --- Utilities ---

function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const raw = atob(base64);
	const bytes = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) {
		bytes[i] = raw.charCodeAt(i);
	}
	return bytes.buffer;
}

/** Wrap raw PCM data in a WAV container. */
function pcmToWav(
	pcm: ArrayBuffer,
	sampleRate: number,
	channels: number,
	bitsPerSample: number,
): ArrayBuffer {
	const byteRate = sampleRate * channels * (bitsPerSample / 8);
	const blockAlign = channels * (bitsPerSample / 8);
	const dataSize = pcm.byteLength;
	const headerSize = 44;
	const buffer = new ArrayBuffer(headerSize + dataSize);
	const view = new DataView(buffer);

	// RIFF header
	writeString(view, 0, "RIFF");
	view.setUint32(4, 36 + dataSize, true);
	writeString(view, 8, "WAVE");

	// fmt chunk
	writeString(view, 12, "fmt ");
	view.setUint32(16, 16, true); // chunk size
	view.setUint16(20, 1, true); // PCM format
	view.setUint16(22, channels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitsPerSample, true);

	// data chunk
	writeString(view, 36, "data");
	view.setUint32(40, dataSize, true);

	// Copy PCM data
	new Uint8Array(buffer, headerSize).set(new Uint8Array(pcm));

	return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
	for (let i = 0; i < str.length; i++) {
		view.setUint8(offset + i, str.charCodeAt(i));
	}
}
