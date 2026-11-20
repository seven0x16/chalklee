import { describe, expect, it } from "vitest";
import { importAppearance } from "./importDocument";
import type { ChalkLeeDocument } from "@chalklee/format";
import { auditImportRender, type ImportRenderSnapshot } from "./renderAudit";

const document = { appearance: importAppearance(), content: { type: "doc", content: [
  { type: "paragraph", content: [{ type: "mathInline", attrs: { latex: "a+b" } }, { type: "mathInline", attrs: { latex: "a+b" } }] },
  { type: "image", attrs: { assetId: "auxiliary" } }, { type: "table" }, { type: "option" }
] } } as unknown as ChalkLeeDocument;
const snapshot = (): ImportRenderSnapshot => ({ formulas: ["a+b", "a+b"], images: [{ assetId: "auxiliary", loaded: true }], tables: 1, options: 1, groupHeadings: [{ id: "group", headings: ["答案：", "解析："] }] });
describe("actual editor render audit", () => {
  it("does not expect pictures and formulas from excluded answers or analysis", () => {
    const output = structuredClone(document);
    (output.content.content as unknown[]).push({ type: "question", content: [
      { type: "questionAnswer", content: [{ type: "image", attrs: { assetId: "answer-picture" } }] },
      { type: "questionAnalysis", content: [{ type: "mathInline", attrs: { latex: "analysis-formula" } }] }
    ] });
    expect(auditImportRender(output, snapshot(), { answers: false, analysis: false }).issues).toEqual([]);
    expect(auditImportRender(output, snapshot(), { answers: true, analysis: true }).issues).toHaveLength(2);
  });
  it("compares formula identities and multiplicity, not just total counts", () => {
    expect(auditImportRender(document, snapshot()).issues).toEqual([]);
    const changed = snapshot(); changed.formulas[1] = "a-b";
    expect(auditImportRender(document, changed).issues[0]).toContain("公式内容或数量");
  });
  it("allows unlabelled subquestions after a single answer or analysis heading", () => {
    const changed = snapshot();
    changed.groupHeadings[0].headings = ["答案：", "", "", "解析：", "", ""];
    expect(auditImportRender(document, changed).issues).toEqual([]);
  });
  it("still rejects repeated visible headings among unlabelled subquestions", () => {
    const changed = snapshot();
    changed.groupHeadings[0].headings = ["答案：", "", "", "答案:"];
    expect(auditImportRender(document, changed).issues).toEqual(["题组 group 重复显示答案或解析标题。"]);
  });
  it("detects missing assets, broken loading, lost tables/options and repeated group headings", () => {
    const changed = snapshot(); changed.images = [{ assetId: "wrong", loaded: false }]; changed.tables = 0; changed.options = 0; changed.groupHeadings[0].headings.push("答案:");
    expect(auditImportRender(document, changed).issues).toEqual([
      "实际编辑器中的配图引用或数量与 ChalkLee 不一致。", "实际编辑器未能加载配图 wrong。",
      "实际编辑器表格数量不一致：0/1。", "实际编辑器选项数量不一致：0/1。", "题组 group 重复显示答案或解析标题。"
    ]);
  });
});
