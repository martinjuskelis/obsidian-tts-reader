export interface TTSReaderSettings {
	backend: "webspeech" | "deepinfra";
	webSpeechVoice: string;
	speed: number;
	deepinfraApiKey: string;
	deepinfraModel: string;
	skipCodeBlocks: boolean;
	skipFrontmatter: boolean;
	autoScroll: boolean;
	deepinfraVoice: string;
	toolbarPadding: number;
	debug: boolean;
}

export const DEFAULT_SETTINGS: TTSReaderSettings = {
	backend: "webspeech",
	webSpeechVoice: "",
	speed: 1.0,
	deepinfraApiKey: "",
	deepinfraModel: "hexgrad/Kokoro-82M",
	deepinfraVoice: "af_heart",
	skipCodeBlocks: true,
	skipFrontmatter: true,
	autoScroll: true,
	toolbarPadding: 0,
	debug: false,
};

export interface DeepInfraModelDef {
	id: string;
	name: string;
	/** API parameter name for the voice field */
	voiceParam: string;
	voices: { id: string; name: string }[];
}

export const DEEPINFRA_MODELS: DeepInfraModelDef[] = [
	{
		id: "hexgrad/Kokoro-82M",
		name: "Kokoro 82M \u2014 fast, lightweight",
		voiceParam: "preset_voice",
		voices: [
			{ id: "af_heart", name: "Heart (F, American)" },
			{ id: "af_bella", name: "Bella (F, American)" },
			{ id: "af_nicole", name: "Nicole (F, American)" },
			{ id: "af_sarah", name: "Sarah (F, American)" },
			{ id: "af_sky", name: "Sky (F, American)" },
			{ id: "am_adam", name: "Adam (M, American)" },
			{ id: "am_michael", name: "Michael (M, American)" },
			{ id: "bf_emma", name: "Emma (F, British)" },
			{ id: "bf_isabella", name: "Isabella (F, British)" },
			{ id: "bm_george", name: "George (M, British)" },
			{ id: "bm_lewis", name: "Lewis (M, British)" },
		],
	},
	{
		id: "Qwen/Qwen3-TTS",
		name: "Qwen3 TTS \u2014 multilingual, streaming",
		voiceParam: "preset_voice",
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
		id: "canopylabs/orpheus-3b-0.1-ft",
		name: "Orpheus 3B \u2014 most expressive",
		voiceParam: "voice",
		voices: [
			{ id: "tara", name: "Tara (F)" },
			{ id: "leah", name: "Leah (F)" },
			{ id: "jess", name: "Jess (F)" },
			{ id: "mia", name: "Mia (F)" },
			{ id: "leo", name: "Leo (M)" },
			{ id: "dan", name: "Dan (M)" },
			{ id: "zac", name: "Zac (M)" },
			{ id: "zoe", name: "Zoe (F)" },
		],
	},
	{
		id: "Qwen/Qwen3-TTS-VoiceDesign",
		name: "Qwen3 VoiceDesign \u2014 describe any voice",
		voiceParam: "voice_description",
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

export const SPEED_MIN = 0.5;
export const SPEED_MAX = 10.0;
export const SPEED_STEP = 0.25;

export interface SentenceInfo {
	text: string;
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
