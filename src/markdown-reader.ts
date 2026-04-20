import { MarkdownView, Notice, Platform, type WorkspaceLeaf } from "obsidian";
import { EditorView } from "@codemirror/view";
import { Reader, type SentenceContext } from "./reader";
import type { SentenceInfo } from "./types";
import type { Highlighter } from "./highlighter";
import type { PlaybackController } from "./playback";
import { extractChunks } from "./text-extractor";
import { buildSentenceOffsets, findSentenceAtOffset } from "./position-map";
import { updateTTSLineIndicator } from "./editor-line-indicator";

export interface MarkdownReaderOptions {
	skipCodeBlocks: boolean;
	skipFrontmatter: boolean;
	stripFootnoteRefs: boolean;
	maxChunkChars: number;
	editorLineIndicator: boolean;
}

/**
 * Reader for Obsidian's built-in MarkdownView. Handles both reading-view
 * (preview) and source-mode playback, with editor-specific extras:
 * line indicator, CodeMirror scroll, and Ctrl/Cmd+Alt+click-to-jump in
 * the editor.
 */
export class MarkdownReader extends Reader {
	readonly view: MarkdownView;
	readonly filePath: string | null;
	readonly leaf: WorkspaceLeaf;

	private readonly opts: MarkdownReaderOptions;

	private markdownCache: string | null = null;
	private sentencesCache: SentenceInfo[] | null = null;
	private offsetsCache: number[] | null = null;

	private previewContainer: HTMLElement | null = null;
	private clickHandler: ((e: MouseEvent) => void) | null = null;
	private clickTarget: HTMLElement | null = null;
	private editorClickHandler: ((e: MouseEvent) => void) | null = null;
	private editorClickTarget: HTMLElement | null = null;

	constructor(view: MarkdownView, opts: MarkdownReaderOptions) {
		super();
		this.view = view;
		this.filePath = view.file?.path ?? null;
		this.leaf = view.leaf;
		this.opts = opts;
	}

	// --- Extraction ---

	extractChunks(): SentenceInfo[] {
		const markdown = this.view.getViewData();
		this.markdownCache = markdown;
		const sentences = extractChunks(
			markdown,
			this.opts.skipCodeBlocks,
			this.opts.skipFrontmatter,
			this.opts.maxChunkChars,
			this.opts.stripFootnoteRefs,
		);
		this.sentencesCache = sentences;
		return sentences;
	}

	resolveStartIndex(
		sentences: readonly SentenceInfo[],
		explicitOffset: number | undefined,
		resumeIndex: number,
	): number {
		const isEditorMode = this.view.getMode() !== "preview";
		const needsOffsets = isEditorMode || explicitOffset != null;
		const markdown = this.markdownCache ?? this.view.getViewData();

		const offsets = needsOffsets
			? buildSentenceOffsets(markdown, sentences)
			: [];
		if (needsOffsets) this.offsetsCache = offsets;

		if (explicitOffset != null) {
			return findSentenceAtOffset(offsets, explicitOffset);
		}
		if (isEditorMode) {
			const cursor = this.view.editor.getCursor();
			const cursorOffset = this.view.editor.posToOffset(cursor);
			const cursorIndex = findSentenceAtOffset(offsets, cursorOffset);
			// Respect cursor if user deliberately placed it; otherwise resume.
			return cursorIndex > 0 ? cursorIndex : resumeIndex;
		}
		// Reading View: resume bookmark wins.
		return resumeIndex;
	}

	// --- Highlight container ---

	getHighlightContainer(_ctx: SentenceContext): HTMLElement | null {
		if (this.view.getMode() !== "preview") {
			return null;
		}
		if (!this.previewContainer || !this.previewContainer.isConnected) {
			this.previewContainer = this.view.contentEl.querySelector(
				".markdown-preview-view",
			) as HTMLElement | null;
		}
		return this.previewContainer;
	}

	// --- Per-sentence hook ---

	onSentenceChanged(ctx: SentenceContext, autoScroll: boolean): void {
		// Editor-mode line indicator — only when in source/live mode.
		if (this.opts.editorLineIndicator) {
			this.updateEditorIndicator(ctx.index);
		}
		if (autoScroll) {
			this.scrollEditorToSentence(ctx.index);
		}
	}

	locateCurrent(ctx: SentenceContext | null, highlighter: Highlighter): void {
		highlighter.scrollToCurrent();
		if (ctx) this.scrollEditorToSentence(ctx.index);
	}

	// --- Click-to-jump ---

