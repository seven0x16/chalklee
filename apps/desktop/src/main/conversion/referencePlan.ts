import { importSectionLabel, isImportAnswerHeading } from "../../shared/conversion/answerSource";
import { importPunctuatedQuestionStart } from "../../shared/conversion/questionAnchors";
import { runImportAgent, type ImportCallObserver, type ImportCredentials } from "./model";

/**
 * The first pass of reference assembly: the whole paper is organized in one reply per part,
 * the parts in parallel, without tools. Each part sees the complete source so a question that
 * crosses into the next part is still organized whole. What the program does not accept goes
 * back once with the exact reasons; whatever is still left is for the assembling agent, which
 * then only fixes what is left.
 */

export interface PlanEntry { ref: string; text: string; role: string; questionNumber?: string }
export interface PlannedFragment { key: string; blocks: unknown[]; continuesPrevious?: boolean; answerFor?: unknown }
export interface PlanReply { part: number; raw: string }
export interface ReferencePlan {
  /** Fragments in the order of the parts, each tagged with the part that wrote it. */
  fragments: (PlannedFragment & { part: number })[];
  /** Parts whose reply could not be used, with the reason. */
  failures: { part: number; from: string; to: string; error: string }[];
  ranges: { from: number; to: number }[];
  outputs: PlanReply[];
}

/** About how many paragraphs one reply organizes; a reply stays well inside the output limit and request timeout. */
const PART_SIZE = 110;
const MAX_PARTS = 6;

/** "【拓展运用】" before "(4)…": a title printed inside a question; a part cut there leaves the question's last parts to the next one. */
const titleInQuestion = (entry: PlanEntry, next: PlanEntry | undefined) => /^\s*【[^【】]{1,12}】\s*$/.test(entry.text)
  && !(next && (next.role === "heading" || importSectionLabel(next.text) || importPunctuatedQuestionStart(next.text)));
const startsSection = (entries: PlanEntry[], index: number) => {
  const entry = entries[index];
  return entry.role === "heading" && !titleInQuestion(entry, entries[index + 1]) || Boolean(importSectionLabel(entry.text)) || entry.role !== "answer" && isImportAnswerHeading(entry.text);
};
const startsQuestion = (entry: PlanEntry, previous: PlanEntry | undefined) =>
  entry.role === "body" && entry.questionNumber !== undefined && entry.questionNumber !== previous?.questionNumber;

/**
 * Parts of about equal size, cut where a section or answer area begins, else where a printed
 * question begins, so a question is rarely split between two replies.
 */
export function referencePlanRanges(entries: PlanEntry[]): { from: number; to: number }[] {
  const parts = Math.min(MAX_PARTS, Math.max(1, Math.round(entries.length / PART_SIZE)));
  const cuts = [0];
  for (let part = 1; part < parts; part++) {
    const target = Math.round(entries.length * part / parts), window = Math.floor(entries.length / parts / 2);
    let best: number | undefined, bestScore = Infinity;
    for (let index = Math.max(cuts.at(-1)! + 1, target - window); index <= Math.min(entries.length - 1, target + window); index++) {
      const kind = startsSection(entries, index) ? 0 : startsQuestion(entries[index], entries[index - 1]) ? 1 : undefined;
      if (kind === undefined) continue;
      const score = kind * window + Math.abs(index - target);
      if (score < bestScore) { best = index; bestScore = score; }
    }
    if (best !== undefined && best > cuts.at(-1)!) cuts.push(best);
  }
  return cuts.map((from, index) => ({ from, to: cuts[index + 1] ?? entries.length }));
}

/** Where to halve a part that did not come back: at a section or question start nearest the middle. */
function splitPoint(entries: PlanEntry[], range: { from: number; to: number }): number {
  const target = Math.floor((range.from + range.to) / 2), window = Math.floor((range.to - range.from) / 4);
  let best = target, bestScore = Infinity;
  for (let index = Math.max(range.from + 1, target - window); index <= Math.min(range.to - 1, target + window); index++) {
    const kind = startsSection(entries, index) ? 0 : startsQuestion(entries[index], entries[index - 1]) ? 1 : undefined;
    if (kind === undefined) continue;
    const score = kind * window + Math.abs(index - target);
    if (score < bestScore) { best = index; bestScore = score; }
  }
  return best;
}

