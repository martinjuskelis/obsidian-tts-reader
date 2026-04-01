import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

/**
 * CM6 extension that highlights lines currently being read by TTS.
 *
 * Uses a StateField + Decoration.line() so it survives scrolling,
 * editing, and line virtualization — the same mechanism Obsidian
 * uses for its own "active line" highlight.
 */

const setTTSLines = StateEffect.define<{
	from: number;
	to: number;
} | null>();

const lineDeco = Decoration.line({ class: "tts-reader-active-line" });

export const ttsLineField: Extension = StateField.define<DecorationSet>({
	create() {
		return Decoration.none;
	},
	update(deco, tr) {
		for (const e of tr.effects) {
			if (e.is(setTTSLines)) {
				if (e.value === null) return Decoration.none;

				const doc = tr.state.doc;
				const from = Math.min(e.value.from, doc.length);
				const to = Math.min(e.value.to, doc.length);
				const startLine = doc.lineAt(from).number;
				const endLine = doc.lineAt(to).number;

				const ranges = [];
				for (let n = startLine; n <= endLine; n++) {
					ranges.push(lineDeco.range(doc.line(n).from));
				}
				return Decoration.set(ranges, true);
			}
		}
		// Map decorations through document changes so edits don't break them
		return deco.map(tr.changes);
	},
	provide: (f) => EditorView.decorations.from(f),
});

/**
 * Dispatch an effect to highlight lines containing the given range.
 * Pass null to clear the indicator.
 */
export function updateTTSLineIndicator(
	cmView: EditorView,
	range: { from: number; to: number } | null,
): void {
	cmView.dispatch({ effects: setTTSLines.of(range) });
}
