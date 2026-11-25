import type { JSONContent } from "@tiptap/core";
import type { ChalkLeeArchive } from "@chalklee/format";
import { Mark, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { GapCursor } from "@tiptap/pm/gapcursor";
import { NodeSelection, Selection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

/** Moving the caret within a text run leaves the block controls and typing format the same. */
export function chalkLeeSelectionControlsChanged(previous: EditorState, current: EditorState, textOnlyEdit = false): boolean {
  const before = previous.selection, after = current.selection;
  if (before instanceof TextSelection && after instanceof TextSelection && before.empty && after.empty
    && (previous.doc === current.doc && before.$from.sameParent(after.$from)
      || textOnlyEdit && before.$from.parent.sameMarkup(after.$from.parent)
        && before.$from.depth === after.$from.depth && before.$from.start() === after.$from.start())) {
    const beforeMarks = before.$from.marks(), afterMarks = after.$from.marks();
    // A font attribute can come from the surrounding text when no stored
    // textStyle mark overrides it.
    return !Mark.sameSet(beforeMarks, afterMarks)
      || !Mark.sameSet(previous.storedMarks ?? beforeMarks, current.storedMarks ?? afterMarks);
  }
  return !before.eq(after) || !Mark.sameSet(previous.storedMarks ?? [], current.storedMarks ?? []);
}

export interface ChalkLeeTopLevelBlockPosition {
  id: string | null;
  type: string;
  from: number;
  to: number;
}

export interface ChalkLeeQuestionRegionPosition extends ChalkLeeTopLevelBlockPosition {
  children: readonly ChalkLeeTopLevelBlockPosition[];
  /** The schema group accepted by this nested container. Older callers default to questionBlock. */
  contentGroup?: "questionBlock" | "cellBlock";
}

export type ChalkLeeBlockInsertionDestination =
  | {
      scope: "question-region";
      position: number;
      regionId: string | null;
      regionType: string;
      childId: string | null;
      childType: string;
    }
  | { scope: "top-level"; position: number }
  | { scope: "unsupported"; reason: "table-inside-cell"; containerType: string };

export type ChalkLeeResolvedBlockInsertionDestination = Exclude<ChalkLeeBlockInsertionDestination, { scope: "unsupported" }>;

export type ChalkLeeBlockInsertionBookmark =
  | {
      kind: "inside-region-after-node";
      regionId: string;
      regionType: string;
      childId: string;
      childType: string;
      capturedRevision: number;
    }
  | {
      kind: "inside-region-position";
      capturedPosition: number;
      capturedRevision: number;
      regionType: string;
    }
  | { kind: "top-level"; bookmark: ChalkLeeTopLevelInsertionBookmark };

export type ChalkLeeBlockBookmarkResolution =
  | { ok: true; destination: ChalkLeeResolvedBlockInsertionDestination }
  | { ok: false; reason: "document-changed" | "target-missing" | "target-ambiguous" };

export type ChalkLeeTopLevelInsertionBookmark =
  | { kind: "start"; capturedRevision: number }
  | { kind: "after-node"; nodeId: string; nodeType: string; capturedPosition: number; capturedRevision: number }
  | { kind: "position"; capturedPosition: number; capturedRevision: number };

export type ChalkLeeBookmarkResolution =
  | { ok: true; position: number }
  | { ok: false; reason: "document-changed" | "target-missing" | "target-ambiguous" };

export type ChalkLeeInsertedQuestionSelectionMode = "caret" | "select-leading-text";
export type ChalkLeeInsertedContentSelection = "node" | "question-caret" | "question-placeholder";

export interface ChalkLeeDirectQuestionPasteTarget {
  from: number;
  to: number;
}

type ChalkLeeDirectQuestionPasteResult = {
  drafts: ReadonlyArray<{
    optionCount: number;
    node: { attrs?: Record<string, unknown> };
  }>;
  unrecognizedSegments: readonly unknown[];
};

/**
 * Keep automatic paste stricter than an explicitly requested recognition.
 * An explicit number or a valid A/B option run is required, so ordinary notes
 * such as `会议记录\n答案：待定` remain ordinary text.
 */
export function isChalkLeeSafeDirectQuestionPaste(result: ChalkLeeDirectQuestionPasteResult) {
  // Text that is not a question (a paper's title, notes, an unclear item) is pasted as written beside the questions.
  return result.drafts.length > 0
    && result.drafts.every((draft) => {
      const number = draft.node.attrs?.number;
      const fixedNumber = number && typeof number === "object"
        ? (number as { mode?: unknown }).mode === "fixed"
        : false;
      return fixedNumber || draft.optionCount >= 2;
    });
}

/**
 * Direct question recognition is intentionally limited to a genuinely empty,
 * top-level paragraph. This gives paste a predictable replace target, avoids a
 * ghost paragraph before the recognized question, and never rewrites text the
 * teacher already had in the document.
 */
export function chalkLeeDirectQuestionPasteTarget(
  doc: ProseMirrorNode,
  selectionFrom: number,
  selectionTo: number
): ChalkLeeDirectQuestionPasteTarget | null {
  if (!Number.isInteger(selectionFrom)
    || !Number.isInteger(selectionTo)
    || selectionFrom !== selectionTo
    || selectionFrom < 0
    || selectionFrom > doc.content.size) return null;
  const resolved = doc.resolve(selectionFrom);
  if (resolved.depth !== 1
    || resolved.parent.type.name !== "paragraph"
    || resolved.parent.content.size !== 0
    || resolved.parentOffset !== 0
    || resolved.parent.marks.length > 0
    || [
      "textAlign",
      "indentLeftPt",
      "indentRightPt",
      "firstLineIndentPt",
      "listType",
      "lineHeight",
      "spaceBeforePt",
      "spaceAfterPt"
    ].some((attribute) => resolved.parent.attrs[attribute] != null)) return null;
  return { from: resolved.before(1), to: resolved.after(1) };
}

/**
 * Return the only safe initial caret destination for a newly-created ChalkLee.
 * Existing documents must never have their saved selection or reading position
 * stolen merely because they happen to end in an editable paragraph.
 */
export function chalkLeePristineBodySelectionPosition(doc: ProseMirrorNode): number | null {
  if (doc.type.name !== "doc" || doc.childCount !== 2) return null;
  const heading = doc.child(0);
  const paragraph = doc.child(1);
  if (heading.type.name !== "heading"
    || Number(heading.attrs.level) !== 1
    || !heading.textContent.trim()
    || heading.attrs.textAlign !== "center"
    || Number(heading.attrs.lineHeight) !== 1.95
    || Number(heading.attrs.spaceBeforePt) !== 0
    || Number(heading.attrs.spaceAfterPt) !== 0
    || heading.childCount !== 1
    || !heading.firstChild?.isText
    || paragraph.type.name !== "paragraph"
    || paragraph.content.size !== 0
    || paragraph.marks.length > 0) return null;
  const plainAttributes = [
    "textAlign",
    "indentLeftPt",
    "indentRightPt",
    "firstLineIndentPt",
    "listType",
    "lineHeight",
    "spaceBeforePt",
    "spaceAfterPt"
  ];
  if (plainAttributes.some((attribute) => paragraph.attrs[attribute] != null)) return null;
  const titleMarks = new Map(heading.firstChild.marks.map((mark) => [mark.type.name, mark.attrs]));
  if (!titleMarks.has("bold") || Number(titleMarks.get("textStyle")?.fontSizePt) !== 16) return null;
  return heading.nodeSize + 1;
}

/**
 * Resolve the first editable text block of an inserted question. Templates can
 * select their leading placeholder text, while recognized/batch questions use
 * a collapsed caret and never expose the whole question to replacement typing.
 */
export function chalkLeeInsertedQuestionTextRange(
  doc: ProseMirrorNode,
  questionPosition: number,
  mode: ChalkLeeInsertedQuestionSelectionMode = "caret"
): { from: number; to: number } | null {
  if (!Number.isInteger(questionPosition) || questionPosition < 0 || questionPosition >= doc.content.size) return null;
  const question = doc.nodeAt(questionPosition);
  if (!question || (question.type.name !== "question" && question.type.name !== "questionGroup")) return null;
  const regionType = question.type.name === "questionGroup" ? "questionMaterial" : "questionStem";
  let regionPosition = questionPosition + 1;
  const region = question.content.content.find((child) => {
    if (child.type.name === regionType) return true;
    regionPosition += child.nodeSize;
    return false;
  });
  if (!region) return null;

  let textblock: { node: ProseMirrorNode; position: number } | null = null;
  region.descendants((node, position) => {
    if (textblock) return false;
    if (!node.isTextblock) return true;
    textblock = { node, position: regionPosition + 1 + position };
    return false;
  });
  if (!textblock) return null;
  const resolvedTextblock = textblock as { node: ProseMirrorNode; position: number };

  const from = resolvedTextblock.position + 1;
  if (mode === "caret") return { from, to: from };
  let leadingTextSize = 0;
  let leadingText = "";
  for (const child of resolvedTextblock.node.content.content) {
    if (!child.isText) break;
    leadingTextSize += child.nodeSize;
    leadingText += child.text ?? "";
  }
  const separatorSize = /\s+$/u.exec(leadingText)?.[0].length ?? 0;
  return { from, to: from + Math.max(0, leadingTextSize - separatorSize) };
}

/** Apply the editor's shared post-insertion selection policy. */
export function setChalkLeeInsertedContentSelection(
  transaction: Transaction,
  selectedAt: number,
  selection: ChalkLeeInsertedContentSelection
) {
  if (selection !== "node") {
    const range = chalkLeeInsertedQuestionTextRange(
      transaction.doc,
      selectedAt,
      selection === "question-placeholder" ? "select-leading-text" : "caret"
    );
    if (range) {
      transaction.setSelection(TextSelection.create(transaction.doc, range.from, range.to));
      return;
    }
  }
  const selectedNode = transaction.doc.nodeAt(selectedAt);
  if (selectedNode?.type.spec.selectable !== false) {
    transaction.setSelection(NodeSelection.create(transaction.doc, selectedAt));
    return;
  }
  transaction.setSelection(TextSelection.near(
    transaction.doc.resolve(Math.min(transaction.doc.content.size, selectedAt + 1))
  ));
}

/**
 * Put the caret right after inserted blocks: at the start of the next line, or
 * on the gap after a question when nothing editable follows it.
 */
export function setChalkLeeCaretAfterInsertedContent(transaction: Transaction, end: number) {
  const $end = transaction.doc.resolve(Math.min(end, transaction.doc.content.size));
  if ($end.nodeAfter?.isTextblock) {
    transaction.setSelection(TextSelection.create(transaction.doc, $end.pos + 1));
  } else if ((GapCursor as unknown as { valid(position: typeof $end): boolean }).valid($end)) {
    transaction.setSelection(new GapCursor($end));
  } else {
    transaction.setSelection(Selection.near($end, -1));
  }
}

/** Place the caret in a semantic region of an inserted question. */
export function setChalkLeeInsertedQuestionRegionSelection(
  transaction: Transaction,
  questionPosition: number,
  regionType: "questionStem" | "questionAnswer" | "questionAnalysis"
): boolean {
  if (!Number.isInteger(questionPosition) || questionPosition < 0 || questionPosition >= transaction.doc.content.size) {
    return false;
  }
  const question = transaction.doc.nodeAt(questionPosition);
  if (!question || question.type.name !== "question") return false;

  let regionPosition = questionPosition + 1;
  let region: ProseMirrorNode | null = null;
  for (const child of question.content.content) {
    if (child.type.name === regionType) {
      region = child;
      break;
    }
    regionPosition += child.nodeSize;
  }
  if (!region) return false;

  let caret: number | null = null;
  region.descendants((node, position) => {
    if (!node.isTextblock) return true;
    caret = regionPosition + 1 + position + 1 + node.content.size;
    return false;
  });
  if (caret === null) return false;
  transaction.setSelection(TextSelection.create(transaction.doc, caret));
  return true;
}

export function captureChalkLeeTopLevelInsertionBookmark(
  blocks: readonly ChalkLeeTopLevelBlockPosition[],
  selectionEnd: number,
  revision: number
): ChalkLeeTopLevelInsertionBookmark {
  if (selectionEnd <= 0) return { kind: "start", capturedRevision: revision };
  const block = blocks.find((candidate) => selectionEnd > candidate.from && selectionEnd <= candidate.to);
  if (!block) return { kind: "position", capturedPosition: selectionEnd, capturedRevision: revision };
  if (!block.id) return { kind: "position", capturedPosition: block.to, capturedRevision: revision };
  return {
    kind: "after-node",
    nodeId: block.id,
    nodeType: block.type,
    capturedPosition: block.to,
    capturedRevision: revision
  };
}

export function resolveChalkLeeTopLevelInsertionBookmark(
  bookmark: ChalkLeeTopLevelInsertionBookmark,
  blocks: readonly ChalkLeeTopLevelBlockPosition[],
  revision: number
): ChalkLeeBookmarkResolution {
  if (bookmark.kind === "start") {
    return revision === bookmark.capturedRevision
      ? { ok: true, position: 0 }
      : { ok: false, reason: "document-changed" };
  }
  if (bookmark.kind === "position") {
    return revision === bookmark.capturedRevision
      ? { ok: true, position: bookmark.capturedPosition }
      : { ok: false, reason: "document-changed" };
  }
  const matches = blocks.filter((block) => block.id === bookmark.nodeId && block.type === bookmark.nodeType);
  if (!matches.length) return { ok: false, reason: "target-missing" };
  if (matches.length > 1) return { ok: false, reason: "target-ambiguous" };
  return { ok: true, position: matches[0].to };
}

/**
 * Block content follows the caret into a question region. Outside a supported
 * region it keeps the editor's established top-level, after-current-block rule.
 */
export function chalkLeeBlockInsertionDestination(
  blocks: readonly ChalkLeeTopLevelBlockPosition[],
  regions: readonly ChalkLeeQuestionRegionPosition[],
  selectionEnd: number,
  allowCellContainer = true
): ChalkLeeBlockInsertionDestination {
  const region = regions
    .filter((candidate) => selectionEnd > candidate.from && selectionEnd < candidate.to)
    .sort((left, right) => (left.to - left.from) - (right.to - right.from))[0];
  const child = region?.children.find((candidate) => selectionEnd > candidate.from && selectionEnd <= candidate.to);
  if (region && child) {
    if (!allowCellContainer && region.contentGroup === "cellBlock") {
      return { scope: "unsupported", reason: "table-inside-cell", containerType: region.type };
    }
    return {
      scope: "question-region",
      position: child.to,
      regionId: region.id,
      regionType: region.type,
      childId: child.id,
      childType: child.type
    };
  }
  if (selectionEnd <= 0) return { scope: "top-level", position: 0 };
  const block = blocks.find((candidate) => selectionEnd > candidate.from && selectionEnd <= candidate.to);
  return { scope: "top-level", position: block?.to ?? selectionEnd };
}

export function captureChalkLeeBlockInsertionBookmark(
  blocks: readonly ChalkLeeTopLevelBlockPosition[],
  regions: readonly ChalkLeeQuestionRegionPosition[],
  selectionEnd: number,
  revision: number
): ChalkLeeBlockInsertionBookmark {
  const destination = chalkLeeBlockInsertionDestination(blocks, regions, selectionEnd);
  // Media bookmarks always allow every supported nested container, so this is
  // only a defensive fallback for malformed position inventories.
  if (destination.scope === "unsupported") {
    return { kind: "top-level", bookmark: captureChalkLeeTopLevelInsertionBookmark(blocks, selectionEnd, revision) };
  }
  if (destination.scope === "top-level") {
    return { kind: "top-level", bookmark: captureChalkLeeTopLevelInsertionBookmark(blocks, selectionEnd, revision) };
  }
  if (destination.regionId && destination.childId) {
    return {
      kind: "inside-region-after-node",
      regionId: destination.regionId,
      regionType: destination.regionType,
      childId: destination.childId,
      childType: destination.childType,
      capturedRevision: revision
    };
  }
  return {
    kind: "inside-region-position",
    capturedPosition: destination.position,
    capturedRevision: revision,
    regionType: destination.regionType
  };
}

export function resolveChalkLeeBlockInsertionBookmark(
  bookmark: ChalkLeeBlockInsertionBookmark,
  blocks: readonly ChalkLeeTopLevelBlockPosition[],
  regions: readonly ChalkLeeQuestionRegionPosition[],
  revision: number
): ChalkLeeBlockBookmarkResolution {
  if (bookmark.kind === "top-level") {
    const resolution = resolveChalkLeeTopLevelInsertionBookmark(bookmark.bookmark, blocks, revision);
    return resolution.ok
      ? { ok: true, destination: { scope: "top-level", position: resolution.position } }
      : resolution;
  }
  if (bookmark.kind === "inside-region-position") {
    return revision === bookmark.capturedRevision
      ? {
          ok: true,
          destination: {
            scope: "question-region",
            position: bookmark.capturedPosition,
            regionId: null,
            regionType: bookmark.regionType,
            childId: null,
            childType: "unknown"
          }
        }
      : { ok: false, reason: "document-changed" };
  }
  const matchingRegions = regions.filter(
    (region) => region.id === bookmark.regionId && region.type === bookmark.regionType
  );
  if (!matchingRegions.length) return { ok: false, reason: "target-missing" };
  if (matchingRegions.length > 1) return { ok: false, reason: "target-ambiguous" };
  const matchingChildren = matchingRegions[0].children.filter(
    (child) => child.id === bookmark.childId && child.type === bookmark.childType
  );
  if (!matchingChildren.length) return { ok: false, reason: "target-missing" };
  if (matchingChildren.length > 1) return { ok: false, reason: "target-ambiguous" };
  return {
    ok: true,
    destination: {
      scope: "question-region",
      position: matchingChildren[0].to,
      regionId: matchingRegions[0].id,
      regionType: matchingRegions[0].type,
      childId: matchingChildren[0].id,
      childType: matchingChildren[0].type
    }
  };
}

/** Retain resources needed by undo or edits made while an asynchronous save was in flight. */
export function mergeChalkLeeSessionResources(canonical: ChalkLeeArchive, live: ChalkLeeArchive): ChalkLeeArchive {
  const descriptors = new Map(live.manifest.assets.map((asset) => [asset.id, asset]));
  for (const asset of canonical.manifest.assets) descriptors.set(asset.id, asset);
  return {
    ...canonical,
    document: {
      ...canonical.document,
      appearance: {
        ...canonical.document.appearance,
        questionStyles: { ...canonical.document.appearance.questionStyles, ...live.document.appearance.questionStyles }
      }
    },
    manifest: {
      ...canonical.manifest,
      assets: Array.from(descriptors.values())
    },
    assets: {
      ...live.assets,
      ...canonical.assets
    }
  };
}

type RecognitionReplacementSegment =
  | { kind: "question"; source: string; draft: { node: JSONContent } }
  | { kind: "answers"; source: string }
  | { kind: "text"; source: string };

export function recognitionReplacementWithOriginalParagraphs(
  segments: readonly RecognitionReplacementSegment[],
  originalParagraphs: readonly JSONContent[]
): JSONContent[] | null {
  const replacement: JSONContent[] = [];
  let paragraphIndex = 0;
  for (const segment of segments) {
    const sourceLines = normalizedNonEmptyLines(segment.source);
    const originals = originalParagraphs.slice(paragraphIndex, paragraphIndex + sourceLines.length);
    if (originals.length !== sourceLines.length) return null;
    const originalLines = originals.map((node) => jsonTextContent(node).trim());
    if (sourceLines.some((line, index) => line !== originalLines[index])) return null;
    if (segment.kind === "question") replacement.push(segment.draft.node);
    // A paper-end answer key now lives in its questions.
    else if (segment.kind === "text") replacement.push(...originals);
    paragraphIndex += sourceLines.length;
  }
  return paragraphIndex === originalParagraphs.length ? replacement : null;
}

export interface ChalkLeeFrameTaskScheduler {
  schedule(): void;
  cancel(): void;
  pending(): boolean;
}

export function isChalkLeePlainTextClipboard(types: readonly string[], fileCount: number, html: string) {
  if (fileCount > 0 || html.trim()) return false;
  return types.every((type) => type === "text/plain" || type === "text");
}

export function createChalkLeeFrameTaskScheduler(
  requestFrame: (callback: FrameRequestCallback) => number,
  cancelFrame: (handle: number) => void,
  task: () => void
): ChalkLeeFrameTaskScheduler {
  let handle: number | null = null;
  return {
    schedule() {
      if (handle !== null) return;
      handle = requestFrame(() => {
        handle = null;
        task();
      });
    },
    cancel() {
      if (handle === null) return;
      cancelFrame(handle);
      handle = null;
    },
    pending() {
      return handle !== null;
    }
  };
}

function normalizedNonEmptyLines(source: string) {
  return source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function jsonTextContent(node: JSONContent): string {
  return [node.text ?? "", ...(node.content?.map(jsonTextContent) ?? [])].join("");
}
