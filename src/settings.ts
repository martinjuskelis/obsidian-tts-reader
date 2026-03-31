import { App, PluginSettingTab, Setting } from "obsidian";
import type TTSReaderPlugin from "./main";
import {
	DEEPINFRA_MODELS,
	SPEED_MIN,
	SPEED_MAX,
	SPEED_STEP,
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
					.addOption("deepinfra", "DeepInfra (cloud, better quality)")
					.setValue(this.plugin.settings.backend)
					.onChange(async (v) => {
						this.plugin.stopPlaybackPublic();
						this.plugin.settings.backend = v as
							| "webspeech"
							| "deepinfra";
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
					.setDesc(
						"Full model ID from DeepInfra, e.g. hexgrad/Kokoro-82M",
					)
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

			new Setting(containerEl)
				.setName("Voice")
				.setDesc(
					"Voice preset name. Kokoro voices: af_heart, af_bella, af_nicole, af_sarah, af_sky, am_adam, am_michael, bf_emma, bf_isabella, bm_george, bm_lewis",
				)
				.addText((t) =>
					t
						.setPlaceholder("af_heart")
						.setValue(this.plugin.settings.deepinfraVoice)
						.onChange(async (v) => {
							this.plugin.stopPlaybackPublic();
							this.plugin.settings.deepinfraVoice = v;
							await this.plugin.saveSettings();
						}),
				);
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
			.setDesc(
				"Automatically scroll the document to keep the current sentence visible.",
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.autoScroll)
					.onChange(async (v) => {
						this.plugin.settings.autoScroll = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Toolbar bottom padding")
			.setDesc(
				"Extra space below the toolbar (pixels). Increase on mobile if Obsidian's navigation bar covers the controls. Default: 0 on desktop, 80 on mobile.",
			)
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

		// --- Advanced ---
		new Setting(containerEl).setName("Advanced").setHeading();

		new Setting(containerEl)
			.setName("Debug mode")
			.setDesc(
				"Show detailed diagnostic notices for troubleshooting TTS issues.",
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.debug)
					.onChange(async (v) => {
						this.plugin.settings.debug = v;
						await this.plugin.saveSettings();
					}),
			);
	}

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
