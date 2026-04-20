import type { View, WorkspaceLeaf } from "obsidian";

/**
 * Type declarations for Obsidian's private PDF viewer API.
 *
 * There is no public API for pdf.js internals (only loadPdfJs()), so we
 * access the viewer via a private chain:
 *
 *   view (getViewType() === 'pdf')
 *     .viewer                 // PDFViewerComponent
 *     .child                  // PDFViewerChild (nullable until load)
 *     .pdfViewer              // ObsidianPDFViewer (Obsidian's wrapper)
 *     .pdfViewer              // real pdf.js PDFViewer
 *     .pdfDocument            // pdf.js PDFDocumentProxy
 *
 * Reshuffled significantly in Obsidian 1.8; plugin gates PDF support with
 * requireApiVersion("1.8") at runtime. Shape derived from:
 * https://github.com/RyotaUshio/obsidian-pdf-plus (src/typings.d.ts).
 */

export interface PDFTextContentItem {
	str: string;
	/** [scaleX, skewX, skewY, scaleY, x, y] — use index 4 (x) and 5 (y). */
	transform: number[];
	width: number;
	height: number;
	dir?: string;
	hasEOL?: boolean;
	fontName?: string;
}

export interface PDFTextContent {
	items: PDFTextContentItem[];
	styles?: Record<string, unknown>;
}

export interface PDFViewport {
	width: number;
	height: number;
	scale: number;
}

export interface PDFPageProxy {
	pageNumber: number;
	getTextContent(opts?: {
		includeChars?: boolean;
		normalizeWhitespace?: boolean;
		disableCombineTextItems?: boolean;
	}): Promise<PDFTextContent>;
	getViewport(opts: { scale: number }): PDFViewport;
}

export interface PDFDocumentProxy {
	numPages: number;
	getPage(pageNumber: number): Promise<PDFPageProxy>;
	getData(): Promise<Uint8Array>;
}

export interface PDFTextLayer {
	div?: HTMLElement;
	textDivs?: HTMLElement[];
	textContentItems?: PDFTextContentItem[];
}

export interface PDFPageView {
	id: number;
	pageNumber?: number;
	textLayer?: PDFTextLayer | null;
	div: HTMLElement;
}

export interface PDFEventBus {
	on(name: string, handler: (evt: any) => void): void;
	off(name: string, handler: (evt: any) => void): void;
}

/** The real pdf.js PDFViewer. */
export interface PDFViewerCore {
	pdfDocument: PDFDocumentProxy | null;
	eventBus: PDFEventBus;
	currentPageNumber: number;
	pagesCount: number;
	scrollPageIntoView(spec: {
		pageNumber: number;
		destArray?: any[];
		allowNegativeOffset?: boolean;
		ignoreDestinationZoom?: boolean;
	}): void;
	getPageView(index: number): PDFPageView | null | undefined;
}

/** Obsidian's wrapper around pdf.js PDFViewerApplication. */
export interface ObsidianPDFViewer {
	eventBus: PDFEventBus;
	pdfViewer: PDFViewerCore | null;
}

export interface PDFViewerChild {
	pdfViewer: ObsidianPDFViewer | null;
	containerEl?: HTMLElement;
}

export interface PDFViewerComponent {
	child: PDFViewerChild | null;
}

/** Obsidian's internal PDFView. Not exported from obsidian-api. */
export interface PDFView extends View {
	viewer: PDFViewerComponent;
	file?: { path: string } | null;
	leaf: WorkspaceLeaf;
	contentEl: HTMLElement;
	getViewType(): string;
	getMode?(): string;
}

/** True when the view is Obsidian's PDF view. */
export function isPDFView(view: View | null | undefined): view is PDFView {
	return !!view && typeof (view as any).getViewType === "function" &&
		(view as any).getViewType() === "pdf";
}

/** Walk the private chain; null if any hop is not ready. */
export function getPDFViewerCore(view: PDFView): PDFViewerCore | null {
	const child = view.viewer?.child ?? null;
	if (!child) return null;
	const outer = child.pdfViewer ?? null;
	if (!outer) return null;
	return outer.pdfViewer ?? null;
}

export function getPDFDocument(view: PDFView): PDFDocumentProxy | null {
	return getPDFViewerCore(view)?.pdfDocument ?? null;
}
