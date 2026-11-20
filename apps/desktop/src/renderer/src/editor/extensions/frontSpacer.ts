import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { ChalkLeePageAppearance } from "@chalklee/format";
import { DOCUMENT_PAGE_GAP_PX } from "../../viewers/pageAppearance";
import type { ChalkLeeEditorLayout } from "../layoutAppearance";
import { chalkLeeColumnLayout, chalkLeePageSizePt } from "../pagination";
import { chalkLeeEditorFrontPages } from "../tableOfContents";
import { createChalkLeePageGap } from "./pageGaps";

const key = new PluginKey("chalkLeeFrontSpacer");

/** A page's body area, which each page before the body takes so the body starts after them. */
export function chalkLeeFrontSpacerPageHeightPx(page: ChalkLeePageAppearance) {
  return Math.max(120, (chalkLeePageSizePt(page).height - page.marginsPt.top - page.marginsPt.bottom) * 4 / 3);
}

/**
 * With a cover or contents, an empty block before the body takes their pages; they are drawn over those pages and
 * pagination starts the body on the next one. Single-column pages are separated as the body's own pages are; with
 * columns each page fills one column and skips the rest. It is never part of the document.
 */
export const ChalkLeeFrontSpacerExtension = Extension.create({
  name: "chalkLeeFrontSpacer",
  addProseMirrorPlugins() {
    let cached: { set: DecorationSet; doc: unknown } | null = null;
    return [new Plugin({
      key,
      props: {
        decorations(state) {
          const layout = state.doc.attrs.runtimeLayout as ChalkLeeEditorLayout | null;
          const page = state.doc.attrs.runtimePage as ChalkLeePageAppearance | null;
          if (!page || !(layout?.cover || layout?.tableOfContents)) return DecorationSet.empty;
          if (cached?.doc === state.doc) return cached.set;
          const pages = chalkLeeEditorFrontPages(state.doc, layout, page);
          const height = chalkLeeFrontSpacerPageHeightPx(page);
          const columns = chalkLeeColumnLayout(page).count;
          const signature = [pages, Math.round(height * 10), columns, JSON.stringify(page.marginsPt)].join(":");
          // The same key keeps the drawn block while typing; it is rebuilt only when the pages change.
          const set = DecorationSet.create(state.doc, [Decoration.widget(0, () => frontSpacer(page, pages, height, columns), {
            side: -100, key: `chalklee-front-spacer-${signature}`, ignoreSelection: true
          })]);
          cached = { set, doc: state.doc };
          return set;
        }
      }
    })];
  }
});

function frontSpacer(page: ChalkLeePageAppearance, pages: number, height: number, columns: number) {
  const spacer = document.createElement("div");
  spacer.className = "chalklee-front-spacer";
  spacer.contentEditable = "false";
  spacer.dataset.chalkleeFrontSpacer = "";
  spacer.dataset.pages = String(pages);
  spacer.setAttribute("aria-hidden", "true");
  const margins = page.marginsPt;
  for (let index = 0; index < pages; index += 1) {
    const block = document.createElement("div");
    block.className = "chalklee-front-spacer-page";
    block.style.height = `${height}px`;
    spacer.append(block);
    if (columns > 1) {
      // The other columns of that sheet stay empty.
      for (let column = 1; column < columns; column += 1) spacer.append(document.createElement("span"));
    } else if (index < pages - 1) {
      spacer.append(createChalkLeePageGap({
        pos: 0, page: index + 2, startPx: (index + 1) * height, fillPx: 0,
        marginTopPx: margins.top * 4 / 3, marginBottomPx: margins.bottom * 4 / 3,
        marginLeftPx: margins.left * 4 / 3, marginRightPx: margins.right * 4 / 3, bandPx: DOCUMENT_PAGE_GAP_PX
      }));
    }
  }
  return spacer;
}
