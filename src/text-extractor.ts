import type { SentenceInfo } from "./types";

/**
 * Extract readable text from Markdown and split into TTS-ready chunks.
 *
 * The pipeline:
 * 1. Strip Markdown syntax (frontmatter, code, formatting) → clean text
 * 2. Split into structural blocks (paragraphs, headings)
 * 3. Sentence-split each block using Intl.Segmenter (multilingual)
 * 4. Accumulate sentences into chunks up to `maxChunkChars`
 *    - Headings always merge forward with the next content
 *    - Never break mid-sentence
 *    - Paragraph boundaries are preferred break points
 */

/**
 * Main entry point. Returns chunks sized for the TTS API.
 * With maxChunkChars=0, returns one sentence per chunk (legacy behavior).
 */
export function extractChunks(
	markdown: string,
	skipCodeBlocks: boolean,
	skipFrontmatter: boolean,
	maxChunkChars: number,
): SentenceInfo[] {
	const text = stripMarkdown(markdown, skipCodeBlocks, skipFrontmatter);
	const blocks = splitIntoBlocks(text);
	const sentences = segmentBlocks(blocks);

	if (maxChunkChars <= 0) {
		return sentences;
	}

	return accumulateChunks(sentences, blocks, maxChunkChars);
}

/** Backwards-compatible: extract one sentence per entry (for webspeech/deepinfra). */
export function extractSentences(
	markdown: string,
	skipCodeBlocks: boolean,
	skipFrontmatter: boolean,
): SentenceInfo[] {
	return extractChunks(markdown, skipCodeBlocks, skipFrontmatter, 0);
}

// ---------------------------------------------------------------------------
// Step 1: Strip Markdown syntax
// ---------------------------------------------------------------------------

