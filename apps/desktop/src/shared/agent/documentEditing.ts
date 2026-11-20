import { chalkLeeGroupContinuesNumbers, type ChalkLeeBlockNode, type ChalkLeeDocument } from "@chalklee/format";
import { chalkLeeQuestionPlaces } from "../document/numbering";
import { conciseInline, hasConciseMarks } from "../conversion/inlineText";

/** Where new or moved content goes: next to an existing block or question, or at either end. */
export type AgentContentPosition = { after: string } | { before: string } | { at: "start" | "end" };

type Container = { nodes: any[]; parentId: string | null; kind: "body" | "group" | "box" };

/** What a box can hold: no headings or questions. */
const BOX_CONTENT = ["paragraph", "image", "graphic", "blockMath", "table", "answerLines", "question", "questionGroup"];

const plain = (node: any): string => node.type === "text" ? node.text ?? ""
  : ["mathInline", "blockMath"].includes(node.type) ? `$${node.attrs?.latex ?? ""}$`
  : node.type === "blank" ? "____"
  : (node.content ?? []).map(plain).join(["paragraph", "heading", "answerLine"].includes(node.type) ? "" : " ");

function containers(document: ChalkLeeDocument): Container[] {
  const result: Container[] = [{ nodes: document.content.content, parentId: null, kind: "body" }];
  const visit = (nodes: any[]) => {
    for (const node of nodes) {
      if (node.type === "box") { result.push({ nodes: node.content, parentId: node.attrs.id, kind: "box" }); continue; }
      if (node.type !== "questionGroup") continue;
      const list = node.content.find((region: any) => region.type === "subQuestionList");
      if (list) { result.push({ nodes: list.content, parentId: node.attrs.id, kind: "group" }); visit(list.content); }
    }
  };
  visit(document.content.content);
  return result;
}

function locate(document: ChalkLeeDocument, id: string) {
  for (const container of containers(document)) {
    const index = container.nodes.findIndex(node => node.attrs?.id === id);
    if (index >= 0) return { container, index };
  }
  throw new Error(`找不到内容 ${id}，请重新读取文档结构。`);
}

const filled = (node: any): boolean => node.type === "text" ? Boolean(node.text?.trim())
  : ["image", "graphic", "mathInline", "blockMath", "table"].includes(node.type) || (node.content ?? []).some(filled);

/** Compact structure for the model: every top-level block and sub-question, with ids for later edits. */
export function agentDocumentOutline(document: ChalkLeeDocument, textLimit = 80) {
  const blocks: Array<Record<string, unknown>> = [];
  // Numbers as the paper prints them: a box's questions continue the document's, a group's subquestions count from 1
  // unless the group continues the paper's numbers.
  const places = chalkLeeQuestionPlaces(document.content.content);
  const visit = (nodes: any[], depth: number) => {
    for (const node of nodes) {
      const isQuestion = node.type === "question" || node.type === "questionGroup";
      const text = plain(node).replace(/\s+/g, " ").trim();
      const entry: Record<string, unknown> = { id: node.attrs?.id, type: node.type };
      if (depth) entry.depth = depth;
      if (node.type === "heading") entry.level = node.attrs.level;
      if ((node.type === "paragraph" || node.type === "heading") && node.attrs.role) entry.role = node.attrs.role;
      if (node.type === "box") {
        if (typeof node.attrs.label === "string") entry.label = node.attrs.label;
        if (node.attrs.styleRef) entry.style = node.attrs.styleRef;
      }
      if (isQuestion) {
        entry.number = node.attrs.number?.mode === "fixed" ? node.attrs.number.label : node.attrs.number?.mode === "none" ? "" : String(places.get(node.attrs.id) ?? "");
        if (chalkLeeGroupContinuesNumbers(node)) entry.subquestionsContinueNumbers = true;
        entry.kind = node.attrs.kind;
        if (node.attrs.score !== undefined) entry.score = node.attrs.score;
        if (node.attrs.difficulty) entry.difficulty = node.attrs.difficulty;
        if (node.attrs.tags?.length) entry.tags = node.attrs.tags;
        // The editor keeps empty answer and analysis rows; only written ones count.
        const regions = node.content.filter((region: any) => region.type === "optionGroup" ? region.content?.length : filled(region)).map((region: any) => region.type);
        entry.has = ["optionGroup", "questionAnswer", "questionAnalysis"].filter(type => regions.includes(type)).map(type => ({ optionGroup: "options", questionAnswer: "answer", questionAnalysis: "analysis" })[type]);
      }
      // Headings and notes are short and edited whole, so they keep more of their text.
      const limit = isQuestion ? textLimit : textLimit * 3;
      entry.text = text.length > limit ? `${text.slice(0, limit)}…` : text;
      if (node.type === "paragraph" && !text) continue;
      blocks.push(entry);
      // Each line in a box keeps its own id for edits and moves.
      if (node.type === "box") visit(node.content, depth + 1);
      if (node.type === "questionGroup") {
        const list = node.content.find((region: any) => region.type === "subQuestionList");
        if (list) visit(list.content, depth + 1);
      }
    }
  };
  visit(document.content.content, 0);
  return { title: document.metadata.title, page: document.appearance.page, blocks };
}

