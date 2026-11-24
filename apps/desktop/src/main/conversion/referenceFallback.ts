import type { ChalkLeeDocument } from "@chalklee/format";
import { importSectionLabel } from "../../shared/conversion/answerSource";
import { assertImportDocument } from "../../shared/conversion/importDocument";
import { importNumberedFirstOption, importOptionAnchors, importPunctuatedQuestionStart, importQuestionAnchors } from "../../shared/conversion/questionAnchors";
import type { ImportFollowUp, ImportFollowUpItem, PreparedImport } from "../../shared/conversion/types";
import { wordAnswerLabel, wordBareLabel } from "../../shared/conversion/wordSource";
import { compileAutonomousDraft, type AutonomousDraft, type AutonomousFragment } from "./autonomous/state";
import { collectSourceRefs, referenceSourceEntries, withOriginalParagraphs } from "./referenceDraft";
import { workingReferenceInput } from "./referenceSources";
import { answerKeyLines, misprintedAnswerNumbers } from "./answers";

const MAX_ORGANIZE_MS = 20_000;

type Entry = ReturnType<typeof referenceSourceEntries>[number];
interface Candidate {
  number: string; at: number; entries: Entry[]; stem: any[]; options: { label: string; content: any[] }[]; answer: any[]; analysis: any[];
  /** Something between its options that belongs to neither, so its parts cannot be told apart. */
  unclear?: boolean;
}

/** An answer label alone on its line carries nothing of its own; the label prefix is left for the compiler otherwise. */
const solutionRef = (entry: Entry) => {
  const label = wordBareLabel.test(entry.text) ? entry.text.match(wordAnswerLabel)?.[0].trim() : undefined;
  return label ? { ref: entry.ref, stripPrefix: label } : { ref: entry.ref };
};

/** Printed questions among the paragraphs nobody has placed, split by the labels the paper itself prints. */
function questionCandidates(entries: Entry[], placed: Set<string>): Candidate[] {
  const found: Candidate[] = [];
  let open: Candidate | undefined;
  entries.forEach((entry, at) => {
    if (placed.has(entry.ref) || entry.role === "heading") { open = undefined; return; }
    const printed = entry.role === "body" ? importPunctuatedQuestionStart(entry.text) : undefined;
    if (printed) {
      const prefix = importQuestionAnchors(entry.text).find(match => match.index === 0)![0].trim();
      // "41. A. fantasy": a cloze question prints its number on the first option and has no stem of its own.
      const first = importNumberedFirstOption(entry.text)?.replace(/\s/g, "");
      open = { number: printed, at, entries: [entry], stem: first ? [] : [{ ref: entry.ref, stripPrefix: prefix }], options: first ? [{ label: "A", content: [{ ref: entry.ref, stripPrefix: first }] }] : [], answer: [], analysis: [] };
      found.push(open);
      return;
    }
    if (!open) return;
    open.entries.push(entry);
    if (entry.role === "answer") open.answer.push(solutionRef(entry));
    else if (entry.role === "analysis") open.analysis.push(solutionRef(entry));
    else if (open.answer.length || open.analysis.length) { open.entries.pop(); open = undefined; }
    else {
      const option = entry.text.match(/^\s*([A-H])\s*[.．、]\s*/);
      // Several options printed on one line stay with the stem rather than being cut by guesswork.
      if (option?.[1] === String.fromCharCode(65 + open.options.length) && importOptionAnchors(entry.text).length <= 1)
        open.options.push({ label: option[1], content: [{ ref: entry.ref, stripPrefix: option[0].trim() }] });
      else if (open.options.length) open.unclear = true;
      else open.stem.push({ ref: entry.ref });
    }
  });
  return found;
}

const questionBlock = (candidate: Candidate) => {
  const stemText = candidate.entries.filter(entry => candidate.stem.some(part => part.ref === entry.ref)).map(entry => entry.text).join("\n");
  return {
    type: "question", number: candidate.number,
    kind: candidate.options.length ? "choice" : /_{2,}/.test(stemText) ? "fill-blank" : "free-response",
    stem: candidate.stem,
    ...(candidate.options.length ? { options: candidate.options } : {}),
    ...(candidate.answer.length ? { answer: candidate.answer } : {}),
    ...(candidate.analysis.length ? { analysis: candidate.analysis } : {})
  };
};

/**
 * Lines the agent left loose that can only be a question: a number on option A, then B, C, D in order. They become
 * questions without retyping, under the passage just before them when there is one. Anything else stays as written.
 */
