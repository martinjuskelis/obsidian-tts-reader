import type { SentenceInfo } from "./types";

/**
 * Selectors for block-level elements whose text content should be read.
 * Each matched element is treated as an independent unit for sentence splitting.
 */
const BLOCK_SELECTOR =
	"p, h1, h2, h3, h4, h5, h6, li, td, th, dt, dd, figcaption";

/** Common abbreviations that end with a period but aren't sentence boundaries */
const ABBREVIATIONS = new Set([
	"mr",
	"mrs",
	"ms",
	"dr",
	"prof",
	"sr",
	"jr",
	"st",
	"vs",
	"etc",
	"inc",
	"ltd",
	"corp",
	"dept",
	"est",
	"govt",
	"approx",
	"no",
	"vol",
	"fig",
	"jan",
	"feb",
	"mar",
	"apr",
	"jun",
	"jul",
	"aug",
	"sep",
	"oct",
	"nov",
	"dec",
	"al", // et al.
]);

interface TextRun {
	node: Text;
	/** Where this node's text starts in the concatenated block text */
	bufferStart: number;
	/** Length of this node's text content */
	length: number;
}

/**
 * Extract sentences from the rendered Reading View DOM.
 *
 * Walks block-level elements, concatenates their text nodes (preserving DOM
 * position info), splits the text into sentences, and produces Range objects
 * that map each sentence back to the DOM for highlighting.
 */
export function extractSentences(
	container: HTMLElement,
	skipCodeBlocks: boolean,
	skipFrontmatter: boolean,
): SentenceInfo[] {
	const results: SentenceInfo[] = [];
	const blocks = container.querySelectorAll(BLOCK_SELECTOR);
	const processedNodes = new WeakSet<Text>();

	for (const block of Array.from(blocks)) {
		const el = block as HTMLElement;
		if (shouldSkip(el, skipCodeBlocks, skipFrontmatter)) continue;

		// Collect text nodes belonging directly to this block (not nested blocks)
		const runs = collectTextRuns(el, processedNodes);
		if (runs.length === 0) continue;

		const fullText = runs.map((r) => r.node.textContent ?? "").join("");
		if (fullText.trim().length === 0) continue;

		// Split into sentences
		const bounds = findSentenceBoundaries(fullText);

		for (const [start, end] of bounds) {
			const text = fullText.substring(start, end).trim();
			if (text.length === 0) continue;

			// Map character offsets back to DOM Ranges
			const ranges = mapToRanges(start, end, runs);
			if (ranges.length > 0) {
				results.push({ text, blockEl: el, ranges });
			}
		}
	}

	return results;
}

function shouldSkip(
	el: HTMLElement,
	skipCode: boolean,
	skipFrontmatter: boolean,
): boolean {
	// Skip frontmatter containers
	if (
		skipFrontmatter &&
		(el.closest(".frontmatter-container") ||
			el.closest(".metadata-container") ||
			el.closest(".frontmatter"))
	) {
		return true;
	}
	// Skip code blocks (pre elements)
	if (skipCode && (el.closest("pre") || el.tagName === "PRE")) {
		return true;
	}
	// Skip collapsed/hidden elements
	if (
		el.offsetParent === null &&
		getComputedStyle(el).display === "none"
	) {
		return true;
	}
	return false;
}

/**
 * Collect text nodes from a block element, skipping nodes that belong to
 * nested block elements (those will be processed when we reach that block).
 * Marks processed nodes in the WeakSet to prevent duplicates.
 */
function collectTextRuns(
	blockEl: HTMLElement,
	processed: WeakSet<Text>,
): TextRun[] {
	const runs: TextRun[] = [];
	let bufferPos = 0;

	const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
	let node: Text | null;

	while ((node = walker.nextNode() as Text | null)) {
		if (processed.has(node)) continue;

		// Check if this text node's closest block ancestor is our target block.
		// If it belongs to a nested block (e.g., an <li> inside our <li>),
		// skip it — it will be processed when we reach that inner block.
		const closestBlock = node.parentElement?.closest(BLOCK_SELECTOR);
		if (closestBlock && closestBlock !== blockEl) continue;

		const text = node.textContent ?? "";
		if (text.length === 0) continue;

		processed.add(node);
		runs.push({ node, bufferStart: bufferPos, length: text.length });
		bufferPos += text.length;
	}

	return runs;
}