const DOCUMENT_TEXT_LIMIT = 30_000;

/**
 * The whole document as text in reading order, for reading it through like a page: headings marked with #, questions
 * with the numbers the paper shows, then their options, answers and analyses; formulas as $LaTeX$.
 */
export function agentDocumentText(document: ChalkLeeDocument, limit = DOCUMENT_TEXT_LIMIT): { text: string; truncated?: true } {
  const places = chalkLeeQuestionPlaces(document.content.content);
  const inline = (nodes: any[] = []): string => nodes.map(node => node.type === "text" ? node.text ?? ""
    : node.type === "mathInline" ? `$${node.attrs?.latex ?? ""}$`
    : node.type === "blank" ? "____"
    : node.type === "hardBreak" ? "\n"
    : node.type === "imageInline" ? "[图片]" : "").join("");
  const flat = (nodes: any[] = []) => lines(nodes).join(" ");
  const picture = (kind: string, attrs: any) => `[${kind}${attrs?.caption || attrs?.alt ? `：${attrs.caption || attrs.alt}` : ""}]`;
  const question = (node: any): string[] => {
    const number = node.attrs.number?.mode === "fixed" ? node.attrs.number.label : node.attrs.number?.mode === "none" ? "" : String(places.get(node.attrs.id) ?? "");
    return node.content.flatMap((region: any): string[] => {
      if (region.type === "questionStem" || region.type === "questionMaterial") {
        const [first = "", ...rest] = lines(region.content);
        return number ? [`${number}. ${first}`.trimEnd(), ...rest] : first ? [first, ...rest] : [];
      }
      if (region.type === "optionGroup") return region.content.map((option: any) => `${option.attrs.label}. ${flat(option.content)}`);
      if (region.type === "subQuestionList") return lines(region.content);
      const text = flat(region.content);
      return text && region.type === "questionAnswer" ? [`答案：${text}`] : text && region.type === "questionAnalysis" ? [`解析：${text}`] : [];
    });
  };
  const lines = (nodes: any[] = []): string[] => {
    let ordered = 0;
    return nodes.flatMap((node): string[] => {
      const list = node.type === "paragraph" ? node.attrs?.listType : undefined;
      if (list !== "ordered") ordered = 0;
      switch (node.type) {
        case "heading": return [`${"#".repeat(node.attrs.level)} ${inline(node.content).trim()}`];
        case "paragraph": {
          const text = inline(node.content).trim();
          if (!text) return [];
          if (list === "ordered") { ordered = node.attrs.listStart ?? ordered + 1; return [`${ordered}. ${text}`]; }
          return [list === "bullet" ? `- ${text}` : text];
        }
        case "blockMath": return [`$$${node.attrs?.latex ?? ""}$$`];
        case "table": return (node.content ?? []).map((row: any) => `| ${(row.content ?? []).map((cell: any) => flat(cell.content)).join(" | ")} |`);
        case "image": return [picture("图片", node.attrs)];
        case "graphic": return [picture("图形", node.attrs)];
        case "answerLines": {
          const written = (node.content ?? []).map((line: any) => inline(line.content).trim()).filter(Boolean);
          return written.length ? written : ["（答题线）"];
        }
        case "divider": return ["---"];
        case "pageBreak": return [];
        case "box": return [...typeof node.attrs?.label === "string" && node.attrs.label.trim() ? [`【${node.attrs.label.trim()}】`] : [], ...lines(node.content)];
        case "question": case "questionGroup": return question(node);
        default: return lines(node.content);
      }
    });
  };
  const text = lines(document.content.content).join("\n");
  return text.length > limit ? { text: `${text.slice(0, limit)}…`, truncated: true } : { text };
}

