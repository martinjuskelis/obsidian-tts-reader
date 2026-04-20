import { Notice, type WorkspaceLeaf } from "obsidian";
import { Reader, type SentenceContext } from "./reader";
import type { SentenceInfo } from "./types";
import type { Highlighter } from "./highlighter";
import type { PlaybackController } from "./playback";
import { extractChunksFromPlain } from "./text-extractor";
import {
	getPDFDocument,
	getPDFViewerCore,
	type PDFView,
	type PDFTextContentItem,
	type PDFViewerCore,
} from "./pdf-types";

export interface PdfReaderOptions {
	maxChunkChars: number;
	/** Min chars per page for a PDF to count as "has a text layer". */
	minCharsPerPage: number;
}

interface PageRange {
	pageNumber: number;
	/** Character offset where this page starts in the joined buffer. */
	start: number;
	/** Character offset where this page ends (exclusive) in the joined buffer. */
	end: number;
}

/**
 * Reader for Obsidian's built-in PDF view.
 *
 * v1 scope: native-text PDFs only. Scanned PDFs (no text layer) are
 * detected up front and rejected with guidance to run OCR externally.
 */
export class PdfReader extends Reader {
	readonly view: PDFView;
	readonly filePath: string | null;
	readonly leaf: WorkspaceLeaf;

	private readonly opts: PdfReaderOptions;
	private sentencePages: number[] = [];
	private clickTeardown: (() => void) | null = null;

	constructor(view: PDFView, opts: PdfReaderOptions) {
		super();
		this.view = view;
		this.filePath = view.file?.path ?? null;
		this.leaf = view.leaf;
		this.opts = opts;
	}

	async extractChunks(): Promise<SentenceInfo[]> {
		const doc = getPDFDocument(this.view);
		if (!doc) {
			new Notice(
				"TTS Reader: PDF not ready yet. Open the PDF fully, then try again.",
			);
			return [];
		}

		const pageTexts: { pageNumber: number; text: string }[] = [];
		for (let n = 1; n <= doc.numPages; n++) {
			const page = await doc.getPage(n);
			const content = await page.getTextContent();
			pageTexts.push({
				pageNumber: n,
				text: buildPageText(content.items),
			});
		}

		// Scanned-PDF guard. Cheap native-text PDFs always return plenty
		// of characters; OCR-less scans return almost nothing.
		const totalChars = pageTexts.reduce((sum, p) => sum + p.text.length, 0);
		if (totalChars < doc.numPages * this.opts.minCharsPerPage) {
			new Notice(
				"TTS Reader: This PDF has no readable text layer (looks scanned). " +
					"Run OCR on it first (e.g. `ocrmypdf input.pdf output.pdf`).",
				12000,
			);
			return [];
		}

		// Join pages with a paragraph break; track per-page char ranges for
		// sentence → page mapping.
		let joined = "";
		const pageRanges: PageRange[] = [];
		for (let i = 0; i < pageTexts.length; i++) {
			const start = joined.length;
			joined += pageTexts[i].text;
			const end = joined.length;
			pageRanges.push({ pageNumber: pageTexts[i].pageNumber, start, end });
			if (i < pageTexts.length - 1) joined += "\n\n";
		}

		joined = dehyphenate(joined);

		const sentences = extractChunksFromPlain(joined, this.opts.maxChunkChars);
		this.sentencePages = computeSentencePages(sentences, joined, pageRanges);
		return sentences;
	}

	resolveStartIndex(
		sentences: readonly SentenceInfo[],
		_explicitOffset: number | undefined,
		resumeIndex: number,
	): number {
		return Math.min(
			Math.max(0, resumeIndex),
			Math.max(0, sentences.length - 1),
		);
	}

	async prepareForSentence(ctx: SentenceContext): Promise<void> {
		const targetPage = this.sentencePages[ctx.index];
		if (!targetPage) return;

		const core = getPDFViewerCore(this.view);
		if (!core) return;

		// If already rendered and visible, nothing to do.
		const pv = core.getPageView(targetPage - 1);
		const rendered = !!pv?.textLayer?.div?.isConnected &&
			!!pv.textLayer.textDivs &&
			pv.textLayer.textDivs.length > 0;

		if (rendered && core.currentPageNumber === targetPage) return;

		if (core.currentPageNumber !== targetPage) {
			try {
				core.scrollPageIntoView({ pageNumber: targetPage });
			} catch (err) {
				console.error("TTS Reader: scrollPageIntoView failed:", err);
			}
		}

		if (!rendered) {
			await waitForTextLayer(core, targetPage, 3000);
		}
	}

	getHighlightContainer(ctx: SentenceContext): HTMLElement | null {
		const targetPage = this.sentencePages[ctx.index];
		if (!targetPage) return null;
		const core = getPDFViewerCore(this.view);
		if (!core) return null;
		const pv = core.getPageView(targetPage - 1);
		return pv?.textLayer?.div ?? null;
	}

	onSentenceChanged(_ctx: SentenceContext, _autoScroll: boolean): void {
		// No editor-line indicator or CM scroll for PDFs; the Highlighter
		// handles intra-page scroll, prepareForSentence handles page jumps.
	}

