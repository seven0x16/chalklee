import { previousChalkLeeFigureParagraph } from "./figureFlow";
import { chalkLeeClosingKeepWithNext, chalkLeeMaterialTitles, chalkLeeSharedChoiceLeadIns, chalkLeeQuestionLeadIns } from "./closingFlow";
import type { ChalkLeeDocument, ChalkLeePageAppearance } from "@chalklee/format";
import { outputSolutionEntries, outputSolutionsTitle, type DocumentOutputOptions } from "../../../shared/document/output";
import { chalkLeeElementScale } from "./viewport";
import { chalkLeePageSizePt, isChalkLeeCompactGroup, measureChalkLeeGapHeightAbove } from "./pagination";
import { chalkLeeDesignLayoutCss } from "./designLayout";
import { chalkLeeGroupBody } from "./paginationMeasure";
import { CHALKLEE_RUNNING_SLOTS, chalkLeeHeaderFooter, chalkLeePageDecorationArea, chalkLeePageDecorationPicture, chalkLeePageDecorationShows, chalkLeeRunningLineVisible, chalkLeeRunningLook, chalkLeeRunningParts, chalkLeeRunningRuleWidthPt } from "@chalklee/format";
import { CHALKLEE_RUNNING_RULE_PADDING_PT, chalkLeeRunningFontFamilies, chalkLeeRunningGapPt } from "./ChalkLeeRunningLines";

/** The pages drawn before the body, in order. */
const CHALKLEE_FRONT_PAGES = ".chalklee-cover, .chalklee-toc-page";