export function settleNumberedChoices(input: PreparedImport, template: ChalkLeeDocument, draft: AutonomousDraft): AutonomousDraft {
  const text = new Map(referenceSourceEntries(workingReferenceInput(input, draft.sourceRevisions)).filter(entry => entry.role === "body").map(entry => [entry.ref, entry.text]));
  const taken = new Set<string>();
  const collect = (value: any): void => {
    if (!value || typeof value !== "object") return;
    if (value.type === "question" && value.number !== undefined) taken.add(String(value.number));
    Object.values(value).forEach(collect);
  };
  draft.fragments.forEach(fragment => collect(fragment.blocks));
  const plain = (block: any) => typeof block?.ref === "string" && block.as === undefined;
  const read = (blocks: any[], at: number) => {
    const opening = plain(blocks[at]) ? text.get(blocks[at].ref) : undefined;
    const prefix = opening && importNumberedFirstOption(opening), number = opening && importPunctuatedQuestionStart(opening);
    if (!prefix || !number || taken.has(number) || importOptionAnchors(opening).length > 1) return undefined;
    const options = [{ label: "A", content: [{ ref: blocks[at].ref, stripPrefix: prefix.replace(/\s/g, "") }] }];
    let next = at + 1;
    for (; next < blocks.length && plain(blocks[next]); next++) {
      const line = text.get(blocks[next].ref) ?? "", option = line.match(/^\s*([B-H])\s*[.．、]\s*/);
      if (option?.[1] !== String.fromCharCode(65 + options.length) || importOptionAnchors(line).length > 1) break;
      options.push({ label: option[1], content: [{ ref: blocks[next].ref, stripPrefix: option[0].replace(/\s/g, "") }] });
    }
    return options.length >= 2 ? { block: { type: "question", number, kind: "choice", stem: [], options }, next } : undefined;
  };
  // Options the agent laid out in a table are the same lines, as long as the whole table reads as such questions.
  const expand = (block: any): any[] => {
    if (block?.type !== "table" || !Array.isArray(block.rows)) return [block];
    const refs = block.rows.flat(2);
    if (!refs.every(plain)) return [block];
    for (let at = 0; at < refs.length;) { const question = read(refs, at); if (!question) return [block]; at = question.next; }
    return refs;
  };
  const build = (grouped: boolean) => draft.fragments.map(fragment => {
    if ((fragment as { answerFor?: unknown }).answerFor !== undefined) return fragment;
    const blocks = (fragment.blocks as any[]).flatMap(expand), written: any[] = [];
    let changed = false;
    for (let at = 0; at < blocks.length;) {
      const questions: unknown[] = [];
      for (let question = read(blocks, at); question; question = read(blocks, at)) { questions.push(question.block); at = question.next; }
      if (!questions.length) { written.push(blocks[at++]); continue; }
      changed = true;
      const passage = written.at(-1);
      if (grouped && questions.length >= 2 && plain(passage) && (text.get(passage.ref)?.length ?? 0) >= 80) written.splice(-1, 1, { type: "questionGroup", number: "", kind: "cloze", material: [passage], questions });
      else written.push(...questions);
    }
    return changed ? { ...fragment, blocks: written } : fragment;
  });
  for (const grouped of [true, false]) {
    const fragments = build(grouped);
    if (fragments.every((fragment, index) => fragment === draft.fragments[index])) return draft;
    const settled = { ...draft, fragments };
    try { assertImportDocument(compileAutonomousDraft(input, template, withOriginalParagraphs(input, settled), true).document); return settled; }
    catch { /* The next form, or the agent's own placement. */ }
  }
  return draft;
}

export interface ReferenceFill {
  draft: AutonomousDraft;
  /** Printed numbers the program turned into questions. */
  organized: string[];
  /** Printed numbers that look like questions and stayed as ordinary text. */
  left: string[];
  /** Some of the paper's text is still outside any structure, so the teacher is told even when it has no number to name. */
  unplaced: boolean;
}

/**
 * Organizes what the agent left, without a model and without retyping: every paragraph keeps its reference. Only what
 * the paper marks clearly becomes a question; a numbered note that merely looks like one stays as text.
 */
