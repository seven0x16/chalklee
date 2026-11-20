import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { chalkLeeFrontPageCount, chalkLeeTocEntries, type ChalkLeePageAppearance, type ChalkLeeTocEntry, type ChalkLeeTocHeading } from "@chalklee/format";
import type { ChalkLeeEditorLayout } from "./layoutAppearance";

/** The body's top-level headings, as the contents and automatic heading numbers count them. */
export function chalkLeeEditorHeadings(doc: ProseMirrorNode): ChalkLeeTocHeading[] {
  const headings: ChalkLeeTocHeading[] = [];
  doc.forEach(node => {
    if (node.type.name === "heading") headings.push({ id: String(node.attrs.id), level: Number(node.attrs.level) || 1, text: node.textContent.replace(/\s+/g, " ").trim() });
  });
  return headings;
}

/** What the contents lists for the open document; empty without a contents. */
export function chalkLeeEditorTocEntries(doc: ProseMirrorNode, layout: ChalkLeeEditorLayout | null | undefined): ChalkLeeTocEntry[] {
  if (!layout?.tableOfContents) return [];
  return chalkLeeTocEntries(chalkLeeEditorHeadings(doc), layout.tableOfContents, layout.headingNumbering);
}

/** Pages before the body: the cover and the contents. */
export function chalkLeeEditorFrontPages(doc: ProseMirrorNode, layout: ChalkLeeEditorLayout | null | undefined, page: ChalkLeePageAppearance): number {
  if (!layout) return 0;
  return chalkLeeFrontPageCount({ page, cover: layout.cover, tableOfContents: layout.tableOfContents }, chalkLeeEditorTocEntries(doc, layout).length);
}
