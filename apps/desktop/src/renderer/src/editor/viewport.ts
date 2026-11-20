/** Screen coordinates use the paper's transform; document dimensions stay at 100%. */
export function chalkLeeElementScale(element: Element): number {
  const paper = element.closest<HTMLElement>(".chalklee-paper");
  const scale = Number(paper?.dataset.zoom);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}
