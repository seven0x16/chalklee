import { prepareImport } from "./prepareImport";
import { renderPdfFigures } from "./pdfFigures";

export function startConversionWorker() {
  const running = new Map<string, AbortController>();
  window.chalkLee.onConversionPreparation(async request => {
    if ("cancel" in request) { running.get(request.requestId)?.abort(); return; }
    const controller = new AbortController();
    running.set(request.requestId, controller);
    try {
      if ("figures" in request) {
        const figures = await renderPdfFigures(request.figures.data, request.figures.regions, controller.signal);
        window.chalkLee.reportConversionPreparation({ requestId: request.requestId, figures });
        return;
      }
      const input = await prepareImport(request.sourcePath, request.data, controller.signal,
        message => window.chalkLee.reportConversionPreparation({ requestId: request.requestId, message }), request.companions);
      window.chalkLee.reportConversionPreparation({ requestId: request.requestId, input });
    } catch (error) {
      window.chalkLee.reportConversionPreparation({ requestId: request.requestId, error: error instanceof Error ? error.message : "原稿处理失败。" });
    } finally { running.delete(request.requestId); }
  });
  window.chalkLee.conversionPreparationReady();
}
