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

### DeepInfra (cloud, optional)

For higher-quality voices, connect to DeepInfra's hosted TTS models. Requires a [DeepInfra API key](https://deepinfra.com/).

Preset models:
- **Kokoro 82M** — fast and lightweight
- **Qwen3 TTS** — multilingual
- **Orpheus 3B** — most expressive

You can also enter any custom model ID from DeepInfra's model catalog.

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
| TTS backend | Web Speech API (free) or DeepInfra (cloud) |
| Default speed | Starting playback speed |
| Voice | Choose from available system voices |
| Skip code blocks | Don't read code blocks aloud (default: on) |
| Skip frontmatter | Don't read YAML frontmatter (default: on) |
| Auto-scroll | Keep the current sentence visible (default: on) |

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

## License

[MIT](LICENSE)