function insertionIndex(document: ChalkLeeDocument, position: AgentContentPosition) {
  if ("at" in position) {
    const nodes: any[] = document.content.content;
    if (position.at === "start") return { container: { nodes, parentId: null, kind: "body" as const }, index: 0 };
    // Keep the editor's trailing typing row last.
    let index = nodes.length;
    while (index > 0 && nodes[index - 1].type === "paragraph" && !nodes[index - 1].content?.length) index--;
    return { container: { nodes, parentId: null, kind: "body" as const }, index };
  }
  const { container, index } = locate(document, "after" in position ? position.after : position.before);
  return { container, index: "after" in position ? index + 1 : index };
}

function assertPlacement(nodes: readonly ChalkLeeBlockNode[], container: Container) {
  if (container.kind === "group" && nodes.some(node => node.type !== "question")) throw new Error("题组内只能放入小题（question），标题、段落或题组请放在题组之外。");
  if (container.kind === "box" && nodes.some(node => !BOX_CONTENT.includes(node.type))) throw new Error("盒子里只能放段落、公式、表格、图片、图形和题目；标题和盒子请放在盒子之外。");
}

export function insertAgentBlocks(document: ChalkLeeDocument, nodes: ChalkLeeBlockNode[], position: AgentContentPosition): ChalkLeeDocument {
  if (!nodes.length) throw new Error("请提供要插入的内容。");
  const next = structuredClone(document);
  const { container, index } = insertionIndex(next, position);
  assertPlacement(nodes, container);
  container.nodes.splice(index, 0, ...structuredClone(nodes));
  return next;
}

export function removeAgentNodes(document: ChalkLeeDocument, ids: readonly string[]): ChalkLeeDocument {
  if (!ids.length) throw new Error("请指定要删除的内容。");
  const next = structuredClone(document);
  for (const id of new Set(ids)) {
    const { container, index } = locate(next, id);
    container.nodes.splice(index, 1);
  }
  dropEmptyBoxes(next);
  return pruneAnchors(next);
}

/** A box emptied by deleting or moving its last line goes with it. */
function dropEmptyBoxes(document: ChalkLeeDocument) {
  document.content.content = document.content.content.filter(node => node.type !== "box" || node.content.length > 0);
}

export function moveAgentNodes(document: ChalkLeeDocument, ids: readonly string[], position: AgentContentPosition): ChalkLeeDocument {
  const unique = [...new Set(ids)];
  if (!unique.length) throw new Error("请指定要移动的内容。");
  if ("after" in position && unique.includes(position.after) || "before" in position && unique.includes(position.before)) throw new Error("不能以正在移动的内容作为目标位置。");
  const next = structuredClone(document);
  // Keep the moved items in their current document order.
  const order = new Map<string, number>();
  let counter = 0;
  const visit = (node: any) => { if (node.attrs?.id) order.set(node.attrs.id, counter++); node.content?.forEach(visit); };
  next.content.content.forEach(visit);
  const moving = unique.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)).map(id => {
    const { container, index } = locate(next, id);
    return container.nodes.splice(index, 1)[0];
  });
  const { container, index } = insertionIndex(next, position);
  assertPlacement(moving, container);
  container.nodes.splice(index, 0, ...moving);
  dropEmptyBoxes(next);
  return next;
}

/**
 * Replace a heading, paragraph or table, or change words inside any block (a question too, or the whole document without an id).
 * Boxes: wrap blocks that follow one another into a box, change a box's title or style, or unwrap it and keep its content.
 */
