export type Backend = "webspeech" | "deepinfra" | "openai" | "gemini";

// ---------------------------------------------------------------------------
// Per-model settings
// ---------------------------------------------------------------------------

export interface ModelSettings {
	voice: string;
	bufferAhead: number;
	/** Max chars per TTS chunk. 0 = sentence-level (DeepInfra). */
	chunkSize: number;
}

/** Default settings per model ID. */
export const MODEL_DEFAULTS: Record<string, ModelSettings> = {
	// --- DeepInfra ---
	"hexgrad/Kokoro-82M": { voice: "af_heart", bufferAhead: 3, chunkSize: 0 },
	"canopylabs/orpheus-3b-0.1-ft": { voice: "tara", bufferAhead: 5, chunkSize: 0 },
	"Qwen/Qwen3-TTS": { voice: "Vivian", bufferAhead: 6, chunkSize: 0 },
	"ResembleAI/chatterbox": { voice: "scarlett", bufferAhead: 5, chunkSize: 0 },
	"Qwen/Qwen3-TTS-VoiceDesign": {
		voice: "A composed, clear adult female voice with a neutral American accent, steady pace, and warm tone",
		bufferAhead: 6,
		chunkSize: 0,
	},
	// --- OpenAI ---
	"tts-1": { voice: "nova", bufferAhead: 3, chunkSize: 200 },
	"tts-1-hd": { voice: "nova", bufferAhead: 4, chunkSize: 400 },
	"gpt-4o-mini-tts": { voice: "nova", bufferAhead: 3, chunkSize: 200 },
	// --- Gemini ---
	"gemini-2.5-flash-preview-tts": { voice: "Zephyr", bufferAhead: 3, chunkSize: 200 },
};

/** Fallback for unknown models. */
const FALLBACK_MODEL_SETTINGS: ModelSettings = {
	voice: "",
	bufferAhead: 5,
	chunkSize: 200,
};

/** Get defaults for a model, falling back to generic defaults. */
export function getModelDefaults(modelId: string): ModelSettings {
	return MODEL_DEFAULTS[modelId] ?? FALLBACK_MODEL_SETTINGS;
}

// ---------------------------------------------------------------------------
// Plugin settings
// ---------------------------------------------------------------------------

export interface TTSReaderSettings {
	backend: Backend;
	webSpeechVoice: string;
	speed: number;
	// API keys
	deepinfraApiKey: string;
	openaiApiKey: string;
	geminiApiKey: string;
	// Currently selected model per backend
	deepinfraModel: string;
	openaiModel: string;
	// Per-model settings map (model ID → settings)
	modelSettings: Record<string, Partial<ModelSettings>>;
	// Global settings
	skipCodeBlocks: boolean;
	skipFrontmatter: boolean;
	autoScroll: boolean;
	toolbarPadding: number;
	exportConcurrency: number;
	/** Tracks which global settings the user has explicitly modified. */
	globalOverrides: string[];
	editorLineIndicator: boolean;
	debug: boolean;
}

export const DEFAULT_SETTINGS: TTSReaderSettings = {
	backend: "webspeech",
	webSpeechVoice: "",
	speed: 1.0,
	deepinfraApiKey: "",
	openaiApiKey: "",
	geminiApiKey: "",
	deepinfraModel: "hexgrad/Kokoro-82M",
	openaiModel: "tts-1",
	modelSettings: {},
	skipCodeBlocks: true,
	skipFrontmatter: true,
	autoScroll: true,
	toolbarPadding: 0,
	exportConcurrency: 20,
	globalOverrides: [],
	editorLineIndicator: true,
	debug: false,
};

/**
 * Get a resolved model setting — user override if set, otherwise model default.
 */
export function getModelSetting<K extends keyof ModelSettings>(
	settings: TTSReaderSettings,
	modelId: string,
	key: K,
): ModelSettings[K] {
	const userOverride = settings.modelSettings[modelId]?.[key];
	if (userOverride !== undefined) return userOverride as ModelSettings[K];
	return getModelDefaults(modelId)[key];
}

/**
 * Set a per-model setting override.
 */
export function setModelSetting<K extends keyof ModelSettings>(
	settings: TTSReaderSettings,
	modelId: string,
	key: K,
	value: ModelSettings[K],
): void {
	if (!settings.modelSettings[modelId]) {
		settings.modelSettings[modelId] = {};
	}
	settings.modelSettings[modelId][key] = value;
}

/**
 * Reset a single per-model setting to its default.
 */
