/** React node views have an outer ProseMirror wrapper. Automatic rows leave
 * hidden source wrappers in that same region; neither is authored content. */
export function previousChalkLeeFigureParagraph(figure: HTMLElement): HTMLElement | null {
  const anchor = figure.closest<HTMLElement>(".react-renderer.node-image") ?? figure;
  let previous = anchor.previousElementSibling as HTMLElement | null;
  while (previous && (previous.matches("[data-image-source], .chalklee-page-gap")
    || (previous.matches(".react-renderer.node-image") && previous.querySelector("[data-image-source]")))) {
    previous = previous.previousElementSibling as HTMLElement | null;
  }
  return previous?.matches("p") ? previous : null;
}
