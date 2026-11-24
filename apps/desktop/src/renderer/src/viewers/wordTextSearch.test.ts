import { describe, expect, it } from "vitest";
import { wordPageWithText } from "./wordTextSearch";

describe("finding printed text in a laid-out Word document", () => {
  const pages = [{ html: "<p>第一页</p>" }, { html: '<p><span>17.</span> 简述&nbsp;<b>原因</b>\n及影响</p>' }];
  it("finds text split across runs, spaces and entities", () => {
    expect(wordPageWithText(pages, "简述原因及影响")).toBe(1);
  });
  it("does not match markup, and reports text that is not there", () => {
    expect(wordPageWithText(pages, "span")).toBe(-1);
    expect(wordPageWithText(pages, "没有这段")).toBe(-1);
    expect(wordPageWithText(pages, "  ")).toBe(-1);
  });
});
