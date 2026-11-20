import { chalkLeeGroupContinuesNumbers, type ChalkLeeDocument, type ChalkLeeQuestionNode, type ChalkLeeQuestionGroupNode } from "@chalklee/format";
import { chalkLeeQuestionPlaces } from "./numbering";

export interface DocumentOutputOptions {
  answers?: boolean;
  analysis?: boolean;
  solutionPlacement?: "after-question" | "end";
}

export const outputSolutionsTitle = (options: DocumentOutputOptions) => options.answers === false ? "参考解析" : options.analysis === false ? "参考答案" : "参考答案与解析";

export function outputSolutionHasContent(node: { type: string; text?: string; content?: readonly unknown[] }): boolean {
  if (node.type === "text") return Boolean(node.text?.trim());
  if (["image", "imageInline", "graphic", "blockMath", "mathInline", "blank", "answerLines"].includes(node.type)) return true;
  return Boolean(node.content?.some(child => outputSolutionHasContent(child as typeof node)));
}

/** The same section and question labels accompany the appendix in PDF, Word and print. */
export function outputSolutionEntries(document: ChalkLeeDocument, options: DocumentOutputOptions) {
  type Question = ChalkLeeQuestionNode | ChalkLeeQuestionGroupNode;
  const result: Array<{ question: Question; label: string; section?: { id: string; title: string } }> = [];
  let section: { id: string; title: string } | undefined;
  const places = chalkLeeQuestionPlaces(document.content.content);
  const hasSolution = (question: Question): boolean => question.content.some(part =>
    part.type === "questionAnswer" ? options.answers !== false && outputSolutionHasContent(part)
      : part.type === "questionAnalysis" ? options.analysis !== false && outputSolutionHasContent(part)
        : part.type === "subQuestionList" && part.content.some(hasSolution));
  // Questions in a box count where they stand.
  for (const block of document.content.content.flatMap(node => node.type === "box" ? node.content : [node])) {
    if (block.type === "heading" && block.attrs.level > 1) {
      section = { id: block.attrs.id, title: (block.content ?? []).map(node => node.type === "text" ? node.text : "").join("") };
    }
    if (block.type !== "question" && block.type !== "questionGroup") continue;
    if (!hasSolution(block)) continue;
    const number = block.attrs.number;
    // A group whose subquestions take the paper's numbers is named by them, as "第 33–36 题".
    const continued = chalkLeeGroupContinuesNumbers(block) ? block.content.flatMap(part => part.type === "subQuestionList" ? part.content.map(child => places.get(child.attrs.id)) : []).filter(place => place !== undefined) : null;
    const label = continued ? continued.length ? `第 ${continued[0]}${continued.length > 1 ? `–${continued[continued.length - 1]}` : ""} 题` : "题组"
      : number.mode === "none" ? block.type === "questionGroup" ? "题组" : "题目"
      : `${block.type === "questionGroup" ? "题组 " : "第 "}${number.mode === "fixed" ? number.label : places.get(block.attrs.id) ?? ""}${block.type === "questionGroup" ? "" : " 题"}`;
    result.push({ question: block, label, section });
  }
  return result;
}
