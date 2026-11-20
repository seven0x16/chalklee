import { chalkLeeGraphicIssues, type ChalkLeeDocument, type ChalkLeeGraphicNode, type ChalkLeeQuestionContentBlock, type ChalkLeeQuestionNode, type ChalkLeeQuestionGroupNode } from "@chalklee/format";
import { normalizeNumberedBlanks } from "../conversion/wordSource";
import { conciseInline } from "../conversion/inlineText";
import { chalkLeeQuestionPlaces } from "../document/numbering";

export type AgentQuestion = ChalkLeeQuestionNode | ChalkLeeQuestionGroupNode;
export type AgentRegionContent = Array<string | ChalkLeeQuestionContentBlock>;
export const AGENT_OPTION_LAYOUTS = ["auto", "inline", "one-column", "two-column", "four-column"] as const;
export type AgentOptionLayout = typeof AGENT_OPTION_LAYOUTS[number];
export interface AgentQuestionPatch {
  stem?: AgentRegionContent;
  options?: Array<{ label: string; content: AgentRegionContent }>;
  answer?: AgentRegionContent;
  analysis?: AgentRegionContent;
  /** How the options sit on the page, as the inspector's 选项排列. */
  optionLayout?: AgentOptionLayout;
  attrs?: {
    kind?: string;
    score?: number | null;
    difficulty?: "easy" | "medium" | "hard" | null;
    /** null or an empty list clears them. */
    tags?: string[] | null;
    number?: { mode: "auto" | "none" } | { mode: "fixed"; label: string };
    /** A question style from appearance.questionStyles, such as a framed 例题; null returns to the document's default. */
    styleRef?: string | null;
    /** This question's frame title; null shows the style's own title, "" hides it. */
    frameLabel?: string | null;
  };
}
export interface AgentQuestionEdit { questionId: string; patch: AgentQuestionPatch }
export interface AgentTextSnapshot { text: string; revision: string; modifiedAt: number | null; dirty: boolean }
export interface AgentEditorSnapshot {
  document: ChalkLeeDocument; modifiedAt: number | null; dirty: boolean;
  assets?: Array<{ id: string; path: string; mediaType: string; dataBase64: string }>;
}
export interface AgentEditorRequest {
  editorId: string;
  requestId: string;
  action: "read" | "prepare" | "save" | "commit" | "release" | "renew";
  lockId?: string;
  document?: ChalkLeeDocument;
  text?: string;
  saved?: { modifiedAt: number; size: number };
  questionIds?: string[];
  /** "document": content and layout together, as a proofread changes them. */
  mutation?: "appearance" | "content" | "document";
  /** Pictures the committed document references that the editor does not have yet. */
  assets?: Array<{ id: string; path: string; mediaType: string; dataBase64: string }>;
  /** Shown in place of the usual "已更新…" line. */
  notice?: string;
  /** One run of ChalkLee AI: its commits to a paper undo in one step. */
  historyGroup?: string;
  includeResources?: boolean;
}
export interface AgentEditorReply { editorId: string; requestId: string; snapshot?: AgentEditorSnapshot; textSnapshot?: AgentTextSnapshot; error?: string }

