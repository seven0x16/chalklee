import type { ChalkLeeBlockNode, ChalkLeeDocument } from "@chalklee/format";

type Node = { type: string; attrs?: Record<string, any>; content?: Node[]; text?: string };

/** A printed paper number: "6", "6." or "6、", not a subquestion's "(1)". */
const paperNumber = (number: { mode?: string; label?: string } | undefined) =>
  number?.mode === "fixed" && /^\s*\d{1,3}\s*[.．、]?\s*$/.test(number.label ?? "") ? Number(number.label!.match(/\d+/)![0]) : undefined;
const subquestions = (group: Node) => group.content?.find(region => region.type === "subQuestionList")?.content?.filter(node => node.type === "question") ?? [];

/**
 * A passage without a number of its own whose questions run on from the paper (shared material, then 6 and 7
 * after question 5) takes no number: its questions keep the paper's numbers as printed, instead of being
 * drawn as the group's (1) and (2). The run must continue the question before it, or lead into the next one,
 * so passages whose questions restart at 1 keep their own numbering.
 */
export function continueImportPaperNumbers(blocks: ChalkLeeBlockNode[]) {
  const items: { node: Node; first?: number; last?: number; subs?: (number | undefined)[] }[] = [];
  const collect = (nodes: Node[]) => {
    for (const node of nodes) {
      if (node.type === "question") items.push({ node, first: paperNumber(node.attrs?.number), last: paperNumber(node.attrs?.number) });
      else if (node.type === "questionGroup") items.push({ node, first: paperNumber(node.attrs?.number), last: paperNumber(node.attrs?.number), subs: subquestions(node).map(question => paperNumber(question.attrs?.number)) });
      else if (node.type === "box") collect(node.content ?? []);
    }
  };
  collect(blocks as Node[]);
  // A run of numberless groups (1–2, 3–4, … 15–16 before question 17) is settled one group at a time: a group
  // learns its neighbour's numbers only once that neighbour continues them, so passes repeat until none changes.
  for (let changed = true; changed;) {
    changed = false;
    items.forEach((item, index) => {
      const { node, subs } = item;
      if (node.type !== "questionGroup" || node.attrs?.number?.mode !== "none" || !subs?.length
        || subs.some((number, at) => number === undefined || (at > 0 && number !== subs[at - 1]! + 1))) return;
      const before = items.slice(0, index).reverse().find(other => other.last !== undefined)?.last;
      const after = items.slice(index + 1).find(other => other.first !== undefined)?.first;
      if (before !== undefined ? subs[0] !== before + 1 : after !== subs.at(-1)! + 1) return;
      node.attrs!.number = { mode: "continue" };
      item.first = subs[0]; item.last = subs.at(-1);
      changed = true;
    });
  }
}

const hasText = (node: Node): boolean => node.type === "text" ? !!node.text?.trim() : node.type === "mathInline" || node.type === "blockMath" || (node.content ?? []).some(hasText);

/**
 * Text printed directly above a numberless passage whose material holds only its figure belongs to that
 * material ("地球上的生物氮循环……完成下列小题。" then the figure, then 6 and 7). The paragraphs move into the
 * material unchanged; a section heading or another question ends the search.
 */
export function gatherImportGroupLeadIns(blocks: ChalkLeeBlockNode[]) {
  const visit = (nodes: Node[]) => {
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      if (node.type === "box") { visit(node.content ?? []); continue; }
      if (node.type !== "questionGroup" || !["none", "continue"].includes(node.attrs?.number?.mode)) continue;
      const material = node.content?.find(region => region.type === "questionMaterial");
      if (!material || hasText(material)) continue;
      let start = index;
      while (start > 0 && nodes[start - 1].type === "paragraph" && hasText(nodes[start - 1])) start--;
      if (start === index || index - start > 6) continue;
      const leadIn = nodes.splice(start, index - start);
      material.content = [...leadIn, ...(material.content ?? []).filter(block => block.type !== "paragraph" || (block.content ?? []).length)];
      index = start;
    }
  };
  visit(blocks as Node[]);
}

const ROUTE_ARROW = /^\s*\\(?:xrightarrow|xleftarrow|xrightleftharpoons|xleftrightharpoons|xlongequal|longrightarrow|rightarrow|to)(?![a-zA-Z])/;

/**
 * A synthesis route or process chain is printed in rows, structure → structure. A recognizer can return each
 * structure image and each arrow as a paragraph of its own; the route is put back on one line (it still wraps
 * like text). Nothing is added or removed, and runs without at least two pictures and an arrow are left alone.
 */
export function joinImportRouteLines(blocks: ChalkLeeBlockNode[]) {
  const single = (paragraph: Node) => {
    if (paragraph.type !== "paragraph") return undefined;
    const parts = (paragraph.content ?? []).filter(node => node.type !== "text" || node.text?.trim());
    if (parts.length !== 1) return undefined;
    if (parts[0].type === "imageInline") return "image";
    if (parts[0].type === "mathInline") return ROUTE_ARROW.test(parts[0].attrs?.latex ?? "") ? "arrow" : "formula";
    return undefined;
  };
  const visit = (nodes: Node[]) => {
    for (let index = 0; index < nodes.length; index++) {
      let end = index;
      while (end < nodes.length && single(nodes[end])) end++;
      // A route runs from a picture to a picture, with an arrow somewhere between them.
      const kinds = nodes.slice(index, end).map(single);
      const first = kinds.indexOf("image"), last = kinds.lastIndexOf("image");
      if (first >= 0 && last > first && kinds.slice(first, last).includes("arrow")) {
        const parts = nodes.slice(index + first, index + last + 1).flatMap((paragraph, at) => [...(at ? [{ type: "text", text: " " }] : []),
          ...(paragraph.content ?? []).filter(node => node.type !== "text" || node.text?.trim())]);
        nodes.splice(index + first, last - first + 1, { ...nodes[index + first], content: parts });
        index += first;
        continue;
      }
      if (nodes[index]?.content && !["paragraph", "heading"].includes(nodes[index].type)) visit(nodes[index].content!);
    }
  };
  visit(blocks as Node[]);
}

/** Structure the printed paper shows but a recognizer can lose; applied to every converted document. */
export function applyImportLayoutRules(document: ChalkLeeDocument) {
  continueImportPaperNumbers(document.content.content);
  gatherImportGroupLeadIns(document.content.content);
  joinImportRouteLines(document.content.content);
}
