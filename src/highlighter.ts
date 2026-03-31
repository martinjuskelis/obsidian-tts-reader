import type { SentenceInfo } from "./types";

const SKIP_SELECTOR =
	"pre, code, .frontmatter-container, .metadata-container, .frontmatter, style, script, .callout-icon";

interface TextRun {
	node: Text;
	bufferStart: number;
	length: number;
}

/**
 * Highlights the current sentence in the rendered Reading View.
 *
 * Searches the live DOM each time (lazy-rendered sections may come and go).
 * Tracks sentence progress so scrollToCurrent() can estimate position
 * even when the target section is de-rendered by Obsidian.
 */
export class Highlighter {
	private container: HTMLElement | null = null;
	private useCustomHighlight: boolean;
	private marks: HTMLElement[] = [];
	private lastSearchOffset = 0;
	private lastRanges: Range[] = [];
	private lastSentenceText = "";
	/** 0–1 ratio of current sentence position through the document */
	private progress = 0;

	constructor() {
		this.useCustomHighlight =
			typeof CSS !== "undefined" &&
			"highlights" in CSS &&
			typeof Highlight !== "undefined";
	}

	setContainer(el: HTMLElement): void {
		this.container = el;
		this.lastSearchOffset = 0;
	}

	/** Update progress ratio (called by playback controller on sentence change). */
	setProgress(current: number, total: number): void {
		this.progress = total > 0 ? current / total : 0;
	}

	highlight(sentence: SentenceInfo, autoScroll: boolean): void {
		this.clear();
		if (!this.container) return;

		this.lastSentenceText = sentence.text;
		const ranges = this.findTextInDOM(sentence.text);
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

	/**
	 * Scroll to the currently playing sentence. Handles the case where
	 * Obsidian has de-rendered the section by estimating the scroll
	 * position first (forcing a re-render), then finding the exact text.
	 */
	scrollToCurrent(): void {
		// 1. Try stored ranges (fast path — section still rendered)
		if (this.tryScrollToRanges()) return;

		// 2. Re-search DOM (maybe section was re-rendered since last highlight)
		if (this.lastSentenceText) {
			const ranges = this.findTextInDOM(this.lastSentenceText);
			if (ranges.length > 0) {
				this.lastRanges = ranges;
				this.scrollToRange(ranges[0]);
				return;
			}
		}

		// 3. Section is de-rendered. Jump to approximate position to force
		//    Obsidian to render it, then find the exact text after a tick.
		const scrollEl = this.getScrollContainer();
		if (!scrollEl) return;

		const target = scrollEl.scrollHeight * this.progress;
		scrollEl.scrollTo({ top: target, behavior: "instant" });

		// Wait for Obsidian to render the section, then find exact text
		setTimeout(() => {
			if (this.lastSentenceText) {
				const ranges = this.findTextInDOM(this.lastSentenceText);
				if (ranges.length > 0) {
					this.lastRanges = ranges;
					// Re-highlight
					if (this.useCustomHighlight) {
						const hl = new Highlight(...ranges);
						CSS.highlights.set("tts-reader-current", hl);
					}
					this.scrollToRange(ranges[0]);
				}
			}
		}, 150);
	}

	resetSearchPosition(): void {
		this.lastSearchOffset = 0;
	}

	// --- DOM search ---

	private findTextInDOM(text: string): Range[] {
		if (!this.container) return [];

		const runs = this.collectTextRuns();
		if (runs.length === 0) return [];

		const rawBuffer = runs.map((r) => r.node.textContent ?? "").join("");

		// Normalize: collapse newlines/whitespace to single spaces so
		// poetry (single \n → <br> → \n in DOM) matches the extracted
		// text where \n was replaced with spaces.
		const buffer = rawBuffer.replace(/\s+/g, " ");

		let idx = buffer.indexOf(text, this.lastSearchOffset);
		if (idx === -1) {
			idx = buffer.indexOf(text);
		}
		if (idx === -1) return [];

		// Map normalized offset back to raw offset for Range creation.
		// Walk the raw buffer counting characters, skipping collapsed whitespace.
		const rawIdx = this.normalizedToRaw(rawBuffer, idx);
		const rawEnd = this.normalizedToRaw(rawBuffer, idx + text.length);

		this.lastSearchOffset = idx + text.length;
		return this.createRanges(rawIdx, rawEnd - rawIdx, runs);
	}

	/**
	 * Convert an offset in the whitespace-normalized buffer back to
	 * the corresponding offset in the raw (un-normalized) buffer.
	 */
	private normalizedToRaw(raw: string, normOffset: number): number {
		let ni = 0;
		let ri = 0;
		let inWhitespace = false;
		while (ri < raw.length && ni < normOffset) {
			if (/\s/.test(raw[ri])) {
				if (!inWhitespace) {
					ni++; // one space in normalized
					inWhitespace = true;
				}
				ri++;
			} else {
				ni++;
				ri++;
				inWhitespace = false;
			}
		}
		return ri;
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
				// node detached
			}
		}
		return ranges;
	}

	// --- Scrolling helpers ---

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

			// Reserve space for the toolbar at the bottom (~120px covers
			// toolbar + any padding the user configured).
			const toolbarReserve = 140;
			const viewportH = window.innerHeight;
			const safeBottom = viewportH - toolbarReserve;

			// Already visible in the safe zone — no scroll needed
			if (rect.top >= 60 && rect.bottom <= safeBottom) return;

			const scrollContainer = this.findScrollContainer(
				range.startContainer as HTMLElement,
			);
			if (scrollContainer) {
				const containerRect = scrollContainer.getBoundingClientRect();
				// Position sentence in the upper quarter of the viewport
				const scrollTop =
					scrollContainer.scrollTop +
					rect.top -
					containerRect.top -
					containerRect.height / 4;
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
		return (
			this.findScrollContainer(this.container) ?? this.container
		);
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
