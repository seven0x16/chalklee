import { chalkLeeQuestionCounter, type ChalkLeeDocument } from "@chalklee/format";

type NumberedNode = { type?: string; attrs?: Record<string, unknown> };

/**
 * True when top-level questions, read in order, print exactly 1, 2, 3… and at
 * least one of them stores that number as a fixed label. An automatic number
 * always prints its position, so it fits the sequence; a missing number reads
 * as automatic, like the editor schema default.
 */
export function chalkLeeFixedNumbersFollowSequence(numbers: readonly unknown[]) {
  const hasFixed = numbers.some(value => (value as { mode?: string } | null | undefined)?.mode === "fixed");
  return hasFixed && numbers.every(chalkLeeNumberShowsPosition);
}

/** True when a question number prints its position (0-based index + 1): automatic, missing, or that fixed label. */
export function chalkLeeNumberShowsPosition(value: unknown, index: number) {
  const number = value as { mode?: string; label?: unknown } | null | undefined;
  if (number == null || number.mode === "auto") return true;
  return number.mode === "fixed" && String(number.label ?? "").trim() === String(index + 1);
}

/**
 * Converted or pasted papers store the numbers they printed. When the paper's
 * questions read exactly 1, 2, 3… in order, those numbers are the paper's own
 * sequence, so they become automatic and follow later insertions, deletions and
 * moves. Anything else (an excerpt starting at 13, gaps, unnumbered questions)
 * stays as written. Returns the same document when nothing changes.
 */
export function chalkLeeSequentialNumbersAsAuto(document: ChalkLeeDocument): ChalkLeeDocument {
  const blocks = (document.content.content ?? []) as NumberedNode[];
  const questions = blocks.filter(block => block.type === "question" || block.type === "questionGroup");
  if (!chalkLeeFixedNumbersFollowSequence(questions.map(question => question.attrs?.number))) return document;
  return {
    ...document,
    content: {
      ...document.content,
      content: blocks.map(block => questions.includes(block) ? { ...block, attrs: { ...block.attrs, number: { mode: "auto" } } } : block) as ChalkLeeDocument["content"]["content"]
    }
  };
}

type NumberedBlock = { type?: string; attrs?: Record<string, unknown>; content?: NumberedBlock[] };

export interface ChalkLeeRunQuestion {
  id: string;
  number: unknown;
  /** Nothing but empty lines lies between it and the question before it. */
  adjacentToPrevious: boolean;
}

/**
 * Fixed numbers that run on in order, such as an excerpt numbered 4, 5, 6, 7,
 * behave like automatic numbers when questions are added or removed: new
 * automatic questions beside the run join it (preferring the question just
 * above them), and the run is renumbered from its first number. Runs the edit
 * did not touch, other runs (a section restarting at 1) and automatic numbers
 * stay as they are. Returns the questions of `after`, by index, whose label changes.
 */
export function chalkLeeFixedNumberRunChanges(
  before: readonly Pick<ChalkLeeRunQuestion, "id" | "number">[],
  after: readonly ChalkLeeRunQuestion[],
  /** Questions moved by the edit: they leave their run and join the one at their new place. */
  moved: ReadonlySet<string> = new Set()
): Array<{ index: number; label: string }> {
  type Run = { start: number };
  const runOf = new Map<string, Run>();
  let run: Run | null = null;
  let previous = 0;
  for (const question of before) {
    const number = fixedInteger(question.number);
    if (number === null) { run = null; continue; }
    if (!run || number !== previous + 1) run = { start: number };
    runOf.set(question.id, run);
    previous = number;
  }
  const beforeIds = new Set(before.map(question => question.id));
  const afterIds = new Set(after.map(question => question.id));
  const affected = new Set<Run>();
  for (const question of before) {
    const leftRun = afterIds.has(question.id) && !moved.has(question.id) ? undefined : runOf.get(question.id);
    if (leftRun) affected.add(leftRun);
  }
  const member = after.map(question => moved.has(question.id) ? undefined : runOf.get(question.id));
  const joins = (index: number) => {
    const { id, number } = after[index];
    return moved.has(id) ? runOf.has(id) : !beforeIds.has(id) && isAutomatic(number);
  };
  for (let start = 0; start < after.length; start += 1) {
    if (!joins(start)) continue;
    let end = start;
    while (end + 1 < after.length && joins(end + 1)) end += 1;
    const above = start - 1;
    const below = end + 1 < after.length ? end + 1 : -1;
    const anchor = above >= 0 && after[start].adjacentToPrevious ? above
      : below >= 0 && after[below].adjacentToPrevious ? below
      : above >= 0 ? above : below;
    const joined = anchor >= 0 ? member[anchor] : undefined;
    if (joined) {
      for (let index = start; index <= end; index += 1) member[index] = joined;
      affected.add(joined);
    }
    start = end;
  }
  const next = new Map<Run, number>();
  const changes: Array<{ index: number; label: string }> = [];
  after.forEach((question, index) => {
    const joined = member[index];
    if (!joined || !affected.has(joined)) return;
    const number = next.get(joined) ?? joined.start;
    next.set(joined, number + 1);
    if (fixedInteger(question.number) !== number) changes.push({ index, label: String(number) });
  });
  return changes;
}