export function resetModelSetting(
	settings: TTSReaderSettings,
	modelId: string,
	key: keyof ModelSettings,
): void {
	const overrides = settings.modelSettings[modelId];
	if (overrides) {
		delete overrides[key];
		if (Object.keys(overrides).length === 0) {
			delete settings.modelSettings[modelId];
		}
	}
}

/**
 * Reset ALL per-model settings for a specific model.
 */
export function resetAllModelSettings(
	settings: TTSReaderSettings,
	modelId: string,
): void {
	delete settings.modelSettings[modelId];
}

/**
 * Check if a model setting differs from its default.
 */
export function isModelSettingChanged(
	settings: TTSReaderSettings,
	modelId: string,
	key: keyof ModelSettings,
): boolean {
	return settings.modelSettings[modelId]?.[key] !== undefined;
}

/**
 * Check if ANY model setting differs from defaults.
 */
export function hasAnyModelSettingChanged(
	settings: TTSReaderSettings,
	modelId: string,
): boolean {
	const overrides = settings.modelSettings[modelId];
	return !!overrides && Object.keys(overrides).length > 0;
}

// ---------------------------------------------------------------------------
// Get the currently active model ID
// ---------------------------------------------------------------------------

export function getActiveModelId(settings: TTSReaderSettings): string {
	switch (settings.backend) {
		case "deepinfra":
			return settings.deepinfraModel;
		case "openai":
			return settings.openaiModel;
		case "gemini":
			return "gemini-2.5-flash-preview-tts";
		default:
			return "";
	}
}

// ---------------------------------------------------------------------------
// Model/voice definitions
// ---------------------------------------------------------------------------

export interface DeepInfraModelDef {
	id: string;
	name: string;
	voiceParam: string;
	freeTextVoice?: boolean;
	voices: { id: string; name: string }[];
}

export const DEEPINFRA_MODELS: DeepInfraModelDef[] = [
	{
		id: "hexgrad/Kokoro-82M",
		name: "Kokoro 82M \u2014 fast, ~$0.80/M chars",
		voiceParam: "voice",
		voices: [
			{ id: "af_heart", name: "Heart (F, American) \u2605" },
			{ id: "af_bella", name: "Bella (F, American)" },
			{ id: "af_nicole", name: "Nicole (F, American)" },
			{ id: "af_sarah", name: "Sarah (F, American)" },
			{ id: "af_sky", name: "Sky (F, American)" },
			{ id: "af_alloy", name: "Alloy (F, American)" },
			{ id: "af_aoede", name: "Aoede (F, American)" },
			{ id: "af_jessica", name: "Jessica (F, American)" },
			{ id: "af_kore", name: "Kore (F, American)" },
			{ id: "af_nova", name: "Nova (F, American)" },
			{ id: "af_river", name: "River (F, American)" },
			{ id: "am_adam", name: "Adam (M, American)" },
			{ id: "am_echo", name: "Echo (M, American)" },
			{ id: "am_eric", name: "Eric (M, American)" },
			{ id: "am_fenrir", name: "Fenrir (M, American)" },
			{ id: "am_liam", name: "Liam (M, American)" },
			{ id: "am_michael", name: "Michael (M, American)" },
			{ id: "am_onyx", name: "Onyx (M, American)" },
			{ id: "am_puck", name: "Puck (M, American)" },
			{ id: "bf_alice", name: "Alice (F, British)" },
			{ id: "bf_emma", name: "Emma (F, British)" },
			{ id: "bf_isabella", name: "Isabella (F, British)" },
			{ id: "bf_lily", name: "Lily (F, British)" },
			{ id: "bm_daniel", name: "Daniel (M, British)" },
			{ id: "bm_fable", name: "Fable (M, British)" },
			{ id: "bm_george", name: "George (M, British)" },
			{ id: "bm_lewis", name: "Lewis (M, British)" },
		],
	},
	{
		id: "canopylabs/orpheus-3b-0.1-ft",
		name: "Orpheus 3B \u2014 most expressive, ~$1/M chars",
		voiceParam: "voice",
		voices: [
			{ id: "tara", name: "Tara (F) \u2605" },
			{ id: "leah", name: "Leah (F)" },
			{ id: "jess", name: "Jess (F)" },
			{ id: "mia", name: "Mia (F)" },
			{ id: "zoe", name: "Zoe (F)" },
			{ id: "leo", name: "Leo (M)" },
			{ id: "dan", name: "Dan (M)" },
			{ id: "zac", name: "Zac (M)" },
		],
	},
	{
		id: "Qwen/Qwen3-TTS",
		name: "Qwen3 TTS \u2014 multilingual, ~$20/M chars",
		voiceParam: "voice",
		voices: [
			{ id: "Vivian", name: "Vivian (F, English) \u2605" },
			{ id: "Serena", name: "Serena (F, English)" },
			{ id: "Dylan", name: "Dylan (M, English)" },
			{ id: "Eric", name: "Eric (M, English)" },
			{ id: "Ryan", name: "Ryan (M, English)" },
			{ id: "Aiden", name: "Aiden (M, English)" },
			{ id: "Uncle_Fu", name: "Uncle Fu (M, Chinese)" },
			{ id: "Ono_Anna", name: "Ono Anna (F, Japanese)" },
			{ id: "Sohee", name: "Sohee (F, Korean)" },
		],
	},
	{
		id: "ResembleAI/chatterbox",
		name: "Chatterbox \u2014 emotion control, ~$1/M chars",
		voiceParam: "voice",
		voices: [
			{ id: "scarlett", name: "Scarlett (F) \u2605" },
			{ id: "olivia", name: "Olivia (F)" },
			{ id: "james", name: "James (M)" },
		],
	},
	{
		id: "Qwen/Qwen3-TTS-VoiceDesign",
		name: "Qwen3 VoiceDesign \u2014 describe any voice, ~$20/M chars",
		voiceParam: "voice",
		freeTextVoice: true,
		voices: [
			{
				id: "A composed, clear adult female voice with a neutral American accent, steady pace, and warm tone",
				name: "Clear female (example)",
			},
			{
				id: "A calm, deep adult male voice with a British accent and measured, authoritative delivery",
				name: "Authoritative male (example)",
			},
		],
	},
];

