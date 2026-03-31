export interface TTSReaderSettings {
	backend: "webspeech" | "deepinfra";
	webSpeechVoice: string;
	speed: number;
	deepinfraApiKey: string;
	deepinfraModel: string;
	skipCodeBlocks: boolean;
	skipFrontmatter: boolean;
	autoScroll: boolean;
	toolbarPosition: "bottom" | "top";
	debug: boolean;
}

export const DEFAULT_SETTINGS: TTSReaderSettings = {
	backend: "webspeech",
	webSpeechVoice: "",
	speed: 1.0,
	deepinfraApiKey: "",
	deepinfraModel: "hexgrad/Kokoro-82M",
	skipCodeBlocks: true,
	skipFrontmatter: true,
	autoScroll: true,
	toolbarPosition: "bottom",
	debug: false,
};

export const DEEPINFRA_MODELS: { id: string; name: string }[] = [
	{ id: "hexgrad/Kokoro-82M", name: "Kokoro 82M \u2014 fast, lightweight" },
	{ id: "Qwen/Qwen3-TTS", name: "Qwen3 TTS \u2014 multilingual" },
	{
		id: "canopylabs/orpheus-3b-0.1-ft",
		name: "Orpheus 3B \u2014 most expressive",
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
