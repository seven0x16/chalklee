/** A short, right-aligned closing belongs together. Page spacers are generated
 * layout, while authored breaks and empty paragraphs remain real boundaries. */
export function chalkLeeClosingParagraphs(content: HTMLElement): HTMLElement[][] {
  const result: HTMLElement[][] = [];
  for (const stem of content.querySelectorAll<HTMLElement>('[data-chalklee-region="stem"]')) {
    const children = Array.from(stem.children).filter(element => !element.matches(".chalklee-page-gap"));
    const closing: HTMLElement[] = [];
    for (const element of children.reverse()) {
      const paragraph = element as HTMLElement;
      const text = paragraph.textContent?.trim() ?? "";
      if (!paragraph.matches("p") || paragraph.style.textAlign !== "right" || !text || text.length > 80) break;
      closing.unshift(paragraph);
    }
    if (closing.length >= 2 && closing.length <= 4) result.push(closing);
  }
  return result;
}

/** Keep a closing with the last writing row as well, so a new page never
 * contains only the signoff and name. Authored empty blocks remain boundaries. */
export function chalkLeeClosingKeepWithNext(content: HTMLElement): HTMLElement[] {
  return chalkLeeClosingParagraphs(content).flatMap(paragraphs => {
    let previous = paragraphs[0].previousElementSibling;
    while (previous?.matches(".chalklee-page-gap")) previous = previous.previousElementSibling;
    const rows = previous?.querySelectorAll<HTMLElement>("[data-chalklee-answer-line]");
    const lastRow = rows?.length ? rows[rows.length - 1] : undefined;
    return [...(lastRow ? [lastRow] : []), ...paragraphs.slice(0, -1)];
  });
}

/** A centered short passage title is often an ordinary paragraph in imported
 * papers. Keep its first content line with it, just like a heading. */
export function chalkLeeMaterialTitles(content: HTMLElement): HTMLElement[] {
  return Array.from(content.querySelectorAll<HTMLElement>('[data-chalklee-region="material"] > p')).filter(paragraph => {
    const text = paragraph.textContent?.trim() ?? "";
    return paragraph.style.textAlign === "center" && text.length > 0 && text.length <= 120
      && !paragraph.querySelector("img,math-field,[data-chalklee-blank]") && paragraph.nextElementSibling != null;
  });
}

/** A short instruction followed by shared choices belongs with their first
 * option. Long reading passages retain normal page breaks. */
export function chalkLeeSharedChoiceLeadIns(content: HTMLElement): HTMLElement[] {
  return Array.from(content.querySelectorAll<HTMLElement>('[data-chalklee-region="material"]')).flatMap(material => {
    const children = Array.from(material.children).filter(element => !element.matches(".chalklee-page-gap"));
    let next = material.nextElementSibling;
    while (next?.matches(".chalklee-page-gap")) next = next.nextElementSibling;
    if (!next || !next.matches("[data-chalklee-options], .node-optionGroup") || children.length < 1 || children.length > 2
      || !children.every(child => child.matches("p") && child.textContent?.trim())
      || (material.textContent?.trim().length ?? 0) > 220) return [];
    return children as HTMLElement[];
  });
}
/** Only the immediate introduction follows a question. Earlier explanations
 * remain free to paginate, identically on screen and in the print copy. */
export function chalkLeeQuestionLeadIns(content: HTMLElement): HTMLElement[] {
  const flow = content.matches(".chalklee-editor-content") ? content : content.querySelector<HTMLElement>(".chalklee-editor-content");
  const result: HTMLElement[] = [];
  let previous: HTMLElement | undefined;
  for (const element of Array.from(flow?.children ?? []) as HTMLElement[]) {
    if (element.matches(".chalklee-page-gap")) continue;
    if (element.matches(".chalklee-question-object, :has(> .chalklee-question-object)") && previous?.matches("p") && previous.textContent?.trim()) result.push(previous);
    previous = element;
  }
  return result;
}
