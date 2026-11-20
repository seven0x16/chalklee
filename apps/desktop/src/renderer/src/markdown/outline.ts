import type { ChangeDesc, Text } from "@codemirror/state";
import type { OutlineItem } from "../viewers/types";

const CHECKPOINT_SPACING = 16_384;
type MarkdownHeading = OutlineItem & { target: number };
type OutlineIndex = { headings: MarkdownHeading[]; checkpoints: number[] };

/** Read headings beyond the viewport without forcing the incremental editor parser to parse the entire file. */
export function markdownOutline(doc: Text, propertiesEnd = 0): OutlineItem[] {
  return scanOutline(doc, propertiesEnd).headings;
}

/** Keep the unchanged portions of the outline across a burst of editor changes. */
export function createMarkdownOutline() {
  let previous: { doc: Text; propertiesEnd: number; index: OutlineIndex } | undefined;
  return (doc: Text, propertiesEnd: number, changes?: ChangeDesc): OutlineItem[] => {
    if (previous?.doc === doc && previous.propertiesEnd === propertiesEnd) return previous.index.headings;
    const index = previous && previous.propertiesEnd === propertiesEnd && changes && !changes.empty
      && changes.length === previous.doc.length && changes.newLength === doc.length
      ? updateOutline(doc, propertiesEnd, previous.index, changes)
      : scanOutline(doc, propertiesEnd);
    previous = { doc, propertiesEnd, index };
    return index.headings;
  };
}

function updateOutline(doc: Text, propertiesEnd: number, previous: OutlineIndex, changes: ChangeDesc): OutlineIndex {
  let firstChange = changes.length, lastChange = 0;
  changes.iterChangedRanges((from, to) => {
    firstChange = Math.min(firstChange, from);
    lastChange = Math.max(lastChange, to);
  });
  const start = previous.checkpoints.findLast(point => point < firstChange) ?? 0;
  const shift = changes.newLength - changes.length;
  const suffix = new Map<number, number>();
  for (const point of previous.checkpoints) {
    if (point > lastChange) suffix.set(point + shift, point);
  }
  const scanned = scanOutline(doc, propertiesEnd, start, suffix);
  const headings = [...previous.headings.filter(item => item.target < start), ...scanned.headings];
  const checkpoints = [...previous.checkpoints.filter(point => point < start), ...scanned.checkpoints];
  if (scanned.resume !== undefined) {
    const resume = scanned.resume;
    for (const item of previous.headings) {
      if (item.target < resume) continue;
      const target = item.target + shift;
      headings.push(shift ? { ...item, id: `markdown:${target}`, target } : item);
    }
    for (const point of previous.checkpoints) if (point >= resume) checkpoints.push(point + shift);
  }
  return { headings, checkpoints };
}

/** A line is a safe restart only outside a fence, a formula and a paragraph
 * that could still become a Setext heading. The unchanged suffix is reusable
 * once the new scan reaches one of those same checkpoints with empty context. */
function scanOutline(doc: Text, propertiesEnd: number, start = 0, suffix?: ReadonlyMap<number, number>): OutlineIndex & { resume?: number } {
  const headings: MarkdownHeading[] = [], checkpoints = [start];
  let offset = start, fence: { character: string; length: number } | null = null, formula: string | null = null;
  let paragraph: { from: number; text: string } | null = null;
  const add = (from: number, label: string, level: number) => headings.push({ id: `markdown:${from}`, label, level, target: from });
  for (const line of doc.iterLines(doc.lineAt(start).number)) {
    const from = offset; offset += line.length + 1;
    if (from < propertiesEnd) continue;
    if (!fence && !formula && !paragraph) {
      const resume = suffix?.get(from);
      if (resume !== undefined) return { headings, checkpoints, resume };
      if (from - checkpoints[checkpoints.length - 1] >= CHECKPOINT_SPACING) checkpoints.push(from);
    }
    if (fence) {
      const close = /^ {0,3}(`+|~+)\s*$/.exec(line);
      if (close && close[1][0] === fence.character && close[1].length >= fence.length) fence = null;
      continue;
    }
    if (formula) { if (line.trimEnd().endsWith(formula)) formula = null; continue; }
    const openFence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (openFence) { fence = { character: openFence[1][0], length: openFence[1].length }; paragraph = null; continue; }
    if (/^ {0,3}(\$\$|\\\[)/.test(line)) {
      const trimmed = line.trimStart(), close = trimmed.startsWith("$$") ? "$$" : "\\]";
      if (!trimmed.slice(2).trimEnd().endsWith(close)) formula = close;
      paragraph = null; continue;
    }
    const heading = /^ {0,3}(#{1,6})(?:\s+(.*?)\s*|\s*)$/.exec(line);
    if (heading) { add(from, (heading[2] ?? "").replace(/\s+#+\s*$/, ""), heading[1].length); paragraph = null; continue; }
    if (paragraph && /^ {0,3}(=+|-+)\s*$/.test(line)) { add(paragraph.from, paragraph.text, line.trimStart()[0] === "=" ? 1 : 2); paragraph = null; continue; }
    if (!line.trim() || /^(?: {4}|\t| {0,3}(?:>|[-+*]\s|\d+[.)]\s|[-*_]{3,}\s*$))/.test(line)) { paragraph = null; continue; }
    paragraph = paragraph ? { from: paragraph.from, text: `${paragraph.text} ${line.trim()}`.slice(0, 240) } : { from, text: line.trim() };
  }
  return { headings, checkpoints };
}
