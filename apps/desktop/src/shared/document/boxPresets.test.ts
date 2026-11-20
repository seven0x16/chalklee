import { chalkLeeSchemaErrors, compileChalkLeeBoxStyleCss, createChalkLeeArchive, readChalkLeeArchive, validateChalkLeeBoxStyleCss } from "@chalklee/format";
import { describe, expect, it } from "vitest";
import { CHALKLEE_BOX_PRESET_GROUPS, CHALKLEE_BOX_PRESETS, chalkLeeBoxPresetStyleName } from "./boxPresets";
import { createEmptyChalkLeeDocument } from "./newDocument";

describe("box style presets", () => {
  it("cover every group with unique names, and their CSS passes the same checks as any box style", () => {
    expect(CHALKLEE_BOX_PRESETS).toHaveLength(30);
    expect(new Set(CHALKLEE_BOX_PRESETS.map(preset => preset.id)).size).toBe(30);
    expect(new Set(CHALKLEE_BOX_PRESETS.map(preset => preset.name)).size).toBe(30);
    expect(new Set(CHALKLEE_BOX_PRESETS.map(preset => preset.group))).toEqual(new Set(CHALKLEE_BOX_PRESET_GROUPS));
    for (const preset of CHALKLEE_BOX_PRESETS) {
      if (preset.style.css) expect(() => validateChalkLeeBoxStyleCss(preset.style.css!), preset.name).not.toThrow();
    }
  });

  it("apply box style CSS only to boxes of that style on one paper and its print copy", () => {
    const css = compileChalkLeeBoxStyleCss("[data-chalklee-box] > [data-chalklee-frame-label] { color: #c81e1e; }", chalkLeeBoxPresetStyleName("seal"), '[data-chalklee-design="doc-1"] .chalklee-editor-content');
    expect(css).toContain('[data-chalklee-design="doc-1"] .chalklee-editor-content [data-chalklee-box][data-box-style="box.preset-seal"] > [data-chalklee-frame-label]');
    expect(css).toContain("#chalklee-print-root [data-chalklee-design=\"doc-1\"]");
  });

  it("reject what box style CSS may not do", () => {
    for (const css of [
      "p { color: red; }",
      ":root { color: red; }",
      "[data-chalklee-box] { background: url(https://example.com/a.png); }",
      "[data-chalklee-box] { animation: spin 1s; }",
      "[data-chalklee-box] { position: fixed; }",
      "[data-chalklee-box] { content: 'x'; }",
      "@import url(a.css);",
      "[data-chalklee-box] { color: \\72 ed; }"
    ]) expect(() => validateChalkLeeBoxStyleCss(css), css).toThrow();
  });

  it("are saved in a document with their CSS and read back unchanged; unsafe CSS is refused on saving", async () => {
    const document = createEmptyChalkLeeDocument("盒子样式");
    document.appearance.boxStyles = Object.fromEntries(CHALKLEE_BOX_PRESETS.map(preset => [chalkLeeBoxPresetStyleName(preset.id), preset.style]));
    expect(chalkLeeSchemaErrors(document)).toEqual([]);
    const { document: read } = await readChalkLeeArchive(await createChalkLeeArchive(document));
    expect(read.appearance.boxStyles).toEqual(document.appearance.boxStyles);

    document.appearance.boxStyles = { "box.bad": { css: "[data-chalklee-box] { background: url(https://example.com/a.png); }" } };
    await expect(createChalkLeeArchive(document)).rejects.toThrow("盒子样式 box.bad");
  });
});