export type AgentBlockEdit = { id: string; block: ChalkLeeBlockNode } | { id?: string; find: string; replace: string }
  | { wrap: string[]; label?: string; style?: string }
  | { id: string; label?: string | null; style?: string | null; unwrap?: boolean; role?: string | null };

const REPLACEABLE = ["heading", "paragraph", "table", "blockMath", "graphic"];
const hasImage = (node: any): boolean => node.type === "image" || (node.content ?? []).some(hasImage);

export function updateAgentBlocks(document: ChalkLeeDocument, edits: readonly AgentBlockEdit[]): { document: ChalkLeeDocument; replaced: number } {
  if (!edits.length || edits.length > 100) throw new Error("每次修改 1–100 处内容。");
  const next = structuredClone(document);
  let replaced = 0;
  for (const edit of edits) {
    if ("wrap" in edit) {
      wrapAgentBox(next, edit);
      replaced++;
      continue;
    }
    if (!("block" in edit) && !("find" in edit)) {
      editAgentBox(next, edit);
      replaced++;
      continue;
    }
    if ("block" in edit) {
      const { container, index } = locate(next, edit.id);
      const current = container.nodes[index];
      if (!REPLACEABLE.includes(current.type)) throw new Error(`${edit.id} 是${current.type === "question" || current.type === "questionGroup" ? "题目，请用 question_update 修改" : "不能整块替换的内容"}；也可以用 find/replace 修改其中的文字。`);
      if (!["heading", "paragraph", "table", "box"].includes(edit.block.type)) throw new Error("block 只能是标题、段落、表格或盒子。");
      if (container.kind === "box" && !BOX_CONTENT.includes(edit.block.type)) throw new Error("盒子里只能放段落、公式、表格、图片、图形和题目。");
      if (hasImage(current) && !hasImage(edit.block)) throw new Error(`${edit.id} 中有图片，整块替换会丢失图片；请用 find/replace 只改文字。`);
      const block = structuredClone(edit.block) as any;
      // Keep the id and any alignment or spacing the block already had; a new box keeps its own id.
      if (block.type !== "box") block.attrs = { ...(block.type === current.type ? current.attrs : {}), ...block.attrs, id: current.attrs.id };
      container.nodes[index] = block;
      replaced++;
      continue;
    }
    if (!edit.find) throw new Error("find 不能为空。");
    const scope = edit.id ? [locate(next, edit.id)].map(({ container, index }) => container.nodes[index]) : next.content.content;
    let count = 0;
    // A replacement may bold, italicise or underline the words ("not" → "<b>not</b>"); the text keeps its own marks.
    const formatted = hasConciseMarks(edit.replace);
    const visit = (node: any) => {
      if (formatted && Array.isArray(node.content)) {
        node.content = node.content.flatMap((child: any) => {
          if (child.type !== "text" || typeof child.text !== "string" || !child.text.includes(edit.find)) return [child];
          const own: any[] = child.marks ?? [], parts: string[] = child.text.split(edit.find);
          count += parts.length - 1;
          const inserted = conciseInline(edit.replace, { text: (value, marks) => {
            const all = [...own, ...marks.filter(mark => !own.some(existing => existing.type === mark.type))];
            return value ? [{ type: "text", text: value, ...(all.length ? { marks: all } : {}) }] : [];
          } });
          return parts.flatMap((part, index) => [...part ? [{ ...child, text: part }] : [], ...index < parts.length - 1 ? structuredClone(inserted) : []]);
        });
      } else if (!formatted && node.type === "text" && typeof node.text === "string" && node.text.includes(edit.find)) {
        count += node.text.split(edit.find).length - 1;
        node.text = node.text.split(edit.find).join(edit.replace);
      }
      node.content?.forEach(visit);
    };
    scope.forEach(visit);
    scope.forEach(pruneEmptyText);
    if (!count) {
      const text = scope.map(plain).join("\n");
      throw new Error(text.includes(edit.find) ? `“${edit.find}”跨越了不同格式或公式，请缩短要替换的文字，或整块替换。` : `找不到“${edit.find}”${edit.id ? `（在 ${edit.id} 中）` : ""}，请重新读取文档结构。`);
    }
    replaced += count;
  }
  return { document: next, replaced };
}

