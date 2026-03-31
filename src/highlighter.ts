import type { SentenceInfo } from "./types";

/**
 * Highlights the current sentence in the rendered document.
 *
 * Primary method: CSS Custom Highlight API (no DOM modification).
 * Fallback: wraps text in <mark> elements (modifies DOM, but cleans up).
 */
export class Highlighter {
	private useCustomHighlight: boolean;
	private marks: HTMLElement[] = [];
	private activeBlockEl: HTMLElement | null = null;

	constructor() {
		// Feature-detect CSS Custom Highlight API
		this.useCustomHighlight =
			typeof CSS !== "undefined" &&
			"highlights" in CSS &&
			typeof Highlight !== "undefined";
	}

	/** Highlight the given sentence and optionally scroll it into view. */
	highlight(sentence: SentenceInfo, autoScroll: boolean): void {
		this.clear();

		if (this.useCustomHighlight) {
			this.highlightWithCustomAPI(sentence);
		} else {
			this.highlightWithMarks(sentence);
		}

		this.activeBlockEl = sentence.blockEl;

		if (autoScroll) {
			this.scrollToSentence(sentence);
		}
	}

	/** Remove all highlights. */
	clear(): void {
		if (this.useCustomHighlight) {
			try {
				CSS.highlights.delete("tts-reader-current");
			} catch {
				// Ignore if already cleared
			}
		} else {
			this.unwrapMarks();
		}
		if (this.activeBlockEl) {
			this.activeBlockEl.classList.remove("tts-reader-active-block");
			this.activeBlockEl = null;
		}
	}

	// --- CSS Custom Highlight API path ---

	private highlightWithCustomAPI(sentence: SentenceInfo): void {
		const validRanges: AbstractRange[] = [];
		for (const range of sentence.ranges) {
			try {
				// Verify the range is still valid
				if (range.startContainer.isConnected) {
					validRanges.push(range);
				}
			} catch {
				// Range became invalid (DOM changed), skip
			}
		}

		if (validRanges.length > 0) {
			const highlight = new Highlight(...validRanges);
			CSS.highlights.set("tts-reader-current", highlight);
		}

		// Also add a class on the block for the fallback scroll indicator
		sentence.blockEl.classList.add("tts-reader-active-block");
	}

	// --- Mark-based fallback path ---

	private highlightWithMarks(sentence: SentenceInfo): void {
		sentence.blockEl.classList.add("tts-reader-active-block");

		for (const range of sentence.ranges) {
			try {
				if (!range.startContainer.isConnected) continue;

				const mark = document.createElement("mark");
				mark.className = "tts-reader-highlight";
				range.surroundContents(mark);
				this.marks.push(mark);
			} catch {
				// surroundContents fails if range crosses element boundary;
				// fall back to just the block-level class
			}
		}
	}

	private unwrapMarks(): void {
		for (const mark of this.marks) {
			const parent = mark.parentNode;
			if (!parent) continue;
			while (mark.firstChild) {
				parent.insertBefore(mark.firstChild, mark);
			}
			parent.removeChild(mark);
			parent.normalize();
		}
		this.marks = [];
	}

	// --- Scrolling ---

	private scrollToSentence(sentence: SentenceInfo): void {
		// Try to scroll the first range's bounding rect into view
		let target: Element | null = null;

		if (sentence.ranges.length > 0) {
			try {
				const rect = sentence.ranges[0].getBoundingClientRect();
				if (rect.height > 0) {
					// Check if the sentence is already visible in the viewport
					const viewportH = window.innerHeight;
					if (rect.top >= 0 && rect.bottom <= viewportH) {
						return; // Already visible
					}

					// Find the scrollable container
					const scrollContainer = this.findScrollContainer(
						sentence.blockEl,
					);
					if (scrollContainer) {
						const containerRect =
							scrollContainer.getBoundingClientRect();
						const scrollTop =
							scrollContainer.scrollTop +
							rect.top -
							containerRect.top -
							containerRect.height / 3;
						scrollContainer.scrollTo({
							top: scrollTop,
							behavior: "smooth",
						});
						return;
					}
				}
			} catch {
				// Range method failed, fall through to element scroll
			}
		}

		// Fallback: scroll the block element into view
		target = sentence.blockEl;
		target.scrollIntoView({ behavior: "smooth", block: "center" });
	}

	private findScrollContainer(el: HTMLElement): HTMLElement | null {
		let current: HTMLElement | null = el.parentElement;
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
