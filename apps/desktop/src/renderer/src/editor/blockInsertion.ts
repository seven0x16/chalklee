import type { Editor, JSONContent } from "@tiptap/core";
import type { ResolvedPos } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import type { ChalkLeeQuestionTemplate } from "./editing";
import { captureChalkLeeBlockInsertionBookmark, chalkLeeBlockInsertionDestination, resolveChalkLeeBlockInsertionBookmark, setChalkLeeInsertedContentSelection, type ChalkLeeBlockInsertionBookmark, type ChalkLeeBlockInsertionDestination, type ChalkLeeInsertedContentSelection, type ChalkLeeQuestionRegionPosition, type ChalkLeeTopLevelBlockPosition } from "./editorWorkflow";
import type { ChalkLeeLineInsertTarget } from "./lineInsert";

export function questionTemplateLabel(template: ChalkLeeQuestionTemplate) {
  return template === "choice" ? "选择题"
    : template === "single-choice" ? "单选题"
    : template === "multiple-choice" ? "多选题"
      : template === "true-false" ? "判断题"
        : template === "fill-blank" ? "填空题"
          : "题目";
}

export function insertTopLevelContent(
  editor: Editor,
  content: JSONContent,
  selection: ChalkLeeInsertedContentSelection = "node",
  lineTarget?: ChalkLeeLineInsertTarget
) {
  return insertContentsAt(editor, lineTarget?.from ?? topLevelInsertPosition(editor), [content], 0, selection, lineTarget?.to);
}

export function insertContentsAt(
  editor: Editor,
  position: number,
  contents: JSONContent[],
  selectedIndex: number,
  selection: ChalkLeeInsertedContentSelection = "node",
  replacementEnd = position
) {
  if (!contents.length) return false;
  const nodes = contents.map((content) => editor.schema.nodeFromJSON(content));
  const safeSelectedIndex = Math.max(0, Math.min(nodes.length - 1, selectedIndex));
  const selectedAt = position + nodes.slice(0, safeSelectedIndex).reduce((size, node) => size + node.nodeSize, 0);
  const transaction = closeHistory(editor.state.tr.replaceWith(position, replacementEnd, nodes));
  setChalkLeeInsertedContentSelection(transaction, selectedAt, selection);
  editor.view.dispatch(transaction.scrollIntoView());
  // closeHistory on the insertion starts a boundary before it. This trailing,
  // no-step boundary keeps the teacher's first keystroke as a separate undo:
  // undo #1 restores the placeholder; undo #2 removes the inserted object.
  editor.view.dispatch(closeHistory(editor.state.tr));
  editor.view.focus();
  return true;
}

/**
 * A question inserted with the caret in a box goes into the box: in place of an empty line, otherwise after the
 * current line. An empty line follows it when it would end the box, so typing can continue or leave the box.
 */
export function insertQuestionContent(
  editor: Editor,
  content: JSONContent,
  selection: ChalkLeeInsertedContentSelection = "node",
  lineTarget?: ChalkLeeLineInsertTarget
) {
  const range = lineTarget ? null : chalkLeeBoxQuestionRange(editor.state.selection.$to);
  if (!range) return insertTopLevelContent(editor, content, selection, lineTarget);
  const contents = range.last ? [content, { type: "paragraph", attrs: { id: `node_${crypto.randomUUID()}` } }] : [content];
  return insertContentsAt(editor, range.from, contents, 0, selection, range.to);
}

/** Where a question goes in the box the caret is in; null outside a box or inside one of its questions. */
export function chalkLeeBoxQuestionRange($to: ResolvedPos) {
  if ($to.depth < 2 || $to.node(1).type.name !== "box" || ["question", "questionGroup"].includes($to.node(2).type.name)) return null;
  const line = $to.node(2), empty = line.type.name === "paragraph" && line.content.size === 0;
  return { from: empty ? $to.before(2) : $to.after(2), to: $to.after(2), last: $to.index(1) === $to.node(1).childCount - 1 };
}

export function topLevelInsertPosition(editor: Editor) {
  const { $to } = editor.state.selection;
  return $to.depth >= 1 ? $to.after(1) : editor.state.selection.to;
}

export function editorBlockInsertionDestination(editor: Editor, allowCellContainer = true) {
  return chalkLeeBlockInsertionDestination(
    chalkLeeTopLevelBlockPositions(editor),
    chalkLeeQuestionRegionPositions(editor),
    editor.state.selection.to,
    allowCellContainer
  );
}

export function captureEditorBlockInsertionBookmark(editor: Editor, revision: number): ChalkLeeBlockInsertionBookmark {
  return captureChalkLeeBlockInsertionBookmark(
    chalkLeeTopLevelBlockPositions(editor),
    chalkLeeQuestionRegionPositions(editor),
    editor.state.selection.to,
    revision
  );
}

export function resolveEditorBlockInsertionBookmark(editor: Editor, bookmark: ChalkLeeBlockInsertionBookmark, revision: number) {
  return resolveChalkLeeBlockInsertionBookmark(
    bookmark,
    chalkLeeTopLevelBlockPositions(editor),
    chalkLeeQuestionRegionPositions(editor),
    revision
  );
}

function chalkLeeTopLevelBlockPositions(editor: Editor): ChalkLeeTopLevelBlockPosition[] {
  const blocks: ChalkLeeTopLevelBlockPosition[] = [];
  editor.state.doc.forEach((node, offset) => {
    blocks.push({
      id: typeof node.attrs.id === "string" && node.attrs.id ? node.attrs.id : null,
      type: node.type.name,
      from: offset,
      to: offset + node.nodeSize
    });
  });
  return blocks;
}

function chalkLeeQuestionRegionPositions(editor: Editor): ChalkLeeQuestionRegionPosition[] {
  const questionBlockContainers = new Set(["questionStem", "questionMaterial", "questionAnswer", "questionAnalysis", "option"]);
  const cellBlockContainers = new Set(["tableCell", "tableHeader"]);
  const regions: ChalkLeeQuestionRegionPosition[] = [];
  editor.state.doc.descendants((node, position) => {
    if (!questionBlockContainers.has(node.type.name) && !cellBlockContainers.has(node.type.name)) return;
    const children: ChalkLeeTopLevelBlockPosition[] = [];
    node.forEach((child, offset) => {
      const from = position + 1 + offset;
      children.push({
        id: typeof child.attrs.id === "string" && child.attrs.id ? child.attrs.id : null,
        type: child.type.name,
        from,
        to: from + child.nodeSize
      });
    });
    regions.push({
      id: typeof node.attrs.id === "string" && node.attrs.id ? node.attrs.id : null,
      type: node.type.name,
      from: position,
      to: position + node.nodeSize,
      contentGroup: cellBlockContainers.has(node.type.name) ? "cellBlock" : "questionBlock",
      children
    });
  });
  return regions;
}

/** Where an insertion landed, as the teacher sees it on the paper. */
export function blockInsertionLocationLabel(destination: ChalkLeeBlockInsertionDestination) {
  if (destination.scope === "unsupported") return "不支持的位置";
  if (destination.scope === "top-level") return "光标处";
  if (destination.regionType === "questionStem") return "题干中";
  if (destination.regionType === "questionMaterial") return "题组材料中";
  if (destination.regionType === "questionAnswer") return "答案中";
  if (destination.regionType === "questionAnalysis") return "解析中";
  if (destination.regionType === "option") return "选项中";
  if (destination.regionType === "tableCell" || destination.regionType === "tableHeader") return "表格中";
  return "题目中";
}