	setupClickToJump(
		controller: PlaybackController,
		highlighter: Highlighter,
		getSpeed: () => number,
	): () => void {
		const isEditorMode = this.view.getMode() !== "preview";
		if (isEditorMode) {
			return this.setupEditorClickToJump(controller, getSpeed);
		}
		const previewEl = this.getHighlightContainer({
			index: 0,
			sentence: { text: "", occurrence: 0 },
		});
		if (!previewEl) return () => {};
		return this.setupPreviewClickToJump(
			previewEl,
			controller,
			highlighter,
			getSpeed,
		);
	}

	destroy(): void {
		// Click handlers torn down via the teardown closure returned from
		// setupClickToJump; the plugin invokes that. Clear the editor indicator
		// here in case playback stopped without a clean teardown path.
		this.clearEditorIndicator();
	}

	// --- Editor scroll / line indicator ---

	private scrollEditorToSentence(index: number): void {
		const cm = this.getLiveEditorView();
		if (!cm) return;
		const offsets = this.offsetsCache;
		if (!offsets) return;
		const pos = offsets[index];
		if (pos == null) return;
		try {
			cm.dispatch({
				effects: EditorView.scrollIntoView(pos, { y: "center" }),
			});
		} catch {
			// EditorView destroyed (mode switch, leaf closed)
		}
	}

	private getLiveEditorView(): EditorView | null {
		// Re-query fresh — CM view is rebuilt on every preview ↔ edit switch.
		const view = this.leaf?.view as MarkdownView | undefined;
		if (!view || view.getMode() === "preview") return null;
		return (view.editor as any)?.cm ?? null;
	}

	private updateEditorIndicator(index: number): void {
		const offsets = this.offsetsCache;
		if (!offsets || offsets.length === 0) return;
		const cm = this.getLiveEditorView();
		if (!cm) return;

		const from = offsets[index];
		const sentences = this.sentencesCache;
		const to =
			index + 1 < offsets.length
				? offsets[index + 1] - 1
				: from + (sentences?.[index]?.text.length ?? 0);

		try {
			updateTTSLineIndicator(cm, { from, to });
		} catch {
			// EditorView may be destroyed
		}
	}

	private clearEditorIndicator(): void {
		const cm = this.getLiveEditorView();
		if (!cm) return;
		try {
			updateTTSLineIndicator(cm, null);
		} catch {
			// EditorView may be destroyed
		}
	}

	// --- Preview click-to-jump ---