export function organizeRemainingReferences(input: PreparedImport, template: ChalkLeeDocument, written: AutonomousDraft): ReferenceFill {
  const compiles = (draft: AutonomousDraft) => {
    try { assertImportDocument(compileAutonomousDraft(input, template, withOriginalParagraphs(input, draft), true).document); return true; }
    catch { return false; }
  };
  // An agent's draft that no longer compiles is left out, as the unfinished paper leaves it out.
  const base = compiles(written) ? settleNumberedChoices(input, template, written) : { ...written, fragments: [] };
  const known = new Set(compileAutonomousDraft(input, template, base, true).summary.mainQuestions);
  const entries = referenceSourceEntries(workingReferenceInput(input, base.sourceRevisions));
  const placed = new Set(base.fragments.flatMap(fragment => collectSourceRefs(fragment.blocks)));
  const candidates: Candidate[] = [];
  for (const candidate of questionCandidates(entries, placed)) {
    // A question shows by its options or solution, or by carrying on the numbering of one that did.
    const marked = candidate.options.length >= 2 || candidate.answer.length > 0 || candidate.analysis.length > 0 || known.has(String(Number(candidate.number) - 1));
    if (!marked || candidate.unclear || candidate.options.length === 1) continue;
    known.add(candidate.number);
    candidates.push(candidate);
  }
  const fragment = (candidate: Candidate): AutonomousFragment => ({
    key: `program_${candidate.number}_${candidate.at}`, order: candidate.at, unitIds: [...new Set(candidate.entries.map(entry => entry.unitId))],
    blocks: [questionBlock(candidate)], continuesPrevious: false, warnings: []
  });
  // "二、填空题" keeps working as a section in the outline and the question numbering.
  const sections = entries.flatMap((entry, at): AutonomousFragment[] => placed.has(entry.ref) || entry.role !== "heading" || !importSectionLabel(entry.text) || entry.text.trim().length > 30 ? [] : [{
    key: `program_section_${at}`, order: at, unitIds: [entry.unitId], blocks: [{ ref: entry.ref, as: "heading", level: 2 }], continuesPrevious: false, warnings: []
  }]);
  const withFragments = (fragments: AutonomousFragment[]) => ({ ...base, fragments: [...base.fragments, ...sections, ...fragments] });
  // A question the compiler cannot take stays as text and does not hold back the others. Halving finds it in a few
  // compiles, and the time limit keeps a very long paper from holding up the app.
  const accepted: Candidate[] = [], deadline = Date.now() + MAX_ORGANIZE_MS;
  const take = (group: Candidate[]) => {
    if (!group.length || Date.now() > deadline) return;
    if (compiles(withFragments([...accepted, ...group].map(fragment)))) { accepted.push(...group); return; }
    if (group.length === 1) return;
    const middle = Math.ceil(group.length / 2);
    take(group.slice(0, middle)); take(group.slice(middle));
  };
  take(candidates);
  const draft = withFragments(accepted.map(fragment));
  const covered = new Set(draft.fragments.flatMap(item => collectSourceRefs(item.blocks)));
  return {
    draft, organized: accepted.map(candidate => candidate.number),
    left: candidates.filter(candidate => !accepted.includes(candidate)).map(candidate => candidate.number),
    unplaced: entries.some(entry => !covered.has(entry.ref))
  };
}

const CONCERN_REF = /(?<![\w-])[\w-]*source_[\w-]+/;
/** A few printed words to name a passage by, as the teacher sees them in the original: no formula source or image ids. */
function quoted(text?: string) {
  const parts = (text ?? "").split(/\$[^$]*\$|\[图片[^\]]*\]/).map(part => part.replace(/\s+/g, " ").trim()).filter(Boolean);
  // Punctuation left between formulas ("；" after "$CN=\\frac12CD$") names nothing a teacher could find.
  const words = parts.find(part => part.replace(/\s/g, "").length >= 4) ?? parts.find(part => /[\p{L}\p{N}]/u.test(part));
  if (!words) return /\[图片/.test(text ?? "") ? "一张图" : /\$[^$]+\$/.test(text ?? "") ? "一段公式" : "有一段内容";
  return `“${words.length > 14 ? `${words.slice(0, 14)}…` : words}”`;
}
/** Words of a line that can be looked up in the original: no formulas or images, and not just its number. */
function searchableText(text: string) {
  const part = text.split(/\$[^$]*\$|\[图片[^\]]*\]/).map(item => item.trim()).find(item => item.replace(/\s/g, "").length >= 4);
  if (!part) return undefined;
  const unnumbered = part.replace(/^\d{1,3}\s*[.．、]\s*/, "");
  return (unnumbered.replace(/\s/g, "").length >= 4 ? unnumbered : part).slice(0, 40);
}

/** The question or sub-question a passage was put in against the number printed on it. */
const movedTo = (concern: string) => concern.match(/不能移入第\s*(\S+?)\s*题/)?.[1];

