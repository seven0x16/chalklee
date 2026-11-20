import { Fragment, type Node as ProseMirrorNode, type ResolvedPos } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import { canonicalChalkLeeKind } from "@chalklee/format";

/*
 * Options are added and removed with buttons, never by typing: Enter and Backspace stay inside the
 * option they are in (see regionExit.ts).
 */

/** The option, its group and question around a position directly inside the option. */
function optionAround($inside: ResolvedPos) {
  for (let depth = $inside.depth; depth >= 3; depth -= 1) {
    if ($inside.node(depth).type.name !== "option") continue;
    const group = $inside.node(depth - 1), question = $inside.node(depth - 2);
    if (group.type.name !== "optionGroup" || !["question", "questionGroup"].includes(question.type.name)) return null;
    return {
      option: $inside.node(depth), group, question,
      optionDepth: depth,
      optionPosition: $inside.before(depth),
      optionIndex: $inside.index(depth - 1),
      groupIndex: $inside.index(depth - 2),
      questionPosition: $inside.before(depth - 2)
    };
  }
  return null;
}

type OptionContext = NonNullable<ReturnType<typeof optionAround>>;

/** Update only a standalone answer-label paragraph; retain explanatory text and media. */
function remapAnswer(answer: ProseMirrorNode, labels: Map<string, string | null>) {
  const paragraph = answer.firstChild;
  if (paragraph?.type.name !== "paragraph" || !/^[A-H](?:[\s、,，/]*[A-H])*$/i.test(paragraph.textContent.trim())
    || !paragraph.content.content.every(node => node.isText)) return answer;
  const pieces: ProseMirrorNode[] = [];
  const used = new Set<string>();
  paragraph.forEach(text => {
    for (const letter of text.textContent.toUpperCase().match(/[A-H]/g) ?? []) {
      const next = labels.get(letter);
      if (!next || used.has(next)) continue;
      if (pieces.length) pieces.push(answer.type.schema.text("、"));
      pieces.push(answer.type.schema.text(next, text.marks));
      used.add(next);
    }
  });
  return answer.copy(Fragment.fromArray([paragraph.copy(Fragment.fromArray(pieces)), ...answer.content.content.slice(1)]));
}

/** The caret at the end of the nearest earlier text that is shown (hidden answers are skipped). */
export function chalkLeePreviousVisibleCaret(doc: ProseMirrorNode, position: number, visible: (textblock: number) => boolean = () => true) {
  let selection = TextSelection.findFrom(doc.resolve(position), -1, true);
  while (selection && !visible(selection.$from.before())) {
    selection = TextSelection.findFrom(doc.resolve(selection.$from.before()), -1, true);
  }
  return selection;
}

/** The delete button on an option: remove it whatever it contains. */
export function chalkLeeDeleteOptionTransaction(state: EditorState, optionPosition: number, visible?: (textblock: number) => boolean) {
  const option = state.doc.nodeAt(optionPosition);
  if (option?.type.name !== "option") return null;
  const context = optionAround(state.doc.resolve(optionPosition + 1));
  return context ? removeOption(state, context, visible) : null;
}

function removeOption(state: EditorState, context: OptionContext, visible?: (textblock: number) => boolean) {
  const { option, question, optionPosition, questionPosition } = context;
  const next = chalkLeeQuestionWithoutOption(context);
  const transaction = closeHistory(state.tr.replaceWith(questionPosition, questionPosition + question.nodeSize, next.question));
  const { from } = state.selection;
  const questionEnd = questionPosition + question.nodeSize;
  const groupEnd = state.doc.resolve(optionPosition).end();
  // A caret outside the removed option keeps its place; one inside it goes to the text before it.
  const kept = from < optionPosition ? from
    : from >= questionEnd ? from + next.question.nodeSize - question.nodeSize
      : from > optionPosition + option.nodeSize && from < groupEnd ? from - option.nodeSize
        : null;
  if (kept !== null && transaction.doc.resolve(kept).parent.isTextblock) return transaction.setSelection(TextSelection.create(transaction.doc, kept));
  const selection = chalkLeePreviousVisibleCaret(transaction.doc, next.groupKept ? optionPosition : optionPosition - 1, visible);
  return selection ? transaction.setSelection(selection).scrollIntoView() : transaction;
}

/** The question with the given options in its group; without any, the group goes and it is no longer a choice question. */
function questionWithOptions(question: ProseMirrorNode, groupIndex: number, options: readonly ProseMirrorNode[], answer?: (node: ProseMirrorNode) => ProseMirrorNode) {
  const group = question.child(groupIndex);
  const children = [...question.content.content];
  if (options.length) children[groupIndex] = group.copy(Fragment.fromArray([...options]));
  else children.splice(groupIndex, 1);
  const attrs = !options.length && ["choice", "single-choice", "multiple-choice", "true-false"].includes(canonicalChalkLeeKind(question.attrs.kind, false))
    ? { ...question.attrs, kind: "free-response" }
    : question.attrs;
  return question.type.create(attrs, answer ? children.map(child => child.type.name === "questionAnswer" ? answer(child) : child) : children, question.marks);
}

/** The question after removing one option; later options and the answer letters move up. */
function chalkLeeQuestionWithoutOption(context: OptionContext) {
  const { group, question, optionIndex, groupIndex } = context;
  const options = group.content.content.filter((_, index) => index !== optionIndex)
    .map((child, index) => child.type.create({ ...child.attrs, label: String.fromCharCode(65 + index) }, child.content, child.marks));
  const labels = new Map<string, string | null>();
  group.forEach((child, _offset, index) => {
    labels.set(String(child.attrs.label), index === optionIndex ? null : String.fromCharCode(65 + (index > optionIndex ? index - 1 : index)));
  });
  return { question: questionWithOptions(question, groupIndex, options, answer => remapAnswer(answer, labels)), groupKept: options.length > 0 };
}