export const REFERENCE_PLAN_OUTPUT = `## 输出

本次不使用工具，直接返回一个 JSON 对象：{"fragments":[{"key":"q1","blocks":[...]}]}

- 按一道完整题或题组一个片段，章节标题可以独立成片段；key 只用字母、数字、下划线和连字符，在本次回复中不重复。blocks 的写法见上面的“结构”和“段落的版式设置”。
- 只整理指定范围内的段落，范围内每个 ref 恰好使用一次。范围开头若接着上一部分的题目、题组、选项或答案（如同一篇材料的后续小题），这些段落由上一部分整理，你跳过它们，从范围内第一个新开始的标题、题目或题组开始。范围内开始的题目或题组延续到范围之后时，把它完整整理完，包括范围之后属于它的段落。
- 本次不做局部修订，内容一律按原样引用。
- 逐段检查排版断行：上一段在句子中间断开、没有句末标点，下一段接着说的（如“…（共5小题，每小题2”和“分）”，“…选出最佳”和“选项，并在答题卡上…”），后一段加 join:true 接回。大题说明、材料、题干和选项都要检查，标为“首行缩进”的新段落不接。
- 不输出解释、Markdown 或代码块。`;

const sourcePrompt = (sourceName: string, count: number, source: string) => `原稿《${sourceName}》共 ${count} 段：\n\n<source>\n${source}\n</source>`;

/** Fragments from a reply; anything not shaped like one is left out rather than failing the reply. */
function parseFragments(raw: string): PlannedFragment[] {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const value = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  if (!Array.isArray(value?.fragments)) throw new Error("缺少 fragments 数组");
  return value.fragments.filter((fragment: any) => fragment && typeof fragment === "object" && Array.isArray(fragment.blocks) && fragment.blocks.length)
    .map((fragment: any, index: number) => ({ key: typeof fragment.key === "string" && /^[a-zA-Z0-9_-]{1,60}$/.test(fragment.key) ? fragment.key : `f${index + 1}`, blocks: fragment.blocks,
      ...(fragment.continuesPrevious === true ? { continuesPrevious: true } : {}), ...(fragment.answerFor !== undefined ? { answerFor: fragment.answerFor } : {}) }));
}

/**
 * Output allowed for one reply: a paragraph takes about 25 tokens to place, so this leaves ample room,
 * while a reply that keeps going past the paragraphs it was given (a runaway) ends within seconds.
 */
const replyTokens = (paragraphs: number) => Math.min(8000, 1500 + paragraphs * 60);

/**
 * One reply, asked again once with the reason when it cannot be read. A reply that ran past its length is not
 * asked again as it was: the caller gives half the paragraphs to each of two replies instead (`smaller`).
 * When the service itself fails (balance, key, connection), asking again or in halves would fail the same way.
 */
async function reply(options: { prompt: string; systemPrompt: string; credentials: ImportCredentials; signal: AbortSignal; observe?: ImportCallObserver; stage: string; paragraphs: number },
  outputs: PlanReply[], part: number): Promise<{ fragments: PlannedFragment[] } | { error: string; smaller?: boolean }> {
  let error = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    options.signal.throwIfAborted();
    let raw: string;
    try {
      // Plain text: a JSON-only response format sometimes ran on with blank output until the limit.
      raw = await runImportAgent({ ...options.credentials, maxOutputTokens: replyTokens(options.paragraphs) }, attempt ? `${options.prompt}\n\n上次的回复无法使用：${error}。请修正后重新返回完整 JSON。` : options.prompt, [], options.signal,
        options.systemPrompt, options.observe, options.stage, "text");
    } catch (failure) {
      options.signal.throwIfAborted();
      const message = (failure instanceof Error ? failure.message : String(failure)).slice(0, 300);
      const partial = (failure as { partialText?: unknown })?.partialText;
      if (typeof partial === "string") outputs.push({ part, raw: `[超出长度，共 ${partial.length} 字，以下为开头和结尾]${partial.slice(0, 1500)}\n……\n${partial.slice(-2500)}` });
      return { error: message, ...(/超过模型输出长度/.test(message) ? { smaller: true } : {}) };
    }
    outputs.push({ part, raw });
    try { return { fragments: parseFragments(raw) }; }
    catch (failure) { error = (failure instanceof Error ? failure.message : String(failure)).slice(0, 300); }
  }
  return { error, smaller: true };
}

