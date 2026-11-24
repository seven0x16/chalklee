import { randomUUID } from "node:crypto";
import { importText } from "../../shared/conversion/importDocument";
import type { ChalkLeeBlockNode, ChalkLeeDocument, ChalkLeeQuestionNode, ChalkLeeQuestionGroupNode } from "@chalklee/format";
import type { ImportAnswerReport, ImportNotice } from "../../shared/conversion/types";
import { importSectionLabel, isImportAnswerHeading, isImportSubsectionHeading, normalizeImportNumber } from "../../shared/conversion/answerSource";
import { expandImportAnswerRanges } from "../../shared/conversion/answerText";
import { wordBareLabel } from "../../shared/conversion/wordSource";
import { splitImportSubquestions } from "./structuredContent";
import { printedFormula } from "./repeatedQuestions";
import { importPunctuatedQuestionStart } from "../../shared/conversion/questionAnchors";

export interface ImportAnswerEntry {
  nodeId: string;
  parents: string[];
  rootOnly?: boolean;
  continuesPrevious: boolean;
  unit: string;
  unitIndex: number;
}

/** answerEntry is an import-only envelope; it never enters the saved schema. */
export function answerEntryPlan(blocks: unknown[]): { blocks: unknown[]; entries: { index: number; parents: string[]; rootOnly?: boolean }[] } {
  const entries: { index: number; parents: string[]; rootOnly?: boolean }[] = [];
  const expanded = expandImportAnswerRanges(blocks).flatMap((block: any) => {
    if (block?.type !== "answerEntry" || block.parentNumbers?.length) return [block];
    const field = block.analysis?.length ? "analysis" : "answer";
    if (!Array.isArray(block[field]) || (field === "analysis" && block.answer?.length)) return [block];
    const split = splitImportSubquestions(block[field], 1);
    if (!split || split.material.length) return [block];
    return split.questions.map(q => ({ type: "answerEntry", number: q.number, parentNumbers: [block.number], [field]: q.stem }));
  });
  const result = expanded.map((block: any, index) => {
    if (block?.type !== "answerEntry") return block;
    if (typeof block.number !== "string" || !block.number.trim() || block.number.length > 40
      || (block.parentNumbers !== undefined && (!Array.isArray(block.parentNumbers) || block.parentNumbers.length > 8 || block.parentNumbers.some((n: unknown) => typeof n !== "string" || !n.trim() || n.length > 40)))
      || (!Array.isArray(block.answer) && !Array.isArray(block.analysis))
      || Object.keys(block).some(key => !["type", "number", "parentNumbers", "answer", "analysis"].includes(key))) throw new Error("独立答案片段需要原稿题号和answer/analysis数组，不能混入题干或选项。");
    entries.push({ index, parents: block.parentNumbers ?? [], ...(Array.isArray(block.parentNumbers) && !block.parentNumbers.length ? { rootOnly: true } : {}) });
    return { type: "question", kind: "solution", number: block.number, stem: [], ...(block.answer !== undefined ? { answer: block.answer } : {}), ...(block.analysis !== undefined ? { analysis: block.analysis } : {}) };
  });
  return { blocks: result, entries };
}

type Question = ChalkLeeQuestionNode | ChalkLeeQuestionGroupNode;
const withoutAnswers = (node: any): any => node.content ? { ...node, content: node.content.filter((child: any) => child.type !== "questionAnswer" && child.type !== "questionAnalysis").map(withoutAnswers) } : node;
const meaningful = (node: any): boolean => !!importText(node).trim() || ["image", "imageInline", "blank"].includes(node.type) || (node.content ?? []).some(meaningful);

/** Takes the repeated letters off the front of "B 【命题点】…", which formatting may have split across text runs. */
function dropLeadingLetters(line: any, choice: string) {
  const inline: any[] = line.content ?? [];
  let rest = choice;
  for (const [index, node] of inline.entries()) {
    if (node.type !== "text") return false;
    let at = 0;
    for (; at < node.text.length; at++) {
      if (/\s/.test(node.text[at])) continue;
      if (node.text[at] !== rest[0]) break;
      rest = rest.slice(1);
    }
    if (at === node.text.length) continue;
    if (rest || node.text[at] !== "【") return false;
    line.content = [{ ...node, text: node.text.slice(at) }, ...inline.slice(index + 1)];
    return true;
  }
  return false;
}