/** Text nodes may not be empty once a replacement removed their words. */
function pruneEmptyText(node: any) {
  if (!Array.isArray(node.content)) return;
  const kept = node.content.filter((child: any) => child.type !== "text" || child.text);
  if (kept.length !== node.content.length) {
    node.content = kept;
    if (!kept.length && ["paragraph", "heading"].includes(node.type)) delete node.content;
  }
  node.content?.forEach(pruneEmptyText);
}

function pruneAnchors(document: ChalkLeeDocument): ChalkLeeDocument {
  if (!document.provenance?.anchors) return document;
  const ids = new Set<string>();
  const visit = (node: any) => { if (node.attrs?.id) ids.add(node.attrs.id); node.content?.forEach(visit); };
  visit(document.content);
  document.provenance.anchors = document.provenance.anchors.filter(anchor => ids.has(anchor.nodeId));
  return document;
}

function wrapAgentBox(document: ChalkLeeDocument, edit: { wrap: string[]; label?: string; style?: string }) {
  const ids = [...new Set(edit.wrap)];
  if (!ids.length) throw new Error("wrap 需要至少一个内容 id。");
  const nodes = document.content.content as any[];
  const indexes = ids.map(id => {
    const index = nodes.findIndex(node => node.attrs?.id === id);
    if (index < 0) throw new Error(`${id} 不在正文最外层（可能已在盒子或题组里），不能放进盒子；请重新读取文档结构。`);
    if (!BOX_CONTENT.includes(nodes[index].type)) throw new Error(`${id} 是${nodes[index].type === "heading" ? "标题" : "盒子"}，盒子里只能放段落、公式、表格、图片、图形和题目。`);
    return index;
  }).sort((a, b) => a - b);
  const first = indexes[0], last = indexes[indexes.length - 1];
  // Empty lines between the chosen blocks go in too; anything else would be swallowed silently.
  for (let index = first; index <= last; index++) {
    const node = nodes[index];
    if (indexes.includes(index) || node.type === "paragraph" && !(node.content ?? []).length) continue;
    throw new Error(`要放进盒子的内容需要前后相连，${node.attrs?.id ?? "中间的内容"} 没有列在 wrap 中。`);
  }
  const box: any = { type: "box", attrs: { id: `node_${crypto.randomUUID()}` }, content: nodes.slice(first, last + 1) };
  if (typeof edit.label === "string") box.attrs.label = edit.label.slice(0, 120);
  if (edit.style) box.attrs.styleRef = edit.style;
  nodes.splice(first, last - first + 1, box);
}

function editAgentBox(document: ChalkLeeDocument, edit: { id: string; label?: string | null; style?: string | null; unwrap?: boolean; role?: string | null }) {
  if (edit.role !== undefined) {
    // A role names what a paragraph or heading is for; it can be anywhere in the body or in a box.
    const { container, index } = locate(document, edit.id);
    const node = container.nodes[index];
    if (node.type !== "paragraph" && node.type !== "heading") throw new Error(`${edit.id} 不是段落或标题，不能设置 role。`);
    if (edit.role === null || edit.role === "") delete node.attrs.role;
    else if (!/^[a-z][a-z0-9-]{0,31}$/.test(edit.role)) throw new Error("role 用小写英文、数字和短横，如 subtitle、byline、key。");
    else node.attrs.role = edit.role;
    if (edit.label === undefined && edit.style === undefined && !edit.unwrap) return;
  }
  const nodes = document.content.content as any[];
  const index = nodes.findIndex(node => node.attrs?.id === edit.id);
  const box = nodes[index];
  if (box?.type !== "box") throw new Error(`${edit.id} 不是盒子；修改文字用 find/replace，整块替换用 block。`);
  if (edit.unwrap) { nodes.splice(index, 1, ...box.content); return; }
  if (edit.label === undefined && edit.style === undefined) throw new Error("请提供盒子的 label、style 或 unwrap。");
  if (edit.label === null) delete box.attrs.label;
  else if (edit.label !== undefined) box.attrs.label = edit.label.slice(0, 120);
  if (edit.style === null) delete box.attrs.styleRef;
  else if (edit.style !== undefined) box.attrs.styleRef = edit.style;
}
