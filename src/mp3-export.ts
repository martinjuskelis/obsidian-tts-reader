import { Notice, TFile, requestUrl } from "obsidian";
import { Mp3Encoder } from "@breezystack/lamejs";
import { extractChunks } from "./text-extractor";
import {
	getActiveModelId,
	getModelSetting,
	type TTSReaderSettings,
	type SentenceInfo,
} from "./types";

// ---------------------------------------------------------------------------
// Export configuration per backend
// ---------------------------------------------------------------------------

/** Get export chunk size from per-model settings. */
function getExportChunkSize(settings: TTSReaderSettings): number {
	const modelId = getActiveModelId(settings);
	if (!modelId) return 0;
	return getModelSetting(settings, modelId, "exportChunkSize");
}

// ---------------------------------------------------------------------------
// Audio generation per backend
// ---------------------------------------------------------------------------

async function generateChunkAudio(
	text: string,
	settings: TTSReaderSettings,
): Promise<Blob> {
	const modelId = getActiveModelId(settings);
	const voice = getModelSetting(settings, modelId, "voice");

	switch (settings.backend) {
		case "gemini":
			return generateGemini(text, settings.geminiApiKey, voice);
		case "openai":
			return generateOpenAI(
				text,
				settings.openaiApiKey,
				settings.openaiModel,
				voice,
			);
		case "deepinfra":
			return generateDeepInfra(
				text,
				settings.deepinfraApiKey,
				settings.deepinfraModel,
				voice,
			);
		default:
			throw new Error(
				"MP3 export is not supported for the Web Speech backend.",
			);
	}
}

async function generateGemini(
	text: string,
	apiKey: string,
	voice: string,
): Promise<Blob> {
	const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
	const response = await requestUrl({
		url,
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			contents: [{ parts: [{ text }] }],
			generationConfig: {
				responseModalities: ["AUDIO"],
				speechConfig: {
					voiceConfig: {
						prebuiltVoiceConfig: { voiceName: voice },
					},
				},
			},
		}),
		throw: false,
	});

	if (response.status !== 200) {
		const detail =
			response.json?.error?.message ||
			response.text?.slice(0, 200) ||
			`HTTP ${response.status}`;
		throw new Error(`Gemini ${response.status}: ${detail}`);
	}

	const data = response.json;
	const parts = data?.candidates?.[0]?.content?.parts;
	if (!parts || parts.length === 0) {
		throw new Error(
			data?.error?.message || "Gemini returned no audio data",
		);
	}

	const pcmChunks: ArrayBuffer[] = [];
	for (const part of parts) {
		const b64 = part?.inlineData?.data;
		if (b64) pcmChunks.push(base64ToArrayBuffer(b64));
	}
	if (pcmChunks.length === 0) throw new Error("No audio in Gemini response");

	const pcm = concatBuffers(pcmChunks);
	const wav = pcmToWav(pcm, 24000, 1, 16);
	return new Blob([wav], { type: "audio/wav" });
}

async function generateOpenAI(
	text: string,
	apiKey: string,
	model: string,
	voice: string,
): Promise<Blob> {
	const response = await requestUrl({
		url: "https://api.openai.com/v1/audio/speech",
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model,
			input: text,
			voice,
			response_format: "mp3",
		}),
		throw: false,
	});

	if (response.status !== 200) {
		const detail =
			response.json?.error?.message ||
			response.text?.slice(0, 200) ||
			`HTTP ${response.status}`;
		throw new Error(`OpenAI ${response.status}: ${detail}`);
	}

	return new Blob([response.arrayBuffer], { type: "audio/mpeg" });
}

async function generateDeepInfra(
	text: string,
	apiKey: string,
	model: string,
	voice: string,
): Promise<Blob> {
	const response = await requestUrl({
		url: "https://api.deepinfra.com/v1/audio/speech",
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ model, input: text, voice }),
		throw: false,
	});

	if (response.status !== 200) {
		const detail =
			response.json?.error?.message ||
			response.text?.slice(0, 200) ||
			`HTTP ${response.status}`;
		throw new Error(`DeepInfra ${response.status}: ${detail}`);
	}

	const contentType = response.headers["content-type"] || "audio/wav";
	return new Blob([response.arrayBuffer], { type: contentType });
}

// ---------------------------------------------------------------------------
// Parallel chunk generation with concurrency limit and robust retry
// ---------------------------------------------------------------------------

const MAX_RETRIES = 50;
const CONCURRENCY = 10;

/** Classify errors to determine retry strategy. */
function isRateLimitError(err: string): boolean {
	return err.includes("429") || err.includes("rate") || err.includes("quota");
}

function isTransientError(err: string): boolean {
	return (
		isRateLimitError(err) ||
		err.includes("500") ||
		err.includes("502") ||
		err.includes("503") ||
		err.includes("504") ||
		err.includes("timeout") ||
		err.includes("ETIMEDOUT") ||
		err.includes("ECONNRESET") ||
		err.includes("network") ||
		err.includes("fetch")
	);
}