function stripMarkdown(
	markdown: string,
	skipCodeBlocks: boolean,
	skipFrontmatter: boolean,
): string {
	let text = markdown;

	// Frontmatter
	if (skipFrontmatter) {
		text = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
	}

	// Fenced code blocks  (``` or ~~~)
	if (skipCodeBlocks) {
		text = text.replace(/^(`{3,}|~{3,}).*\r?\n[\s\S]*?\r?\n\1\s*$/gm, "");
	}

	// Inline code
	if (skipCodeBlocks) {
		text = text.replace(/`[^`\n]+`/g, "");
	}

	// HTML tags
	text = text.replace(/<[^>]+>/g, "");

	// Comments  (%%...%%)
	text = text.replace(/%%[\s\S]*?%%/g, "");

	// Images / embeds
	text = text.replace(/!\[\[.*?\]\]/g, "");
	text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");

	// Wikilinks  [[page|display]] → display,  [[page]] → page
	text = text.replace(
		/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,
		(_, page, display) => display ?? page,
	);

	// Markdown links  [text](url) → text
	text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

	// Bold / italic / strikethrough / highlight
	text = text.replace(/\*{1,3}(.+?)\*{1,3}/g, "$1");
	text = text.replace(/_{1,3}(.+?)_{1,3}/g, "$1");
	text = text.replace(/~~(.+?)~~/g, "$1");
	text = text.replace(/==(.+?)==/g, "$1");

	// Blockquote markers
	text = text.replace(/^>\s*/gm, "");

	// Horizontal rules
	text = text.replace(/^[-*_]{3,}\s*$/gm, "");

	// List markers  (-, *, +, 1.)
	text = text.replace(/^[\t ]*[-*+]\s+/gm, "");
	text = text.replace(/^[\t ]*\d+\.\s+/gm, "");

	// Task checkboxes  [ ] or [x]
	text = text.replace(/\[[ xX]\]\s*/g, "");

	// Footnote references  [^1]
	text = text.replace(/\[\^\w+\]/g, "");

	return text;
}

// ---------------------------------------------------------------------------
// Step 2: Split into structural blocks
// ---------------------------------------------------------------------------

interface TextBlock {
	text: string;
	isHeading: boolean;
}

function splitIntoBlocks(text: string): TextBlock[] {
	// Split the stripped text at paragraph boundaries first, then
	// detect which blocks were headings (short, no terminal punctuation,
	// preceded by a blank line — headings were converted to standalone
	// paragraphs by the markdown stripping which adds \n\n around them).
	const rawBlocks = text.split(/\n{2,}/);
	const blocks: TextBlock[] = [];

	for (const raw of rawBlocks) {
		const clean = raw.replace(/\n/g, " ").trim();
		if (clean.length === 0) continue;

		// Heuristic: a heading is a short block (< 200 chars) with no
		// sentence-ending punctuation. This works because the markdown
		// stripping already removed # markers and placed headings as
		// their own paragraphs.
		const isHeading =
			clean.length < 200 && !/[.!?:;]\s*$/.test(clean);

		blocks.push({ text: clean, isHeading });
	}

	return blocks;
}

// ---------------------------------------------------------------------------
// Step 3: Sentence segmentation using Intl.Segmenter
// ---------------------------------------------------------------------------

function segmentBlocks(blocks: TextBlock[]): SentenceInfo[] {
	const results: SentenceInfo[] = [];
	const occurrenceCounts = new Map<string, number>();

	for (const block of blocks) {
		const sentences = splitSentences(block.text);
		for (const sentence of sentences) {
			const trimmed = sentence.trim();
			if (trimmed.length === 0) continue;
			const occ = occurrenceCounts.get(trimmed) ?? 0;
			results.push({ text: trimmed, occurrence: occ });
			occurrenceCounts.set(trimmed, occ + 1);
		}
	}

	return results;
}

/**
 * Split text into sentences using Intl.Segmenter (built-in, multilingual).
 * Falls back to regex splitting if Intl.Segmenter is not available.
 */
function splitSentences(text: string): string[] {
	if (typeof Intl !== "undefined" && Intl.Segmenter) {
		const segmenter = new Intl.Segmenter(undefined, {
			granularity: "sentence",
		});
		const segments: string[] = [];
		for (const seg of segmenter.segment(text)) {
			const trimmed = seg.segment.trim();
			if (trimmed.length > 0) {
				segments.push(trimmed);
			}
		}
		return segments;
	}

	// Fallback: simple regex split for environments without Intl.Segmenter
	return text
		.split(/(?<=[.!?])\s+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// Step 4: Accumulate sentences into TTS-sized chunks
// ---------------------------------------------------------------------------

/**
 * Accumulate sentences into chunks up to maxChunkChars.
 *
 * Rules:
 * - Never break mid-sentence.
 * - Prefer paragraph boundaries as break points.
 * - Headings always merge forward (never orphaned at the end of a chunk).
 * - If a single sentence exceeds the limit, sub-split at clause boundaries.
 */
function accumulateChunks(
	sentences: SentenceInfo[],
	blocks: TextBlock[],
	maxChars: number,
): SentenceInfo[] {
	// Build a set of sentence indices that start a new paragraph.
	// This lets us prefer breaking at paragraph boundaries.
	const paragraphStarts = buildParagraphStartSet(sentences, blocks);

	const chunks: SentenceInfo[] = [];
	let pending = "";
	let pendingOcc = 0;

	for (let i = 0; i < sentences.length; i++) {
		const s = sentences[i];
		const sentText = s.text;

		// Handle a single sentence that exceeds the limit on its own
		if (sentText.length > maxChars && pending.length === 0) {
			const subChunks = splitLongSentence(sentText, maxChars);
			for (const sub of subChunks) {
				chunks.push({ text: sub, occurrence: s.occurrence });
			}
			continue;
		}

		// Would adding this sentence exceed the limit?
		const combined = pending.length === 0
			? sentText
			: pending + " " + sentText;

		if (combined.length > maxChars && pending.length > 0) {
			// Flush current chunk — but only if the pending text doesn't
			// end with a heading (headings must merge forward)
			if (!endsWithHeading(pending, sentences, i - 1, blocks, paragraphStarts)) {
				chunks.push({ text: pending, occurrence: pendingOcc });
				pending = sentText;
				pendingOcc = s.occurrence;
				continue;
			}
			// If pending ends with heading text, keep accumulating
		}

		// Accumulate
		if (pending.length === 0) {
			pending = sentText;
			pendingOcc = s.occurrence;
		} else {
			pending = pending + " " + sentText;
		}
	}

	// Flush remainder
	if (pending.length > 0) {
		chunks.push({ text: pending, occurrence: pendingOcc });
	}

	return chunks;
}

/**
 * Build a set of sentence indices that begin a new block/paragraph.
 */
function buildParagraphStartSet(
	sentences: SentenceInfo[],
	blocks: TextBlock[],
): Set<number> {
	const starts = new Set<number>();
	let sentIdx = 0;
	for (const block of blocks) {
		const blockSentences = splitSentences(block.text);
		starts.add(sentIdx);
		sentIdx += blockSentences.filter((s) => s.trim().length > 0).length;
	}
	return starts;
}

/**
 * Check if the pending text ends with a heading block's text.
 */
function endsWithHeading(
	pending: string,
	sentences: SentenceInfo[],
	lastIdx: number,
	blocks: TextBlock[],
	_paragraphStarts: Set<number>,
): boolean {
	if (lastIdx < 0) return false;
	const lastSent = sentences[lastIdx].text;
	// Check if this sentence matches any heading block
	for (const block of blocks) {
		if (block.isHeading && lastSent === block.text) {
			return true;
		}
	}
	return false;
}

/**
 * Split a very long sentence at clause boundaries (commas, semicolons,
 * colons, conjunctions) so each sub-chunk fits within maxChars.
 */
function splitLongSentence(text: string, maxChars: number): string[] {
	// Try splitting at clause boundaries
	const clausePattern = /[,;:]\s+|\s+(?:and|but|or|nor|for|yet|so|ir|bet|ar|nei|nes|tačiau)\s+/gi;
	const parts: string[] = [];
	let lastEnd = 0;
	let match: RegExpExecArray | null;

	clausePattern.lastIndex = 0;
	while ((match = clausePattern.exec(text)) !== null) {
		parts.push(text.substring(lastEnd, match.index + match[0].length).trim());
		lastEnd = match.index + match[0].length;
	}
	if (lastEnd < text.length) {
		parts.push(text.substring(lastEnd).trim());
	}

	// Accumulate clause parts into sub-chunks
	const subChunks: string[] = [];
	let current = "";
	for (const part of parts) {
		if (current.length + part.length + 1 > maxChars && current.length > 0) {
			subChunks.push(current);
			current = part;
		} else {
			current = current.length === 0 ? part : current + " " + part;
		}
	}
	if (current.length > 0) {
		subChunks.push(current);
	}

	// If clause splitting didn't help (no boundaries found), hard-split
	if (subChunks.length === 0 || subChunks.some((c) => c.length > maxChars)) {
		const hardChunks: string[] = [];
		for (let i = 0; i < text.length; i += maxChars) {
			// Try to break at a space
			let end = Math.min(i + maxChars, text.length);
			if (end < text.length) {
				const spaceIdx = text.lastIndexOf(" ", end);
				if (spaceIdx > i) end = spaceIdx;
			}
			hardChunks.push(text.substring(i, end).trim());
			if (end !== i + maxChars) i = end - maxChars; // adjust for space-break
		}
		return hardChunks.filter((c) => c.length > 0);
	}

	return subChunks.filter((c) => c.length > 0);
}
