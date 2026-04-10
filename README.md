# TTS Reader for Obsidian

Read your Markdown documents aloud with sentence-level highlighting, auto-scrolling, and playback controls — like Microsoft Edge's "Read Aloud" but inside Obsidian.

![Obsidian](https://img.shields.io/badge/Obsidian-v1.0+-7C3AED)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android%20%7C%20iOS-blue)

## Features

- **Sentence-level highlighting** — the current sentence is highlighted in the document as it's read
- **Auto-scrolling** — the view follows along so the current sentence stays visible
- **Playback controls** — floating toolbar with play/pause, skip forward/back, and speed adjustment
- **Click to jump** — click any sentence in the document to start reading from there
- **Smart text extraction** — reads clean prose, not Markdown syntax. Strips formatting, skips frontmatter and code blocks by default
- **Speed control** — 0.5x to 10x in 0.25 steps
- **Voice selection** — pick from your system's available voices
- **Cross-platform** — works on Windows, macOS, Linux, Android, and iOS

## TTS Backends

### Web Speech API (default, free)

Uses your browser/OS built-in speech synthesis. No API key needed.

- **Windows**: Microsoft neural voices (same as Edge Read Aloud)
- **macOS**: Apple system voices
- **Android**: Google TTS
- **Linux**: Depends on installed speech engines

### OpenAI (cloud)

High-quality voices with good multilingual support. Requires an [OpenAI API key](https://platform.openai.com/api-keys).

- **tts-1** — fast, cost-effective ($15/M chars)
- **tts-1-hd** — higher fidelity ($30/M chars)
- **gpt-4o-mini-tts** — newest, supports natural-language style instructions

10 voices available (alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer).

### Google Gemini (cloud, best for multilingual)

Uses Gemini 2.5 Flash TTS via a simple API key from [Google AI Studio](https://aistudio.google.com/). No Google Cloud project needed.

- 50+ languages with strong non-English support (Lithuanian, Chinese, Japanese, etc.)
- 8 voices (Kore, Aoede, Charon, Fenrir, Leda, Orus, Puck, Zephyr)
- Very affordable (~$0.05 per large document)

### DeepInfra (cloud)

Multiple TTS models via [DeepInfra](https://deepinfra.com/). Preset models:

- **Kokoro 82M** — fast and lightweight (~$0.80/M chars)
- **Qwen3 TTS** — multilingual (~$20/M chars)
- **Orpheus 3B** — most expressive (~$1/M chars)

You can also enter any custom model ID from DeepInfra's model catalog.

### Privacy

Each cloud backend shows a privacy notice in settings:

- **DeepInfra**: Does not store or train on your data. May temporarily store for debugging.
- **OpenAI**: Retains API data for 30 days for abuse monitoring. Not used for model training.
- **Google Gemini**: May use free-tier API data to improve models. Paid-tier data has better protections.

## Usage

1. Open a note and switch to **Reading View** (click the book icon or press `Ctrl/Cmd+E`)
2. Open the command palette (`Ctrl/Cmd+P`) and run **TTS Reader: Start reading aloud**
3. Use the floating toolbar at the bottom to control playback
4. Click any sentence in the document to jump there

### Toolbar Controls

| Button | Action |
|--------|--------|
| ⏮ | Previous sentence |
| ▶ / ⏸ | Play / Pause |
| ⏭ | Next sentence |
| − / + | Decrease / Increase speed |
| ✕ | Stop and close |

### Commands

All commands are available in the command palette and can be bound to hotkeys:

| Command | Description |
|---------|-------------|
| Start reading aloud | Begin reading the current document |
| Stop reading | Stop playback and close the toolbar |
| Pause / Resume | Toggle pause |
| Skip to next sentence | Jump forward one sentence |
| Skip to previous sentence | Jump backward one sentence |
| Increase speed | Speed up by 0.25x |
| Decrease speed | Slow down by 0.25x |

## Settings

| Setting | Description |
|---------|-------------|
| TTS backend | Web Speech, DeepInfra, OpenAI, or Google Gemini |
| Default speed | Starting playback speed |
| Voice | Choose from available voices (per-backend) |
| Buffer ahead | Sentences to pre-fetch (per-backend, with tuned defaults) |
| Min chunk size | Minimum characters per TTS request — merges short text like headers with following content (OpenAI/Gemini only) |
| Skip code blocks | Don't read code blocks aloud (default: on) |
| Skip frontmatter | Don't read YAML frontmatter (default: on) |
| Auto-scroll | Keep the current sentence visible (default: on) |
| Editor line indicator | Show left-border marker on current line in editing mode |

Each per-backend setting has a reset-to-default button.

## Installation

### From BRAT (recommended for beta)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat)
2. In BRAT settings, click **Add Beta Plugin**
3. Enter: `martinjuskelis/obsidian-tts-reader`
4. Enable **TTS Reader** in Settings > Community Plugins

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/martinjuskelis/obsidian-tts-reader/releases/latest)
2. Create a folder at `<your-vault>/.obsidian/plugins/tts-reader/`
3. Copy the three files into that folder
4. Enable **TTS Reader** in Settings > Community Plugins

## Building from Source

```bash
npm install
npm run build
```

The built plugin is `main.js` in the project root. Copy it along with `manifest.json` and `styles.css` to your vault's plugin folder.

## Roadmap

Planned improvements (contributions welcome):

- ~~**Paragraph-based chunking**~~ — Done in v3.1.0.
- **Dynamic model/voice/limits discovery** — Currently, model lists, voice options, and API limits (max chars per request) are hardcoded. These go stale every few months as providers add new models, voices, and change limits. The plugin should dynamically fetch this information from each provider's API when the user enters their API key, then cache it locally. Hardcoded values would remain as a fallback baseline, but the live data would take precedence. This covers: available models, available voices per model, max input characters/tokens per model, pricing info if available, and any model-specific constraints (e.g. gpt-4o-mini-tts's lower token limit).
- **Audio caching** — Cache generated audio so navigating back to a section or re-reading a file doesn't re-generate (and re-bill) the same text. Chunks would be keyed by text hash + backend + voice.
- **Save and resume progress** — Remember the last playback position per file so you can pick up where you left off when returning to a document.
- **Word-level highlighting** — Show both the current chunk/section and the individual word being spoken (similar to Speechify). Would require word-level timestamp alignment from the TTS response or client-side audio analysis.
- **MP3 export** — Export the full document as an MP3 file for offline listening. Generate audio for all chunks, concatenate with crossfade, and save to the vault.

## License

[MIT](LICENSE)