export function createChalkLeePrintRoot(paper: HTMLElement, page: ChalkLeePageAppearance, options: DocumentOutputOptions = {}, content?: ChalkLeeDocument): HTMLElement {
  document.getElementById("chalklee-print-root")?.remove();
  const root = document.createElement("main");
  root.id = "chalklee-print-root";
  root.setAttribute("aria-label", "ChalkLee 打印内容");
  const printStyle = document.createElement("style");
  const size = chalkLeePageSizePt(page);
  const margins = page.marginsPt;
  // The printer cannot leave the cover and contents out of its page total, so with them the total is the body's sheets on screen.
  const front = paper.querySelectorAll(CHALKLEE_FRONT_PAGES).length;
  const bodyPages = front ? Math.max(1, paper.querySelectorAll(".chalklee-paper-sheet").length - front) : undefined;
  // A heading stays with what follows it, as the editor's own pagination keeps it.
  printStyle.textContent = `@page { size: ${size.width}pt ${size.height}pt; margin: ${margins.top}pt ${margins.right}pt ${margins.bottom}pt ${margins.left}pt;${content ? chalkLeeRunningPageCss(content, bodyPages) : ""} }
${content ? chalkLeeRunningFirstPageCss(content) : ""}
${front ? chalkLeeFrontPageCss() : ""}
${content ? chalkLeePageDecorationCss(content) : ""}
#chalklee-print-root :is(h1, h2, h3, h4, h5, h6) { break-after: avoid-page; }`;
  root.append(printStyle);
  const clone = paper.cloneNode(true) as HTMLElement;
  for (const question of clone.querySelectorAll<HTMLElement>('.chalklee-question-object[data-pagination-keep-together="true"]')) {
    // Imported question styles may set break-inside:auto inline. Apply the
    // measured screen constraint at that same cascade level in the print copy.
    question.style.breakInside = "avoid";
  }
  // As on screen, a short table stays whole, and the rows marked as its header head
  // every page it runs onto: the printer repeats a table's header group by itself.
  for (const table of clone.querySelectorAll<HTMLElement>("[data-chalklee-table]")) {
    // Mark the whole block up to the content it sits in, so a heading kept with it moves along
    // instead of the printer breaking inside the block's wrappers just above the table.
    if (table.dataset.paginationWhole === "true") {
      for (let block: HTMLElement | null = table; block && !block.matches(".chalklee-editor-content, [data-node-view-content-react], .chalklee-option-content"); block = block.parentElement) {
        block.style.breakInside = "avoid";
      }
    }
    const body = table.querySelector<HTMLElement>(":scope > tbody");
    const header: HTMLElement[] = [];
    for (const row of Array.from(body?.children ?? []) as HTMLElement[]) {
      if (row.matches(".chalklee-page-gap, .chalklee-page-repeat-header")) continue;
      if (row.dataset.repeatHeader !== "true") break;
      header.push(row);
    }
    if (body && header.length) {
      const head = table.ownerDocument.createElement("thead");
      head.append(...header);
      table.insertBefore(head, body);
    }
  }
  // As on screen: a question's stem, figure and options stay together, while its
  // shown answer and analysis may follow on the next page. Short solution regions
  // stay whole; a long analysis keeps its label with the opening lines.
  for (const question of clone.querySelectorAll<HTMLElement>('.chalklee-question-object[data-pagination-keep-body="true"]')) {
    question.style.breakInside = "auto";
    const parts = Array.from(question.querySelector(":scope > .chalklee-question-object-content > [data-node-view-content-react]")?.children ?? []) as HTMLElement[];
    const solution = parts.findIndex(part => part.matches('[data-chalklee-region="answer"], [data-chalklee-region="analysis"]'));
    const body = parts.slice(0, solution < 0 ? parts.length : solution).filter(part => !part.matches(".chalklee-page-gap"));
    body.forEach((part, index) => { part.style.breakInside = "avoid"; if (index < body.length - 1) part.style.breakAfter = "avoid-page"; });
  }
  for (const question of clone.querySelectorAll<HTMLElement>(".chalklee-question-object:not(.group)[data-pagination-split=\"true\"]")) {
    const kept = question.dataset.paginationKeepRegions?.split(" ") ?? [];
    for (const region of question.querySelectorAll<HTMLElement>(':scope > .chalklee-question-object-content > [data-node-view-content-react] > :is([data-chalklee-region="answer"], [data-chalklee-region="analysis"])')) {
      if (kept.includes(region.dataset.chalkleeRegion ?? "")) region.style.breakInside = "avoid";
      else region.querySelector<HTMLElement>(":scope > p")?.style.setProperty("break-after", "avoid");
    }
  }
  for (const paragraph of chalkLeeClosingKeepWithNext(clone)) {
    paragraph.style.breakAfter = "avoid-page";
    const writing = paragraph.closest<HTMLElement>("[data-chalklee-answer-lines]");
    if (writing) writing.style.breakAfter = "avoid-page";
  }
  for (const title of chalkLeeMaterialTitles(clone)) title.style.breakAfter = "avoid-page";
  for (const instruction of chalkLeeSharedChoiceLeadIns(clone)) {
    instruction.style.breakAfter = "avoid-page";
    instruction.closest<HTMLElement>('[data-chalklee-region="material"]')!.style.breakAfter = "avoid-page";
  }
  // Drawings print still: their print version, or how they start.
  for (const picture of clone.querySelectorAll<HTMLImageElement>("img[data-chalklee-print-src]")) picture.src = picture.dataset.chalkleePrintSrc!;
  if (options.answers !== undefined) clone.classList.toggle("hide-answers", !options.answers);
  if (options.analysis !== undefined) clone.classList.toggle("hide-analysis", !options.analysis);
  const designLayout = clone.querySelector<HTMLStyleElement>("style[data-chalklee-design-layout]");
  if (designLayout && paper.dataset.chalkleeDesign) designLayout.textContent = chalkLeeDesignLayoutCss(paper, paper.dataset.chalkleeDesign);
  // Apply pagination hints only to the detached print copy. Preserve its DOM
  // hierarchy so first-paragraph numbering and indentation keep their selectors.
  const printContentHeight = (size.height - margins.top - margins.bottom) * 4 / 3;
  const scale = chalkLeeElementScale(paper);
  const gapHeightAbove = measureChalkLeeGapHeightAbove(paper);
  const clonedGroups = elementsByNodeId(clone, ".chalklee-question-object.group");
  for (const source of paper.querySelectorAll<HTMLElement>(".chalklee-question-object.group")) {
    const group = clonedGroups.get(source.dataset.nodeId);
    if (source.dataset.questionKind === "matching" && source.dataset.paginationOverflow === "true") {
      const list = source.querySelector<HTMLElement>(":scope > .chalklee-question-object-content > [data-node-view-content-react] > [data-chalklee-subquestions]");
      const first = list && Array.from(list.children).find(element => element.matches(".node-question, .chalklee-question-object") && !element.querySelector('[data-linked-placeholder="true"]'));
      if (first && !source.querySelector("[data-chalklee-page-break]")) {
        const top = source.getBoundingClientRect().top, bottom = first.getBoundingClientRect().bottom;
        const height = (bottom - top - gapHeightAbove(bottom) + gapHeightAbove(top)) / scale;
        if (height > 0 && height <= printContentHeight * .65) {
          const container = group?.querySelector<HTMLElement>(":scope > .chalklee-question-object-content > [data-node-view-content-react]");
          const material = container?.querySelector<HTMLElement>(':scope > [data-chalklee-region="material"]');
          const questions = container?.querySelector<HTMLElement>(":scope > [data-chalklee-subquestions]");
          if (material && questions) {
            material.style.breakAfter = "avoid-page";
            questions.style.breakBefore = "avoid-page";
            const opening = Array.from(questions.children).find(element => element.matches(".node-question, .chalklee-question-object")) as HTMLElement | undefined;
            if (opening) opening.style.breakBefore = "avoid-page";
          }
        }
      }
    }
    const sourceBody = chalkLeeGroupBody(source);
    if (!sourceBody) continue;
    const body = group && chalkLeeGroupBody(group);
    if (!body) continue;
    // Retain the original material/numbering selectors. Only the print clone
    // gets a separate block for solutions, avoiding flex fragmentation bugs.
    const solutions = document.createElement("div");
    solutions.className = "chalklee-print-group-solutions";
    while (body.last.nextSibling) solutions.append(body.last.nextSibling);
    body.container.after(solutions);
    const top = source.getBoundingClientRect().top, bottom = sourceBody.last.getBoundingClientRect().bottom;
    const height = (bottom - top - gapHeightAbove(bottom) + gapHeightAbove(top)) / scale;
    if (sourceBody.hasVisibleSubquestions && isChalkLeeCompactGroup(height, printContentHeight)) body.container.style.breakInside = "avoid";
  }
  let clonedParagraphs: ReturnType<typeof elementsByNodeId> | undefined;
  for (const source of paper.querySelectorAll<HTMLElement>("[data-chalklee-image], .chalklee-auto-image-row")) {
    if (source.closest(".chalklee-image-pair-row, .chalklee-auto-image-cell") || !source.getClientRects().length
      || source.dataset.imageLayout === "inline" || source.dataset.imageLayout?.startsWith("wrap-")) continue;
    const preceding = previousChalkLeeFigureParagraph(source);
    if (!preceding?.dataset.nodeId || !(preceding.textContent?.trim() || preceding.querySelector("[data-chalklee-inline-math]"))) continue;
    const top = preceding.getBoundingClientRect().top, bottom = source.getBoundingClientRect().bottom;
    const height = (bottom - top - gapHeightAbove(bottom) + gapHeightAbove(top)) / scale;
    if (height > printContentHeight * .65) continue;
    clonedParagraphs ??= elementsByNodeId(clone, "p[data-node-id]");
    const paragraph = clonedParagraphs.get(preceding.dataset.nodeId);
    if (paragraph) {
      paragraph.style.breakAfter = "avoid";
      paragraph.dataset.printKeepWithFigure = "true";
    }
  }
  for (const paragraph of chalkLeeQuestionLeadIns(clone)) paragraph.style.breakAfter = "avoid-page";
  const sheet = clone.querySelector<HTMLElement>(".chalklee-paper-sheet");
  if (sheet) {
    for (const property of ["background-color", "background-image", "background-size", "background-repeat"]) {
      clone.style.setProperty(property, sheet.style.getPropertyValue(property));
    }
  }
  clone.querySelector(".chalklee-paper-sheets")?.remove();
  // The cover and contents leave the pages they were drawn over for sheets of their own, before the body.
  clone.querySelector("[data-chalklee-front-spacer]")?.remove();
  const surface = clone.querySelector<HTMLElement>(".chalklee-editor-surface");
  surface?.style.removeProperty("clip-path");
  for (const sheet of clone.querySelectorAll<HTMLElement>(CHALKLEE_FRONT_PAGES)) {
    sheet.removeAttribute("data-selected");
    sheet.style.removeProperty("top");
    sheet.style.width = `${size.width}pt`;
    sheet.style.height = `${size.height}pt`;
    sheet.querySelectorAll("[data-empty]").forEach(element => element.remove());
    surface?.before(sheet);
  }
  clone.querySelectorAll(".chalklee-image-tools, .chalklee-image-resize-controls, .chalklee-question-basket-mark, .chalklee-answer-lines-controls").forEach(element => element.remove());
  let pairedQuestions: ReturnType<typeof elementsByNodeId> | undefined;
  for (const row of clone.querySelectorAll<HTMLElement>('.chalklee-image-pair-row:not([data-suspended="true"])')) {
    const firstId = row.querySelector<HTMLElement>("[data-pair-question]")?.dataset.pairQuestion;
    pairedQuestions ??= elementsByNodeId(clone, ".chalklee-question-object");
    let first = pairedQuestions.get(firstId);
    while (first && first.parentElement !== row.parentElement && first.parentElement) first = first.parentElement;
    if (!first || first === row || first.parentElement !== row.parentElement) continue;
    const group = document.createElement("div");
    group.className = "chalklee-print-image-pair";
    first.before(group);
    let current: Element | null = first;
    while (current) {
      const next: Element | null = current.nextElementSibling;
      group.append(current);
      if (current === row) break;
      current = next;
    }
  }
  for (const image of clone.querySelectorAll<HTMLElement>('[data-chalklee-image][data-image-layout^="wrap-"]')) {
    if (image.closest(".chalklee-question-object, td")) continue;
    let anchor: HTMLElement = image;
    while (anchor.parentElement && !anchor.parentElement.classList.contains("chalklee-editor-content")) anchor = anchor.parentElement;
    if (!anchor.parentElement?.classList.contains("chalklee-editor-content")) continue;
    const group = document.createElement("div");
    group.className = "chalklee-print-image-wrap";
    anchor.before(group);
    let next: Element | null = anchor.nextElementSibling;
    group.append(anchor);
    while (next?.matches("p, .chalklee-page-gap")) {
      const following: Element | null = next.nextElementSibling;
      group.append(next);
      next = following;
    }
  }
  clone.querySelectorAll(".chalklee-column-page-skip").forEach(element => element.remove());
  // Empty lines left at the end of the paper must not start a sheet of their own.
  const body = clone.querySelector<HTMLElement>(".chalklee-editor-content");
  for (let last = body?.lastElementChild; last && (last.matches(".chalklee-page-gap") || last.matches("p") && !last.textContent?.trim()
    && !last.querySelector("img, [data-chalklee-inline-math], [data-chalklee-blank]")); last = body?.lastElementChild) last.remove();
  clone.removeAttribute("data-pristine");
  clone.style.removeProperty("zoom");
  clone.style.removeProperty("transform");
  clone.removeAttribute("data-zoom");
  clone.querySelectorAll<HTMLElement>("[data-question-drop]").forEach((element) => element.removeAttribute("data-question-drop"));
  clone.querySelectorAll<HTMLElement>("[contenteditable]").forEach((element) => element.setAttribute("contenteditable", "false"));
  clone.querySelectorAll<HTMLElement>(".selected, .ProseMirror-selectednode, .is-editing, .has-caret").forEach((element) => {
    element.classList.remove("selected", "ProseMirror-selectednode", "is-editing", "has-caret");
  });
  clone.querySelectorAll<HTMLElement>('[data-chalklee-region="answer"], [data-chalklee-region="analysis"]').forEach((region) => {
    const hasVisibleContent = Boolean(region.textContent?.trim()) || Boolean(region.querySelector(
      "[data-chalklee-image], [data-chalklee-table], [data-chalklee-block-math], [data-chalklee-inline-math], [data-chalklee-blank], [data-chalklee-answer-lines]"
    ));
    if (!hasVisibleContent) region.dataset.printEmpty = "true";
  });
  // Remove excluded solutions from the output copy, including their pictures and group labels.
  for (const region of clone.querySelectorAll<HTMLElement>('[data-chalklee-region="answer"], [data-chalklee-region="analysis"]')) {
    const hidden = region.dataset.chalkleeRegion === "answer" ? clone.classList.contains("hide-answers") : clone.classList.contains("hide-analysis");
    if (hidden || region.dataset.printEmpty === "true") (region.closest(".chalklee-group-solution") ?? region).remove();
  }
  if (options.solutionPlacement === "end" && content) {
    const appendix = document.createElement("section");
    appendix.className = "chalklee-print-appendix";
    const heading = (tag: string, text: string) => { const element = document.createElement(tag); element.textContent = text; return element; };
    appendix.append(heading("h2", outputSolutionsTitle(options)));
    let sectionId: string | undefined;
    const appendixQuestions = elementsByNodeId(clone, ".chalklee-question-object");
    for (const entry of outputSolutionEntries(content, options)) {
      const question = appendixQuestions.get(entry.question.attrs.id);
      if (!question || !clone.contains(question)) continue;
      const regions = Array.from(question.querySelectorAll<HTMLElement>('[data-chalklee-region="answer"], [data-chalklee-region="analysis"]'));
      if (!regions.length) continue;
      if (entry.section?.id !== sectionId && entry.section?.title) appendix.append(heading("h3", entry.section.title));
      sectionId = entry.section?.id;
      const solution = document.createElement("article");
      solution.className = "chalklee-print-solution-entry";
      solution.dataset.questionId = entry.question.attrs.id;
      solution.append(heading("h4", entry.label));
      const moved = new Set<Element>();
      for (const region of regions) {
        const wrapper = region.closest(".chalklee-group-solution") ?? region;
        if (!moved.has(wrapper)) { solution.append(wrapper); moved.add(wrapper); }
      }
      appendix.append(solution);
    }
    if (appendix.querySelector("article")) clone.querySelector(".chalklee-editor-content")?.append(appendix);
  }
  if (Number(paper.dataset.columnCount) > 1) {
    const content = clone.querySelector<HTMLElement>(".chalklee-editor-content");
    if (content?.querySelector(":scope > [data-chalklee-page-break], :scope > .chalklee-print-appendix")) {
      // Chromium does not reliably honour a page break inside a multicol box.
      // End that box at each authored break so the next flow starts on a sheet,
      // including consecutive breaks that intentionally create an empty page.
      const sections = document.createDocumentFragment();
      const newSection = () => {
        const section = content.cloneNode(false) as HTMLElement;
        section.classList.add("chalklee-print-column-section");
        sections.append(section);
        return section;
      };
      let section = newSection();
      for (const child of Array.from(content.childNodes)) {
        if (child instanceof HTMLElement && child.matches("[data-chalklee-page-break]")) section = newSection();
        else if (child instanceof HTMLElement && child.matches(".chalklee-print-appendix")) { section = newSection(); section.append(child); }
        else section.append(child);
      }
      content.replaceWith(sections);
    }
  }
  root.append(clone);
  if (content) root.append(...chalkLeePrintBodyDecorations(content));
  return root;
}

