import type { ChalkLeePageAppearance } from "@chalklee/format";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { CHALKLEE_LAYOUT_REPORT_LIMIT, type ChalkLeeLayoutReport } from "../../../shared/document/layoutReport";
import { chalkLeePageSizePt, measureChalkLeeGapHeightAbove } from "./pagination";
import { chalkLeeQuestionNames } from "./questionNames";

/** How the teacher names each question and box: 第 3 题, 第 33–36 题, “注意”盒子 (questionNames.ts). */
export function chalkLeeLayoutLabels(doc: ProseMirrorNode): Map<string, string> {
  const labels = chalkLeeQuestionNames(doc);
  doc.descendants(node => {
    if (node.type.name === "box" && typeof node.attrs.id === "string") labels.set(node.attrs.id, node.attrs.label ? `“${node.attrs.label}”盒子` : "盒子");
  });
  return labels;
}

/** Reads the pages the editor shows, which print as the same pages. */
export function chalkLeeLayoutReport(paper: HTMLElement, page: ChalkLeePageAppearance, labels: ReadonlyMap<string, string>): ChalkLeeLayoutReport {
  const report: ChalkLeeLayoutReport = { used: [], split: [], strandedHeadings: [], tooWide: [] };
  const sheets = Array.from(paper.querySelectorAll<HTMLElement>(".chalklee-paper-sheet")).map(sheet => sheet.getBoundingClientRect());
  const content = paper.querySelector<HTMLElement>(".chalklee-editor-content");
  if (!sheets.length || !content) return report;
  const scale = sheets[0].height / (chalkLeePageSizePt(page).height * 4 / 3);
  const margin = { top: page.marginsPt.top * 4 / 3 * scale, right: page.marginsPt.right * 4 / 3 * scale, bottom: page.marginsPt.bottom * 4 / 3 * scale, left: page.marginsPt.left * 4 / 3 * scale };
  const body = sheets[0].height - margin.top - margin.bottom;
  // A point in the band between two sheets belongs to the page above it.
  const pageAt = (y: number) => {
    let index = 0;
    for (let i = 1; i < sheets.length; i++) if (sheets[i].top <= y + .5) index = i;
    return index;
  };
  // Page gaps and the on-screen page-break marker take room only on screen.
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return rect.height > 0 && !element.closest(".chalklee-page-gap, [data-chalklee-page-break]") ? rect : null;
  };

  const used = sheets.map(() => 0);
  for (const element of content.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, img, table, [data-node-id]")) {
    const rect = visible(element);
    if (!rect) continue;
    const first = pageAt(rect.top);
    // Something running onto the next page is counted by its parts.
    if (pageAt(rect.bottom - 1) !== first) continue;
    used[first] = Math.max(used[first], rect.bottom - sheets[first].top - margin.top);
  }
  report.used = used.map(value => Math.round(Math.min(1, Math.max(0, value / body)) * 100) / 100);

  let gapHeightAbove: ReturnType<typeof measureChalkLeeGapHeightAbove> | undefined;
  const split = (element: HTMLElement, kind: "question" | "box") => {
    const rect = visible(element), id = element.dataset.nodeId;
    if (!rect || !id || report.split.length >= CHALKLEE_LAYOUT_REPORT_LIMIT) return;
    const first = pageAt(rect.top);
    if (pageAt(rect.bottom - 1) === first) return;
    const heightAbove = gapHeightAbove ??= measureChalkLeeGapHeightAbove(content);
    const height = rect.height - heightAbove(rect.bottom) + heightAbove(rect.top);
    report.split.push({ page: first + 1, kind, id, label: labels.get(id) ?? (kind === "box" ? "盒子" : "题目"), fitsOnPage: height <= body });
  };
  for (const element of content.querySelectorAll<HTMLElement>(".chalklee-question-object[data-node-id], .chalklee-box[data-node-id]")) {
    // A group or box that runs on is named once, not again for each question inside it.
    if (element.parentElement?.closest(".chalklee-question-object[data-node-id], .chalklee-box[data-node-id]")) continue;
    split(element, element.matches(".chalklee-box") ? "box" : "question");
  }

  for (const heading of content.querySelectorAll<HTMLElement>(":scope > :is(h1, h2, h3, h4, h5, h6)")) {
    const rect = visible(heading), id = heading.dataset.nodeId;
    if (!rect || !id || report.strandedHeadings.length >= CHALKLEE_LAYOUT_REPORT_LIMIT) continue;
    let next = heading.nextElementSibling;
    while (next && !visible(next)) next = next.nextElementSibling;
    // A heading before a question that starts its own page (slides) is meant to stand alone.
    const forced = next?.querySelector<HTMLElement>(".chalklee-question-object")?.style.getPropertyValue("--chalklee-break-before") === "page"
      || Boolean(next?.matches("[data-chalklee-page-break], :has(> [data-chalklee-page-break])"));
    if (next && !forced && pageAt(next.getBoundingClientRect().top) > pageAt(rect.top)) {
      report.strandedHeadings.push({ page: pageAt(rect.top) + 1, id, text: (heading.textContent ?? "").trim().slice(0, 30) });
    }
  }

  for (const element of content.querySelectorAll<HTMLElement>("img, table")) {
    const rect = visible(element), id = element.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
    if (!rect || !id || report.tooWide.length >= CHALKLEE_LAYOUT_REPORT_LIMIT) continue;
    const sheet = sheets[pageAt(rect.top)];
    if (rect.right > sheet.right - margin.right + 2 || rect.left < sheet.left + margin.left - 2) {
      report.tooWide.push({ page: pageAt(rect.top) + 1, kind: element.matches("table") ? "table" : "image", id });
    }
  }
  return report;
}