/**
 * chalkLeeFixedNumberRunChanges applied to a document edited outside the editor
 * (ChalkLee AI, external agents): the paper's questions and each group's subquestions.
 */
export function chalkLeeFixedNumberRunsAfterEdit(before: ChalkLeeDocument, after: ChalkLeeDocument): ChalkLeeDocument {
  const previousLists = new Map<string, NumberedBlock[]>();
  const collect = (blocks: NumberedBlock[], key: string) => {
    previousLists.set(key, blocks);
    for (const block of blocks) if (block.type === "questionGroup") for (const child of block.content ?? []) if (child.type === "subQuestionList") collect(child.content ?? [], String(child.attrs?.id ?? ""));
  };
  collect((before.content.content ?? []) as NumberedBlock[], "doc");
  // A blank in a passage shows the number of the question that answers it.
  const blankLabels = new Map<string, string>();
  const relabel = (blocks: NumberedBlock[], key: string): NumberedBlock[] => {
    const changes = chalkLeeFixedNumberRunChanges(chalkLeeRunQuestions(previousLists.get(key) ?? []), chalkLeeRunQuestions(blocks));
    const questions = blocks.filter(isQuestionBlock);
    const labels = new Map(changes.map(({ index, label }) => [questions[index], label]));
    const result = blocks.map(block => {
      let next = block;
      const label = labels.get(block);
      if (label !== undefined) {
        if (typeof block.attrs?.sourceBlankId === "string" && block.attrs.sourceBlankId) blankLabels.set(block.attrs.sourceBlankId, label);
        next = { ...block, attrs: { ...block.attrs, number: { ...(block.attrs?.number as object | undefined), mode: "fixed", label } } };
      }
      if (block.type !== "questionGroup" || !next.content) return next;
      const content = next.content.map(child => {
        if (child.type !== "subQuestionList") return child;
        const list = relabel(child.content ?? [], String(child.attrs?.id ?? ""));
        return list === child.content ? child : { ...child, content: list };
      });
      return content.every((child, index) => child === next.content![index]) ? next : { ...next, content };
    });
    return result.every((block, index) => block === blocks[index]) ? blocks : result;
  };
  const blocks = (after.content.content ?? []) as NumberedBlock[];
  const relabeled = relabel(blocks, "doc");
  if (relabeled === blocks) return after;
  const withBlankLabels = (block: NumberedBlock): NumberedBlock => block.type === "blank" && blankLabels.has(String(block.attrs?.id))
    ? { ...block, attrs: { ...block.attrs, label: blankLabels.get(String(block.attrs?.id)) } }
    : block.content ? { ...block, content: block.content.map(withBlankLabels) } : block;
  return {
    ...after,
    content: { ...after.content, content: (blankLabels.size ? relabeled.map(withBlankLabels) : relabeled) as ChalkLeeDocument["content"]["content"] }
  };
}

export function chalkLeeRunQuestions(blocks: readonly NumberedBlock[]): ChalkLeeRunQuestion[] {
  const questions: ChalkLeeRunQuestion[] = [];
  let onlyEmptyLines = true;
  for (const block of blocks) {
    if (isQuestionBlock(block)) {
      questions.push({ id: String(block.attrs?.id ?? ""), number: block.attrs?.number, adjacentToPrevious: questions.length > 0 && onlyEmptyLines });
      onlyEmptyLines = true;
    } else if (!(block.type === "paragraph" && !block.content?.length)) {
      onlyEmptyLines = false;
    }
  }
  return questions;
}

function isQuestionBlock(block: NumberedBlock) {
  return block.type === "question" || block.type === "questionGroup";
}

function isAutomatic(value: unknown) {
  const number = value as { mode?: string } | null | undefined;
  return number == null || number.mode === "auto";
}

function fixedInteger(value: unknown) {
  const number = value as { mode?: string; label?: unknown } | null | undefined;
  const label = String(number?.label ?? "").trim();
  return number?.mode === "fixed" && /^\d+$/.test(label) ? Number(label) : null;
}

type PlacedNode = { type?: string; attrs?: { id?: unknown; number?: { mode?: string } | null } | null; content?: PlacedNode[] };

/**
 * The number each question and group takes, by id, counted as the paper prints them (see chalkLeeQuestionCounter):
 * the automatic number it shows, or the place a fixed or hidden number stands in. A group that leaves its numbers
 * to its subquestions has none.
 */
export function chalkLeeQuestionPlaces(content: readonly unknown[]): Map<string, number> {
  const counter = chalkLeeQuestionCounter(), places = new Map<string, number>();
  const visit = (nodes: readonly PlacedNode[], next: (node: PlacedNode) => number | null) => {
    for (const node of nodes) {
      if (node.type === "question" || node.type === "questionGroup") {
        const place = next(node);
        if (place !== null) places.set(String(node.attrs?.id ?? ""), place);
      }
      if (node.type === "box") visit(node.content ?? [], next);
      if (node.type === "questionGroup") {
        const sub = counter.group(node);
        for (const part of node.content ?? []) if (part.type === "subQuestionList") visit(part.content ?? [], sub);
      }
    }
  };
  visit(content as PlacedNode[], node => counter.next(node));
  return places;
}