export interface OpenAIModelDef {
	id: string;
	name: string;
	maxChars: number;
}

export const OPENAI_MODELS: OpenAIModelDef[] = [
	{ id: "tts-1", name: "TTS-1 \u2014 fast, $15/M chars", maxChars: 4096 },
	{ id: "tts-1-hd", name: "TTS-1 HD \u2014 higher fidelity, $30/M chars", maxChars: 4096 },
	{ id: "gpt-4o-mini-tts", name: "GPT-4o Mini TTS \u2014 newest, style control", maxChars: 1800 },
];

export const OPENAI_VOICES: { id: string; name: string }[] = [
	{ id: "alloy", name: "Alloy (neutral)" },
	{ id: "ash", name: "Ash (warm M)" },
	{ id: "ballad", name: "Ballad (soft)" },
	{ id: "coral", name: "Coral (warm F)" },
	{ id: "echo", name: "Echo (clear M)" },
	{ id: "fable", name: "Fable (narrative)" },
	{ id: "marin", name: "Marin (clear F, mini-tts)" },
	{ id: "nova", name: "Nova (friendly F) \u2605" },
	{ id: "onyx", name: "Onyx (deep M)" },
	{ id: "sage", name: "Sage (calm)" },
	{ id: "shimmer", name: "Shimmer (bright F)" },
	{ id: "verse", name: "Verse (versatile)" },
];

export const GEMINI_VOICES: { id: string; name: string }[] = [
	{ id: "Zephyr", name: "Zephyr (F, bright) \u2605" },
	{ id: "Aoede", name: "Aoede (F, warm)" },
	{ id: "Kore", name: "Kore (F, clear)" },
	{ id: "Charon", name: "Charon (M, deep)" },
	{ id: "Fenrir", name: "Fenrir (M, strong)" },
	{ id: "Leda", name: "Leda (F, gentle)" },
	{ id: "Orus", name: "Orus (M, smooth)" },
	{ id: "Puck", name: "Puck (M, lively)" },
];

/** API limits (characters). Used as slider maximums. */
export const OPENAI_MAX_CHARS = 4096;
export const OPENAI_MINI_MAX_CHARS = 1800;
/** Gemini quality degrades progressively past ~2000 chars. 3000 is the safe max. */
export const GEMINI_MAX_CHARS = 3000;

export const SPEED_MIN = 0.5;
export const SPEED_MAX = 10.0;
export const SPEED_STEP = 0.25;

export interface SentenceInfo {
	text: string;
	occurrence: number;
}

export type PlaybackState = "idle" | "playing" | "paused";

export interface VoiceOption {
	id: string;
	name: string;
	lang: string;
}

export interface TTSEngine {
	speak(text: string, speed: number): Promise<void>;
	stop(): void;
	pause(): void;
	resume(): void;
	setSpeed(speed: number): void;
	getVoices(): Promise<VoiceOption[]>;
	readonly speaking: boolean;
	readonly paused: boolean;
}
