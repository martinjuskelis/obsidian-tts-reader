import type { SentenceInfo } from "./types";

/**
 * Build an array of approximate character offsets mapping each sentence
 * to its position in the original raw markdown.
 *
 * Uses sequential word search: for each sentence, the first few words
 * are turned into a regex with flexible gaps (to skip markdown formatting
 * like **bold**, _italic_, [[links]], etc.) and searched forward from
 * the last match position.
 *
 * Returns a number[] parallel to the sentences array.
 */
export function buildSentenceOffsets(
	markdown: string,
	sentences: readonly SentenceInfo[],
): number[] {
	const offsets: number[] = [];
	let searchFrom = 0;

	for (const sentence of sentences) {
		const words = sentence.text.split(/\s+/).filter((w) => w.length > 0);
		if (words.length === 0) {
			offsets.push(searchFrom);
			continue;
		}

		// Take up to 4 words for the search pattern
		const searchWords = words.slice(0, Math.min(4, words.length));
		// Each word escaped, joined with flexible gap to match through formatting
		const pattern = searchWords.map(escapeRegex).join("[\\s\\S]{0,40}");
		const regex = new RegExp(pattern);

		// Search from where we left off
		const remaining = markdown.substring(searchFrom);
		const match = regex.exec(remaining);

		if (match) {
			const offset = searchFrom + match.index;
			offsets.push(offset);
			searchFrom = offset + match[0].length;
		} else {
			// Fallback: keep the same position (sentence might have been
			// in a stripped region like code block or frontmatter)
			offsets.push(searchFrom);
		}
	}

	return offsets;
}

/**
 * Find the sentence index whose offset is closest to (and not after)
 * the given cursor offset.  Uses binary search.
 */
export function findSentenceAtOffset(
	offsets: number[],
	cursorOffset: number,
): number {
	if (offsets.length === 0) return 0;

	let lo = 0;
	let hi = offsets.length - 1;

	while (lo < hi) {
		const mid = (lo + hi + 1) >>> 1;
		if (offsets[mid] <= cursorOffset) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}

	return lo;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
