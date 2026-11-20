import React from "react";
import { createRoot } from "react-dom/client";
import { openChalkLeeArchiveForEditing, readChalkLeeArchive } from "@chalklee/format";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ChalkLeeEditorPane, LoadedChalkLeeEditor } from "../editor/ChalkLeeEditor";
import { createChalkLeePrintRoot } from "../editor/printRoot";
import { createChalkLeePaginatedPrintRoot } from "../editor/paginatedPrint";
import { decodeChalkLeePrintImages, PRINT_IMAGE_SELECTOR } from "../editor/printImages";
import { chalkLeeUnmatchedDesignSelectors } from "../editor/designCoverage";
import type { PreviewController } from "../viewers/types";
import { auditImportRender, inspectImportPrint } from "../../../shared/conversion/renderAudit";
import type { DocumentOutputOptions } from "../../../shared/document/output";

/** Byte by byte: Uint8Array.from would first list every byte, which runs out of memory on a textbook-sized PDF. */
const decode = (value: string) => {
  const binary = atob(value), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const noop = () => {};

/** Isolated renderer: the shipping editor and print DOM, without workspace IPC. */
export function startImportPreview() {
  GlobalWorkerOptions.workerSrc = workerUrl;
  const editorHost = document.getElementById("root")!;
  const root = createRoot(editorHost);
  let controller: PreviewController | null = null, failure = "", serial = 0;
  const onController = (value: PreviewController | null) => { controller = value; };
  const onError = (message: string) => { failure = message; };
  const openPaper = async (input: ArrayBuffer | string, output?: DocumentOutputOptions) => {
    document.getElementById("chalklee-print-root")?.remove();
    document.getElementById("chalklee-paginated-print-root")?.remove();
    document.documentElement.classList.remove("chalklee-pdf-export");
    controller = null; failure = "";
    const data = typeof input === "string" ? decode(input).buffer : input;
    const editable = output && await openChalkLeeArchiveForEditing(data);
    const archive = editable?.archive ?? await readChalkLeeArchive(data);
    const props = { filePath: "/import-preview.chalklee", modifiedAt: null, active: true,
      onController, onError, onState: noop, onOutline: noop, onDirtyChange: noop, onSaved: noop };
    editorHost.style.removeProperty("display");
    root.render(<div key={++serial} style={{ width: 1100, height: 1700 }}>
      {editable ? <LoadedChalkLeeEditor {...props} editableArchive={editable} initialSolutionVisibility={output} />
        : <ChalkLeeEditorPane {...props} data={data} />}
    </div>);
    const deadline = Date.now() + 25000;
    while (!controller && !failure && Date.now() < deadline) await pause(50);
    if (failure || !controller) throw new Error(failure || "文档预览启动超时。");
    return { archive, current: controller as PreviewController };
  };
  const api = {
    async preparePdf(data: ArrayBuffer, view: DocumentOutputOptions = {}) {
      const { archive: { document: model }, current } = await openPaper(data, view);
      const paper = await current.waitForPrintLayout?.();
      if (!paper) throw new Error("预览卷面未生成。");
      const page = model.appearance.page;
      const printRoot = createChalkLeePaginatedPrintRoot(paper, page, view, { trimColumnFlow: true })
        ?? createChalkLeePrintRoot(paper, page, view, model);
      document.body.append(printRoot);
      document.documentElement.classList.add("chalklee-pdf-export");
      document.title = model.metadata.title;
      await Promise.all([document.fonts.ready, decodeChalkLeePrintImages(printRoot.querySelectorAll<HTMLImageElement>(PRINT_IMAGE_SELECTOR))]);
      // Release the editor's layout before Chromium lays out the PDF pages.
      // The mounted editor keeps the copied paper's blob URLs alive.
      editorHost.style.display = "none";
      void editorHost.offsetWidth;
      return page;
    },
    async load(base64: string, view: DocumentOutputOptions = {}) {
      const { archive, current } = await openPaper(base64);
      // The same toggles as the toolbar, so an exported student copy paginates without answers.
      if (view.answers === false) current.setAnswersVisible?.(false);
      if (view.analysis === false) current.setAnalysisVisible?.(false);
      await document.fonts.ready;
      await Promise.all([...document.querySelectorAll<HTMLImageElement>(".chalklee-editor img")].map(image => image.decode().catch(() => undefined)));
      await pause(700);
      // Read the pages once pagination has settled: two readings in a row agree.
      let layout = current.layoutReport?.() ?? null;
      for (let tries = 0; layout && tries < 10; tries++) {
        await pause(150);
        const next = current.layoutReport!();
        if (JSON.stringify(next) === JSON.stringify(layout)) break;
        layout = next;
      }
      const paper = document.querySelector<HTMLElement>(".chalklee-paper");
      if (!paper) throw new Error("预览卷面未生成。");
      // Rules of the design CSS that select nothing here: a change that left the page as it was shows up as one of them.
      const content = paper.querySelector(".chalklee-editor-content"), designCss = archive.document.appearance.design?.css;
      const unmatchedCss = designCss && content ? chalkLeeUnmatchedDesignSelectors(designCss, content) : [];
      const printRoot = createChalkLeePrintRoot(paper, archive.document.appearance.page, view, archive.document);
      document.body.append(printRoot); document.documentElement.classList.add("chalklee-pdf-export");
      document.title = archive.document.metadata.title;
      await document.fonts.ready; await pause(100);
      await Promise.all([...printRoot.querySelectorAll<HTMLImageElement>("img")].map(image => image.decode().catch(() => undefined)));
      const html = printRoot.cloneNode(true) as HTMLElement;
      // The author CSS is available through document_style_read. Keep the DOM
      // inspection budget for content rather than expanded scoped selectors.
      html.querySelectorAll("style[data-chalklee-design-sheet], style[data-chalklee-design-layout]").forEach(element => element.remove());
      // Keep the semantic number/score in the head, while removing its controls.
      html.querySelectorAll("button, .chalklee-question-settings, .chalklee-question-object-actions, .chalklee-question-actions, .chalklee-image-tools, .chalklee-image-resize-controls").forEach(element => element.remove());
      html.querySelectorAll("img").forEach(image => image.removeAttribute("src"));
      // Printing moves a table's header rows into <thead> so they repeat on every page. Show them
      // where the editor keeps them, so CSS chosen from this HTML matches on screen as well.
      html.querySelectorAll("[data-chalklee-table] > thead").forEach(head => { head.nextElementSibling?.prepend(...Array.from(head.children)); head.remove(); });
      const renderedHtml = html.outerHTML;
      const audit = auditImportRender(archive.document, inspectImportPrint(printRoot), view);
      const paginated = createChalkLeePaginatedPrintRoot(paper, archive.document.appearance.page, view);
      if (paginated) {
        printRoot.replaceWith(paginated);
        await Promise.all(Array.from(paginated.querySelectorAll("img"), image => image.decode().catch(() => undefined)));
      }
      return { page: archive.document.appearance.page, audit, layout, unmatchedCss,
        renderedHtml: renderedHtml.slice(0, 150_000), htmlTruncated: renderedHtml.length > 150_000 };
    },
    async pages(base64: string, selected: number[] = [], withText = false) {
      const task = getDocument({ data: decode(base64), isEvalSupported: false });
      const pdf = await task.promise;
      try {
        const images: { page: number; dataUrl: string; text?: string }[] = [];
        for (const number of selected) {
          // Reading an original asks for its first pages without knowing how many there are.
          if (withText && number > pdf.numPages) continue;
          if (!Number.isInteger(number) || number < 1 || number > pdf.numPages) throw new Error("预览页码无效。");
          const page = await pdf.getPage(number), original = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: 1500 / Math.max(original.width, original.height) });
          const canvas = document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
          const text = withText ? (await page.getTextContent()).items.map(item => "str" in item ? `${item.str}${item.hasEOL ? "\n" : ""}` : "").join("").trim() : undefined;
          images.push({ page: number, dataUrl: canvas.toDataURL("image/png"), ...(withText ? { text } : {}) });
        }
        return { count: pdf.numPages, images };
      } finally { await task.destroy(); }
    }
  };
  (window as any).__chalkleeImportPreview = api;
}