/** Stable across JSON key order, saves, and the editor's trailing typing row. */
export async function agentDocumentRevision(document: ChalkLeeDocument): Promise<string> {
  const copy = structuredClone(document);
  copy.metadata.updatedAt = "";
  while (copy.content.content.length) {
    const last = copy.content.content.at(-1)!;
    if (last.type !== "paragraph" || last.content?.length || Object.keys(last.attrs).some(key => key !== "id")) break;
    copy.content.content.pop();
  }
  const stable = (value: any): any => Array.isArray(value) ? value.map(stable)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])])) : value;
  const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(stable(copy))));
  return `sha256:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function agentQuestionInventory(document: ChalkLeeDocument) {
  const questions: Array<{ id: string; type: AgentQuestion["type"]; number: string; parentId?: string; section: string; text: string; node: AgentQuestion }> = [];
  let section = "";
  const text = (node: any): string => node.type === "text" ? node.text ?? ""
    : ["mathInline", "blockMath"].includes(node.type) ? `$${node.attrs?.latex ?? ""}$`
    : (node.content ?? []).map(text).join(node.type === "paragraph" ? "" : " ");
  // Numbers as the paper prints them (shared/document/numbering.ts).
  const places = chalkLeeQuestionPlaces(document.content.content);
  const visit = (nodes: any[], parentId?: string) => {
    for (const node of nodes) {
      if (node.type === "heading" && !parentId) section = text(node);
      if (node.type === "question" || node.type === "questionGroup") {
        questions.push({ id: node.attrs.id, type: node.type, number: node.attrs.number?.mode === "fixed" ? node.attrs.number.label : node.attrs.number?.mode === "none" ? "" : String(places.get(node.attrs.id) ?? ""),
          ...(parentId ? { parentId } : {}), section, text: text(node), node });
        for (const region of node.content) if (region.type === "subQuestionList") visit(region.content, node.attrs.id);
      } else if (node.type === "box") visit(node.content, parentId);
    }
  };
  visit(document.content.content);
  return questions;
}

/** A graphic as the model writes it, {type, svg, printSvg?, widthPercent?, …}, as its node; its SVG is checked here. */
export function agentGraphicNode(item: Record<string, any>): ChalkLeeGraphicNode {
  if (item.attrs) return item as ChalkLeeGraphicNode;
  if (typeof item.svg !== "string") throw new Error("图形需要 svg：一张完整的 <svg viewBox=…>…</svg>。");
  const attrs: ChalkLeeGraphicNode["attrs"] = { id: "", svg: item.svg.trim(),
    ...(typeof item.printSvg === "string" && item.printSvg.trim() ? { printSvg: item.printSvg.trim() } : {}),
    ...(typeof item.widthPercent === "number" && item.widthPercent !== 100 ? { widthPercent: Math.round(item.widthPercent) } : {}),
    ...(["left", "center", "right"].includes(item.textAlign) ? { textAlign: item.textAlign } : {}),
    ...(typeof item.caption === "string" && item.caption.trim() ? { caption: item.caption.trim() } : {}),
    ...(typeof item.alt === "string" && item.alt.trim() ? { alt: item.alt.trim() } : {}) };
  const issues = chalkLeeGraphicIssues(attrs);
  if (issues.length) throw new Error(issues.join(""));
  return { type: "graphic", attrs };
}

/** Only supplied regions are replaced; all other content, IDs and resources survive. */
export function patchAgentQuestions(document: ChalkLeeDocument, edits: AgentQuestionEdit[], createId = () => `node_${crypto.randomUUID()}`): ChalkLeeDocument {
  if (!edits.length || edits.length > 30 || new TextEncoder().encode(JSON.stringify(edits)).byteLength > 500_000) throw new Error("每批修改 1–30 道题，内容不超过 500 KB。");
  const next = structuredClone(document), questions = agentQuestionInventory(next), seen = new Set<string>();
  const blocks = (content: AgentRegionContent): ChalkLeeQuestionContentBlock[] => content.flatMap(item => {
    if (typeof item !== "string") {
      if (!item || !["paragraph", "image", "graphic", "blockMath", "table", "answerLines"].includes(item.type)) throw new Error("题目内容仅支持文本、段落、图片、图形、公式、表格和作答横线。");
      // Answer lines in the concise format give only how many lines to leave.
      if (item.type === "answerLines" && !Array.isArray((item as any).content)) {
        const count = Math.max(1, Math.min(40, Math.round(Number((item as any).count)) || 3));
        return [{ type: "answerLines", attrs: { id: createId() }, content: Array.from({ length: count }, () => ({ type: "answerLine", attrs: { id: createId() } })) } as unknown as ChalkLeeQuestionContentBlock];
      }
      const assignIds = (node: any): any => {
        if (!node || typeof node !== "object" || Array.isArray(node)) throw new Error("内容节点格式无效。");
        const result = structuredClone(node.type === "graphic" ? agentGraphicNode(node) : node);
        if (!["text", "hardBreak", "mathInline"].includes(result.type)) result.attrs = { ...result.attrs, id: result.attrs?.id || createId() };
        if (result.content) result.content = result.content.map(assignIds);
        return result;
      };
      return [assignIds(item)];
    }
    return item.split(/\r?\n/).map(line => {
      const formula = line.match(/^\s*\$\$([\s\S]+)\$\$\s*$/);
      if (formula) return { type: "blockMath", attrs: { id: createId(), latex: formula[1].trim() } } as ChalkLeeQuestionContentBlock;
      // The same inline format as new content: formulas, bold, italic and underline. Escaped dollars remain
      // ordinary text; unmatched dollars are preserved.
      const content: any[] = conciseInline(line, { text: (value, marks) => value ? [{ type: "text", text: value, ...(marks.length ? { marks } : {}) }] : [] });
      // Underscores are blanks, as when ChalkLee AI writes new content or the teacher types them.
      return { type: "paragraph", attrs: { id: createId() }, ...(content.length ? { content: normalizeNumberedBlanks(content, createId, true) } : {}) } as ChalkLeeQuestionContentBlock;
    });
  });
  for (const { questionId, patch } of edits) {
    if (seen.has(questionId)) throw new Error("同一批不能重复修改同一道题。");
    seen.add(questionId);
    const matches = questions.filter(question => question.id === questionId);
    if (matches.length !== 1) throw new Error(`题目 ${questionId} 不存在或 ID 不唯一，请重新读取题目。`);
    if (!Object.keys(patch).length) throw new Error("请提供要修改的题目内容或属性。");
    const question = matches[0].node;
    if (patch.attrs) for (const [key, value] of Object.entries(patch.attrs)) {
      if (value === null) delete (question.attrs as any)[key];
      else (question.attrs as any)[key] = structuredClone(value);
    }
    const regions: any[] = question.content;
    const region = (type: string, content: any[], required = false) => {
      const previous = regions.find(node => node.type === type);
      if (!content.length && !required) {
        if (previous) regions.splice(regions.indexOf(previous), 1);
        return;
      }
      const replacement = { type, attrs: previous?.attrs ?? { id: createId() }, content: content.length ? content : blocks([""]) };
      if (previous) regions[regions.indexOf(previous)] = replacement;
      else regions.push(replacement);
    };
    if (patch.stem !== undefined) region(question.type === "questionGroup" ? "questionMaterial" : "questionStem", blocks(patch.stem), true);
    if (patch.answer !== undefined) region("questionAnswer", blocks(patch.answer));
    if (patch.analysis !== undefined) region("questionAnalysis", blocks(patch.analysis));
    if (patch.options !== undefined) {
      const previous = regions.find(node => node.type === "optionGroup");
      region("optionGroup", patch.options.map(option => ({ type: "option", attrs: previous?.content.find((node: any) => node.attrs.label === option.label)?.attrs ?? { id: createId(), label: option.label }, content: blocks(option.content) })));
    }
    if (patch.optionLayout !== undefined) {
      if (!AGENT_OPTION_LAYOUTS.includes(patch.optionLayout)) throw new Error("选项排列只能是 auto、inline、one-column、two-column 或 four-column。");
      const group = regions.find(node => node.type === "optionGroup");
      if (!group?.content?.length) throw new Error(`题目 ${questionId} 没有选项，不能设置选项排列。`);
      group.attrs = { ...group.attrs, layout: patch.optionLayout };
    }
    const order = question.type === "questionGroup" ? ["questionMaterial", "optionGroup", "subQuestionList", "questionAnswer", "questionAnalysis"] : ["questionStem", "optionGroup", "questionAnswer", "questionAnalysis"];
    regions.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  }
  // Keep conversion anchors for nodes that still exist, including unchanged figures.
  const ids = new Set<string>();
  const visitIds = (node: any) => { if (node.attrs?.id) ids.add(node.attrs.id); node.content?.forEach(visitIds); };
  visitIds(next.content);
  if (next.provenance?.anchors) next.provenance.anchors = next.provenance.anchors.filter(anchor => ids.has(anchor.nodeId));
  return next;
}
