import { chalkLeeSchemaErrors, createChalkLeeArchive, readChalkLeeArchive, validateChalkLeeSemantics } from "@chalklee/format";
import type { ChalkLeeAppearance, ChalkLeeArchiveAssetInput, ChalkLeeBlockNode, ChalkLeeDocument, ChalkLeePageAppearance } from "@chalklee/format";

export function importAppearance(page?: ChalkLeePageAppearance): ChalkLeeAppearance {
  return {
    page: page ?? {
      size: "A4", orientation: "portrait", marginsPt: { top: 45, right: 45, bottom: 45, left: 45 },
      background: { type: "solid", color: "#FFFFFF" }, printBackground: false
    },
    body: { fontFamilies: ["Times New Roman", "Songti SC", "SimSun", "serif"], fontSizePt: 10.5, lineHeight: 1.5, color: "#000000" },
    defaults: { questionStyleRef: "question.exam", optionStyleRef: "option.exam", answerStyleRef: "answer.standard", analysisStyleRef: "analysis.standard" },
    questionStyles: { "question.exam": { gapPt: 6, breakInside: "auto" } },
    optionStyles: { "option.exam": { marker: "label", layout: "auto", columnGapPt: 16, rowGapPt: 2, labelGapPt: 4 } },
    answerStyles: { "answer.standard": { label: "答案", paddingPt: { top: 18, right: 0, bottom: 4, left: 0 } } },
    analysisStyles: { "analysis.standard": { label: "解析", paddingPt: { top: 18, right: 0, bottom: 4, left: 0 } } }
  };
}

export function parseImportReply(text: string): { blocks: unknown[]; warnings: string[]; continuesPrevious: boolean } {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const value = JSON.parse(cleaned) as Record<string, unknown>;
  if (!value || !Array.isArray(value.blocks) || !value.blocks.length || value.blocks.length > 3000) {
    throw new Error("模型没有返回完整的文档内容，请重试当前部分。");
  }
  if (value.warnings !== undefined && (!Array.isArray(value.warnings) || value.warnings.some(warning => typeof warning !== "string"))) {
    throw new Error("模型返回的校对说明格式不正确。");
  }
  return { blocks: value.blocks, warnings: (value.warnings as string[] | undefined) ?? [], continuesPrevious: value.continuesPrevious === true };
}

export function regenerateImportIds(value: unknown, createId: () => string = () => `node_${crypto.randomUUID()}`): unknown {
  if (Array.isArray(value)) return value.map(item => regenerateImportIds(item, createId));
  if (!value || typeof value !== "object") return value;
  const node = value as Record<string, unknown>;
  const result = { ...node };
  if (typeof node.type === "string" && !["text", "hardBreak", "mathInline"].includes(node.type)) {
    result.attrs = { ...(node.attrs && typeof node.attrs === "object" ? node.attrs : {}), id: createId() };
  }
  if (Array.isArray(node.content)) result.content = node.content.filter(child => !(child && typeof child === "object" && child.type === "text" && child.text === "")).map(child => regenerateImportIds(child, createId));
  if (["mathInline", "blockMath", "image", "imageInline", "blank", "hardBreak"].includes(String(node.type)) && Array.isArray(result.content) && result.content.length === 0) delete result.content;
  return result;
}

export function assertImportDocument(document: ChalkLeeDocument, fragment = false, subject = "转换内容"): void {
  // A page can end in the middle of a stem or reading material. Keep those
  // fragments unmodified until their continuation arrives; the saved file must
  // still pass the complete ChalkLee schema.
  const errors = chalkLeeSchemaErrors(document, { fragment });
  if (errors.length) throw new Error(`${subject}未通过格式校验：${errors.join("；")}`);
  const issues = validateChalkLeeSemantics(document).filter(issue => !fragment || !["missing-question-stem", "missing-question-material", "missing-subquestion-list"].includes(issue.code));
  if (issues.length) throw new Error(`${subject}未通过结构校验：${issues.slice(0, 4).map(issue => issue.message).join("；")}`);
}

export async function validatedImportArchive(document: ChalkLeeDocument, assets: ChalkLeeArchiveAssetInput[]): Promise<Uint8Array> {
  assertImportDocument(document);
  const bytes = await createChalkLeeArchive(document, assets);
  const archive = await readChalkLeeArchive(bytes);
  const issues = validateChalkLeeSemantics(document, archive.manifest);
  if (issues.length) throw new Error(`转换内容的素材或引用不完整：${issues.map(issue => issue.message).join("；")}`);
  return bytes;
}

