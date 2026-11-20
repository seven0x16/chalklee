import { randomUUID } from "node:crypto";
import type { ChalkLeeBlockNode } from "@chalklee/format";

/** A PDF page may begin with standalone choices for blanks in the preceding
 * material. Join only an exact, unique prefix of those still-unfilled numbers. */
export function continueImportBlankGroup(previous: ChalkLeeBlockNode | undefined, blocks: ChalkLeeBlockNode[]): boolean {
  if (previous?.type !== "questionGroup" || blocks[0]?.type !== "question") return false;
  const labels: string[] = [];
  const visit = (node: any): void => {
    if (node.type === "blank" && node.attrs?.label) labels.push(node.attrs.label);
    node.content?.forEach(visit);
  };
  const material = previous.content.find(region => region.type === "questionMaterial");
  if (material) visit(material);
  if (!labels.length || new Set(labels).size !== labels.length) return false;
  const existing = previous.content.find(region => region.type === "subQuestionList")?.content ?? [];
  const occupied = new Set(existing.filter(question => question.attrs.number.mode === "fixed").map(question => question.attrs.number.mode === "fixed" ? question.attrs.number.label : ""));
  const pending = labels.filter(label => !occupied.has(label));
  let count = 0;
  while (count < pending.length) {
    const block = blocks[count];
    if (block?.type !== "question" || block.attrs.number.mode !== "fixed" || block.attrs.number.label !== pending[count]) break;
    count++;
  }
  if (!count) return false;
  const children = blocks.splice(0, count) as Extract<ChalkLeeBlockNode, { type: "question" }>[];
  blocks.unshift({
    type: "questionGroup", attrs: { ...previous.attrs, id: `node_${randomUUID()}` },
    content: [
      { type: "questionMaterial", attrs: { id: `node_${randomUUID()}` }, content: [] },
      { type: "subQuestionList", attrs: { id: `node_${randomUUID()}` }, content: children }
    ]
  });
  return true;
}
