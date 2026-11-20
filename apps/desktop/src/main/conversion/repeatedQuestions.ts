import { createHash } from "node:crypto";
import type { ChalkLeeArchiveAssetInput, ChalkLeeDocument } from "@chalklee/format";
import { importText } from "../../shared/conversion/importDocument";
import { importSectionLabel, isImportAnswerHeading, normalizeImportNumber } from "../../shared/conversion/answerSource";
import type { ImportAnswerReport, ImportNotice } from "../../shared/conversion/types";

type Node = any;
export interface ImportQuestionSource { nodeId: string; refs: string[]; answerFor?: string }
const solution = (node: Node) => ["questionAnswer", "questionAnalysis"].includes(node.type);
const question = (node: Node) => ["question", "questionGroup"].includes(node.type);
const walk = (node: Node, visit: (node: Node) => void) => { visit(node); node.content?.forEach((child: Node) => walk(child, visit)); };
const number = (node: Node) => normalizeImportNumber(node.attrs?.number?.label ?? "");
// A list printed with “，” in one copy may be recognised with “、” in the other.
const punctuation: Record<string, string> = { "。": ".", "．": ".", "，": ",", "、": ",", "；": ";", "：": ":", "？": "?", "！": "!", "（": "(", "）": ")" };
// A blank to fill in may be recognised as a blank, as an empty underline in a
// formula, or as a run of underscores; all of them are the same blank.
const BLANK = "□";
// Do not use NFKC here: it would equate a printed superscript such as x² with x2.
const textKey = (text: string) => text.replace(/[。．，、；：？！（）]/g, value => punctuation[value]).replace(/[_＿]{2,}|＿/g, BLANK).replace(/\s/g, "");
// A solved copy may misprint a section's ordinal; its title is otherwise the same.
const headerKey = (text: string) => textKey(text).replace(/^[一二三四五六七八九十]+[,.]/, "");
const hasSolution = (node: Node): boolean => solution(node) && !!node.content?.length || (node.content ?? []).some(hasSolution);
const hasBody = (node: Node): boolean => !solution(node) && (node.type === "text" && !!node.text?.trim()
  || ["mathInline", "blockMath", "image", "imageInline", "blank"].includes(node.type) || (node.content ?? []).some(hasBody));