	private setupPreviewClickToJump(
		previewEl: HTMLElement,
		controller: PlaybackController,
		highlighter: Highlighter,
		getSpeed: () => number,
	): () => void {
		const handler = (e: MouseEvent) => {
			try {
				if (controller.state === "idle") return;
				if ((e.target as HTMLElement)?.closest(".tts-reader-toolbar")) {
					return;
				}

				const sentences = controller.sentences;

				const clickProgress = this.estimateClickProgress(
					e.target as HTMLElement,
					previewEl,
				);

				const caretRange = document.caretRangeFromPoint(
					e.clientX,
					e.clientY,
				);
				if (
					caretRange &&
					caretRange.startContainer.nodeType === Node.TEXT_NODE
				) {
					const clickedNode = caretRange.startContainer as Text;
					const clickOffset = caretRange.startOffset;
					const nodeText = clickedNode.textContent ?? "";
					const ctxStart = Math.max(0, clickOffset - 10);
					const ctxEnd = Math.min(nodeText.length, clickOffset + 10);
					const snippet = nodeText.substring(ctxStart, ctxEnd).trim();

					if (snippet.length >= 3) {
						const matchingIndices: number[] = [];
						for (let i = 0; i < sentences.length; i++) {
							if (sentences[i].text.includes(snippet)) {
								matchingIndices.push(i);
							}
						}

						if (matchingIndices.length === 1) {
							controller.jumpTo(matchingIndices[0], getSpeed());
							return;
						}

						if (matchingIndices.length > 1) {
							const sentText = sentences[matchingIndices[0]].text;
							const occ = highlighter.getOccurrenceAt(
								sentText,
								clickedNode,
								clickOffset,
							);
							if (occ >= 0) {
								for (const idx of matchingIndices) {
									if (sentences[idx].occurrence === occ) {
										controller.jumpTo(idx, getSpeed());
										return;
									}
								}
							}
							const idx = this.findClosestSentence(
								sentences,
								snippet,
								clickProgress,
							);
							if (idx >= 0) {
								controller.jumpTo(idx, getSpeed());
								return;
							}
						}
					}
				}

				const target = e.target as HTMLElement;
				const block = target.closest(
					"p, h1, h2, h3, h4, h5, h6, li, td, th, dt, dd, blockquote",
				);
				if (!block) return;

				const blockText = block.textContent ?? "";
				if (blockText.trim().length === 0) return;

				const idx = this.findClosestSentence(
					sentences,
					blockText,
					clickProgress,
				);
				if (idx >= 0) {
					controller.jumpTo(idx, getSpeed());
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error("TTS Reader: click-to-jump error:", err);
				new Notice(`TTS Reader: click-to-jump failed: ${msg}`, 6000);
			}
		};

		this.clickHandler = handler;
		this.clickTarget = previewEl;
		previewEl.addEventListener("click", handler);

		return () => {
			if (this.clickHandler && this.clickTarget) {
				this.clickTarget.removeEventListener("click", this.clickHandler);
			}
			this.clickHandler = null;
			this.clickTarget = null;
		};
	}

	private estimateClickProgress(
		target: HTMLElement,
		container: HTMLElement,
	): number {
		const scrollContainer =
			container.closest(".markdown-preview-view") ?? container;
		const scrollEl = scrollContainer as HTMLElement;
		const totalHeight = scrollEl.scrollHeight;
		if (totalHeight === 0) return 0;

		const rect = target.getBoundingClientRect();
		const containerRect = scrollEl.getBoundingClientRect();
		const docPosition =
			scrollEl.scrollTop + rect.top - containerRect.top;
		return Math.max(0, Math.min(1, docPosition / totalHeight));
	}

	private findClosestSentence(
		sentences: readonly SentenceInfo[],
		snippet: string,
		clickProgress: number,
	): number {
		const matches: number[] = [];
		for (let i = 0; i < sentences.length; i++) {
			if (sentences[i].text.includes(snippet)) {
				matches.push(i);
			}
		}
		if (matches.length === 0) return -1;
		if (matches.length === 1) return matches[0];

		let totalChars = 0;
		const charPos: number[] = [];
		for (let i = 0; i < sentences.length; i++) {
			charPos.push(totalChars);
			totalChars += sentences[i].text.length;
		}

		let best = matches[0];
		let bestDist = Math.abs(
			charPos[matches[0]] / totalChars - clickProgress,
		);
		for (let i = 1; i < matches.length; i++) {
			const dist = Math.abs(
				charPos[matches[i]] / totalChars - clickProgress,
			);
			if (dist < bestDist) {
				best = matches[i];
				bestDist = dist;
			}
		}
		return best;
	}

	// --- Editor click-to-jump ---

	private setupEditorClickToJump(
		controller: PlaybackController,
		getSpeed: () => number,
	): () => void {
		const handler = (e: MouseEvent) => {
			try {
				if (controller.state === "idle") return;
				if ((e.target as HTMLElement)?.closest(".tts-reader-toolbar")) {
					return;
				}

				const modKey = Platform.isMacOS ? e.metaKey : e.ctrlKey;
				if (!modKey || !e.altKey) return;

				e.preventDefault();
				e.stopImmediatePropagation();

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

				const ctxStart = Math.max(0, clickOffset - 20);
				const ctxEnd = Math.min(nodeText.length, clickOffset + 20);
				const snippet = nodeText.substring(ctxStart, ctxEnd).trim();
				if (snippet.length < 3) return;

				const markdown = this.view.getViewData();
				const sentences = controller.sentences;
				const offsets = buildSentenceOffsets(markdown, sentences);

				const snippetPos = markdown.indexOf(snippet);
				if (snippetPos >= 0) {
					const idx = findSentenceAtOffset(offsets, snippetPos);
					controller.jumpTo(idx, getSpeed());
					return;
				}

				for (let i = 0; i < sentences.length; i++) {
					if (sentences[i].text.includes(snippet)) {
						controller.jumpTo(i, getSpeed());
						return;
					}
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error("TTS Reader: editor click-to-jump error:", err);
				new Notice(`TTS Reader: click-to-jump failed: ${msg}`, 6000);
			}
		};

		const editorEl = this.view.contentEl.querySelector(
			".cm-editor",
		) as HTMLElement | null;
		if (!editorEl) return () => {};

		this.editorClickHandler = handler;
		this.editorClickTarget = editorEl;
		editorEl.addEventListener("mousedown", handler, true);

		return () => {
			if (this.editorClickHandler && this.editorClickTarget) {
				this.editorClickTarget.removeEventListener(
					"mousedown",
					this.editorClickHandler,
					true,
				);
			}
			this.editorClickHandler = null;
			this.editorClickTarget = null;
		};
	}
}
