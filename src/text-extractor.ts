import type { SentenceInfo } from "./types";

/**
 * Extract sentences from raw Markdown source text.
 *
 * Unlike DOM-based extraction, this works on the full document regardless
 * of whether Obsidian has lazily rendered later sections in Reading View.
 * Markdown formatting is stripped so the TTS engine reads clean prose.
 */
export function extractSentences(
	markdown: string,
	skipCodeBlocks: boolean,
	skipFrontmatter: boolean,
): SentenceInfo[] {
	let text = markdown;

	// --- Strip non-readable content ---

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

	// --- Strip formatting but keep text ---

	// Images / embeds  (before links, since ![[]] looks like [[]])
	text = text.replace(/!\[\[.*?\]\]/g, "");
	text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");

	// Wikilinks  [[page|display]] → display,  [[page]] → page
	text = text.replace(
		/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,
		(_, page, display) => display ?? page,
	);

	// Markdown links  [text](url) → text
	text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

	// Heading markers → own paragraph (ensures heading doesn't merge with next line)
	text = text.replace(/^#{1,6}\s+(.+)$/gm, "\n\n$1\n\n");

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

	// --- Split into paragraphs, then sentences ---

	const paragraphs = text.split(/\n{2,}/);
	const results: SentenceInfo[] = [];
	const occurrenceCounts = new Map<string, number>();

	for (const para of paragraphs) {
		const clean = para.replace(/\n/g, " ").trim();
		if (clean.length === 0) continue;

		const bounds = findSentenceBoundaries(clean);
		for (const [start, end] of bounds) {
			const sentence = clean.substring(start, end).trim();
			if (sentence.length > 0) {
				const occ = occurrenceCounts.get(sentence) ?? 0;
				results.push({ text: sentence, occurrence: occ });
				occurrenceCounts.set(sentence, occ + 1);
			}
		}
	}

	return results;
}

// --- Sentence splitter (unchanged from before) ---

const ABBREVIATIONS = new Set([
	"mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc",
	"inc", "ltd", "corp", "dept", "est", "govt", "approx", "no",
	"vol", "fig", "jan", "feb", "mar", "apr", "jun", "jul", "aug",
	"sep", "oct", "nov", "dec", "al",
]);

function findSentenceBoundaries(text: string): [number, number][] {
	if (text.trim().length === 0) return [];

	const bounds: [number, number][] = [];
	let sentenceStart = 0;
	while (sentenceStart < text.length && /\s/.test(text[sentenceStart]))
		sentenceStart++;
	if (sentenceStart >= text.length) return [];

	const pattern = /([.!?]+)\s+/g;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(text)) !== null) {
		const punctStart = match.index;
		const punctEnd = match.index + match[1].length;
		const afterSpace = match.index + match[0].length;

		if (afterSpace >= text.length) {
			bounds.push([sentenceStart, punctEnd]);
			sentenceStart = text.length;
			break;
		}

		const nextChar = text[afterSpace];
		if (
			!/[A-Z\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF"'\u201C\u2018(\[*\-\u2022]/.test(
				nextChar,
			)
		) {
			continue;
		}

		if (match[1] === ".") {
			const wordBefore = getWordBefore(text, punctStart);
			if (ABBREVIATIONS.has(wordBefore.toLowerCase())) continue;
			if (wordBefore.length === 1 && /[A-Z]/.test(wordBefore)) continue;
			if (
				punctStart > 0 &&
				/\d/.test(text[punctStart - 1]) &&
				punctEnd < text.length &&
				/\d/.test(text[punctEnd])
			) {
				continue;
			}
		}

		if (match[1].length >= 3 && /[a-z]/.test(nextChar)) continue;

		bounds.push([sentenceStart, punctEnd]);
		sentenceStart = afterSpace;
	}

	if (sentenceStart < text.length) {
		let end = text.length;
		while (end > sentenceStart && /\s/.test(text[end - 1])) end--;
		if (end > sentenceStart) {
			bounds.push([sentenceStart, end]);
		}
	}

	return bounds;
}

function getWordBefore(text: string, pos: number): string {
	let start = pos - 1;
	while (start >= 0 && /[a-zA-Z]/.test(text[start])) start--;
	return text.substring(start + 1, pos);
}
