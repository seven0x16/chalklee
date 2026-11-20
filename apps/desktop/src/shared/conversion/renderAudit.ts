import type { ChalkLeeDocument } from "@chalklee/format";
import type { DocumentOutputOptions } from "../document/output";

export interface ImportRenderSnapshot {
  formulas: string[];
  images: { assetId: string; loaded: boolean }[];
  tables: number;
  options: number;
  groupHeadings: { id: string; headings: string[] }[];
}
export interface ImportRenderAudit {
  expected: { formulas: number; images: number; tables: number; options: number };
  actual: { formulas: number; images: number; tables: number; options: number };
  issues: string[];
}

export function auditImportRender(document: ChalkLeeDocument, rendered: ImportRenderSnapshot, view: DocumentOutputOptions = {}): ImportRenderAudit {
  const formulas: string[] = [], images: string[] = [];
  let tables = 0, options = 0;
  const walk = (node: any) => {
    if (node.type === "questionAnswer" && view.answers === false || node.type === "questionAnalysis" && view.analysis === false) return;
    if (["mathInline", "blockMath"].includes(node.type)) formulas.push(node.attrs.latex);
    if (["image", "imageInline"].includes(node.type)) images.push(node.attrs.assetId);
    if (node.type === "table") tables++;
    if (node.type === "option") options++;
    node.content?.forEach(walk);
  };
  walk(document.content);
  const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const issues: string[] = [];
  if (!same(formulas, rendered.formulas)) issues.push("实际编辑器中的公式内容或数量与 ChalkLee 不一致。");
  if (!same(images, rendered.images.map(image => image.assetId))) issues.push("实际编辑器中的配图引用或数量与 ChalkLee 不一致。");
  for (const image of rendered.images) if (!image.loaded) issues.push(`实际编辑器未能加载配图 ${image.assetId}。`);
  if (tables !== rendered.tables) issues.push(`实际编辑器表格数量不一致：${rendered.tables}/${tables}。`);
  if (options !== rendered.options) issues.push(`实际编辑器选项数量不一致：${rendered.options}/${options}。`);
  for (const group of rendered.groupHeadings) {
    // Later subquestions keep an empty heading so each section is labelled once.
    const headings = group.headings.map(value => value.replace(/[：:\s]/g, "")).filter(Boolean);
    if (new Set(headings).size !== headings.length) issues.push(`题组 ${group.id} 重复显示答案或解析标题。`);
  }
  return { expected: { formulas: formulas.length, images: images.length, tables, options }, actual: { formulas: rendered.formulas.length, images: rendered.images.length, tables: rendered.tables, options: rendered.options }, issues };
}

/** Inspect the actual detached print DOM, after image/font loading. */
export function inspectImportPrint(root: HTMLElement): ImportRenderSnapshot {
  return {
    formulas: [...root.querySelectorAll<HTMLElement>("[data-chalklee-inline-math], [data-chalklee-block-math]")].map(node => (node.getAttribute("aria-label") ?? "").replace(/^公式：/, "")),
    images: [...root.querySelectorAll<HTMLElement>("[data-chalklee-image]")].map(node => {
      const image = node.querySelector<HTMLImageElement>("img");
      return { assetId: node.dataset.assetId ?? "", loaded: !!image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0 };
    }),
    tables: root.querySelectorAll("table").length,
    options: root.querySelectorAll("[data-chalklee-option]").length,
    groupHeadings: [...root.querySelectorAll<HTMLElement>(".chalklee-question-object.group")].map(node => ({
      id: node.dataset.nodeId ?? "", headings: [...node.querySelectorAll<HTMLElement>(".chalklee-group-solution")].filter(region => region.closest(".chalklee-question-object.group") === node).map(region => region.dataset.heading ?? "")
    }))
  };
}
