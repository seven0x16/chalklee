/** Derived CSS keeps semantic labels aligned without mutating ProseMirror DOM. */
export function chalkLeeDesignLayoutCss(paper: HTMLElement, scopeId: string): string {
  const scope = `[data-chalklee-design=${cssString(scopeId)}]`;
  const rules: string[] = [];
  const rule = (selector: string, declarations: string) => rules.push(`${selector}, #chalklee-print-root ${selector} { ${declarations} }`);
  for (const question of paper.querySelectorAll<HTMLElement>(".chalklee-question-object[data-node-id]")) {
    const style = getComputedStyle(question);
    rule(`${scope} .chalklee-question-object[data-node-id=${cssString(question.dataset.nodeId!)}] > .chalklee-question-object-head`,
      `top: ${style.paddingTop}; left: ${style.paddingLeft}; right: ${style.paddingRight};`);
  }
  for (const region of paper.querySelectorAll<HTMLElement>('[data-chalklee-region="answer"][data-node-id], [data-chalklee-region="analysis"][data-node-id]')) {
    // Group solution items already share one label above their numbered items.
    if (region.closest(".chalklee-group-solution")) continue;
    const style = getComputedStyle(region);
    if (parseFloat(style.paddingLeft) >= parseFloat(style.fontSize) * 2.6) continue;
    const selector = `${scope} [data-chalklee-region][data-node-id=${cssString(region.dataset.nodeId!)}]`;
    rule(`${selector}::before`, "position: static; display: inline; width: auto; margin-right: .5em;");
    rule(`${selector} > p:first-of-type`, "display: inline;");
  }
  return rules.join("\n");
}

function cssString(value: string): string {
  return `"${value.replace(/[\\"\n\r\f\0]/g, character => `\\${character.charCodeAt(0).toString(16)} `)}"`;
}