function elementsByNodeId(root: HTMLElement, selector: string) {
  const elements = new Map<string | undefined, HTMLElement>();
  for (const element of root.querySelectorAll<HTMLElement>(selector)) {
    const id = element.dataset.nodeId;
    if (!elements.has(id)) elements.set(id, element);
  }
  return elements;
}

const cssString = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ")}"`;

/** The header and footer as page-margin boxes, so the printer's own page count fills in {page} and {pages}. */
export function chalkLeeRunningPageCss(document: ChalkLeeDocument, pages?: number): string {
  const headerFooter = chalkLeeHeaderFooter(document.appearance);
  const fontFamilies = chalkLeeRunningFontFamilies(headerFooter, document.appearance.body);
  const margins = document.appearance.page.marginsPt;
  const rules: string[] = [];
  for (const [place, edge] of [["header", "top"], ["footer", "bottom"]] as const) {
    const line = headerFooter[place];
    if (!chalkLeeRunningLineVisible(line)) continue;
    const look = chalkLeeRunningLook(headerFooter, line);
    const marginPt = place === "header" ? margins.top : margins.bottom;
    const gap = chalkLeeRunningGapPt(marginPt);
    const near = edge === "top" ? "bottom" : "top", far = edge;
    const ruleWidth = look.rule ? chalkLeeRunningRuleWidthPt(look.rule) : 0;
    const border = look.rule ? `${ruleWidth}pt ${look.rule.style} ${look.rule.color}` : "";
    // A margin box fills its margin's height; a rule on the far side needs the box shrunk to the text.
    const lineHeight = look.fontSizePt * 1.4;
    const farMargin = look.rule?.bothSides ? Math.max(0, marginPt - gap - lineHeight - 2 * (CHALKLEE_RUNNING_RULE_PADDING_PT + ruleWidth)) : null;
    for (const slot of CHALKLEE_RUNNING_SLOTS) {
      const text = line[slot]?.trim() ?? "";
      if (!text && !look.rule) continue;
      const value = chalkLeeRunningParts(text).map(part => typeof part === "string" ? cssString(part)
        : part.field === "title" ? cssString(document.metadata.title) : part.field === "pages" && pages ? cssString(String(pages)) : `counter(${part.field})`).join(" ") || '""';
      const declarations = [
        `content: ${value}`,
        `font-family: ${fontFamilies.map(cssString).join(", ")}`,
        `font-size: ${look.fontSizePt}pt`,
        `font-weight: ${look.fontWeight === "bold" ? 700 : 400}`,
        ...(look.letterSpacingEm ? [`letter-spacing: ${look.letterSpacingEm}em`] : []),
        `line-height: 1.4`,
        `color: ${look.color}`,
        `white-space: pre`,
        `text-align: ${slot === "center" ? "center" : slot}`,
        `vertical-align: ${edge === "top" ? "bottom" : "top"}`,
        `margin-${near}: ${gap}pt`,
        ...(look.rule ? [`border-${near}: ${border}`, `padding-${near}: ${CHALKLEE_RUNNING_RULE_PADDING_PT}pt`] : []),
        ...(farMargin !== null ? [`margin-${far}: ${Math.round(farMargin * 100) / 100}pt`, `border-${far}: ${border}`, `padding-${far}: ${CHALKLEE_RUNNING_RULE_PADDING_PT}pt`] : [])
      ];
      rules.push(` @${edge}-${slot} { ${declarations.join("; ")}; }`);
    }
  }
  return rules.join("");
}

export function chalkLeeRunningFirstPageCss(document: ChalkLeeDocument): string {
  if (!chalkLeeHeaderFooter(document.appearance).differentFirstPage) return "";
  const boxes = ["top", "bottom"].flatMap(edge => CHALKLEE_RUNNING_SLOTS.map(slot => `@${edge}-${slot} { content: none; border: 0; }`));
  return `@page :first { ${boxes.join(" ")} }`;
}

/** The cover's and contents' sheets: the whole paper, with nothing in its margins, and not counted in the body's page numbers. */
export function chalkLeeFrontPageCss(): string {
  const boxes = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right", "left-middle", "right-middle"]
    .map(box => `@${box} { content: none; border: 0; }`);
  return `@page chalklee-front { margin: 0; counter-increment: page 0; ${boxes.join(" ")} }`;
}

/**
 * Side-margin drawings as page-margin pictures, which print whether or not backgrounds do. The first page and
 * the odd and even pages after it each get the drawings meant for them.
 */
export function chalkLeePageDecorationCss(document: ChalkLeeDocument): string {
  const decorations = document.appearance.pageDecorations ?? [];
  const rules: string[] = [];
  for (const [selector, sample] of [[":first", 1], [":right", 3], [":left", 2]] as const) {
    const boxes: string[] = [];
    for (const [place, box] of [["left", "left-middle"], ["right", "right-middle"]] as const) {
      if (!decorations.some(decoration => decoration.place === place)) continue;
      const shown = decorations.filter(decoration => decoration.place === place && chalkLeePageDecorationShows(decoration, sample));
      const picture = chalkLeePageDecorationPicture(shown, chalkLeePageDecorationArea(document.appearance.page, place), document.metadata.title);
      boxes.push(`@${box} { content: ${picture ? `url("${picture}")` : "none"}; }`);
    }
    if (boxes.length) rules.push(`@page ${selector} { ${boxes.join(" ")} }`);
  }
  return rules.join("\n");
}

/** Body-area drawings: on every page as a layer the printer repeats, or on the first page only. */
export function chalkLeePrintBodyDecorations(document: ChalkLeeDocument): HTMLElement[] {
  const decorations = (document.appearance.pageDecorations ?? []).filter(decoration => decoration.place === "content");
  const area = chalkLeePageDecorationArea(document.appearance.page, "content");
  return (["all", "first"] as const).flatMap(pages => {
    const picture = chalkLeePageDecorationPicture(decorations.filter(decoration => (decoration.pages ?? "all") === pages), area, document.metadata.title);
    if (!picture) return [];
    const image = window.document.createElement("img");
    image.className = "chalklee-print-decoration";
    image.dataset.pages = pages;
    image.alt = "";
    image.src = picture;
    if (pages === "first") image.style.height = `${area.height}pt`;
    return [image];
  });
}