/**
 * Find sentence boundaries in a block of text.
 * Returns [start, end) pairs into the text string.
 */
function findSentenceBoundaries(text: string): [number, number][] {
	if (text.trim().length === 0) return [];

	const bounds: [number, number][] = [];

	// Skip leading whitespace
	let sentenceStart = 0;
	while (sentenceStart < text.length && /\s/.test(text[sentenceStart])) {
		sentenceStart++;
	}
	if (sentenceStart >= text.length) return [];

	// Search for sentence-ending punctuation followed by whitespace
	const pattern = /([.!?]+)\s+/g;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(text)) !== null) {
		const punctStart = match.index;
		const punctEnd = match.index + match[1].length;
		const afterSpace = match.index + match[0].length;

		if (afterSpace >= text.length) {
			// Punctuation + whitespace at very end — sentence ends at punctuation
			bounds.push([sentenceStart, punctEnd]);
			sentenceStart = text.length;
			break;
		}

		const nextChar = text[afterSpace];

		// Only split if the next character looks like a sentence start
		if (
			!/[A-Z\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF"'\u201C\u2018(\[*\-\u2022]/.test(
				nextChar,
			)
		) {
			continue;
		}

		// Check for abbreviations
		if (match[1] === ".") {
			const wordBefore = getWordBefore(text, punctStart);
			if (ABBREVIATIONS.has(wordBefore.toLowerCase())) continue;

			// Single-letter initials: "J. K. Rowling"
			if (wordBefore.length === 1 && /[A-Z]/.test(wordBefore)) continue;

			// Decimal numbers: "3.14"
			if (
				punctStart > 0 &&
				/\d/.test(text[punctStart - 1]) &&
				punctEnd < text.length &&
				/\d/.test(text[punctEnd])
			) {
				continue;
			}
		}

		// Ellipsis followed by lowercase typically continues the sentence
		if (match[1].length >= 3) {
			if (/[a-z]/.test(nextChar)) continue;
		}

		bounds.push([sentenceStart, punctEnd]);
		sentenceStart = afterSpace;
	}

	// Remaining text is the last (or only) sentence
	if (sentenceStart < text.length) {
		let end = text.length;
		while (end > sentenceStart && /\s/.test(text[end - 1])) end--;
		if (end > sentenceStart) {
			bounds.push([sentenceStart, end]);
		}
	}

	return bounds;
}

/** Extract the word immediately before position `pos` in `text`. */
function getWordBefore(text: string, pos: number): string {
	let start = pos - 1;
	while (start >= 0 && /[a-zA-Z]/.test(text[start])) start--;
	return text.substring(start + 1, pos);
}

/**
 * Map character offsets [start, end) in the concatenated text back to
 * DOM Range objects covering the corresponding text nodes.
 */
function mapToRanges(
	charStart: number,
	charEnd: number,
	runs: TextRun[],
): Range[] {
	const ranges: Range[] = [];

	for (const run of runs) {
		const runEnd = run.bufferStart + run.length;

		// Skip runs entirely before or after our target range
		if (runEnd <= charStart) continue;
		if (run.bufferStart >= charEnd) break;

		// This run overlaps with [charStart, charEnd)
		const segStart = Math.max(0, charStart - run.bufferStart);
		const segEnd = Math.min(run.length, charEnd - run.bufferStart);

		try {
			const range = document.createRange();
			range.setStart(run.node, segStart);
			range.setEnd(run.node, segEnd);
			ranges.push(range);
		} catch {
			// If the node is detached or offsets are invalid, skip
		}
	}

	return ranges;
}
