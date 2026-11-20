import { describe, expect, it, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { ChalkLeeArchive, ChalkLeeManifestAsset } from "@chalklee/format";
import {
  captureChalkLeeTopLevelInsertionBookmark,
  captureChalkLeeBlockInsertionBookmark,
  chalkLeeBlockInsertionDestination,
  chalkLeeSelectionControlsChanged,
  createChalkLeeFrameTaskScheduler,
  isChalkLeeSafeDirectQuestionPaste,
  isChalkLeePlainTextClipboard,
  mergeChalkLeeSessionResources,
  recognitionReplacementWithOriginalParagraphs,
  resolveChalkLeeBlockInsertionBookmark,
  resolveChalkLeeTopLevelInsertionBookmark,
  type ChalkLeeQuestionRegionPosition,
  type ChalkLeeTopLevelBlockPosition
} from "./editorWorkflow";

const blocks: ChalkLeeTopLevelBlockPosition[] = [
  { id: "title", type: "heading", from: 0, to: 12 },
  { id: "instructions", type: "paragraph", from: 12, to: 36 },
  { id: "section", type: "heading", from: 36, to: 48 }
];

const questionBlocks: ChalkLeeTopLevelBlockPosition[] = [
  { id: "question-1", type: "question", from: 0, to: 90 },
  { id: "section-2", type: "heading", from: 90, to: 106 }
];

const questionRegions: ChalkLeeQuestionRegionPosition[] = [{
  id: "stem-1",
  type: "questionStem",
  from: 1,
  to: 60,
  children: [
    { id: "stem-p1", type: "paragraph", from: 2, to: 24 },
    { id: "stem-p2", type: "paragraph", from: 24, to: 59 }
  ]
}];

const nestedQuestionContainers: ChalkLeeQuestionRegionPosition[] = [
  {
    id: "option-a",
    type: "option",
    from: 61,
    to: 78,
    contentGroup: "questionBlock",
    children: [{ id: "option-a-p1", type: "paragraph", from: 62, to: 77 }]
  },
  {
    id: "cell-a1",
    type: "tableCell",
    from: 10,
    to: 30,
    contentGroup: "cellBlock",
    children: [{ id: "cell-a1-p1", type: "paragraph", from: 11, to: 29 }]
  }
];

describe("ChalkLee editor workflow", () => {
  it("refreshes selection controls for formatting, range and block changes", () => {
    const schema = new Schema({
      nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} },
      marks: { bold: {}, textStyle: { attrs: { fontSizePt: {} } } }
    });
    const bold = schema.marks.bold.create();
    const font = schema.marks.textStyle.create({ fontSizePt: 18 });
    const first = schema.nodes.paragraph.create(null, [schema.text("abc"), schema.text("def", [bold, font])]);
    const doc = schema.nodes.doc.create(null, [first, schema.nodes.paragraph.create(null, schema.text("second"))]);
    const at = (from: number, to = from) => EditorState.create({ schema, doc, selection: TextSelection.create(doc, from, to) });
    const start = at(1), otherRun = at(5);
    expect(chalkLeeSelectionControlsChanged(start, at(2))).toBe(false);
    expect(chalkLeeSelectionControlsChanged(start, otherRun)).toBe(true);
    expect(chalkLeeSelectionControlsChanged(start, at(first.nodeSize + 2))).toBe(true);
    expect(chalkLeeSelectionControlsChanged(start, at(1, 3))).toBe(true);
    expect(chalkLeeSelectionControlsChanged(start, start.apply(start.tr.setSelection(NodeSelection.create(doc, 0))))).toBe(true);
    expect(chalkLeeSelectionControlsChanged(start, start.apply(start.tr.setStoredMarks([bold])))).toBe(true);
    expect(chalkLeeSelectionControlsChanged(start.apply(start.tr.setStoredMarks([bold])), otherRun.apply(otherRun.tr.setStoredMarks([bold])))).toBe(true);
  });

  it("anchors insertion after the selection-end block and resolves it after preceding edits", () => {
    const bookmark = captureChalkLeeTopLevelInsertionBookmark(blocks, 42, 7);
    const movedBlocks = blocks.map((block) => ({ ...block, from: block.from + 20, to: block.to + 20 }));

    expect(bookmark).toMatchObject({ kind: "after-node", nodeId: "section" });
    expect(resolveChalkLeeTopLevelInsertionBookmark(bookmark, movedBlocks, 8)).toEqual({ ok: true, position: 68 });
  });

  it("fails visibly resolvable bookmarks instead of falling back to a stale numeric position", () => {
    const bookmark = captureChalkLeeTopLevelInsertionBookmark(blocks, 42, 7);

    expect(resolveChalkLeeTopLevelInsertionBookmark(bookmark, blocks.slice(0, 2), 8)).toEqual({ ok: false, reason: "target-missing" });
    expect(resolveChalkLeeTopLevelInsertionBookmark(bookmark, [...blocks, blocks[2]], 8)).toEqual({ ok: false, reason: "target-ambiguous" });
  });

  it("places synchronous block content after the active child inside a question region", () => {
    expect(chalkLeeBlockInsertionDestination(questionBlocks, questionRegions, 40)).toEqual({
      scope: "question-region",
      position: 59,
      regionId: "stem-1",
      regionType: "questionStem",
      childId: "stem-p2",
      childType: "paragraph"
    });
    expect(chalkLeeBlockInsertionDestination(questionBlocks, questionRegions, 100)).toEqual({
      scope: "top-level",
      position: 106
    });
  });

  it("keeps media inside options and table cells, but rejects nested tables in cells", () => {
    expect(chalkLeeBlockInsertionDestination(questionBlocks, nestedQuestionContainers, 70)).toMatchObject({
      scope: "question-region",
      position: 77,
      regionId: "option-a"
    });
    expect(chalkLeeBlockInsertionDestination(questionBlocks, nestedQuestionContainers, 20)).toMatchObject({
      scope: "question-region",
      position: 29,
      regionId: "cell-a1"
    });
    expect(chalkLeeBlockInsertionDestination(questionBlocks, nestedQuestionContainers, 20, false)).toEqual({
      scope: "unsupported",
      reason: "table-inside-cell",
      containerType: "tableCell"
    });
  });

  it("resolves an async media bookmark inside an option after preceding edits", () => {
    const bookmark = captureChalkLeeBlockInsertionBookmark(questionBlocks, nestedQuestionContainers, 70, 2);
    const moved = nestedQuestionContainers.map((container) => ({
      ...container,
      from: container.from + 40,
      to: container.to + 40,
      children: container.children.map((child) => ({ ...child, from: child.from + 40, to: child.to + 40 }))
    }));

    expect(bookmark).toMatchObject({ kind: "inside-region-after-node", regionId: "option-a", childId: "option-a-p1" });
    expect(resolveChalkLeeBlockInsertionBookmark(bookmark, questionBlocks, moved, 3)).toMatchObject({
      ok: true,
      destination: { scope: "question-region", position: 117, regionId: "option-a" }
    });
  });

  it("resolves an async question-region bookmark after preceding edits and fails closed if its child disappears", () => {
    const bookmark = captureChalkLeeBlockInsertionBookmark(questionBlocks, questionRegions, 18, 4);
    const movedRegions = questionRegions.map((region) => ({
      ...region,
      from: region.from + 30,
      to: region.to + 30,
      children: region.children.map((child) => ({ ...child, from: child.from + 30, to: child.to + 30 }))
    }));

    expect(bookmark).toMatchObject({
      kind: "inside-region-after-node",
      regionId: "stem-1",
      childId: "stem-p1"
    });
    expect(resolveChalkLeeBlockInsertionBookmark(bookmark, questionBlocks, movedRegions, 5)).toEqual({
      ok: true,
      destination: {
        scope: "question-region",
        position: 54,
        regionId: "stem-1",
        regionType: "questionStem",
        childId: "stem-p1",
        childType: "paragraph"
      }
    });
    expect(resolveChalkLeeBlockInsertionBookmark(bookmark, questionBlocks, [{
      ...movedRegions[0],
      children: movedRegions[0].children.slice(1)
    }], 5)).toEqual({ ok: false, reason: "target-missing" });
    expect(resolveChalkLeeBlockInsertionBookmark(bookmark, questionBlocks, [movedRegions[0], movedRegions[0]], 5))
      .toEqual({ ok: false, reason: "target-ambiguous" });
  });

  it("rejects a numeric region bookmark after any intervening document edit", () => {
    const regionsWithoutIds: ChalkLeeQuestionRegionPosition[] = [{
      ...questionRegions[0],
      id: null,
      children: questionRegions[0].children.map((child) => ({ ...child, id: null }))
    }];
    const bookmark = captureChalkLeeBlockInsertionBookmark(questionBlocks, regionsWithoutIds, 18, 4);

    expect(bookmark).toMatchObject({ kind: "inside-region-position", capturedPosition: 24 });
    expect(resolveChalkLeeBlockInsertionBookmark(bookmark, questionBlocks, regionsWithoutIds, 5))
      .toEqual({ ok: false, reason: "document-changed" });
  });

  it("keeps live-only and undo-only image assets while preferring canonical checksums", () => {
    const oldAsset = asset("old", "saved-sha");
    const savedAsset = asset("saved", "saved-sha");
    const liveNewAsset = asset("new", "pending-save");
    const canonical = archive([savedAsset], { saved: [2] });
    const live = archive([oldAsset, { ...savedAsset, sha256: "pending-save" }, liveNewAsset], {
      old: [1],
      saved: [2],
      new: [3]
    });

    const merged = mergeChalkLeeSessionResources(canonical, live);

    expect(merged.manifest.assets.map((item) => item.id)).toEqual(["old", "saved", "new"]);
    expect(merged.manifest.assets.find((item) => item.id === "saved")?.sha256).toBe("saved-sha");
    expect(Object.keys(merged.assets)).toEqual(["old", "saved", "new"]);
  });

  it("keeps frame definitions made while an earlier save is in flight", () => {
    const canonical = archive([], {});
    canonical.document.appearance.questionStyles = { saved: { frame: { label: "已保存" } } };
    const live = archive([], {});
    live.document.appearance.questionStyles = {
      ...canonical.document.appearance.questionStyles,
      pending: { frame: { label: "保存期间新选的样式" } }
    };
    const merged = mergeChalkLeeSessionResources(canonical, live);
    expect(merged.document.appearance.questionStyles).toEqual(live.document.appearance.questionStyles);
    expect(canonical.document.appearance.questionStyles).not.toHaveProperty("pending");
  });

  it("reuses untouched source paragraphs for unrecognized recognition segments", () => {
    const original = [paragraph("卷头", "p1", { textAlign: "center" }), paragraph("1. 坏题", "p2")];
    const question = { type: "question", attrs: { id: "q1" } };
    const replacement = recognitionReplacementWithOriginalParagraphs([
      { kind: "text", source: "卷头" },
      { kind: "question", source: "1. 坏题", draft: { node: question } }
    ], original);

    expect(replacement).toEqual([original[0], question]);
    expect(replacement?.[0].attrs).toEqual({ id: "p1", textAlign: "center" });
  });

  it("drops the paragraphs of an answer key whose answers went into the questions", () => {
    const original = [paragraph("1. 题干", "p1"), paragraph("参考答案", "p2"), paragraph("1. B", "p3")];
    const question = { type: "question", attrs: { id: "q1" } };
    expect(recognitionReplacementWithOriginalParagraphs([
      { kind: "question", source: "1. 题干", draft: { node: question } },
      { kind: "answers", source: "参考答案\n1. B" }
    ], original)).toEqual([question]);
  });

  it("coalesces repeated work into one animation frame and supports cancellation", () => {
    let nextHandle = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    const task = vi.fn();
    const scheduler = createChalkLeeFrameTaskScheduler(
      (callback) => {
        const handle = ++nextHandle;
        callbacks.set(handle, callback);
        return handle;
      },
      (handle) => callbacks.delete(handle),
      task
    );

    scheduler.schedule();
    scheduler.schedule();
    expect(callbacks.size).toBe(1);
    const firstFrame = callbacks.get(1);
    callbacks.delete(1);
    firstFrame?.(0);
    expect(task).toHaveBeenCalledTimes(1);
    expect(scheduler.pending()).toBe(false);

    scheduler.schedule();
    scheduler.cancel();
    expect(callbacks.size).toBe(0);
    callbacks.get(2)?.(0);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("only opts into plain-text clipboard payloads", () => {
    expect(isChalkLeePlainTextClipboard(["text/plain"], 0, "")).toBe(true);
    expect(isChalkLeePlainTextClipboard(["text/plain", "text/html"], 0, "<b>题目</b>")).toBe(false);
    expect(isChalkLeePlainTextClipboard(["text/plain", "text/rtf"], 0, "")).toBe(false);
    expect(isChalkLeePlainTextClipboard(["text/plain"], 1, "")).toBe(false);
  });

  it("auto-applies recognition with an explicit number or valid options, beside text kept as written", () => {
    const draft = (optionCount: number, number: unknown) => ({
      optionCount,
      node: { attrs: { number } }
    });

    expect(isChalkLeeSafeDirectQuestionPaste({
      drafts: [draft(3, { mode: "fixed", label: "21" })],
      unrecognizedSegments: []
    })).toBe(true);
    expect(isChalkLeeSafeDirectQuestionPaste({
      drafts: [draft(2, { mode: "auto" })],
      unrecognizedSegments: []
    })).toBe(true);
    expect(isChalkLeeSafeDirectQuestionPaste({
      drafts: [draft(0, { mode: "auto" })],
      unrecognizedSegments: []
    })).toBe(false);
    expect(isChalkLeeSafeDirectQuestionPaste({
      drafts: [draft(3, { mode: "fixed", label: "21" })],
      unrecognizedSegments: [{ kind: "text" }]
    })).toBe(true);
  });
});

function asset(id: string, sha256: string): ChalkLeeManifestAsset {
  return { id, path: `assets/${id}.png`, mediaType: "image/png", byteLength: 1, sha256 };
}

function archive(assets: ChalkLeeManifestAsset[], bytes: Record<string, number[]>): ChalkLeeArchive {
  return {
    manifest: { assets },
    document: { schemaVersion: "chalklee/0.3", appearance: { questionStyles: {} } },
    assets: Object.fromEntries(Object.entries(bytes).map(([id, value]) => [id, new Uint8Array(value)]))
  } as unknown as ChalkLeeArchive;
}

function paragraph(text: string, id: string, attrs: Record<string, unknown> = {}) {
  return { type: "paragraph", attrs: { id, ...attrs }, content: [{ type: "text", text }] };
}
