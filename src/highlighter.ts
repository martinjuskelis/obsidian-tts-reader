import type { SentenceInfo } from "./types";

/**
 * Gap pattern between consecutive words when matching a sentence in the DOM.
 *
 * Lazy, up to 40 chars of any character — enough to span a footnote marker,
 * a superscript number, a scripture reference, or an OCR page marker that
 * got stripped from the extracted sentence but still lives in the DOM.
 * Lazy so it prefers the tightest match (plain whitespace) when there's no
 * intervening junk, keeping occurrence counts aligned with extraction.
 */
const WORD_GAP = "[\\s\\S]{0,40}?";

/**
 * Elements whose text content should be excluded from the search buffer.
 */
const SKIP_SELECTOR = [
	"pre",
	"code",
	".frontmatter-container",
	".metadata-container",
	".frontmatter",
	"style",
	"script",
	".callout-icon",
	".heading-collapse-indicator",
	".collapse-indicator",
	".copy-code-button",
	".markdown-embed-link",
	".footnote-ref",
	".footnote-backref",
	".math-display",
	".MathJax",
	"svg",
	"button",
].join(", ");

interface TextEntry {
	node: Text;
	/** Byte offset where this node's content starts in the raw buffer */
	start: number;
	length: number;
}

/**
 * Highlights the current sentence in the rendered Reading View.
 *
 * Uses regex-based matching against the raw DOM text buffer so that
 * any whitespace in the sentence (spaces) flexibly matches any
 * whitespace in the DOM (newlines, tabs, multiple spaces from <br>,
 * trailing spaces from poetry, etc.).
 *
 * No normalization, no character maps, no normToRaw conversion.
 */
export class Highlighter {
	private container: HTMLElement | null = null;
	private useCustomHighlight: boolean;
	private marks: HTMLElement[] = [];
	private lastRanges: Range[] = [];
	private lastSentenceText = "";
	private lastOccurrence = 0;

	constructor() {
		this.useCustomHighlight =
			typeof CSS !== "undefined" &&
			"highlights" in CSS &&
			typeof Highlight !== "undefined";
	}

	setContainer(el: HTMLElement): void {
		this.container = el;
	}

	highlight(sentence: SentenceInfo, autoScroll: boolean): void {
		this.clear();
		if (!this.container) return;

		this.lastSentenceText = sentence.text;
		this.lastOccurrence = sentence.occurrence;
		const ranges = this.findTextInDOM(
			sentence.text,
			sentence.occurrence,
		);
		this.lastRanges = ranges;

		if (ranges.length > 0) {
			if (this.useCustomHighlight) {
				const hl = new Highlight(...ranges);
				CSS.highlights.set("tts-reader-current", hl);
			} else {
				for (const range of ranges) {
					try {
						const mark = document.createElement("mark");
						mark.className = "tts-reader-highlight";
						range.surroundContents(mark);
						this.marks.push(mark);
					} catch {
						// cross-element range
					}
				}
			}
		}

		if (autoScroll && ranges.length > 0) {
			this.scrollToRange(ranges[0]);
		}
	}

	clear(): void {
		if (this.useCustomHighlight) {
			try {
				CSS.highlights.delete("tts-reader-current");
			} catch {
				// already cleared
			}
		} else {
			for (const mark of this.marks) {
				const parent = mark.parentNode;
				if (!parent) continue;
				while (mark.firstChild)
					parent.insertBefore(mark.firstChild, mark);
				parent.removeChild(mark);
				parent.normalize();
			}
			this.marks = [];
		}
	}

	scrollToCurrent(): void {
		if (this.tryScrollToRanges()) return;

		if (this.lastSentenceText) {
			const ranges = this.findTextInDOM(
				this.lastSentenceText,
				this.lastOccurrence,
			);
			if (ranges.length > 0) {
				this.lastRanges = ranges;
				this.scrollToRange(ranges[0]);
				return;
			}
		}

		// Section de-rendered — no fallback scroll estimate needed;
		// auto-scroll during playback will catch up on next sentence.
	}

	/** Reset cursor so next search uses progress-based positioning. */
	resetSearchPosition(): void {
		// no-op — occurrence-based matching doesn't need cursor resets
	}

	/**
	 * Given a clicked text node and offset, determine which occurrence
	 * of `text` contains that position in the DOM buffer.
	 * Returns the occurrence index, or -1 if not found.
	 */
	getOccurrenceAt(text: string, node: Text, offset: number): number {
		if (!this.container) return -1;

		const entries = this.collectEntries();
		const rawBuffer = entries
			.map((e) => e.node.textContent ?? "")
			.join("");

		// Find the click's position in the raw buffer
		let clickPos = -1;
		for (const entry of entries) {
			if (entry.node === node) {
				clickPos = entry.start + offset;
				break;
			}
		}
		if (clickPos < 0) return -1;

		// Build regex and find all matches
		const words = text.split(/\s+/).filter((w) => w.length > 0);
		if (words.length === 0) return -1;
		const pattern = words.map(escapeRegex).join(WORD_GAP);
		const regex = new RegExp(pattern, "g");

		let occurrence = 0;
		let m: RegExpExecArray | null;
		while ((m = regex.exec(rawBuffer)) !== null) {
			if (clickPos >= m.index && clickPos < m.index + m[0].length) {
				return occurrence;
			}
			occurrence++;
		}
		return -1;
	}

