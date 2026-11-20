import { importText } from "../../shared/conversion/importDocument";
import type { ChalkLeeBlockNode, ChalkLeeDocument } from "@chalklee/format";
import { importSectionLabel } from "../../shared/conversion/answerSource";

/** Scores come only from printed per-question or per-section statements. Never
 * divide a section total or use cumulative marking points from answer regions. */
export function applyImportScores(document: ChalkLeeDocument): void {
  let sectionScore: number | undefined;
  const set = (node: ChalkLeeBlockNode, fallback?: number) => {
    if (node.type !== "question" && node.type !== "questionGroup") return;
    const body = node.content.find(region => region.type === "questionStem" || region.type === "questionMaterial");
    const printed = importText(body).trimStart().match(/^[（(]\s*(\d+(?:\.\d+)?)\s*分\s*[）)]/);
    const score = printed ? Number(printed[1]) : fallback;
    if (score !== undefined && node.attrs.score == null) node.attrs.score = score;
    if (node.type === "questionGroup") for (const region of node.content) if (region.type === "subQuestionList") region.content.forEach(child => set(child));
  };
  for (const block of document.content.content) {
    if (block.type === "heading" || block.type === "paragraph") {
      const text = importText(block);
      if (importSectionLabel(text)) sectionScore = undefined;
      const match = text.match(/每(?:小)?题\s*(\d+(?:\.\d+)?)\s*分/);
      if (match) sectionScore = Number(match[1]);
    } else set(block, sectionScore);
  }
}
