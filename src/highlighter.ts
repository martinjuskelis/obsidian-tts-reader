import type { SentenceInfo } from "./types";

/**
 * Elements to skip when searching for text in the DOM.
 * These contain content that was stripped during markdown extraction.
 */
const SKIP_SELECTOR =
	"pre, code, .frontmatter-container, .metadata-container, .frontmatter, style, script, .callout-icon";

interface TextRun {
	node: Text;
	/** Offset of this node's start within the full concatenated buffer */
	bufferStart: number;
	length: number;
}

/**
 * Highlights the current sentence in the rendered Reading View.
 *
 * Since Obsidian lazy-renders Reading View sections, we can't store
 * pre-built Range objects. Instead we search the live DOM for the
 * sentence text each time highlight() is called.
 *
 * Primary: CSS Custom Highlight API.  Fallback: <mark> elements.
 */
export class Highlighter {
	private container: HTMLElement | null = null;
	private useCustomHighlight: boolean;
	private marks: HTMLElement[] = [];
	private lastSearchOffset = 0;

	constructor() {
		this.useCustomHighlight =
			typeof CSS !== "undefined" &&
			"highlights" in CSS &&
			typeof Highlight !== "undefined";
	}

	/** Bind to the reading-view container so highlight() knows where to search. */
	setContainer(el: HTMLElement): void {
		this.container = el;
		this.lastSearchOffset = 0;
	}

	/** Find the sentence text in the DOM, highlight it, and optionally scroll. */
	highlight(sentence: SentenceInfo, autoScroll: boolean): void {
		this.clear();
		if (!this.container) return;

		const ranges = this.findTextInDOM(sentence.text);
		if (ranges.length === 0) return;

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
					// surroundContents fails on cross-element ranges; skip
				}
			}
		}

		if (autoScroll) {
			this.scrollToRange(ranges[0]);
		}
	}

	/** Remove all highlights. */
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

	/** Reset the search position (e.g., when jumping backward). */
	resetSearchPosition(): void {
		this.lastSearchOffset = 0;
	}

	// --- DOM search ---

	/**
	 * Build a text buffer from all visible text nodes in the container
	 * (skipping code blocks, frontmatter, etc.), then search for the
	 * sentence text and create Range objects covering the match.
	 */
	private findTextInDOM(text: string): Range[] {
		if (!this.container) return [];

		const runs = this.collectTextRuns();
		if (runs.length === 0) return [];

		const buffer = runs.map((r) => r.node.textContent ?? "").join("");

		// Search forward from last position first (normal sequential reading)
		let idx = buffer.indexOf(text, this.lastSearchOffset);
		if (idx === -1) {
			// Not found ahead — search from beginning (jump backward / wrap)
			idx = buffer.indexOf(text);
		}
		if (idx === -1) return [];

		this.lastSearchOffset = idx + text.length;

		// Map buffer offset → DOM Ranges
		return this.createRanges(idx, text.length, runs);
	}

	private collectTextRuns(): TextRun[] {
		const runs: TextRun[] = [];
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
				runs.push({ node, bufferStart: pos, length: len });
				pos += len;
			}
		}
		return runs;
	}

	private createRanges(
		start: number,
		length: number,
		runs: TextRun[],
	): Range[] {
		const end = start + length;
		const ranges: Range[] = [];

		for (const run of runs) {
			const runEnd = run.bufferStart + run.length;
			if (runEnd <= start) continue;
			if (run.bufferStart >= end) break;

			const segStart = Math.max(0, start - run.bufferStart);
			const segEnd = Math.min(run.length, end - run.bufferStart);

			try {
				const range = document.createRange();
				range.setStart(run.node, segStart);
				range.setEnd(run.node, segEnd);
				ranges.push(range);
			} catch {
				// node detached or offsets invalid
			}
		}
		return ranges;
	}

	// --- Scrolling ---

	private scrollToRange(range: Range): void {
		try {
			const rect = range.getBoundingClientRect();
			if (rect.height === 0) return;

			const viewportH = window.innerHeight;
			if (rect.top >= 0 && rect.bottom <= viewportH) return;

			const scrollContainer = this.findScrollContainer(
				range.startContainer as HTMLElement,
			);
			if (scrollContainer) {
				const containerRect = scrollContainer.getBoundingClientRect();
				const scrollTop =
					scrollContainer.scrollTop +
					rect.top -
					containerRect.top -
					containerRect.height / 3;
				scrollContainer.scrollTo({ top: scrollTop, behavior: "smooth" });
			} else {
				// Fallback: scroll the range's parent element into view
				const el =
					range.startContainer.parentElement ??
					(range.startContainer as HTMLElement);
				el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
			}
		} catch {
			// range became invalid
		}
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
