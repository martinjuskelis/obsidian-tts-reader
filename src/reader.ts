import type { WorkspaceLeaf } from "obsidian";
import type { SentenceInfo } from "./types";
import type { Highlighter } from "./highlighter";
import type { PlaybackController } from "./playback";

export interface SentenceContext {
	index: number;
	sentence: SentenceInfo;
}

/**
 * A source for TTS playback. Concrete implementations wrap a specific
 * Obsidian view type (markdown, PDF, etc.) and hide source-specific
 * concerns (text extraction, click-to-jump, scroll, highlight container)
 * from the rest of the plugin.
 *
 * The plugin holds a Reader and drives it through lifecycle calls in the
 * order:
 *   1. extractChunks()
 *   2. resolveStartIndex()
 *   3. per sentence: prepareForSentence() → getHighlightContainer() →
 *      (highlight + speak) → onSentenceChanged()
 *   4. destroy()
 */
export abstract class Reader {
	abstract readonly filePath: string | null;
	abstract readonly leaf: WorkspaceLeaf;

	abstract extractChunks(): Promise<SentenceInfo[]> | SentenceInfo[];

	/**
	 * Pick the starting sentence.
	 * @param explicitOffset caller-supplied offset (e.g. cursor position, page).
	 *   Meaning is reader-specific.
	 * @param resumeIndex sentence index from the saved bookmark (0 if none).
	 */
	abstract resolveStartIndex(
		sentences: readonly SentenceInfo[],
		explicitOffset: number | undefined,
		resumeIndex: number,
	): number;

	/**
	 * Ensure the DOM is ready to highlight this sentence. PdfReader uses
	 * this to scroll the target page into view and await textlayerrendered.
	 */
	prepareForSentence(_ctx: SentenceContext): Promise<void> | void {
		// default: no-op
	}

	/**
	 * DOM container the Highlighter should search within. May vary per
	 * sentence (e.g. active PDF page's text layer). Return null to skip
	 * DOM highlight for this sentence (e.g. markdown edit mode).
	 */
	abstract getHighlightContainer(ctx: SentenceContext): HTMLElement | null;

	/** Fired after every sentence change — secondary UI updates. */
	onSentenceChanged(_ctx: SentenceContext, _autoScroll: boolean): void {
		// default: no-op
	}

	/** "Locate current" toolbar button — bring the active sentence back into view. */
	locateCurrent(_ctx: SentenceContext | null, highlighter: Highlighter): void {
		highlighter.scrollToCurrent();
	}

	/**
	 * Install click-to-jump handlers. Returns a teardown function that the
	 * plugin calls when playback stops.
	 */
	setupClickToJump(
		_controller: PlaybackController,
		_highlighter: Highlighter,
		_getSpeed: () => number,
	): () => void {
		return () => {};
	}

	/** Cleanup hook called when playback stops or the plugin unloads. */
	destroy(): void {
		// default: no-op
	}
}