/** The same choice letter printed again for a question, alone or before a labelled note: settled once all answers are in. */
function repeatsChoiceAnswer(target: Question, regions: any[]) {
  const letters = (node: any) => importText(node).normalize("NFKC").replace(/\s/g, "");
  const answer: any = target.content.find(region => region.type === "questionAnswer");
  const first = answer ? letters(answer) : "";
  return target.content.some(region => region.type === "optionGroup") && /^[A-H]{1,8}$/.test(first)
    && regions.every(region => region.type === "questionAnswer" && region.content.filter(meaningful).every((line: any) => letters(line) === first || letters(line).startsWith(`${first}【`)));
}

/**
 * An answer key whose number breaks an otherwise steady count: "40. cheerful", "37. to make", "42. so". The paper itself
 * may be misprinted, so the answer is not moved; the teacher is pointed to the number the count expects.
 */
export function misprintedAnswerNumbers(lines: string[]): { printed: string; expected: string; line: number }[] {
  const numbers = lines.flatMap((line, index) => [...line.matchAll(/(?:^|\s)(\d{1,3})\s*[.．、]\s*(?=[^\d\s])/g)].map(match => ({ value: Number(match[1]), line: index })));
  const seen = new Set<number>(), found: { printed: string; expected: string; line: number }[] = [];
  numbers.forEach(({ value, line }, at) => {
    const before = numbers[at - 1]?.value;
    if (before !== undefined && value !== before + 1 && numbers[at + 1]?.value === before + 2 && seen.has(value))
      found.push({ printed: String(value), expected: String(before + 1), line });
    seen.add(value);
  });
  return found;
}

/** Lines of an answer key: marked as answers, or listing three numbered answers or more (a PDF's lines carry no role). */
export function answerKeyLines<T extends { text: string; role: string }>(entries: T[]): T[] {
  return entries.filter(entry => entry.role === "answer" || (entry.text.match(/(?:^|\s)\d{1,3}\s*[.．、]\s*[^\d\s]/g)?.length ?? 0) >= 3);
}

/**
 * A single answer printed under a misprinted number ("37. to make" where 41 is due), by its source reference. Put in the
 * question the count expects, that number is the paper's slip, not part of the answer.
 */
export function misprintedAnswerKeys(entries: { ref: string; text: string; role: string }[]): Map<string, { printed: string; expected: string }> {
  const lines = answerKeyLines(entries);
  return new Map(misprintedAnswerNumbers(lines.map(entry => entry.text))
    .filter(({ line }) => (lines[line].text.match(/(?:^|\s)\d{1,3}\s*[.．、]\s*[^\d\s]/g)?.length ?? 0) === 1)
    .map(({ printed, expected, line }) => [lines[line].ref, { printed, expected }]));
}

/**
 * A paper may print each answer under its question and again in a solutions section, and both land in the question's
 * answer. What is certainly the same answer is settled here without changing a word of it: a label line that only
 * says "参考答案", the same choice letter again, and the letter repeated before a labelled note, whose note goes to
 * the analysis. Answers that differ are left for a person.
 */
