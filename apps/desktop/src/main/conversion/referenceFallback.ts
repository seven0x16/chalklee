import type { ChalkLeeDocument } from "@chalklee/format";
import { importSectionLabel } from "../../shared/conversion/answerSource";
import { assertImportDocument } from "../../shared/conversion/importDocument";
import { importOptionAnchors, importPunctuatedQuestionStart, importQuestionAnchors } from "../../shared/conversion/questionAnchors";
import type { ImportFollowUp, PreparedImport } from "../../shared/conversion/types";
import { wordAnswerLabel, wordBareLabel } from "../../shared/conversion/wordSource";
import { compileAutonomousDraft, type AutonomousDraft, type AutonomousFragment } from "./autonomous/state";
import { collectSourceRefs, referenceSourceEntries, withOriginalParagraphs } from "./referenceDraft";
import { workingReferenceInput } from "./referenceSources";

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
      open = { number: printed, at, entries: [entry], stem: [{ ref: entry.ref, stripPrefix: prefix }], options: [], answer: [], analysis: [] };
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
  const base = compiles(written) ? written : { ...written, fragments: [] };
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

/** The questions and pages to point the teacher to, from what the program organized and what its checks still doubt. */
export function referenceFollowUp(input: PreparedImport, numbers: string[], concerns: string[], pages: number[], service?: string, unplaced = false): ImportFollowUp | undefined {
  const owner = new Map(referenceSourceEntries(input).map(entry => [entry.ref, entry.questionNumber]));
  const questions = new Set(numbers);
  for (const concern of concerns) {
    const named = [...concern.matchAll(/第\s*(\d{1,3})\s*[题空]/g)].map(match => match[1]);
    const owned = [...concern.matchAll(/(?<![\w-])[\w-]*source_[\w-]+/g)].flatMap(match => owner.get(match[0]) ?? []);
    (named.length ? named : owned).forEach(number => questions.add(number));
  }
  const list = [...questions].filter(number => /^\d+$/.test(number));
  // A doubt that names no question gives the teacher nothing to look at, so it raises no notice by itself.
  if (!list.length && !pages.length && !service && !unplaced) return undefined;
  return { questions: list, pages, ...(service ? { service } : {}) };
}
