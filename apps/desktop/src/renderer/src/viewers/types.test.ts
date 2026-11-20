import { describe, expect, it } from "vitest";
import { displayZoomPercent, mergePreviewState, outlinesEqual, resolvePreviewPageStep, type PreviewState } from "./types";

const state: PreviewState = {
  zoom: 100,
  zoomMode: "manual",
  currentPage: 2,
  pageCount: 8
};

describe("mergePreviewState", () => {
  it("preserves the object for duplicate engine reports", () => {
    expect(mergePreviewState(state, { zoom: 100, currentPage: 2 })).toBe(state);
  });

  it("creates a new object when a reported value changes", () => {
    const next = mergePreviewState(state, { zoom: 75 });
    expect(next).not.toBe(state);
    expect(next).toEqual({ ...state, zoom: 75 });
  });
});

describe("displayZoomPercent", () => {
  it("shows a whole percentage and clamps invalid toolbar values", () => {
    expect(displayZoomPercent(94.4901730220057)).toBe(94);
    expect(displayZoomPercent(240)).toBe(200);
    expect(displayZoomPercent(Number.NaN)).toBe(100);
  });
});

describe("outlinesEqual", () => {
  it("treats equivalent outline reports as the same runtime state", () => {
    const current = [{ id: "heading-1", label: "第一章", level: 1, target: "heading-1" }];
    expect(outlinesEqual(current, current.map((item) => ({ ...item })))).toBe(true);
  });

  it("detects a changed outline item", () => {
    const current = [{ id: "heading-1", label: "第一章", level: 1, target: "heading-1" }];
    expect(outlinesEqual(current, [{ ...current[0], label: "第二章" }])).toBe(false);
  });

  it("distinguishes question navigation entries from headings", () => {
    const current = [{ id: "question-1", label: "第 1 题", level: 1, kind: "question" as const, target: "question-1" }];
    expect(outlinesEqual(current, [{ ...current[0], kind: "heading" }])).toBe(false);
  });
});

describe("resolvePreviewPageStep", () => {
  it("continues from a pending page while the viewer still reports the old page", () => {
    expect(resolvePreviewPageStep(1, 8, 2, 1)).toBe(3);
    expect(resolvePreviewPageStep(1, 8, 3, 1)).toBe(4);
  });

  it("clamps queued navigation to the document bounds", () => {
    expect(resolvePreviewPageStep(1, 8, null, -1)).toBe(1);
    expect(resolvePreviewPageStep(8, 8, null, 1)).toBe(8);
  });
});