// The paper and its solved copy are typeset and recognised separately, so one
// formula can be spelt differently. Only spellings that cannot change the
// mathematics are unified; every digit, letter and operator still counts.
// The same symbol may be recognised as a formula command in one copy and as a
// printed character in the other.
const symbols: Record<string, string> = { geqslant: "≥", geq: "≥", ge: "≥", leqslant: "≤", leq: "≤", le: "≤", neq: "≠", ne: "≠", gt: ">", lt: "<", mid: "|", vert: "|", lvert: "|", rvert: "|",
  angle: "∠", triangle: "△", parallel: "∥", perp: "⊥", cdot: "·", times: "×", div: "÷", pm: "±", because: "∵", therefore: "∴", odot: "⊙", circ: "°",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", theta: "θ", vartheta: "θ", lambda: "λ", mu: "μ", pi: "π",
  rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", varphi: "φ", omega: "ω", Delta: "Δ", Sigma: "Σ", Omega: "Ω" };
// A system of equations is printed with one brace either way: `\begin{cases}` or `\left\{\begin{aligned}…\right.`
// (or an array). The alignment marks `&` only place the rows.
const SYSTEM = /\\\{\s*\\begin\{(aligned|array)\}(?:\{[^{}]*\})?([\s\S]*?)\\end\{\1\}\s*\.|\\begin\{cases\}([\s\S]*?)\\end\{cases\}/g;
// A row break `\\` is its own token: in `\\ (x-2)` the space follows the break
// and is not the spacing command `\ `.
const ROW_BREAK = "\uE000";
const latexKey = (latex: string) => latex
  .replace(/\\\\/g, ROW_BREAK)
  .replace(/\\underline\s*\{(?:\s|~|\\text\s*\{\s*\}|\\q?quad(?![a-zA-Z])|\\[,;:! ]|\\hspace\*?\s*\{[^{}]*\}|\\h?phantom\s*\{[^{}]*\})*\}|(?:\\_\s*){2,}/g, BLANK)
  .replace(/\\([a-zA-Z]+)(?![a-zA-Z])/g, (command, name: string) => symbols[name] ?? command)
  .replace(/\^\s*\{?\s*°\s*\}?/g, "°")
  .replace(/\\(?:left|right)(?![a-zA-Z])/g, "")
  .replace(SYSTEM, (_, _environment, aligned: string | undefined, cases: string | undefined) => `\\begin{cases}${(aligned ?? cases ?? "").replace(/&/g, "")}\\end{cases}`)
  .replace(/\\(?:text|mathrm|textrm|textnormal)\s*\{([^{}]*)\}/g, "$1")
  .replace(/\\(?:quad|qquad)(?![a-zA-Z])|\\[,;:! ]|~/g, "")
  .replace(/\\[dt]frac(?![a-zA-Z])/g, "\\frac")
  .replace(/\\%/g, "%")
  .replace(/\s/g, "")
  .replace(/([\^_])\{(\\[a-zA-Z]+|[^{}\\])\}/g, "$1$2")
  .replace(/\uE000/g, "\\\\");
/** A formula as printed, whichever of the equivalent spellings a copy was read with. */
export const printedFormula = latexKey;
// A title's score may be a formula in one copy ("（$8\times 3=24$ 分）") and plain text in the other.
const printedLine = (node: Node): string => node.type === "text" ? node.text ?? ""
  : ["mathInline", "blockMath"].includes(node.type) ? latexKey(node.attrs?.latex ?? "") : (node.content ?? []).map(printedLine).join("");
interface QuestionPrint { text: string; tables: string; figures: string[] }
/** What a question says, without how a copy happened to lay it out: a number
 * may be recognised as text in one copy and as a formula in the other, figures
 * may sit in a different paragraph, and table cells may be split differently. */
const questionPrint = (root: Node, includeSolutions = false): QuestionPrint => {
  let text = "";
  const tables: string[] = [], figures: string[] = [];
  const visit = (node: Node, table: boolean) => {
    if (solution(node) && !includeSolutions) return;
    const add = (value: string) => { if (table) tables.push(...value); else text += value; };
    if (node.type === "text") return add(textKey(node.text ?? ""));
    if (["mathInline", "blockMath"].includes(node.type)) return add(latexKey(node.attrs?.latex ?? ""));
    if (["image", "imageInline"].includes(node.type)) { figures.push(node.attrs?.assetId ?? ""); return; }
    if (node.type === "blank") return add(`${BLANK}${node.attrs?.label ?? ""}`);
    const [open, close] = node.type === "option" ? [`«${node.attrs?.label ?? ""}`, "»"] : node !== root && question(node) ? [`〔${number(node)}`, "〕"] : ["", ""];
    text += open;
    node.content?.forEach((child: Node) => visit(child, table || node.type === "table"));
    text += close;
  };
  visit(root, false);
  // A copy whose stem still begins with the question's own printed number, "(16)" or "16.", says the same.
  const own = number(root);
  if (own && /^\d+$/.test(own)) text = text.replace(new RegExp(`^\\(${own}\\)|^${own}[.,](?!\\d)`), "");
  return { text, tables: tables.sort().join(""), figures };
};
/** Shared character pairs. On its own it only asks about a likely repeat; it
 * joins a slightly different copy only after the agent has linked the two. */
const resemblance = (left: string, right: string) => {
  const pairs = (value: string) => {
    const chars = [...value], counts = new Map<string, number>();
    for (let at = 0; at + 1 < chars.length; at++) counts.set(chars[at] + chars[at + 1], (counts.get(chars[at] + chars[at + 1]) ?? 0) + 1);
    return counts;
  };
  const a = pairs(left), b = pairs(right);
  let shared = 0, total = 0;
  for (const [pair, count] of a) shared += Math.min(count, b.get(pair) ?? 0);
  for (const count of [...a.values(), ...b.values()]) total += count;
  return total ? 2 * shared / total : 0;
};
const differenceAt = (left: string, right: string): [string, string] => {
  const a = [...left], b = [...right];
  let at = 0;
  while (at < a.length && a[at] === b[at]) at++;
  const excerpt = (chars: string[]) => chars.slice(Math.max(0, at - 8), at + 12).join("") || "（无）";
  return [excerpt(a), excerpt(b)];
};
const firstDifference = (left: string, right: string) => { const [a, b] = differenceAt(left, right); return `原题“${a}”，解析版“${b}”`; };
/** The child list a copy's child solutions can go to: one with as many children. */
const childList = (target: Node, list: Node): Node[] | undefined => {
  const existing = target.content?.find((old: Node) => old.type === "subQuestionList");
  return existing?.content?.length === list.content.length ? existing.content : undefined;
};
/** A copy split into a different number of parts can only bring the solutions printed for the whole question. */
const placeable = (target: Node, source: Node): boolean => (source.content ?? []).every((region: Node) => {
  if (region.type !== "subQuestionList" || !hasSolution(region)) return true;
  const children = childList(target, region);
  return !!children && region.content.every((child: Node, index: number) => placeable(children[index], child));
});

/** Fold a repeated solved question into its original, while retaining both source
 * references. Without the agent's answerFor link, text, mathematics, options and
 * child questions must agree exactly. With it, a copy that differs only slightly
 * (a misprint or misrecognition in one of them) is joined as well: the original
 * keeps its wording and the teacher is told what differs. */
export function reconcileRepeatedQuestions(document: ChalkLeeDocument, assets: ChalkLeeArchiveAssetInput[], sources: ImportQuestionSource[] = []) {
  const hashes = new Map(assets.map(asset => [asset.id, createHash("sha256").update(asset.data).digest("hex")]));
  // Solutions are excluded, so merging answers into a question keeps its print valid.
  const prints = new WeakMap<Node, QuestionPrint>();
  const print = (node: Node) => { if (!prints.has(node)) prints.set(node, questionPrint(node)); return prints.get(node)!; };
  const matches = (left: Node, right: Node, figures: "pixels" | "count" | "ignore") => {
    const a = print(left), b = print(right);
    if (number(left) !== number(right) || a.text !== b.text || a.tables !== b.tables) return false;
    const key = (value: QuestionPrint) => figures === "pixels" ? value.figures.map(id => hashes.get(id) ?? id).sort().join() : String(value.figures.length);
    return figures === "ignore" || key(a) === key(b);
  };
  const before = new Set<string>(), beforeFormulas = new Map<string, number>();
  const inspect = (root: Node, ids: Set<string>, formulas: Map<string, number>) => walk(root, node => {
    if (node.attrs?.id) ids.add(node.attrs.id);
    if (["mathInline", "blockMath"].includes(node.type)) formulas.set(node.attrs.latex, (formulas.get(node.attrs.latex) ?? 0) + 1);
  });
  inspect(document.content, before, beforeFormulas);
  const claims = new Map(sources.filter(source => source.answerFor).map(source => [source.nodeId, source.answerFor!]));
  const refOwners = new Map<string, string[]>();
  for (const source of sources) for (const ref of source.refs) refOwners.set(ref, [...(refOwners.get(ref) ?? []), source.nodeId]);
  const issues: string[] = [], links: ImportAnswerReport["links"] = [], notices: ImportNotice[] = [];
  const removed = new Map<string, string>();
  const originals: { node: Node; paper: string }[] = [];
  let paper = "", masthead = false;
  // Whatever stays unresolved at delivery is shown to the teacher, not kept silently twice.
  const unresolved = (node: Node, issue: string) => {
    issues.push(issue);
    notices.push({ message: `第${number(node)}题与前面的同号题目可能是同一道题，未能合并，两处均已保留。`, questionIds: [node.attrs.id] });
    originals.push({ node, paper });
  };
  const conflict = (left: Node, right: Node): boolean => {
    for (const region of right.content ?? []) {
      const existing = left.content?.find((old: Node) => old.type === region.type);
      const said = (node: Node) => { const value = questionPrint(node, true); return value.text + value.tables; };
      if (solution(region) && existing?.content?.length && said(existing) !== said(region)) return true;
      const children = region.type === "subQuestionList" ? childList(left, region) : undefined;
      if (children && region.content.some((child: Node, index: number) => conflict(children[index], child))) return true;
    }
    return false;
  };
  const merge = (target: Node, source: Node) => {
    removed.set(source.attrs.id, target.attrs.id);
    for (const region of source.content) {
      const existing = target.content.find((old: Node) => old.type === region.type);
      if (solution(region)) {
        if (!existing) target.content.push(region);
        else if (!existing.content.length) existing.content = region.content;
      } else if (region.type === "subQuestionList") {
        const children = childList(target, region);
        if (children) region.content.forEach((child: Node, index: number) => merge(children[index], child));
      }
    }
    // Anchors for the suppressed stem still locate its surviving question.
    const surviving = new Set<string>(); walk(target, child => { if (child.attrs?.id) surviving.add(child.attrs.id); });
    walk(source, child => { if (child.attrs?.id && !surviving.has(child.attrs.id) && !removed.has(child.attrs.id)) removed.set(child.attrs.id, target.attrs.id); });
  };
  const blocks = document.content.content as Node[];
  for (const node of blocks) {
    if (["heading", "paragraph"].includes(node.type)) {
      const text = importText(node);
      // A paper starts at its first title line. A centred subtitle under it, or
      // a solved copy printing only the main title, still belongs to that paper.
      if (!importSectionLabel(text) && !isImportAnswerHeading(text) && (node.type === "heading" && node.attrs.level === 1 || node.attrs.textAlign === "center")) {
        if (!masthead) paper = textKey(text);
        masthead = true;
      }
    }
    if (!question(node)) continue;
    masthead = false;
    if (!hasBody(node)) continue;
    const claim = claims.get(node.attrs.id);
    const owners = claim ? refOwners.get(claim) ?? [] : [];
    if (!hasSolution(node)) {
      if (claim) issues.push(`第${number(node)}题的 answerFor 没有对应答案或解析，请先完成解析版题目。`);
      originals.push({ node, paper }); continue;
    }
    const candidates = originals.filter(entry => claim ? owners.length === 1 && entry.node.attrs.id === owners[0]
      : number(node) && entry.paper === paper && matches(entry.node, node, "count"));
    if (!claim && !candidates.length) {
      const similar = number(node) && originals.some(entry => !hasSolution(entry.node) && number(entry.node) === number(node)
        && resemblance(print(entry.node).text + print(entry.node).tables, print(node).text + print(node).tables) >= 0.8);
      if (similar) unresolved(node, `第${number(node)}题前面已有内容相近的同号题目，像是解析版重复印出的题。是同一道题时，在解析版 question/questionGroup 上用 answerFor 指向原题题干 ref；确属不同题目时可直接完成。`);
      else originals.push({ node, paper });
      continue;
    }
    const target = candidates.length === 1 ? candidates[0].node : undefined;
    const printed = (node: Node) => print(node).text + print(node).tables;
    const differs = !!target && !matches(target, node, claim ? "ignore" : "count");
    const close = differs && !!claim && number(target) === number(node) && resemblance(printed(target), printed(node)) >= 0.9 && placeable(target, node);
    if (!target || differs && !close) {
      const detail = target ? `第一处不同：${firstDifference(printed(target), printed(node))}。` : "";
      unresolved(node, `第${number(node)}题的解析版未关联到唯一且题干、公式、选项和小问一致的原题。${detail}请核对 answerFor 来源；识别有误时对照原图修订，不按题号强行合并。`);
      continue;
    }
    if (!claim && !matches(target, node, "pixels")) {
      unresolved(node, `第${number(node)}题在题卷与解析版重复，但图片不同；请查看两处原图，确认是同一道题后，在解析版 question/questionGroup 上用 answerFor 指向原题题干 ref。`);
      continue;
    }
    if (conflict(target, node)) {
      unresolved(node, `第${number(node)}题重复版本的答案或解析冲突，请对照原稿整理，不能覆盖已有答案。`);
      continue;
    }
    const regions = node.content.filter(solution).map((region: Node) => region.type);
    // Being split into child questions in only one copy is not worth a note.
    const [here, solved] = [printed(target), printed(node)].map(value => value.replace(/[〔〕]/g, ""));
    if (differs && here !== solved) {
      const [mine, theirs] = differenceAt(here, solved);
      notices.push({ message: `第${number(target)}题与后面带解析的重复题目印得不完全一致（本题“${mine}”，带解析处“${theirs}”），已把答案和解析并入本题，请核对。`, questionIds: [target.attrs.id] });
    }
    merge(target, node);
    links.push({ sourceNodeId: node.attrs.id, questionNodeId: target.attrs.id, number: number(target), regions });
  }
  // A repeated masthead/section can disappear only when every question in its
  // following section has moved. Unique instructions and scoring notes survive.
  const knownHeaders = new Set<string>();
  for (let at = 0; at < blocks.length; at++) {
    const node = blocks[at];
    if (!["heading", "paragraph"].includes(node.type)) continue;
    const text = headerKey(printedLine(node));
    let end = at + 1;
    while (end < blocks.length && !["heading", "paragraph"].includes(blocks[end].type)) end++;
    const following = blocks.slice(at + 1, end).filter(question);
    // Consecutive masthead lines share the next question's section.
    if (!following.length) {
      let next = end;
      while (next < blocks.length && !question(blocks[next])) next++;
      if (next < blocks.length) following.push(blocks[next]);
    }
    if (text && knownHeaders.has(text) && following.length && following.every(item => removed.has(item.attrs.id))) removed.set(node.attrs.id, removed.get(following[0].attrs.id)!);
    else if (text) knownHeaders.add(text);
  }
  document.content.content = blocks.filter(node => !removed.has(node.attrs.id));
  if (document.provenance?.anchors) document.provenance.anchors = document.provenance.anchors.map(anchor => ({ ...anchor, nodeId: removed.get(anchor.nodeId) ?? anchor.nodeId }));
  const after = new Set<string>(), afterFormulas = new Map<string, number>(); inspect(document.content, after, afterFormulas);
  return { issues, links, notices, removedIds: [...before].filter(id => !after.has(id)),
    removedFormulas: new Map([...beforeFormulas].map(([latex, count]) => [latex, count - (afterFormulas.get(latex) ?? 0)])) };
}