	setupClickToJump(
		controller: PlaybackController,
		_highlighter: Highlighter,
		getSpeed: () => number,
	): () => void {
		const container = this.view.contentEl;
		const handler = (e: MouseEvent) => {
			try {
				if (controller.state === "idle") return;
				if ((e.target as HTMLElement)?.closest(".tts-reader-toolbar")) {
					return;
				}
				// Only handle clicks inside a text layer — ignore sidebar, toolbar, etc.
				const textLayer = (e.target as HTMLElement)?.closest(
					".textLayer",
				);
				if (!textLayer) return;

				const caretRange = document.caretRangeFromPoint(
					e.clientX,
					e.clientY,
				);
				if (
					!caretRange ||
					caretRange.startContainer.nodeType !== Node.TEXT_NODE
				) {
					return;
				}

				const clickedNode = caretRange.startContainer as Text;
				const clickOffset = caretRange.startOffset;
				const nodeText = clickedNode.textContent ?? "";
				const ctxStart = Math.max(0, clickOffset - 10);
				const ctxEnd = Math.min(nodeText.length, clickOffset + 10);
				const snippet = nodeText.substring(ctxStart, ctxEnd).trim();
				if (snippet.length < 3) return;

				const sentences = controller.sentences;
				for (let i = 0; i < sentences.length; i++) {
					if (sentences[i].text.includes(snippet)) {
						controller.jumpTo(i, getSpeed());
						return;
					}
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error("TTS Reader: PDF click-to-jump error:", err);
				new Notice(`TTS Reader: click-to-jump failed: ${msg}`, 6000);
			}
		};

		container.addEventListener("click", handler);
		this.clickTeardown = () => {
			container.removeEventListener("click", handler);
		};
		return this.clickTeardown;
	}

	destroy(): void {
		if (this.clickTeardown) {
			try {
				this.clickTeardown();
			} catch {}
			this.clickTeardown = null;
		}
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a page's text by concatenating text items in document order.
 * pdf.js returns items in the order they appear in the PDF content stream.
 * hasEOL flags end-of-line; we use that to insert newlines.
 *
 * Reading order may be wrong on multi-column PDFs — accepted v1 limitation.
 */
function buildPageText(items: PDFTextContentItem[]): string {
	let out = "";
	for (const item of items) {
		out += item.str;
		if (item.hasEOL) out += "\n";
	}
	return out;
}

/**
 * Join line-broken words split by a hyphen. "segmenta-\ntion" → "segmentation".
 * Some compound words (well-being, state-of-the-art) may get wrongly joined
 * when broken across lines; accepted tradeoff.
 */
function dehyphenate(text: string): string {
	return text.replace(/([A-Za-z])-\n([a-z])/g, "$1$2");
}

/**
 * For each sentence, find the page whose character range contains the
 * sentence's starting offset in the joined buffer. Search uses the same
 * flexible-gap regex as buildSentenceOffsets so we survive intervening
 * newlines/formatting.
 */
function computeSentencePages(
	sentences: readonly SentenceInfo[],
	joined: string,
	pageRanges: readonly PageRange[],
): number[] {
	const result: number[] = [];
	let searchFrom = 0;

	for (const sent of sentences) {
		const words = sent.text
			.split(/\s+/)
			.filter((w) => w.length > 0)
			.slice(0, 4);
		let offset = searchFrom;
		if (words.length > 0) {
			const pattern = words.map(escapeRegex).join("[\\s\\S]{0,40}");
			const regex = new RegExp(pattern);
			const remaining = joined.substring(searchFrom);
			const m = regex.exec(remaining);
			if (m) {
				offset = searchFrom + m.index;
				searchFrom = offset + m[0].length;
			}
		}
		result.push(findPageAtOffset(pageRanges, offset));
	}

	return result;
}

function findPageAtOffset(
	pageRanges: readonly PageRange[],
	offset: number,
): number {
	if (pageRanges.length === 0) return 1;
	let lo = 0;
	let hi = pageRanges.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >>> 1;
		if (pageRanges[mid].start <= offset) lo = mid;
		else hi = mid - 1;
	}
	return pageRanges[lo].pageNumber;
}

function waitForTextLayer(
	core: PDFViewerCore,
	pageNumber: number,
	timeoutMs: number,
): Promise<void> {
	return new Promise<void>((resolve) => {
		let settled = false;
		const cleanup = () => {
			if (settled) return;
			settled = true;
			try {
				core.eventBus.off("textlayerrendered", handler);
			} catch {}
			clearTimeout(timer);
			resolve();
		};
		const handler = (evt: any) => {
			// pdf.js emits {source: PDFPageView, pageNumber: n}
			const rendered =
				evt?.pageNumber ?? evt?.source?.id ?? evt?.source?.pageNumber;
			if (rendered === pageNumber) cleanup();
		};
		const timer = setTimeout(cleanup, timeoutMs);
		try {
			core.eventBus.on("textlayerrendered", handler);
		} catch {
			cleanup();
			return;
		}
		// Already rendered? Re-check once; the render may have finished between
		// prepareForSentence's check and our subscribe.
		const pv = core.getPageView(pageNumber - 1);
		if (pv?.textLayer?.div?.isConnected && pv.textLayer.textDivs?.length) {
			cleanup();
		}
	});
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