function getRetryDelay(attempt: number, errMsg: string): number {
	if (isRateLimitError(errMsg)) {
		// Rate limited: longer exponential backoff (5s, 15s, 45s, ...)
		return Math.min(5000 * Math.pow(3, attempt - 1), 60000);
	}
	// Transient error: standard backoff (2s, 4s, 8s, ...)
	return Math.min(2000 * Math.pow(2, attempt - 1), 30000);
}

async function generateOneChunkWithRetry(
	text: string,
	index: number,
	total: number,
	settings: TTSReaderSettings,
	onRetryStart: () => void,
	onRetryEnd: () => void,
): Promise<Blob> {
	let lastError = "";
	let wasRetrying = false;
	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
		try {
			const blob = await generateChunkAudio(text, settings);
			if (wasRetrying) onRetryEnd();
			return blob;
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err);
			const transient = isTransientError(lastError);

			if (attempt < MAX_RETRIES && transient) {
				if (!wasRetrying) {
					wasRetrying = true;
					onRetryStart();
				}
				const delay = getRetryDelay(attempt, lastError);
				console.warn(
					`MP3 Export: Chunk ${index + 1}/${total} attempt ${attempt}/${MAX_RETRIES} failed (${lastError}), retrying in ${delay / 1000}s`,
				);
				await sleep(delay);
				continue;
			}

			// Non-transient error or max retries exhausted
			if (wasRetrying) onRetryEnd();
			break;
		}
	}
	throw new Error(
		`Chunk ${index + 1}/${total} failed after ${MAX_RETRIES} attempts: ${lastError}`,
	);
}