export async function planReferenceFragments(options: {
  entries: PlanEntry[]; source: string; sourceName: string; systemPrompt: string;
  credentials: ImportCredentials; signal: AbortSignal; observe?: ImportCallObserver;
}): Promise<ReferencePlan> {
  const { entries } = options;
  const plan: ReferencePlan = { fragments: [], failures: [], ranges: [], outputs: [] };
  const whole = referencePlanRanges(entries).length === 1;
  type Result = { range: { from: number; to: number }; fragments: PlannedFragment[]; error?: string };
  /** A part that does not come back is halved, and a half once more. */
  const organize = async (range: { from: number; to: number }, splits: number): Promise<Result[]> => {
    const from = entries[range.from].ref, to = entries[range.to - 1].ref;
    const scope = whole && range.from === 0 && range.to === entries.length ? `整理全部 ${entries.length} 段。`
      : `全卷分成几部分同时整理，你负责从 [${from}] 到 [${to}] 的 ${range.to - range.from} 段。其余部分由别人整理，只用来理解上下文。`;
    // The source comes first and is the same in every part, so the parts share the service's prompt cache.
    const result = await reply({ ...options, prompt: `${sourcePrompt(options.sourceName, entries.length, options.source)}\n\n${scope}`, stage: "reference-plan", paragraphs: range.to - range.from }, plan.outputs, -1);
    if ("fragments" in result) return [{ range, fragments: result.fragments }];
    if (result.smaller && splits && range.to - range.from >= 20) {
      const middle = splitPoint(entries, range);
      const parts = await Promise.all([organize({ from: range.from, to: middle }, splits - 1), organize({ from: middle, to: range.to }, splits - 1)]);
      return parts.flat();
    }
    return [{ range, fragments: [], error: result.error }];
  };
  const results = (await Promise.all(referencePlanRanges(entries).map(range => organize(range, 2)))).flat();
  // Keys stay unique across parts, so a later write can replace exactly one fragment.
  const keys = new Set<string>();
  results.forEach((result, part) => {
    plan.ranges.push(result.range);
    if (result.error !== undefined) plan.failures.push({ part, from: entries[result.range.from].ref, to: entries[result.range.to - 1].ref, error: result.error });
    for (const fragment of result.fragments) {
      let key = fragment.key;
      for (let suffix = 2; keys.has(key); suffix++) key = `${fragment.key}-${suffix}`;
      keys.add(key);
      plan.fragments.push({ ...fragment, key, part });
    }
  });
  return plan;
}

/**
 * The second and last tool-free reply: the fragments the program refused, with each reason, and the
 * paragraphs no fragment placed. It returns replacements for those only; accepted fragments stay as they are.
 */
export async function repairReferenceFragments(options: {
  entries: PlanEntry[]; source: string; sourceName: string; systemPrompt: string; accepted: string[];
  refused: { fragment: PlannedFragment; error: string }[]; missing: string[];
  credentials: ImportCredentials; signal: AbortSignal; observe?: ImportCallObserver; outputs: PlanReply[];
}): Promise<PlannedFragment[]> {
  // Many refused fragments in one reply ran past its length (13 cloze passages of a practice set), and all of them went
  // to ChalkLee AI one by one; batches of about a hundred paragraphs are repaired side by side instead.
  const size = ({ fragment }: { fragment: PlannedFragment }) => JSON.stringify(fragment.blocks).split('"ref"').length - 1;
  const batches: { refused: typeof options.refused; missing: string[]; paragraphs: number }[] = [];
  const open = () => { const batch = { refused: [] as typeof options.refused, missing: [] as string[], paragraphs: 0 }; batches.push(batch); return batch; };
  let batch = open();
  for (const item of options.refused) {
    if (batch.paragraphs && batch.paragraphs + size(item) > REPAIR_PARAGRAPHS) batch = open();
    batch.refused.push(item); batch.paragraphs += size(item);
  }
  for (const ref of options.missing) {
    if (batch.paragraphs >= REPAIR_PARAGRAPHS) batch = open();
    batch.missing.push(ref); batch.paragraphs++;
  }
  const others = batches.length > 1 ? ["其余没通过或没整理的段落由别人同时处理，只用来理解上下文，不要输出。"] : [];
  const results = await Promise.all(batches.filter(part => part.paragraphs).map(part => {
    const task = [
      `已保存的片段（不要重复输出，其中的 ref 已经使用）：${options.accepted.join("、") || "无"}。`,
      ...(part.refused.length ? [`下面的片段没有通过程序校验，按原因修正后重新输出完整片段，key 不变：\n${part.refused.map(({ fragment, error }) => `原因：${error}\n${JSON.stringify({ key: fragment.key, blocks: fragment.blocks })}`).join("\n\n")}`] : []),
      ...(part.missing.length ? [`还没有片段使用的段落，按原稿结构整理进片段：${part.missing.join("、")}。`] : []),
      ...others,
      `只输出修正和补写的片段，不输出已保存的片段。这次不限范围：上面列出的段落都由你整理。`
    ].join("\n\n");
    return reply({ ...options, prompt: `${sourcePrompt(options.sourceName, options.entries.length, options.source)}\n\n${task}`, stage: "reference-plan-repair", paragraphs: part.paragraphs }, options.outputs, -1);
  }));
  return results.flatMap(result => "fragments" in result ? result.fragments : []);
}

/** Paragraphs one repair reply takes on, well within its output limit. */
const REPAIR_PARAGRAPHS = 100;
