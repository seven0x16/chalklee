import { importText } from "../../shared/conversion/importDocument";
import { importSectionLabel, isImportAnswerHeading } from "../../shared/conversion/answerSource";

const visit = (node: any, fn: (node: any) => void) => {
  if (Array.isArray(node)) { node.forEach(child => visit(child, fn)); return; }
  if (!node || typeof node !== "object") return;
  fn(node); node.content?.forEach((child: any) => visit(child, fn));
};
// Compare content, not generated IDs or presentation. Preserve character and
// formula order within each paragraph, including punctuation and operators.
const signature = (node: any): unknown => node.type === "text" ? ["text", node.text]
  : [node.type, node.attrs?.latex ?? node.attrs?.assetId ?? null,
    ...(node.type === "tableCell" ? [node.attrs?.colspan ?? 1, node.attrs?.rowspan ?? 1] : []),
    ...(node.type === "blank" ? [node.attrs?.label ?? ""] : []),
    (node.content ?? []).map(signature)];

/** Capture hydrated, editable transcription before continuation/answer moves.
 * This verifies the compiler, not the model's interpretation of source pixels. */
export function captureImportContent(blocks: any[], answerEntryIds = new Set<string>()): Map<string, string> {
  const result = new Map<string, string>();
  for (const block of blocks) {
    // The answer reconciler deliberately removes now-redundant answer titles
    // and section labels. Those headings are outside this conservation check.
    if (["heading", "paragraph"].includes(block.type) && (isImportAnswerHeading(importText(block)) || importSectionLabel(importText(block)))) continue;
    // answerEntry uses a temporary question shell with an empty synthetic
    // stem. Only its source answer/analysis regions are meant to survive.
    const source = answerEntryIds.has(block.attrs?.id) ? block.content.filter((region: any) => ["questionAnswer", "questionAnalysis"].includes(region.type)) : block;
    visit(source, node => {
      if (node.attrs?.id && ["paragraph", "blockMath", "image", "imageInline", "table"].includes(node.type)) {
        result.set(node.attrs.id, JSON.stringify(signature(node)));
      }
    });
  }
  return result;
}

export function auditImportContent(expected: Map<string, string>, content: unknown) {
  const actual = new Map<string, string>();
  visit(content, node => { if (node.attrs?.id) actual.set(node.attrs.id, JSON.stringify(signature(node))); });
  const issues: string[] = [];
  for (const [id, value] of expected) {
    if (actual.get(id) !== value) issues.push(`转录内容 ${id} 在组装后${actual.has(id) ? "发生改变" : "丢失"}，请保留原片段并检查编译结果。`);
  }
  return { scope: "核验已展开转录到组装结果的段落字符顺序、公式、图片和表格；不证明原稿识别正确。", checkedNodes: expected.size, issues };
}

export function importQuestionInventory(content: unknown) {
  const result: { number: string; group: boolean; answer: boolean; analysis: boolean; options: number; tables: number; formulas: number; images: string[] }[] = [];
  const walk = (node: any, parents: string[]) => {
    if (!node || typeof node !== "object") return;
    if (["question", "questionGroup"].includes(node.type)) {
      parents = [...parents, node.attrs.number?.label ?? "无题号"];
      const regions = node.content.filter((region: any) => region.type !== "subQuestionList");
      const entry = { number: parents.join("/"), group: node.type === "questionGroup", answer: regions.some((r: any) => r.type === "questionAnswer"), analysis: regions.some((r: any) => r.type === "questionAnalysis"), options: 0, tables: 0, formulas: 0, images: [] as string[] };
      visit(regions, child => {
        if (child.type === "option") entry.options++;
        if (child.type === "table") entry.tables++;
        if (["mathInline", "blockMath"].includes(child.type)) entry.formulas++;
        if (["image", "imageInline"].includes(child.type)) entry.images.push(child.attrs.assetId);
      });
      result.push(entry);
    }
    node.content?.forEach((child: any) => walk(child, parents));
  };
  walk(content, []); return result;
}