	// --- DOM search ---

	/**
	 * Find sentence text in the DOM using regex with flexible whitespace.
	 *
	 * 1. Walk text nodes → build entries[] with raw buffer offsets
	 * 2. Concatenate into raw buffer (untouched — newlines, tabs, whatever)
	 * 3. Turn the sentence into a regex: split on whitespace, escape each
	 *    word, rejoin with \s+ so it matches ANY whitespace in the DOM
	 * 4. regex.exec(rawBuffer) → match position in raw buffer
	 * 5. createRanges() maps raw offset back to text nodes
	 */
	/**
	 * Find the Nth occurrence of sentence text in the DOM.
	 *
	 * `occurrence` is deterministic (computed during extraction),
	 * so duplicate lines always highlight the correct instance.
	 */
	private findTextInDOM(text: string, occurrence = 0): Range[] {
		if (!this.container) return [];

		const entries = this.collectEntries();
		if (entries.length === 0) return [];

		const rawBuffer = entries
			.map((e) => e.node.textContent ?? "")
			.join("");

		const words = text.split(/\s+/).filter((w) => w.length > 0);
		if (words.length === 0) return [];

		const pattern = words.map(escapeRegex).join(WORD_GAP);
		const regex = new RegExp(pattern, "g");

		// Find ALL matches, then pick the Nth one
		const allMatches: { index: number; length: number }[] = [];
		let m: RegExpExecArray | null;
		while ((m = regex.exec(rawBuffer)) !== null) {
			allMatches.push({ index: m.index, length: m[0].length });
		}

		if (allMatches.length === 0) return [];

		// Pick the correct occurrence, clamped to available matches
		const pick =
			allMatches[Math.min(occurrence, allMatches.length - 1)];

		return this.createRanges(pick.index, pick.length, entries);
	}

	private collectEntries(): TextEntry[] {
		const entries: TextEntry[] = [];
		let pos = 0;

		const walker = document.createTreeWalker(
			this.container!,
			NodeFilter.SHOW_TEXT,
			{
				acceptNode(node: Node) {
					const el = node.parentElement;
					if (el && el.closest(SKIP_SELECTOR))
						return NodeFilter.FILTER_REJECT;
					return NodeFilter.FILTER_ACCEPT;
				},
			},
		);

		let node: Text | null;
		while ((node = walker.nextNode() as Text | null)) {
			const len = node.textContent?.length ?? 0;
			if (len > 0) {
				entries.push({ node, start: pos, length: len });
				pos += len;
			}
		}
		return entries;
	}

	private createRanges(
		matchStart: number,
		matchLength: number,
		entries: TextEntry[],
	): Range[] {
		const matchEnd = matchStart + matchLength;
		const ranges: Range[] = [];

		for (const entry of entries) {
			const entryEnd = entry.start + entry.length;
			if (entryEnd <= matchStart) continue;
			if (entry.start >= matchEnd) break;

			const segStart = Math.max(0, matchStart - entry.start);
			const segEnd = Math.min(entry.length, matchEnd - entry.start);

			try {
				const range = document.createRange();
				range.setStart(entry.node, segStart);
				range.setEnd(entry.node, segEnd);
				ranges.push(range);
			} catch {
				// node detached or offsets invalid
			}
		}
		return ranges;
	}

	// --- Scrolling ---

	private tryScrollToRanges(): boolean {
		if (this.lastRanges.length === 0) return false;
		try {
			if (!this.lastRanges[0].startContainer.isConnected) return false;
			const rect = this.lastRanges[0].getBoundingClientRect();
			if (rect.height === 0) return false;
			this.scrollToRange(this.lastRanges[0]);
			return true;
		} catch {
			return false;
		}
	}

	private scrollToRange(range: Range): void {
		try {
			const rect = range.getBoundingClientRect();
			if (rect.height === 0) return;

			// Reserve the bottom 40% of the viewport — scroll before
			// the sentence gets anywhere near the toolbar.
			const viewportH = window.innerHeight;
			const safeBottom = viewportH * 0.6;

			if (rect.top >= 40 && rect.bottom <= safeBottom) return;

			const scrollContainer = this.findScrollContainer(
				range.startContainer as HTMLElement,
			);
			if (scrollContainer) {
				const containerRect = scrollContainer.getBoundingClientRect();
				// Position sentence near the top (1/6th from top edge)
				const scrollTop =
					scrollContainer.scrollTop +
					rect.top -
					containerRect.top -
					containerRect.height / 6;
				scrollContainer.scrollTo({
					top: scrollTop,
					behavior: "smooth",
				});
			} else {
				const el =
					range.startContainer.parentElement ??
					(range.startContainer as HTMLElement);
				el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
			}
		} catch {
			// range invalid
		}
	}

	private getScrollContainer(): HTMLElement | null {
		if (!this.container) return null;
		return this.findScrollContainer(this.container) ?? this.container;
	}

	private findScrollContainer(el: HTMLElement): HTMLElement | null {
		let current: HTMLElement | null = el?.parentElement ?? null;
		while (current) {
			const overflow = getComputedStyle(current).overflowY;
			if (
				overflow === "auto" ||
				overflow === "scroll" ||
				overflow === "overlay"
			) {
				return current;
			}
			current = current.parentElement;
		}
		return null;
	}
}

/** Escape special regex characters in a string */
function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
