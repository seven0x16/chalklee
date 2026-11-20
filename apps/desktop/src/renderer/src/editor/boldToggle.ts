import type { Mark, ResolvedPos } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { mergeChalkLeeTextStyleAttribute } from "./editing";

/** Blocks whose text is bold until the teacher makes it otherwise. */
const BOLD_BY_DEFAULT = new Set(["heading"]);

function boldByDefault($pos: ResolvedPos) {
  for (let depth = $pos.depth; depth > 0; depth--) if (BOLD_BY_DEFAULT.has($pos.node(depth).type.name)) return true;
  return false;
}

/** Bold as the teacher sees it: a "not bold" weight wins, then the bold mark, then the block's own look. */
export function chalkLeeTextLooksBold(marks: readonly Mark[], inBoldBlock: boolean) {
  if (marks.some(mark => mark.type.name === "textStyle" && mark.attrs.fontWeight === "normal")) return false;
  return inBoldBlock || marks.some(mark => mark.type.name === "bold");
}

/** Whether the toolbar shows bold as pressed: all of the selected text, or the text about to be typed, looks bold. */
export function chalkLeeBoldActive(state: EditorState) {
  const { selection } = state;
  if (selection.empty) return chalkLeeTextLooksBold(state.storedMarks ?? selection.$from.marks(), boldByDefault(selection.$from));
  let any = false, all = true;
  state.doc.nodesBetween(selection.from, selection.to, (node, position) => {
    if (!node.isText) return;
    any = true;
    if (!chalkLeeTextLooksBold(node.marks, boldByDefault(state.doc.resolve(position)))) all = false;
  });
  return any && all;
}

/**
 * Bold on or off by what the teacher sees, as Word does. Text that is not bold gets the bold mark, except in a
 * heading, which is bold already once its "not bold" weight is gone. Bold text loses its mark, and in a heading
 * also takes the "not bold" weight, so a heading can be made normal. The mark itself is a plain bold (700).
 */
export function chalkLeeToggleBold(state: EditorState, dispatch?: (transaction: Transaction) => void) {
  const { bold, textStyle } = state.schema.marks;
  if (!bold || !textStyle) return false;
  const makeBold = !chalkLeeBoldActive(state);
  const weighted = (marks: readonly Mark[], weight: "normal" | null) => {
    const style = marks.find(mark => mark.type === textStyle);
    const attrs = mergeChalkLeeTextStyleAttribute(style?.attrs, "fontWeight", weight);
    const others = marks.filter(mark => mark.type !== textStyle);
    return attrs ? textStyle.create(attrs).addToSet(others) : others;
  };
  const toggled = (marks: readonly Mark[], inBoldBlock: boolean) => {
    const plain = weighted(bold.removeFromSet([...marks]), null);
    if (makeBold) return inBoldBlock ? plain : bold.create().addToSet(plain);
    return inBoldBlock ? weighted(plain, "normal") : plain;
  };
  const transaction = state.tr;
  if (state.selection.empty) {
    const { $from } = state.selection;
    transaction.setStoredMarks(toggled(state.storedMarks ?? $from.marks(), boldByDefault($from)));
  } else {
    for (const range of state.selection.ranges) {
      const from = range.$from.pos, to = range.$to.pos;
      state.doc.nodesBetween(from, to, (node, position) => {
        if (!node.isText) return;
        const start = Math.max(from, position), end = Math.min(to, position + node.nodeSize);
        if (start >= end) return;
        const next = toggled(node.marks, boldByDefault(state.doc.resolve(position)));
        transaction.removeMark(start, end, bold).removeMark(start, end, textStyle);
        for (const mark of next) if (mark.type === bold || mark.type === textStyle) transaction.addMark(start, end, mark);
      });
    }
  }
  dispatch?.(transaction.scrollIntoView());
  return true;
}
