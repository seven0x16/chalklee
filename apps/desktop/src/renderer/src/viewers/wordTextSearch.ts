const squash = (text: string) => text.replace(/\s/g, "");
const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#160": " " };
const htmlText = (html: string) => html.replace(/<[^>]*>/g, "").replace(/&(nbsp|amp|lt|gt|quot|#39|#160);/g, (_, name: string) => ENTITIES[name]!);

/** The first laid-out page printing this text; spacing and line breaks do not count. */
export function wordPageWithText(pages: readonly { html: string }[], text: string) {
  const wanted = squash(text);
  return wanted ? pages.findIndex(page => squash(htmlText(page.html)).includes(wanted)) : -1;
}

/** The range of this text inside a mounted page, across the runs and line boxes it is split into. */
export function wordTextRange(root: HTMLElement, text: string): Range | null {
  const wanted = squash(text);
  if (!wanted) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const places: { node: Text; offset: number }[] = [];
  let joined = "";
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    for (let offset = 0; offset < node.data.length; offset++) {
      if (/\s/.test(node.data[offset]!)) continue;
      joined += node.data[offset]; places.push({ node, offset });
    }
  }
  const at = joined.indexOf(wanted);
  if (at < 0) return null;
  const start = places[at]!, end = places[at + wanted.length - 1]!;
  const range = document.createRange();
  range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset + 1);
  return range;
}