export function importText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const node = value as { type?: string; text?: string; attrs?: { latex?: string }; content?: unknown[] };
  if (node.type === "text") return node.text ?? "";
  if (node.type === "mathInline" || node.type === "blockMath") return node.attrs?.latex ?? "";
  return node.content?.map(importText).join(" ") ?? "";
}

/** A conservative corruption check, not a mathematical correctness test. */
export function isPlausibleImportFormula(latex: string): boolean {
  // Check before trimming: JSON's \f, \t and \b can consume the first letter
  // of a LaTeX command. Trimming then turns a broken \frac into plausible "rac".
  if (!latex.trim() || /[\u0000-\u0009\u000b-\u001f\u007f\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]|APAPAE.*[%!]/u.test(latex)) return false;
  // HTML styling inside LaTeX is printed as literal letters and brackets.
  if (/<\/(?:u|b|strong|i|em|span)\s*>|<br\s*\/?>/i.test(latex)) return false;
  let braces = 0;
  for (let index = 0; index < latex.length; index++) {
    if (latex[index] === "\\") { index++; continue; }
    if (latex[index] === "{") braces++;
    if (latex[index] === "}" && --braces < 0) return false;
  }
  return braces === 0;
}

export function importContinuationTarget(blocks: ChalkLeeBlockNode[]): ChalkLeeBlockNode | undefined {
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.type === "question" || block.type === "questionGroup") return block;
    if (block.type === "heading" || block.type === "pageBreak") return undefined;
  }
  return undefined;
}

export function appendImportBlocks(target: ChalkLeeBlockNode[], next: ChalkLeeBlockNode[], continuesPrevious: boolean): boolean {
  let previous = importContinuationTarget(target);
  const first = next[0];
  // The first page may contain only shared prose. A later page supplies the
  // printed children that establish this same numbered question as a group.
  if (continuesPrevious && previous?.type === "question" && first?.type === "questionGroup"
    && previous.attrs.number.mode === "fixed" && first.attrs.number.mode === "fixed" && previous.attrs.number.label === first.attrs.number.label
    && previous.content.length === 1 && previous.content[0].type === "questionStem"
    && first.content.some(region => region.type === "subQuestionList" && region.content.length > 0)) {
    const group: ChalkLeeBlockNode = { type: "questionGroup", attrs: { ...previous.attrs, kind: first.attrs.kind }, content: [{ ...previous.content[0], type: "questionMaterial" }] };
    target[target.indexOf(previous)] = group; previous = group;
  }
  if (continuesPrevious && previous && first && previous.type === first.type && (previous.type === "question" || previous.type === "questionGroup")) {
    const right = first as typeof previous;
    const leftNumber = previous.attrs.number;
    const rightNumber = right.attrs.number;
    if (leftNumber.mode === rightNumber.mode && (leftNumber.mode !== "fixed" || (rightNumber.mode === "fixed" && leftNumber.label === rightNumber.label))) {
      for (const region of right.content) {
        const existing = previous.content.find(candidate => candidate.type === region.type);
        if (existing && existing.type === region.type) {
          if (existing.type === "optionGroup" && region.type === "optionGroup") {
            for (const option of region.content) {
              const old = existing.content.find(item => item.attrs.label === option.attrs.label);
              if (old) old.content.push(...option.content);
              else existing.content.push(option);
            }
          } else if (existing.type === "subQuestionList" && region.type === "subQuestionList") {
            const children = existing.content as ChalkLeeBlockNode[];
            const pending = region.content.filter(child => {
              const number = child.attrs.number;
              if (number.mode !== "fixed") return true;
              const placeholder = existing.content.find(old => old.attrs.number.mode === "fixed" && old.attrs.number.label === number.label && old.content.length === 1 && old.content[0].type === "questionStem" && old.content[0].content.every(block => block.type === "paragraph" && !block.content?.length));
              if (!placeholder) return true;
              // A printed blank can precede its question's text/options on the
              // next page. Fill that source-backed child instead of duplicating
              // the entire number sequence after the last placeholder.
              placeholder.attrs = { ...placeholder.attrs, ...child.attrs, id: placeholder.attrs.id };
              placeholder.content = child.content;
              return false;
            });
            appendImportBlocks(children, pending, true);
          } else {
            (existing.content as unknown[]).push(...region.content);
          }
        } else (previous.content as unknown[]).push(region);
      }
      const order = ["questionStem", "questionMaterial", "optionGroup", "subQuestionList", "questionAnswer", "questionAnalysis"];
      previous.content.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
      target.push(...next.slice(1));
      return true;
    }
  }
  target.push(...next);
  return !continuesPrevious;
}
