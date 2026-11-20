import { describe, expect, it } from "vitest";
import { CHALKLEE_BOX_PRESETS } from "../document/boxPresets";
import { createEmptyChalkLeeDocument } from "../document/newDocument";
import { patchAgentDesign } from "./design";

const grid = CHALKLEE_BOX_PRESETS.find(preset => preset.id === "grid")!;
const document = () => {
  const value = createEmptyChalkLeeDocument("盒子");
  value.content.content = [{ type: "box", attrs: { id: "box_1", label: "定义" }, content: [{ type: "paragraph", attrs: { id: "p_1" } }] }] as never;
  return value;
};

describe("box styles written by ChalkLee AI", () => {
  it("keep their own decoration CSS and name", () => {
    const style = { name: "树叶便签", backgroundColor: "#f1f8e9", css: "[data-chalklee-box] > [data-chalklee-frame-decoration]::before { content: \"\"; position: absolute; top: -6pt; left: 12pt; width: 40pt; height: 12pt; background: #c5e1a5; }" };
    const next = patchAgentDesign(document(), { boxStyles: { "box.leaf": style } });
    expect(next.appearance.boxStyles?.["box.leaf"]).toEqual(style);
  });

  it("refuse CSS that breaks the rules, naming the style", () => {
    expect(() => patchAgentDesign(document(), { boxStyles: { "box.web": { css: "[data-chalklee-box] { background: url(https://example.com/a.png); }" } } }))
      .toThrow("盒子样式 box.web 的 css");
    expect(() => patchAgentDesign(document(), { boxStyles: { "box.loose": { css: "p { color: red; }" } } })).toThrow("[data-chalklee-box]");
  });

  it("take a preset by name", () => {
    const preset = patchAgentDesign(document(), { boxStyles: { "box.preset-grid": "方格纸" } });
    expect(preset.appearance.boxStyles?.["box.preset-grid"]).toEqual(grid.style);
    expect(() => patchAgentDesign(document(), { boxStyles: { "box.x": "好看一点" } })).toThrow("不是预设样式名");
  });
});

describe("cover by ChalkLee AI", () => {
  it("adds a cover in a preset look by name, keeps the margins, and removes it", () => {
    const covered = patchAgentDesign(document(), { cover: { subtitle: "第一章", style: "深色" } });
    expect(covered.appearance.cover?.subtitle).toBe("第一章");
    expect(covered.appearance.cover?.style?.titleColor).toBe("#ffffff");
    expect(covered.appearance.page).toEqual(document().appearance.page);
    expect(patchAgentDesign(covered, { cover: null }).appearance.cover).toBeUndefined();
    expect(() => patchAgentDesign(document(), { cover: { style: "好看一点" } })).toThrow("不是预设名");
  });

  it("adds a contents in a preset look by name and removes it", () => {
    const listed = patchAgentDesign(document(), { tableOfContents: { levels: 3, style: "蓝色" } });
    expect(listed.appearance.tableOfContents).toEqual({ levels: 3, style: { accentColor: "#0d74ce" } });
    expect(patchAgentDesign(listed, { tableOfContents: null }).appearance.tableOfContents).toBeUndefined();
    expect(() => patchAgentDesign(document(), { tableOfContents: { style: "好看一点" } })).toThrow("不是预设名");
  });
});
