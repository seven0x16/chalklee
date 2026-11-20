import { describe, expect, it } from "vitest";
import { chalkLeeCircledNumber, chalkLeeQuestionLabelText, chalkLeeQuestionNumberText } from "@chalklee/format";
import { patchAgentDesign } from "../agent/design";
import { applyChalkLeeLayout, chalkLeeLayoutFromDocument } from "./layouts";
import { createEmptyChalkLeeDocument } from "./newDocument";
import { CHALKLEE_QUESTION_NUMBERING_PRESETS, chalkLeeCurrentQuestionNumberingPreset } from "./paperPresets";

describe("question numbers", () => {
  it("are written in the document's style, circled ones up to ㊿ and then as 51.", () => {
    expect([1, 12].map(value => chalkLeeQuestionNumberText("dot", value))).toEqual(["1.", "12."]);
    expect(chalkLeeQuestionNumberText("comma", 3)).toBe("3、");
    expect(chalkLeeQuestionNumberText("paren", 10)).toBe("(10)");
    expect(chalkLeeQuestionNumberText("plain", 7)).toBe("7");
    expect([1, 20, 21, 35, 36, 50].map(chalkLeeCircledNumber)).toEqual(["①", "⑳", "㉑", "㉟", "㊱", "㊿"]);
    expect(chalkLeeQuestionNumberText("circle", 51)).toBe("51.");
  });

  it("follow the style for a teacher's own number however it was typed, and print labels with words as written", () => {
    expect(chalkLeeQuestionLabelText("circle", " 3 ")).toBe("③");
    expect(["(1)", "（1）", "1.", "1．", "1、", "①"].map(label => chalkLeeQuestionLabelText("dot", label))).toEqual(Array(6).fill("1."));
    expect(chalkLeeQuestionLabelText("circle", "(2)")).toBe("②");
    expect(["例1", "A1", "(1", "1)"].map(label => chalkLeeQuestionLabelText("paren", label))).toEqual(["例1", "A1", "(1", "1)"]);
  });

  it("name the preset they look like, the standard one when the document sets nothing", () => {
    expect(chalkLeeCurrentQuestionNumberingPreset(undefined)?.name).toBe("标准");
    expect(chalkLeeCurrentQuestionNumberingPreset({ style: "dot", fontWeight: "bold", subStyle: "paren" })?.name).toBe("标准");
    expect(chalkLeeCurrentQuestionNumberingPreset({ style: "circle", fontWeight: "normal" })?.name).toBe("圆圈");
    expect(chalkLeeCurrentQuestionNumberingPreset({ color: "#ff0000" })).toBeNull();
    expect(new Set(CHALKLEE_QUESTION_NUMBERING_PRESETS.map(preset => JSON.stringify(preset.numbering))).size).toBe(CHALKLEE_QUESTION_NUMBERING_PRESETS.length);
  });

  it("are set by ChalkLee AI by preset name or fields, and null returns to the standard", () => {
    const document = createEmptyChalkLeeDocument("期中");
    const circled = patchAgentDesign(document, { questionNumbering: "圆圈" });
    expect(circled.appearance.questionNumbering).toEqual({ style: "circle", fontWeight: "normal" });
    const blue = patchAgentDesign(circled, { questionNumbering: { color: "#0d74ce" } });
    expect(blue.appearance.questionNumbering).toEqual({ color: "#0d74ce" });
    expect(patchAgentDesign(blue, { questionNumbering: null }).appearance.questionNumbering).toBeUndefined();
    expect(() => patchAgentDesign(document, { questionNumbering: "彩虹" })).toThrow(/不是预设名/);
  });

  it("travel with a layout to another document", () => {
    const source = createEmptyChalkLeeDocument("讲义");
    source.appearance.questionNumbering = { style: "plain", frame: true };
    const target = applyChalkLeeLayout(createEmptyChalkLeeDocument("练习"), chalkLeeLayoutFromDocument(source, "方框题号"));
    expect(target.appearance.questionNumbering).toEqual({ style: "plain", frame: true });
    const plain = applyChalkLeeLayout(target, chalkLeeLayoutFromDocument(createEmptyChalkLeeDocument("空白"), "标准"));
    expect(plain.appearance.questionNumbering).toBeUndefined();
  });
});
