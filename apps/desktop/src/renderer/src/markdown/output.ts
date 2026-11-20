import type { ExportChalkLeePdfRequest } from "../../../shared/contracts";
import { renderMarkdownPage } from "./render";

/** A note has no paper settings: it prints on A4 with even margins and the page number at the foot. */
export const MARKDOWN_PAGE: ExportChalkLeePdfRequest["page"] = { size: "A4", orientation: "portrait", marginsPt: { top: 54, right: 54, bottom: 54, left: 54 }, printBackground: true };

/**
 * The note as the printer and PDF take it, shown in place of the window while they read it (styles/app/inspector.css):
 * the text as it reads in the editor, without the properties at the top.
 */
export function createMarkdownPrintRoot(source: string): HTMLElement {
  document.getElementById("chalklee-print-root")?.remove();
  const root = document.createElement("main");
  root.id = "chalklee-print-root";
  root.setAttribute("aria-label", "Markdown 打印内容");
  const { top, right, bottom, left } = MARKDOWN_PAGE.marginsPt;
  const style = document.createElement("style");
  style.textContent = `@page { size: A4; margin: ${top}pt ${right}pt ${bottom}pt ${left}pt;
  @bottom-center { content: counter(page) " / " counter(pages); font-size: 9pt; color: #60646c; } }`;
  const article = document.createElement("article");
  article.className = "markdown-print";
  article.innerHTML = renderMarkdownPage(source);
  root.append(style, article);
  return root;
}

/** Lets the print copy lay out before the printer reads it. */
export const nextPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
