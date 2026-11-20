import type { ChalkLeeBlockNode, ChalkLeeInlineNode } from "@chalklee/format";

type Paragraph = { content?: ChalkLeeInlineNode[] };
function paragraphs(blocks: ChalkLeeBlockNode[]): Paragraph[] {
  const result: Paragraph[] = [];
  const visit = (node: any) => {
    if (["paragraph", "heading"].includes(node.type)) result.push(node);
    else node.content?.forEach(visit);
  };
  blocks.forEach(visit);
  return result;
}

function indexedText(paragraph: Paragraph) {
  let text = "";
  const positions: { node: Extract<ChalkLeeInlineNode, { type: "text" }>; from: number; to: number; underlined: boolean }[] = [];
  if (paragraph.content?.some(node => !["text", "hardBreak"].includes(node.type))) return { text, positions };
  for (const node of paragraph.content ?? []) {
    if (node.type !== "text") continue;
    // Isolated letters/digits can touch a nearby answer rule; they are not
    // sufficient evidence of underlined prose.
    const underlined = (node.text.match(/\p{L}/gu)?.length ?? 0) >= 2 && Boolean(node.marks?.some(mark => mark.type === "underline"));
    let offset = 0;
    for (const original of node.text) {
      const normalized = original.normalize("NFKC").replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
      for (const character of normalized) if (!/\s/.test(character)) {
        text += character;
        // Index by UTF-16 offsets, as string slicing below does.
        for (let i = 0; i < character.length; i++) positions.push({ node, from: offset, to: offset + original.length, underlined });
      }
      offset += original.length;
    }
  }
  return { text, positions };
}

/** Recover PDF rule-based emphasis on an OCR page only when an entire native
 * line matches uniquely. Never copy text, infer styles from a repeated word,
 * or turn printed answer rules into underlined prose. */
export function restorePdfTextUnderlines(blocks: ChalkLeeBlockNode[], nativeBlocks: ChalkLeeBlockNode[]): void {
  const targets = paragraphs(blocks).map(paragraph => ({ paragraph, ...indexedText(paragraph) }));
  const sources = paragraphs(nativeBlocks).map(indexedText);
  const selected = new Map<ChalkLeeInlineNode, Set<number>>();
  for (const source of sources) {
    if (source.text.length < 12 || !source.positions.some(position => position.underlined)) continue;
    if (sources.filter(other => other.text.includes(source.text)).length !== 1) continue;
    const matches = targets.flatMap(target => {
      const at = target.text.indexOf(source.text);
      return at < 0 ? [] : [{ target, at }, ...(target.text.indexOf(source.text, at + 1) >= 0 ? [{ target, at: -1 }] : [])];
    });
    if (matches.length !== 1) continue;
    const { target, at } = matches[0];
    source.positions.forEach((position, index) => {
      if (!position.underlined) return;
      const destination = target.positions[at + index];
      const offsets = selected.get(destination.node) ?? new Set<number>();
      for (let i = destination.from; i < destination.to; i++) offsets.add(i);
      selected.set(destination.node, offsets);
    });
  }
  for (const { paragraph } of targets) paragraph.content = paragraph.content?.flatMap(node => {
    const offsets = selected.get(node);
    if (node.type !== "text" || !offsets?.size || node.marks?.some(mark => mark.type === "underline")) return [node];
    const pieces: ChalkLeeInlineNode[] = [];
    for (let from = 0; from < node.text.length;) {
      const underlined = offsets.has(from);
      let to = from + 1;
      while (to < node.text.length && offsets.has(to) === underlined) to++;
      pieces.push({ ...node, text: node.text.slice(from, to), ...(underlined ? { marks: [...(node.marks ?? []), { type: "underline" }] } : {}) });
      from = to;
    }
    return pieces;
  });
}