export function settleRepeatedAnswers(document: ChalkLeeDocument): { settledIds: string[]; doubts: string[] } {
  const settledIds: string[] = [], doubts: string[] = [];
  const letters = (node: any) => importText(node).normalize("NFKC").replace(/\s/g, "");
  const remove = (region: any, lines: any[]) => {
    settledIds.push(...lines.map(line => line.attrs.id));
    region.content = region.content.filter((child: any) => !lines.includes(child));
  };
  const visit = (node: any): void => {
    (node.content ?? []).forEach(visit);
    if (node.type !== "question" && node.type !== "questionGroup") return;
    const region = node.content.find((child: any) => child.type === "questionAnswer");
    if (!region) return;
    const printed = region.content.filter(meaningful);
    if (printed.length > 1 && /^【?(?:参考)?答案】?[:：]?$/.test(letters(printed[0]))) remove(region, region.content.slice(0, region.content.indexOf(printed[1])));
    if (node.type !== "question" || !node.content.some((child: any) => child.type === "optionGroup")) return;
    const lines: any[] = region.content.filter(meaningful);
    const first = lines[0] ? letters(lines[0]) : "";
    if (lines.length < 2 || !/^[A-H]{1,8}$/.test(first)) return;
    const label = node.attrs.number?.label ?? "";
    const same: any[] = [], notes: any[] = [];
    for (const line of lines.slice(1)) {
      const value = letters(line);
      if (value === first) same.push(line);
      else if (/^[A-H]{1,8}$/.test(value)) doubts.push(`第${label}题原稿两处答案不一致：“${first}”和“${value}”。对照原稿，确实如此时保留，不要自行选择。`);
      else if (value.startsWith(`${first}【`)) {
        if (dropLeadingLetters(line, first)) notes.push(line);
        else doubts.push(`第${label}题的答案印了两遍：“${first}”和“${importText(line).trim().slice(0, 24)}”。只保留一个答案，其余内容放进这题的 analysis，用 stripPrefix 去掉重复的题号和答案。`);
      }
    }
    if (!same.length && !notes.length) return;
    remove(region, region.content.filter((child: any) => same.includes(child) || notes.includes(child) || !meaningful(child)));
    if (!notes.length) return;
    const analysis = node.content.find((child: any) => child.type === "questionAnalysis");
    if (analysis) {
      settledIds.push(...analysis.content.filter((child: any) => !meaningful(child)).map((child: any) => child.attrs.id));
      analysis.content = [...notes, ...analysis.content.filter(meaningful)];
    } else node.content.splice(node.content.indexOf(region) + 1, 0, { type: "questionAnalysis", attrs: { id: `node_${randomUUID()}` }, content: notes });
  };
  visit(document.content);
  return { settledIds, doubts };
}

/** Resolve after all units: printed numbers alone never select between duplicates.
 * Keep ambiguous/conflicting entries in their source position as ordinary prose.
 * Source child IDs survive moves, including formulas, figures and provenance. */