/** What a check found, in the words of someone looking at the paper. */
function concernReason(concern: string, textOf: (ref: string) => string | undefined): string {
  const passage = () => quoted(textOf(concern.match(CONCERN_REF)?.[0] ?? ""));
  const moved = movedTo(concern), from = concern.match(/属于第\s*(\S+?)\s*题(?:的小问\s*\((\S+?)\))?/);
  if (concern.includes("留在了题外")) return "没有整理成题目";
  if (concern.includes("已保留在原答案位置待核对")) return "答案没有归到题目里";
  if (concern.includes("答案印了两遍")) return "原稿印了两遍答案，请核对";
  if (concern.includes("两处答案不一致")) return "原稿两处答案不一致，请核对";
  // Told at the question the passage went into, so it names where else it may belong.
  if (moved && /^\d+$/.test(moved) && from) return `${passage()}可能属于第 ${from[1]} 题${from[2] ? `的小问 (${from[2]})` : ""}，请核对`;
  if (moved) return `${passage()}放在了第 ${moved} ${/^\d+$/.test(moved) ? "题" : "小问"}，请核对`;
  const heading = concern.match(/是标题，不能放入(答案|解析)/)?.[1];
  if (heading) return `标题${passage()}放进了${heading}，请核对`;
  const unmarked = concern.match(/没有标为(答案|解析)/)?.[1];
  if (unmarked) return `${passage()}放进了${unmarked}，原稿没有这样标注`;
  if (concern.includes("没有题干")) return "没有题干，原稿里也没有这个空";
  if (concern.includes("引用配图")) return "题目提到图，这里没有图";
  if (concern.includes("不在任何题目中")) return "前面的材料没有和题目放在一起";
  if (concern.includes("尚未建立对应小题")) return "原稿有这个空，但没有对应的小题";
  if (concern.includes("没有对应答案或解析")) return "答案没有归到题目里";
  return "结构可能不对";
}

/** The questions and pages to point the teacher to, from what the program organized and what its checks still doubt. */
export function referenceFollowUp(input: PreparedImport, numbers: string[], concerns: string[], pages: number[], service?: string, unplaced = false): ImportFollowUp | undefined {
  const entries = referenceSourceEntries(input);
  const owner = new Map(entries.map(entry => [entry.ref, entry.questionNumber]));
  const reasons = new Map<string, string>();
  const note = (number: string, reason: string) => { if (/^\d+$/.test(number) && !reasons.has(number)) reasons.set(number, reason); };
  const keyLines = answerKeyLines(entries);
  const pageOfUnit = (unitId: string) => input.units.find(unit => unit.id === unitId)?.page;
  const byRef = new Map(entries.map(entry => [entry.ref, entry]));
  // The line a doubt is about, so the original opens there rather than at the top of the question.
  const located = new Map<string, (typeof entries)[number]>();
  for (const { printed, expected, line } of misprintedAnswerNumbers(keyLines.map(entry => entry.text))) {
    note(expected, `原稿答案的题号印成了 ${printed}，请核对这题和第 ${printed} 题的答案`);
    located.set(expected, keyLines[line]);
  }
  for (const concern of concerns) {
    const named = [...concern.matchAll(/第\s*(\d{1,3})(?:\s*[–～~-]\s*\d{1,3})?\s*[题空]/g)].map(match => match[1]);
    const owned = [...concern.matchAll(/(?<![\w-])[\w-]*source_[\w-]+/g)].flatMap(match => owner.get(match[0]) ?? []);
    const line = byRef.get(concern.match(CONCERN_REF)?.[0] ?? "");
    // A passage put in another question is looked at there, once, rather than also at the number printed on it.
    const moved = movedTo(concern);
    for (const number of moved && /^\d+$/.test(moved) ? [moved] : named.length ? named : owned) {
      if (!reasons.has(number) && line) located.set(number, line);
      note(number, concernReason(concern, ref => byRef.get(ref)?.text));
    }
  }
  numbers.forEach(number => note(number, "由程序整理，请核对"));
  const list = [...reasons.keys()];
  // A doubt that names no question gives the teacher nothing to look at, so it raises no notice by itself.
  if (!list.length && !pages.length && !service && !unplaced) return undefined;
  // A label printed under every question ("【小问1详解】") would always find its first copy in the original.
  const printedTimes = new Map<string, number>();
  for (const entry of entries) { const text = searchableText(entry.text); if (text) printedTimes.set(text, (printedTimes.get(text) ?? 0) + 1); }
  const once = (entry?: Entry) => { const text = entry && searchableText(entry.text); return text && printedTimes.get(text) === 1 ? text : undefined; };
  const place = (number: string) => {
    const line = located.get(number) ?? entries.find(entry => entry.questionNumber === number);
    const page = line && pageOfUnit(line.unitId);
    if (!line || page) return page ? { page } : {};
    // The line itself if its words are printed only there, else the next such line of the same question, else its first line.
    const at = entries.indexOf(line), owner = line.questionNumber;
    const following = entries.slice(at, at + 12).filter((entry, index) => !index || entry.questionNumber === owner);
    const sourceText = following.map(once).find(Boolean) ?? once(entries.find(entry => entry.questionNumber === number)) ?? searchableText(line.text);
    return sourceText ? { sourceText } : {};
  };
  const items: ImportFollowUpItem[] = [
    ...list.map(question => ({ question, ...place(question), reason: reasons.get(question)! })),
    ...pages.map(page => ({ page, reason: "保留为原图" }))
  ];
  return { questions: list, pages, items, ...(service ? { service } : {}), ...(numbers.length || pages.length || unplaced ? { rerun: true } : {}) };
}
