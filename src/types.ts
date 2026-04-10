export type Backend = "webspeech" | "deepinfra" | "openai" | "gemini";

export interface TTSReaderSettings {
	backend: Backend;
	webSpeechVoice: string;
	speed: number;
	deepinfraApiKey: string;
	deepinfraModel: string;
	deepinfraVoice: string;
	openaiApiKey: string;
	openaiModel: string;
	openaiVoice: string;
	geminiApiKey: string;
	geminiVoice: string;
	skipCodeBlocks: boolean;
	skipFrontmatter: boolean;
	autoScroll: boolean;
	toolbarPadding: number;
	/** @deprecated Use per-backend bufferAhead fields instead */
	bufferAhead: number;
	bufferAheadDeepinfra: number;
	bufferAheadOpenai: number;
	bufferAheadGemini: number;
	minChunkCharsOpenai: number;
	minChunkCharsGemini: number;
	editorLineIndicator: boolean;
	debug: boolean;
}

export const DEFAULT_SETTINGS: TTSReaderSettings = {
	backend: "webspeech",
	webSpeechVoice: "",
	speed: 1.0,
	deepinfraApiKey: "",
	deepinfraModel: "hexgrad/Kokoro-82M",
	deepinfraVoice: "af_heart",
	openaiApiKey: "",
	openaiModel: "tts-1",
	openaiVoice: "nova",
	geminiApiKey: "",
	geminiVoice: "Kore",
	skipCodeBlocks: true,
	skipFrontmatter: true,
	autoScroll: true,
	toolbarPadding: 0,
	bufferAhead: 5,
	bufferAheadDeepinfra: 5,
	bufferAheadOpenai: 8,
	bufferAheadGemini: 15,
	minChunkCharsOpenai: 100,
	minChunkCharsGemini: 200,
	editorLineIndicator: true,
	debug: false,
};

export interface DeepInfraModelDef {
	id: string;
	name: string;
	/** API parameter name for the voice field */
	voiceParam: string;
	/** If true, the voice field is free-text (describe the voice) */
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
			{ id: "Vivian", name: "Vivian (F, English)" },
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
			{ id: "scarlett", name: "Scarlett (F)" },
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
				id: "A calm, clear adult male voice with a neutral American accent",
				name: "Calm male (example)",
			},
			{
				id: "A warm, friendly young female voice with a British accent",
				name: "Warm female (example)",
			},
		],
	},
];

export interface OpenAIModelDef {
	id: string;
	name: string;
}

export const OPENAI_MODELS: OpenAIModelDef[] = [
	{ id: "tts-1", name: "TTS-1 — fast, $15/M chars" },
	{ id: "tts-1-hd", name: "TTS-1 HD — higher fidelity, $30/M chars" },
	{ id: "gpt-4o-mini-tts", name: "GPT-4o Mini TTS — newest, style control" },
];

export const OPENAI_VOICES: { id: string; name: string }[] = [
	{ id: "alloy", name: "Alloy (neutral)" },
	{ id: "ash", name: "Ash (warm M)" },
	{ id: "ballad", name: "Ballad (soft)" },
	{ id: "coral", name: "Coral (warm F)" },
	{ id: "echo", name: "Echo (clear M)" },
	{ id: "fable", name: "Fable (narrative)" },
	{ id: "nova", name: "Nova (friendly F) \u2605" },
	{ id: "onyx", name: "Onyx (deep M)" },
	{ id: "sage", name: "Sage (calm)" },
	{ id: "shimmer", name: "Shimmer (bright F)" },
];

export const GEMINI_VOICES: { id: string; name: string }[] = [
	{ id: "Kore", name: "Kore (F, clear) \u2605" },
	{ id: "Aoede", name: "Aoede (F, warm)" },
	{ id: "Charon", name: "Charon (M, deep)" },
	{ id: "Fenrir", name: "Fenrir (M, strong)" },
	{ id: "Leda", name: "Leda (F, gentle)" },
	{ id: "Orus", name: "Orus (M, smooth)" },
	{ id: "Puck", name: "Puck (M, lively)" },
	{ id: "Zephyr", name: "Zephyr (F, breathy)" },
];

export const SPEED_MIN = 0.5;
export const SPEED_MAX = 10.0;
export const SPEED_STEP = 0.25;

export interface SentenceInfo {
	text: string;
	/** Which occurrence of this exact text (0-indexed). For unique text, always 0. */
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
