import { App, PluginSettingTab, Setting } from "obsidian";
import type TTSReaderPlugin from "./main";
import {
	DEFAULT_SETTINGS,
	DEEPINFRA_MODELS,
	OPENAI_MODELS,
	OPENAI_VOICES,
	OPENAI_MAX_CHARS,
	GEMINI_VOICES,
	GEMINI_MAX_CHARS,
	SPEED_MIN,
	SPEED_MAX,
	SPEED_STEP,
	getActiveModelId,
	getModelSetting,
	getModelDefaults,
	setModelSetting,
	resetModelSetting,
	resetAllModelSettings,
	isModelSettingChanged,
	hasAnyModelSettingChanged,
	type Backend,
	type ModelSettings,
	type VoiceOption,
} from "./types";

export class TTSReaderSettingTab extends PluginSettingTab {
	plugin: TTSReaderPlugin;

	constructor(app: App, plugin: TTSReaderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	async display(): Promise<void> {
		const { containerEl } = this;
		containerEl.empty();

		// --- Backend ---
		new Setting(containerEl)
			.setName("TTS backend")
			.setDesc("Choose between browser built-in voices or cloud TTS.")
			.addDropdown((d) =>
				d
					.addOption("webspeech", "Web Speech API (free, built-in)")
					.addOption("deepinfra", "DeepInfra (cloud)")
					.addOption("openai", "OpenAI (cloud)")
					.addOption("gemini", "Google Gemini (cloud, multilingual)")
					.setValue(this.plugin.settings.backend)
					.onChange(async (v) => {
						this.plugin.stopPlaybackPublic();
						this.plugin.settings.backend = v as Backend;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		// --- Speed ---
		new Setting(containerEl)
			.setName("Default speed")
			.setDesc(`${SPEED_MIN}x \u2013 ${SPEED_MAX}x`)
			.addSlider((s) =>
				s
					.setLimits(SPEED_MIN, SPEED_MAX, SPEED_STEP)
					.setValue(this.plugin.settings.speed)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.speed = v;
						await this.plugin.saveSettings();
					}),
			);

		// --- Web Speech voice ---
		if (this.plugin.settings.backend === "webspeech") {
			const voices = await this.getWebSpeechVoices();
			new Setting(containerEl)
				.setName("Voice")
				.setDesc("Select a voice from your system's available voices.")
				.addDropdown((d) => {
					d.addOption("", "System default");
					for (const v of voices) {
						d.addOption(v.id, `${v.name} (${v.lang})`);
					}
					d.setValue(this.plugin.settings.webSpeechVoice);
					d.onChange(async (val) => {
						this.plugin.stopPlaybackPublic();
						this.plugin.settings.webSpeechVoice = val;
						await this.plugin.saveSettings();
					});
				});
		}

		// --- DeepInfra settings ---
		if (this.plugin.settings.backend === "deepinfra") {
			this.renderPrivacyNote(
				containerEl,
				"Privacy: DeepInfra does not store or train on your data. " +
				"They may temporarily store inputs/outputs for debugging purposes for a limited period.",
			);

			new Setting(containerEl)
				.setName("DeepInfra API key")
				.setDesc("Your DeepInfra API key for cloud TTS.")
				.addText((t) =>
					t
						.setPlaceholder("Enter API key")
						.setValue(this.plugin.settings.deepinfraApiKey)
						.then((t) => (t.inputEl.type = "password"))
						.onChange(async (v) => {
							this.plugin.stopPlaybackPublic();
							this.plugin.settings.deepinfraApiKey = v;
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName("Model")
				.setDesc("Choose a preset or enter a custom model ID below.")
				.addDropdown((d) => {
					for (const m of DEEPINFRA_MODELS) {
						d.addOption(m.id, m.name);
					}
					d.addOption("custom", "Custom model...");
					const current = DEEPINFRA_MODELS.some(
						(m) => m.id === this.plugin.settings.deepinfraModel,
					)
						? this.plugin.settings.deepinfraModel
						: "custom";
					d.setValue(current);
					d.onChange(async (v) => {
						this.plugin.stopPlaybackPublic();
						if (v !== "custom") {
							this.plugin.settings.deepinfraModel = v;
							await this.plugin.saveSettings();
						}
						this.display();
					});
				});

			const isCustom = !DEEPINFRA_MODELS.some(
				(m) => m.id === this.plugin.settings.deepinfraModel,
			);
			if (isCustom) {
				new Setting(containerEl)
					.setName("Custom model ID")
					.setDesc("Full model ID from DeepInfra, e.g. hexgrad/Kokoro-82M")
					.addText((t) =>
						t
							.setPlaceholder("owner/model-name")
							.setValue(this.plugin.settings.deepinfraModel)
							.onChange(async (v) => {
								this.plugin.stopPlaybackPublic();
								this.plugin.settings.deepinfraModel = v;
								await this.plugin.saveSettings();
							}),
					);
			}

			const modelId = this.plugin.settings.deepinfraModel;
			const modelDef = DEEPINFRA_MODELS.find((m) => m.id === modelId);

			// Voice
			if (modelDef && modelDef.voices.length > 0) {
				this.renderModelVoiceDropdown(containerEl, modelId, modelDef);
			} else if (!modelDef) {
				this.renderModelVoiceText(containerEl, modelId, "Voice ID or name for your custom model.");
			}

			// Buffer ahead
			this.renderModelSlider(containerEl, modelId, "bufferAhead",
				"Buffer ahead",
				"Sentences to pre-fetch. Fast models (Kokoro) need less; slower ones (Orpheus) need more.",
				0, 20, 1);

			this.renderResetAll(containerEl, modelId);
		}

		// --- OpenAI settings ---
		if (this.plugin.settings.backend === "openai") {
			this.renderPrivacyNote(
				containerEl,
				"Privacy: OpenAI retains API data for 30 days for abuse monitoring, then deletes it. Your data is not used for model training.",
			);

			new Setting(containerEl)
				.setName("OpenAI API key")
				.setDesc("Your OpenAI API key.")
				.addText((t) =>
					t
						.setPlaceholder("sk-...")
						.setValue(this.plugin.settings.openaiApiKey)
						.then((t) => (t.inputEl.type = "password"))
						.onChange(async (v) => {
							this.plugin.stopPlaybackPublic();
							this.plugin.settings.openaiApiKey = v;
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName("Model")
				.setDesc("TTS-1 is faster, TTS-1 HD is higher quality. GPT-4o Mini TTS is newest with style control.")
				.addDropdown((d) => {
					for (const m of OPENAI_MODELS) {
						d.addOption(m.id, m.name);
					}
					d.setValue(this.plugin.settings.openaiModel);
					d.onChange(async (v) => {
						this.plugin.stopPlaybackPublic();
						this.plugin.settings.openaiModel = v;
						await this.plugin.saveSettings();
						this.display();
					});
				});

			const modelId = this.plugin.settings.openaiModel;
			const modelDef = OPENAI_MODELS.find((m) => m.id === modelId);
			const maxChars = modelDef?.maxChars ?? OPENAI_MAX_CHARS;

			// Voice
			this.renderModelVoiceDropdownFromList(containerEl, modelId, OPENAI_VOICES, "OpenAI voice. All voices support multilingual output.");

			// Chunk size
			this.renderModelSlider(containerEl, modelId, "chunkSize",
				"Chunk size",
				`Characters per TTS request. Larger = better prosody but slower loading. Max: ${maxChars}.`,
				100, maxChars, 50);

			// Buffer ahead
			this.renderModelSlider(containerEl, modelId, "bufferAhead",
				"Buffer ahead",
				"Chunks to pre-fetch while the current one plays.",
				0, 10, 1);

			this.renderResetAll(containerEl, modelId);
		}

		// --- Gemini settings ---
		if (this.plugin.settings.backend === "gemini") {
			this.renderPrivacyNote(
				containerEl,
				"Privacy: Google may use free-tier API data to improve their models. " +
				"Paid-tier data has better protections but is still subject to Google's terms. " +
				"Get an API key from Google AI Studio (aistudio.google.com).",
			);

			new Setting(containerEl)
				.setName("Gemini API key")
				.setDesc("API key from Google AI Studio.")
				.addText((t) =>
					t
						.setPlaceholder("AI...")
						.setValue(this.plugin.settings.geminiApiKey)
						.then((t) => (t.inputEl.type = "password"))
						.onChange(async (v) => {
							this.plugin.stopPlaybackPublic();
							this.plugin.settings.geminiApiKey = v;
							await this.plugin.saveSettings();
						}),
				);

			const modelId = "gemini-2.5-flash-preview-tts";

			// Voice
			this.renderModelVoiceDropdownFromList(containerEl, modelId, GEMINI_VOICES, "Gemini voice. All voices support 50+ languages including Lithuanian, Chinese, Japanese, and more.");

			// Chunk size
			this.renderModelSlider(containerEl, modelId, "chunkSize",
				"Chunk size",
				`Characters per TTS request. Larger = better prosody but slower loading. Max: ${GEMINI_MAX_CHARS}.`,
				100, GEMINI_MAX_CHARS, 50);

			// Buffer ahead
			this.renderModelSlider(containerEl, modelId, "bufferAhead",
				"Buffer ahead",
				"Chunks to pre-fetch. Gemini is slower per request so buffering helps avoid gaps.",
				0, 10, 1);

			this.renderResetAll(containerEl, modelId);
		}

		// --- Text extraction ---
		new Setting(containerEl).setName("Text extraction").setHeading();

		new Setting(containerEl)
			.setName("Skip code blocks")
			.setDesc("Don't read code blocks aloud.")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.skipCodeBlocks)
					.onChange(async (v) => {
						this.plugin.settings.skipCodeBlocks = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Skip frontmatter")
			.setDesc("Don't read YAML frontmatter aloud.")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.skipFrontmatter)
					.onChange(async (v) => {
						this.plugin.settings.skipFrontmatter = v;
						await this.plugin.saveSettings();
					}),
			);

		// --- Behavior ---
		new Setting(containerEl).setName("Behavior").setHeading();

		new Setting(containerEl)
			.setName("Auto-scroll")
			.setDesc("Automatically scroll the document to keep the current sentence visible.")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.autoScroll)
					.onChange(async (v) => {
						this.plugin.settings.autoScroll = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Editor line indicator")
			.setDesc("Show a left-border marker on the line being read in editing mode.")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.editorLineIndicator)
					.onChange(async (v) => {
						this.plugin.settings.editorLineIndicator = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Toolbar bottom padding")
			.setDesc("Extra space below the toolbar (pixels). Increase on mobile if Obsidian's navigation bar covers the controls.")
			.addSlider((s) =>
				s
					.setLimits(0, 200, 10)
					.setValue(this.plugin.settings.toolbarPadding)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.toolbarPadding = v;
						await this.plugin.saveSettings();
					}),
			);

		// --- Export ---
		new Setting(containerEl).setName("Export").setHeading();

		new Setting(containerEl)
			.setName("Export parallel requests")
			.setDesc("Number of simultaneous API calls when exporting to MP3. Higher = faster export but may hit rate limits.")
			.addSlider((s) =>
				s
					.setLimits(1, 20, 1)
					.setValue(this.plugin.settings.exportConcurrency)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.exportConcurrency = v;
						await this.plugin.saveSettings();
					}),
			);

		// --- Advanced ---
		new Setting(containerEl).setName("Advanced").setHeading();

		new Setting(containerEl)
			.setName("Debug mode")
			.setDesc("Show detailed diagnostic notices for troubleshooting TTS issues.")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.debug)
					.onChange(async (v) => {
						this.plugin.settings.debug = v;
						await this.plugin.saveSettings();
					}),
			);
	}

	// -----------------------------------------------------------------------
	// Per-model setting renderers
	// -----------------------------------------------------------------------

	private renderPrivacyNote(containerEl: HTMLElement, text: string): void {
		const el = containerEl.createEl("p", { cls: "setting-item-description" });
		el.style.padding = "8px 12px";
		el.style.borderLeft = "3px solid var(--text-warning)";
		el.style.marginBottom = "12px";
		el.textContent = text;
	}

	/** Render a voice dropdown from a DeepInfra model definition (supports freeTextVoice). */
	private renderModelVoiceDropdown(
		containerEl: HTMLElement,
		modelId: string,
		modelDef: { freeTextVoice?: boolean; voices: { id: string; name: string }[]; name: string },
	): void {
		const currentVoice = getModelSetting(this.plugin.settings, modelId, "voice");
		const isVoiceDesign = modelDef.freeTextVoice === true;

		const setting = new Setting(containerEl)
			.setName("Voice")
			.setDesc(isVoiceDesign
				? "Describe the voice you want in natural language."
				: `Voice for ${modelDef.name.split(" \u2014")[0]}.`);

		if (isVoiceDesign) {
			setting.addText((t) =>
				t
					.setPlaceholder("A calm, clear adult voice...")
					.setValue(currentVoice)
					.onChange(async (v) => {
						this.plugin.stopPlaybackPublic();
						setModelSetting(this.plugin.settings, modelId, "voice", v);
						await this.plugin.saveSettings();
					}),
			);
		} else {
			setting.addDropdown((d) => {
				for (const v of modelDef.voices) {
					d.addOption(v.id, v.name);
				}
				const validVoice = modelDef.voices.some((v) => v.id === currentVoice)
					? currentVoice
					: modelDef.voices[0].id;
				if (validVoice !== currentVoice) {
					setModelSetting(this.plugin.settings, modelId, "voice", validVoice);
					this.plugin.saveSettings();
				}
				d.setValue(validVoice);
				d.onChange(async (v) => {
					this.plugin.stopPlaybackPublic();
					setModelSetting(this.plugin.settings, modelId, "voice", v);
					await this.plugin.saveSettings();
				});
			});
		}

		this.addModelReset(setting, modelId, "voice");
	}

	/** Render a voice dropdown from a flat voice list (OpenAI, Gemini). */
	private renderModelVoiceDropdownFromList(
		containerEl: HTMLElement,
		modelId: string,
		voices: { id: string; name: string }[],
		desc: string,
	): void {
		const currentVoice = getModelSetting(this.plugin.settings, modelId, "voice");
		const setting = new Setting(containerEl)
			.setName("Voice")
			.setDesc(desc)
			.addDropdown((d) => {
				for (const v of voices) {
					d.addOption(v.id, v.name);
				}
				const validVoice = voices.some((v) => v.id === currentVoice)
					? currentVoice
					: voices[0].id;
				d.setValue(validVoice);
				d.onChange(async (v) => {
					this.plugin.stopPlaybackPublic();
					setModelSetting(this.plugin.settings, modelId, "voice", v);
					await this.plugin.saveSettings();
				});
			});

		this.addModelReset(setting, modelId, "voice");
	}

	/** Render a free-text voice field for custom DeepInfra models. */
	private renderModelVoiceText(containerEl: HTMLElement, modelId: string, desc: string): void {
		const currentVoice = getModelSetting(this.plugin.settings, modelId, "voice");
		const setting = new Setting(containerEl)
			.setName("Voice")
			.setDesc(desc)
			.addText((t) =>
				t
					.setPlaceholder("voice name")
					.setValue(currentVoice)
					.onChange(async (v) => {
						this.plugin.stopPlaybackPublic();
						setModelSetting(this.plugin.settings, modelId, "voice", v);
						await this.plugin.saveSettings();
					}),
			);

		this.addModelReset(setting, modelId, "voice");
	}

	/** Render a numeric slider for a per-model setting. */
	private renderModelSlider(
		containerEl: HTMLElement,
		modelId: string,
		key: "bufferAhead" | "chunkSize",
		name: string,
		desc: string,
		min: number,
		max: number,
		step: number,
	): void {
		const value = getModelSetting(this.plugin.settings, modelId, key);
		const setting = new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addSlider((s) =>
				s
					.setLimits(min, max, step)
					.setValue(Math.min(Math.max(value, min), max))
					.setDynamicTooltip()
					.onChange(async (v) => {
						setModelSetting(this.plugin.settings, modelId, key, v);
						await this.plugin.saveSettings();
					}),
			);

		this.addModelReset(setting, modelId, key);
	}

	/** Add a reset button to a setting, only if the value differs from default. */
	private addModelReset(
		setting: Setting,
		modelId: string,
		key: keyof ModelSettings,
	): void {
		if (!isModelSettingChanged(this.plugin.settings, modelId, key)) return;
		const defaultVal = getModelDefaults(modelId)[key];
		setting.addExtraButton((btn) =>
			btn
				.setIcon("reset")
				.setTooltip(`Reset to default (${defaultVal})`)
				.onClick(async () => {
					this.plugin.stopPlaybackPublic();
					resetModelSetting(this.plugin.settings, modelId, key);
					await this.plugin.saveSettings();
					this.display();
				}),
		);
	}

	/** Render a "Reset all to defaults" button for a model. */
	private renderResetAll(containerEl: HTMLElement, modelId: string): void {
		if (!hasAnyModelSettingChanged(this.plugin.settings, modelId)) return;

		const defaults = getModelDefaults(modelId);
		new Setting(containerEl)
			.setName("Reset all to defaults")
			.setDesc(
				`Reset all settings for this model to defaults ` +
				`(voice: ${defaults.voice}, buffer: ${defaults.bufferAhead}` +
				(defaults.chunkSize > 0 ? `, chunk: ${defaults.chunkSize}` : "") +
				`)`,
			)
			.addButton((btn) =>
				btn
					.setButtonText("Reset all")
					.setWarning()
					.onClick(async () => {
						this.plugin.stopPlaybackPublic();
						resetAllModelSettings(this.plugin.settings, modelId);
						await this.plugin.saveSettings();
						this.display();
					}),
			);
	}

	// -----------------------------------------------------------------------
	// Web Speech voices
	// -----------------------------------------------------------------------

	private async getWebSpeechVoices(): Promise<VoiceOption[]> {
		if (typeof speechSynthesis === "undefined") return [];

		let voices = speechSynthesis.getVoices();
		if (voices.length === 0) {
			voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
				const onVoices = () => resolve(speechSynthesis.getVoices());
				speechSynthesis.addEventListener("voiceschanged", onVoices, {
					once: true,
				});
				setTimeout(() => resolve(speechSynthesis.getVoices()), 1000);
			});
		}

		return voices.map((v) => ({
			id: v.voiceURI,
			name: v.name,
			lang: v.lang,
		}));
	}
}