export function reconcileImportAnswers(document: ChalkLeeDocument, entries: ImportAnswerEntry[], incompleteSource = false): { report: ImportAnswerReport; notices: ImportNotice[]; redundantIds: string[] } {
  const report: ImportAnswerReport = { entries: entries.length, matched: 0, unmatched: 0, conflicting: 0, links: [] };
  const notices: ImportNotice[] = [];
  const redundantIds: string[] = [];
  // A left-out block takes everything in it out of the content check: a reprinted question's paragraphs and figures too.
  const drop = (node: any) => {
    replacements.set(node.attrs.id, []);
    const visit = (child: any) => { if (child.attrs?.id) redundantIds.push(child.attrs.id); child.content?.forEach(visit); };
    visit(node);
  };
  const byId = new Map(entries.map(entry => [entry.nodeId, entry]));
  const index: { node: Question; path: string[]; section?: string; sectionName?: string }[] = [];
  const scopes = new Map<string, string | undefined>();
  const scopeNames = new Map<string, string | undefined>();
  const number = (node: Question) => node.attrs.number.mode === "fixed" ? normalizeImportNumber(node.attrs.number.label) : "";
  let section: string | undefined, sectionName: string | undefined;
  const visit = (node: ChalkLeeBlockNode, parents: string[]) => {
    if (node.type !== "question" && node.type !== "questionGroup") return;
    const path = [...parents, ...(number(node) ? [number(node)] : [])];
    if (byId.has(node.attrs.id)) { scopes.set(node.attrs.id, section); scopeNames.set(node.attrs.id, sectionName); return; }
    index.push({ node, path, section, sectionName });
    if (node.type === "questionGroup") for (const region of node.content) if (region.type === "subQuestionList") region.content.forEach(child => visit(child, path));
  };
  for (const node of document.content.content) {
    if (node.type === "heading" || node.type === "paragraph") {
      const text = importText(node);
      if (isImportAnswerHeading(text)) { section = undefined; sectionName = undefined; }
      else {
        const label = importSectionLabel(text);
        // Roman section numbers can differ between a paper and its key, or
        // look like digits in a scan. A repeated explicit type title provides
        // an independent scope; the question number must still be unique.
        const name = text.normalize("NFKC").trim().match(/^(?:[IVX\d一二三四五六七八九十]+[、.．\s]+)(完形填空|语法填空|阅读理解|书面表达|信息匹配|选择题|填空题|解答题)(?:[（(\s]|$)/)?.[1];
        if (label || name) {
          section = label;
          // A paper's numbered subsection may be omitted from its answer key.
          // Retain the enclosing named type while still requiring a unique number.
          sectionName = name ?? (/^第[一二三四五六七八九十百\d]+节$/.test(label ?? "") ? sectionName : undefined);
        }
      }
    }
    visit(node, []);
  }
  const replacements = new Map<string, ChalkLeeBlockNode[]>();
  let last: { target: string; path: string; unitIndex: number } | undefined;
  const paragraph = (text: string, id = `node_${randomUUID()}`): ChalkLeeBlockNode => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
  for (const node of document.content.content) {
    const entry = byId.get(node.attrs.id);
    if (!entry || node.type !== "question") { if (node.type === "question" || node.type === "questionGroup") last = undefined; continue; }
    const path = [...entry.parents.map(normalizeImportNumber), number(node)];
    const key = JSON.stringify(path);
    const entrySection = scopes.get(entry.nodeId);
    const entrySectionName = scopeNames.get(entry.nodeId);
    const numberedCandidates = index.filter(candidate => candidate.path.at(-1) === path.at(-1)
      && (!entry.rootOnly || candidate.path.length === 1)
      && (!entry.parents.length || JSON.stringify(candidate.path) === key));
    let candidates = numberedCandidates.filter(candidate => (!entrySection && !entrySectionName) || (entrySection && candidate.section === entrySection)
      || (entrySectionName && candidate.sectionName === entrySectionName));
    // A sample essay can be identified by the printed section title instead
    // of a question number. Only the unique unnumbered writing question fits.
    if (!numberedCandidates.length && !entry.parents.length && /^(?:书面表达|写作|writing)$/i.test(path.at(-1) ?? "")) candidates = index.filter(candidate =>
      candidate.node.type === "question" && !candidate.path.length && candidate.sectionName === "书面表达");
    // A key's plain "1. A" is question 1, not part (1) of some later question.
    const printedAsPart = (question: Question) => question.attrs.number.mode === "fixed" && /^\s*[（(]/.test(question.attrs.number.label);
    if (!entry.parents.length && !printedAsPart(node)) {
      const whole = candidates.filter(candidate => !printedAsPart(candidate.node));
      if (whole.length) candidates = whole;
    }
    const regions = node.content.filter(region => region.type === "questionAnswer" || region.type === "questionAnalysis");
    // The same choice answer printed again ("1.B 【命题点】…") is that question's, not a part's that shares its number.
    if (candidates.length > 1 && !entry.parents.length) {
      const repeated = candidates.filter(candidate => candidate.path.length === 1 && repeatsChoiceAnswer(candidate.node, regions));
      if (repeated.length === 1) candidates = repeated;
    }
    if (!regions.length || !regions.some(meaningful)) throw new Error("独立答案片段没有可保留的答案或解析正文。");
    // Explicit parent/section scope remains usable when an unrelated page is
    // unfinished. Bare numbers still cannot exclude duplicates in missing pages.
    const scoped = entry.parents.length > 0 || !!entrySection || !!entrySectionName;
    const target = (!incompleteSource || scoped) && candidates.length === 1 ? candidates[0].node : undefined;
    const continuation = target && entry.continuesPrevious && last?.target === target.attrs.id && last.path === key && last.unitIndex === entry.unitIndex - 1;
    const conflict = target && regions.some(region => target.content.some(old => old.type === region.type && meaningful(old))) && !continuation && !repeatsChoiceAnswer(target, regions);
    if (!target || conflict || (entry.continuesPrevious && !continuation)) {
      report.unmatched++;
      if (conflict) report.conflicting++;
      const sectionMismatch = entrySection && !candidates.length && numberedCandidates.length;
      const reason = incompleteSource ? "部分页面尚未完成转换，归属待核对" : conflict ? "已有答案或解析，未覆盖" : entry.continuesPrevious && !continuation ? "续页归属未能确认" : candidates.length > 1 ? "有重复题号，归属不明确" : sectionMismatch ? `章节不一致（答案在“${entrySection}”，同题号题目在“${[...new Set(numberedCandidates.map(candidate => candidate.section ?? "未标章节"))].join("、")}”），请对照原稿检查是否漏了章节标题` : "未找到唯一对应题目";
      const source = document.provenance?.anchors?.find(anchor => anchor.nodeId === node.attrs.id);
      notices.push({ message: `第 ${path.join(" · ")} 题答案${reason}，已保留在原答案位置待核对。`, nodeId: node.attrs.id,
        questionIds: candidates.length === 1 ? [candidates[0].node.attrs.id] : [],
        ...(source?.locator.kind === "pdf" ? { page: source.locator.page } : {}) });
      replacements.set(node.attrs.id, [paragraph(`第 ${path.join(" · ")} 题答案（待关联）`, node.attrs.id), ...regions.flatMap(region => [paragraph(region.type === "questionAnswer" ? "答案" : "解析", region.attrs.id), ...region.content])]);
      last = undefined;
      continue;
    }
    for (const region of regions) {
      const existing = target.content.find(old => old.type === region.type);
      if (existing) (existing.content as unknown[]).push(...region.content);
      else (target.content as unknown[]).push(region);
    }
    const order = ["questionStem", "questionMaterial", "optionGroup", "subQuestionList", "questionAnswer", "questionAnalysis"];
    target.content.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    // The question itself also points to its answer source, not only its moved children.
    for (const anchor of document.provenance?.anchors?.filter(anchor => anchor.nodeId === node.attrs.id) ?? []) document.provenance!.anchors!.push({ ...anchor, nodeId: target.attrs.id });
    replacements.set(node.attrs.id, []);
    report.matched++;
    report.links.push({ sourceNodeId: node.attrs.id, questionNodeId: target.attrs.id, number: path.join("/"), regions: regions.map(region => region.type) });
    last = { target: target.attrs.id, path: key, unitIndex: entry.unitIndex };
  }
  // Remove only now-empty answer headings; preserve instructions and unresolved originals.
  const blocks = document.content.content;
  const firstQuestion = blocks.findIndex(block => block.type === "question" || block.type === "questionGroup");
  const titleKey = (text: string) => text.normalize("NFKC").replace(/\s/g, "").replace(/^(.*?)(\d{4}年)/, "$2$1");
  const frontMatter = new Set(blocks.slice(0, Math.max(0, firstQuestion))
    .filter(block => block.type === "heading" || block.type === "paragraph" && block.attrs.textAlign === "center")
    .map(block => titleKey(importText(block))).filter(Boolean));
  // A title left as plain paragraphs: the short lines opening the paper, up to
  // its first note, section or numbered line.
  for (const block of blocks.slice(0, Math.max(0, firstQuestion))) {
    const text = ["heading", "paragraph"].includes(block.type) ? importText(block).trim() : "";
    if (!text || text.length > 40 || importSectionLabel(text) || /^\d+\s*[.．、]|[:：]$/.test(text)) break;
    frontMatter.add(titleKey(text));
  }
  for (let start = 0; start < blocks.length; start++) {
    const block = blocks[start];
    if (!["paragraph", "heading"].includes(block.type) || !isImportAnswerHeading(importText(block))) continue;
    let end = start + 1;
    while (end < blocks.length && (byId.has(blocks[end].attrs.id) || (["heading", "paragraph"].includes(blocks[end].type) && (!!importSectionLabel(importText(blocks[end])) || isImportSubsectionHeading(importText(blocks[end])))))) end++;
    // With more of the paper after it, a section title past the last answer opens that part: it is not the key's.
    if (end < blocks.length) while (end > start + 1 && !byId.has(blocks[end - 1].attrs.id)) end--;
    const segment = blocks.slice(start + 1, end);
    const linkedEntries = segment.some(item => byId.has(item.attrs.id));
    // References may have been placed directly in their questions, leaving no
    // answerEntry envelopes. An empty trailing key is redundant in that case too.
    const directlyLinked = end === blocks.length && index.some(({ node }) => node.content.some(region =>
      (region.type === "questionAnswer" || region.type === "questionAnalysis") && meaningful(region)));
    if ((linkedEntries || directlyLinked) && segment.every(item => byId.has(item.attrs.id) ? replacements.get(item.attrs.id)?.length === 0 : true)) {
      for (const heading of blocks.slice(start, end).filter(item => !byId.has(item.attrs.id))) replacements.set(heading.attrs.id, []);
      for (let previous = start - 1; previous >= 0; previous--) {
        const title = blocks[previous];
        if (!["heading", "paragraph"].includes(title.type) || !frontMatter.has(titleKey(importText(title)))) break;
        drop(title);
      }
    }
  }
  // Global scoring notes can keep an answer key in the document. Its other
  // section titles must not survive as empty headings after their answers move.
  let inAnswerKey = false;
  const keyHeading = (node: ChalkLeeBlockNode) => ["heading", "paragraph"].includes(node.type)
    && (!!importSectionLabel(importText(node)) || isImportSubsectionHeading(importText(node)) || /^(?:(?:参考)?范文|范文参考|参考作文|(?:[·•-]\s*)?[A-H]\s*篇|one possible version|sample (?:answer|essay))\s*[:：]?$/i.test(importText(node).trim()));
  const answerKeyStarts = new Set<number>();
  for (let i = 0; i < blocks.length; i++) if (byId.has(blocks[i].attrs.id)) {
    let start = i;
    while (start > 0 && keyHeading(blocks[start - 1])) start--;
    answerKeyStarts.add(start);
  }
  for (let i = 0; i < blocks.length; i++) {
    const node = blocks[i];
    if (answerKeyStarts.has(i)) inAnswerKey = true;
    if (["heading", "paragraph"].includes(node.type) && isImportAnswerHeading(importText(node))) { inAnswerKey = true; continue; }
    if ((node.type === "question" || node.type === "questionGroup") && !byId.has(node.attrs.id)) inAnswerKey = false;
    if (!inAnswerKey || !keyHeading(node) || replacements.has(node.attrs.id)) continue;
    // Titles stacked over the paper's next part ("第二部分", "Ⅲ．语法填空", its passage) head that part, not an emptied key.
    let below = i + 1;
    while (below < blocks.length && keyHeading(blocks[below])) below++;
    if (below > i + 1 && below < blocks.length && !byId.has(blocks[below].attrs.id) && !isImportAnswerHeading(importText(blocks[below])) && meaningful(blocks[below])) continue;
    let contentRemains = false;
    for (let j = i + 1; j < blocks.length; j++) {
      const next = blocks[j];
      if (keyHeading(next) || ["heading", "paragraph"].includes(next.type) && isImportAnswerHeading(importText(next))) break;
      if ((replacements.get(next.attrs.id) ?? [next]).some(meaningful)) { contentRemains = true; break; }
    }
    if (!contentRemains) drop(node);
  }
  // "【答案】1. D 2. B" printed after a question group leaves its bare label once the answers are split
  // into the questions. Standing alone right after the question that now holds them, or with nothing after it
  // that could be its content (a title, a question, another bare label), it is an emptied title too.
  const answered = (node: any): boolean => (node.content ?? []).some((child: any) => child.type === "questionAnswer" && meaningful(child) || answered(child));
  const bareLabel = (node: any) => node.type === "paragraph" && wordBareLabel.test(importText(node));
  const remaining = blocks.filter(node => replacements.get(node.attrs.id)?.length !== 0);
  remaining.forEach((node, i) => {
    if (!bareLabel(node)) return;
    const previous = remaining[i - 1], next = remaining[i + 1];
    const afterAnswered = previous && ["question", "questionGroup"].includes(previous.type) && answered(replacements.get(previous.attrs.id)?.[0] ?? previous);
    const nothingAfter = !next || ["heading", "question", "questionGroup"].includes(next.type) || bareLabel(next);
    if (afterAnswered || nothingAfter) drop(node);
  });
  // A key printed after the questions under the paper's own masthead and section titles, its answers labelled
  // per question ("【1~3 题答案】"): once those answers are in the questions, only the reprinted titles are left.
  const kept = blocks.filter(node => replacements.get(node.attrs.id)?.length !== 0);
  let lastQuestion = -1;
  kept.forEach((node, i) => { if (node.type === "question" || node.type === "questionGroup") lastQuestion = i; });
  const tail = kept.slice(lastQuestion + 1);
  const earlier = new Set(kept.slice(0, lastQuestion + 1).filter(node => ["heading", "paragraph"].includes(node.type)).map(node => titleKey(importText(node))));
  // A masthead is reprinted with its lines split or joined differently ("…（江苏卷） 地理" over one line or two).
  const masthead = (node: ChalkLeeBlockNode) => {
    const key = titleKey(importText(node));
    return ["heading", "paragraph"].includes(node.type) && key.length >= 2 && [...frontMatter].some(front => front === key || front.includes(key) || key.includes(front) && front.length >= 2);
  };
  const reprintedSection = (node: ChalkLeeBlockNode) => ["heading", "paragraph"].includes(node.type) && earlier.has(titleKey(importText(node)))
    && (!!importSectionLabel(importText(node)) || isImportSubsectionHeading(importText(node)));
  if (lastQuestion >= 0 && tail.some(masthead) && tail.every(node => masthead(node) || reprintedSection(node))
    && index.some(({ node }) => node.content.some(region => (region.type === "questionAnswer" || region.type === "questionAnalysis") && meaningful(region))))
    tail.forEach(drop);
  // A bundle that reprints the paper's opening after its end: from a reprinted masthead on, every block repeats one
  // before it word for word (cover, notes, directions, the first questions), and no reprinted question brings an
  // answer or analysis the earlier copy lacks. The copy adds nothing, so it is left out rather than kept as a second
  // set of the same questions.
  const current = blocks.filter(node => replacements.get(node.attrs.id)?.length !== 0);
  // The two copies are often read differently ("A. £19. 15." and "A £19.15."): only letters and digits are compared.
  const printedKey = (text: string) => text.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "");
  const questionKey = (node: any): string => printedKey(importText(withoutAnswers(node)));
  const fullKey = (node: any): string => printedKey(importText(node));
  for (let start = current.findIndex(node => node.type === "question" || node.type === "questionGroup") + 1; start > 0 && start < current.length; start++) {
    if (!masthead(current[start])) continue;
    const before = current.slice(0, start), questions = new Map<string, string[]>(), texts = new Set<string>();
    for (const node of before) {
      if (node.type === "question" || node.type === "questionGroup") questions.set(questionKey(node), [...questions.get(questionKey(node)) ?? [], fullKey(node)]);
      texts.add(fullKey(node));
    }
    // A reprinted line may be split or joined differently from the paper (a section title with its directions), or left
    // unstructured where the paper has it inside a question (a stem, an option, with its number in front): its text
    // only has to appear somewhere in the earlier copy.
    const earlierText = [...texts].join("|");
    const printedBefore = (key: string) => texts.has(key) || key.length >= 4 && (earlierText.includes(key) || earlierText.includes(key.replace(/^\d{1,3}/, "")));
    const copy = current.slice(start).filter(meaningful);
    const repeats = (node: ChalkLeeBlockNode) => {
      if (node.type === "question" || node.type === "questionGroup") {
        const earlier = questions.get(questionKey(node));
        return !!earlier && (!answered(node) || earlier.includes(fullKey(node)));
      }
      return masthead(node) || ["heading", "paragraph"].includes(node.type) && printedBefore(fullKey(node));
    };
    if (!copy.some(node => node.type === "question" || node.type === "questionGroup") || !copy.every(repeats)) continue;
    current.slice(start).forEach(drop);
    notices.push({ message: `卷末重印了前面的 ${copy.filter(node => node.type === "question" || node.type === "questionGroup").length} 道题且没有新的答案，已略去重印部分。` });
    break;
  }
  // A solved copy that reprints each question before its answer, with only the answer and analysis placed in the
  // question: the reprinted stem, its options and figure stay behind as loose text ("4. 在一个不透明的箱子里…", "8",
  // "12") that says nothing the question does not. A run of it is left out when it starts with the number of an
  // answered question, its stem is printed in that question and every line after it is too. Formulas count by what
  // they print, letters and digits only, as the two copies are read separately.
  const isQuestion = (node: any): node is Question => node.type === "question" || node.type === "questionGroup";
  const printedText = (node: any): string => node.type === "text" ? node.text ?? ""
    : ["mathInline", "blockMath"].includes(node.type) ? printedFormula(node.attrs?.latex ?? "") : (node.content ?? []).map(printedText).join("");
  const printKey = (node: any) => printedKey(printedText(node));
  const pictured = (node: any): boolean => ["image", "imageInline"].includes(node.type) || (node.content ?? []).some(pictured);
  const left = blocks.filter(node => replacements.get(node.attrs.id)?.length !== 0);
  const reprinted: string[] = [];
  for (let at = left.findIndex(isQuestion) + 1; at > 0 && at < left.length; at++) {
    const printed = left[at].type === "paragraph" ? importPunctuatedQuestionStart(importText(left[at]).trim()) : undefined;
    if (!printed) continue;
    const targets = left.slice(0, at).filter(isQuestion).filter(node => number(node) === normalizeImportNumber(printed))
      .map(node => replacements.get(node.attrs.id)?.[0] ?? node);
    if (targets.length !== 1 || !answered(targets[0])) continue;
    const inQuestion = printKey(withoutAnswers(targets[0]));
    const stem = printKey(left[at]).replace(new RegExp(`^${printed}`), "");
    if (stem.length < 8 || !inQuestion.includes(stem)) continue;
    let end = at + 1;
    for (; end < left.length && left[end].type === "paragraph" && !importPunctuatedQuestionStart(importText(left[end]).trim()); end++) {
      const key = printKey(left[end]);
      // A reprinted figure goes only where the question has its own.
      if (key ? !inQuestion.includes(key) : pictured(left[end]) && !pictured(withoutAnswers(targets[0]))) break;
    }
    left.slice(at, end).forEach(drop);
    reprinted.push(printed);
    at = end - 1;
  }
  if (reprinted.length) {
    // Section titles reprinted with them are left with nothing under them at the end.
    const remaining = blocks.filter(node => replacements.get(node.attrs.id)?.length !== 0);
    const last = remaining.findLastIndex(isQuestion);
    const titles = new Set(remaining.slice(0, last + 1).filter(node => ["heading", "paragraph"].includes(node.type)).map(printKey));
    const trailing = remaining.slice(last + 1);
    if (trailing.every(node => ["heading", "paragraph"].includes(node.type) && titles.has(printKey(node))
      && (!!importSectionLabel(importText(node)) || isImportSubsectionHeading(importText(node))))) trailing.forEach(drop);
    notices.push({ message: `第${reprinted.join("、")}题在解析部分重印的题干和选项已略去，答案和解析已放进原题。` });
  }
  document.content.content = blocks.flatMap(node => replacements.get(node.attrs.id) ?? [node]);
  return { report, notices, redundantIds };
}
