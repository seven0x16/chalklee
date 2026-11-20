import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppSelect } from "./AppSelect";
import { appSelectMenuPosition, findAppSelectOption, nextAppSelectOption } from "./appSelectBehavior";

const options = [
  { value: "paragraph", label: "正文" },
  { value: "question", label: "题目", disabled: true },
  { value: "heading-1", label: "标题 1" },
  { value: "heading-2", label: "标题 2" }
];

describe("application themed selects", () => {
  it("moves through enabled options, wraps and handles an absent selection", () => {
    expect(nextAppSelectOption(options, 0, 1)).toBe(2);
    expect(nextAppSelectOption(options, 2, -1)).toBe(0);
    expect(nextAppSelectOption(options, 3, 1)).toBe(0);
    expect(nextAppSelectOption(options, -1, -1)).toBe(3);
    expect(nextAppSelectOption(options, -1, 1)).toBe(0);
    expect(nextAppSelectOption([], 0, 1)).toBe(-1);
    expect(nextAppSelectOption(options.map(option => ({ ...option, disabled: true })), 0, 1)).toBe(-1);
  });

  it("finds typed labels cyclically while skipping unavailable choices", () => {
    expect(findAppSelectOption(options, "标题", -1)).toBe(2);
    expect(findAppSelectOption(options, "标题", 2)).toBe(3);
    expect(findAppSelectOption(options, "标题", 3)).toBe(2);
    expect(findAppSelectOption(options, "题目", -1)).toBe(-1);
    expect(findAppSelectOption([{ value: "Letter", label: "Letter" }], "le", -1)).toBe(0);
    expect(findAppSelectOption([], "a", -1)).toBe(-1);
  });

  it("opens above a control near the window bottom and stays inside the right edge", () => {
    expect(appSelectMenuPosition({ left: 1160, top: 710, bottom: 744, width: 112 }, { width: 1288, height: 772 }, 170)).toEqual({
      left: 1120, top: 534, width: 160, maxHeight: 360
    });
  });

  it("lines a wider menu up with the right edge of a control at the end of its row", () => {
    expect(appSelectMenuPosition({ left: 900, top: 100, bottom: 130, width: 120 }, { width: 1200, height: 800 }, 100, 280, undefined, "end")).toMatchObject({ left: 740, width: 280 });
    expect(appSelectMenuPosition({ left: 100, top: 100, bottom: 130, width: 120 }, { width: 1200, height: 800 }, 100, 280, undefined, "end")).toMatchObject({ left: 8 });
  });

  it("uses available space for a long list and supports a narrow viewport", () => {
    const position = appSelectMenuPosition({ left: 10, top: 60, bottom: 94, width: 210 }, { width: 220, height: 400 }, 800, 240);
    expect(position).toEqual({ left: 8, top: 100, width: 204, maxHeight: 292 });
  });

  it("exposes the current label and disables an unavailable control", () => {
    const html = renderToStaticMarkup(createElement(AppSelect, { label: "段落类型", value: "heading-2", options, onChange: () => undefined }));
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-label="段落类型"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("标题 2");
    const disabled = renderToStaticMarkup(createElement(AppSelect, { label: "纸张大小", value: "custom", options: [{ value: "custom", label: "自定义尺寸", disabled: true }], onChange: () => undefined }));
    expect(disabled).toContain('disabled=""');
    expect(disabled).toContain("自定义尺寸");
  });
});