async function generateAllChunks(
	chunks: SentenceInfo[],
	settings: TTSReaderSettings,
	concurrency: number,
	onProgress: (done: number, total: number, retrying: number, lastError: string) => void,
): Promise<Blob[]> {
	const total = chunks.length;
	const results: (Blob | null)[] = new Array(total).fill(null);
	let nextIndex = 0;
	let doneCount = 0;
	let retryingCount = 0;
	let lastError = "";

	return new Promise<Blob[]>((resolve, reject) => {
		let rejected = false;

		function report() {
			onProgress(doneCount, total, retryingCount, lastError);
		}

		function startNext() {
			if (rejected) return;
			if (nextIndex >= total) {
				if (doneCount === total) {
					resolve(results as Blob[]);
				}
				return;
			}

			const i = nextIndex++;
			generateOneChunkWithRetry(
				chunks[i].text,
				i,
				total,
				settings,
				() => { retryingCount++; report(); },
				() => { retryingCount = Math.max(0, retryingCount - 1); report(); },
			)
				.then((blob) => {
					results[i] = blob;
					doneCount++;
					report();
					startNext();
				})
				.catch((err) => {
					if (!rejected) {
						rejected = true;
						lastError = err instanceof Error ? err.message : String(err);
						reject(err);
					}
				});
		}

		// Launch initial batch
		const initialBatch = Math.min(concurrency, total);
		for (let i = 0; i < initialBatch; i++) {
			startNext();
		}
	});
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

export async function exportToMp3(
	file: TFile,
	markdown: string,
	settings: TTSReaderSettings,
	vault: { createBinary: (path: string, data: ArrayBuffer) => Promise<TFile> },
): Promise<string> {
	// Validate backend
	if (settings.backend === "webspeech") {
		throw new Error(
			"MP3 export requires a cloud TTS backend (OpenAI, Gemini, or DeepInfra). " +
				"Change your backend in Settings > TTS Reader.",
		);
	}

	const modelId = getActiveModelId(settings);
	if (!modelId) throw new Error("No model selected.");

	// Check API key
	if (settings.backend === "gemini" && !settings.geminiApiKey)
		throw new Error("Gemini API key not set.");
	if (settings.backend === "openai" && !settings.openaiApiKey)
		throw new Error("OpenAI API key not set.");
	if (settings.backend === "deepinfra" && !settings.deepinfraApiKey)
		throw new Error("DeepInfra API key not set.");

	// Chunk the document with max export size for best prosody
	const exportChunkSize = getExportChunkSize(settings);
	const chunks = extractChunks(
		markdown,
		settings.skipCodeBlocks,
		settings.skipFrontmatter,
		exportChunkSize,
		settings.stripFootnoteRefs,
	);

	if (chunks.length === 0) {
		throw new Error("No readable text found in this document.");
	}

	const notice = new Notice("", 0);

	// Generate audio for all chunks in parallel (with concurrency limit)
	const concurrency = settings.exportConcurrency;
	notice.setMessage(
		`MP3 Export: Generating audio for ${chunks.length} chunks (${concurrency} parallel)...`,
	);
	const audioBlobs = await generateAllChunks(
		chunks,
		settings,
		concurrency,
		(done, total, retrying, lastErr) => {
			let msg = `MP3 Export: ${done}/${total} chunks done`;
			if (retrying > 0) msg += ` (${retrying} retrying)`;
			if (lastErr) msg += `\nLast error: ${lastErr.slice(0, 100)}`;
			notice.setMessage(msg);
		},
	);

	// Decode all audio to PCM using AudioContext
	notice.setMessage("MP3 Export: Decoding audio...");
	const audioCtx = new AudioContext({ sampleRate: 24000 });
	const decodedBuffers: AudioBuffer[] = [];

	for (let i = 0; i < audioBlobs.length; i++) {
		const arrayBuf = await audioBlobs[i].arrayBuffer();
		try {
			const decoded = await audioCtx.decodeAudioData(arrayBuf.slice(0));
			decodedBuffers.push(decoded);
		} catch (err) {
			notice.hide();
			await audioCtx.close();
			throw new Error(
				`Failed to decode audio for chunk ${i + 1}: ${err instanceof Error ? err.message : err}`,
			);
		}
	}

	// Concatenate all decoded audio into one Float32Array
	notice.setMessage("MP3 Export: Concatenating...");
	const sampleRate = decodedBuffers[0]?.sampleRate ?? 24000;
	let totalFrames = 0;
	for (const buf of decodedBuffers) {
		totalFrames += buf.length;
	}

	const mergedFloat = new Float32Array(totalFrames);
	let offset = 0;
	for (const buf of decodedBuffers) {
		mergedFloat.set(buf.getChannelData(0), offset);
		offset += buf.length;
	}

	await audioCtx.close();

	// Encode to MP3
	notice.setMessage("MP3 Export: Encoding MP3...");
	const int16 = float32ToInt16(mergedFloat);
	const mp3Data = encodeMp3(int16, sampleRate, 64);

	// Save to vault
	notice.setMessage("MP3 Export: Saving...");
	const parentPath = file.parent?.path ?? "";
	const mp3Name = `${file.basename}.mp3`;
	const mp3Path = parentPath ? `${parentPath}/${mp3Name}` : mp3Name;

	await vault.createBinary(mp3Path, mp3Data.buffer as ArrayBuffer);

	const sizeMB = (mp3Data.length / 1024 / 1024).toFixed(1);
	const durationMin = (totalFrames / sampleRate / 60).toFixed(1);
	notice.hide();

	return `Exported ${mp3Name} (${sizeMB} MB, ~${durationMin} min)`;
}

// ---------------------------------------------------------------------------
// MP3 encoding
// ---------------------------------------------------------------------------

function encodeMp3(
	pcm: Int16Array,
	sampleRate: number,
	kbps: number,
): Uint8Array {
	const encoder = new Mp3Encoder(1, sampleRate, kbps);
	const blockSize = 1152;
	const chunks: Uint8Array[] = [];

	for (let i = 0; i < pcm.length; i += blockSize) {
		const block = pcm.subarray(i, i + blockSize);
		const mp3buf = encoder.encodeBuffer(block);
		if (mp3buf.length > 0) chunks.push(new Uint8Array(mp3buf));
	}

	const flushed = encoder.flush();
	if (flushed.length > 0) chunks.push(new Uint8Array(flushed));

	return concatUint8Arrays(chunks);
}

function float32ToInt16(float32: Float32Array): Int16Array {
	const int16 = new Int16Array(float32.length);
	for (let i = 0; i < float32.length; i++) {
		const s = Math.max(-1, Math.min(1, float32[i]));
		int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
	}
	return int16;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
	const total = arrays.reduce((s, a) => s + a.length, 0);
	const result = new Uint8Array(total);
	let off = 0;
	for (const a of arrays) {
		result.set(a, off);
		off += a.length;
	}
	return result;
}

function concatBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
	const total = buffers.reduce((s, b) => s + b.byteLength, 0);
	const result = new Uint8Array(total);
	let off = 0;
	for (const buf of buffers) {
		result.set(new Uint8Array(buf), off);
		off += buf.byteLength;
	}
	return result.buffer;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const raw = atob(base64);
	const bytes = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) {
		bytes[i] = raw.charCodeAt(i);
	}
	return bytes.buffer;
}

function pcmToWav(
	pcm: ArrayBuffer,
	sampleRate: number,
	channels: number,
	bitsPerSample: number,
): ArrayBuffer {
	const byteRate = sampleRate * channels * (bitsPerSample / 8);
	const blockAlign = channels * (bitsPerSample / 8);
	const dataSize = pcm.byteLength;
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);

	writeStr(view, 0, "RIFF");
	view.setUint32(4, 36 + dataSize, true);
	writeStr(view, 8, "WAVE");
	writeStr(view, 12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, channels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitsPerSample, true);
	writeStr(view, 36, "data");
	view.setUint32(40, dataSize, true);
	new Uint8Array(buffer, 44).set(new Uint8Array(pcm));

	return buffer;
}

function writeStr(view: DataView, offset: number, str: string): void {
	for (let i = 0; i < str.length; i++) {
		view.setUint8(offset + i, str.charCodeAt(i));
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
