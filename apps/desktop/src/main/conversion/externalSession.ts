import { conversionTaggingRequest, type ExternalConversionTags } from "./tagging";
import { sourceFormat } from "../../shared/document/kinds";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { lstat, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { validatedImportArchive } from "../../shared/conversion/importDocument";
import { chalkLeeSchemaErrors, readChalkLeeArchive, type ChalkLeeDocument } from "@chalklee/format";
import { renderChalkLeeDocx } from "../workspace/docxExport";
import type { PreparedImport, ImportResult, SourceFragmentEdit } from "../../shared/conversion/types";
import { wordSourceEntries } from "../../shared/conversion/wordSource";
import { AgentWorkspaceService, type AgentWorkspaceOptions } from "../agent/workspace";
import type { AgentEditorBridge } from "../agent/editorBridge";
import { snapshotConversionSource } from "./sources";
import type { ExternalConversionEvent } from "./taskQueue";
import type { ConversionWorkerHost } from "./workerHost";
import { applyProofread } from "./proofread";
import { finalizeImportDocument, makeDocument, readImportHistory, saveImportDocument } from "./documentImport";
import { conversionStorageDirectory, conversionStorageNames, openConversionStorage } from "./cacheStorage";
import { applyAutonomousEdits, type AutonomousEdit } from "./autonomous/edits";
import { assessAutonomousDraft, autonomousFigureImage, autonomousRevision, compileAutonomousDraft, newAutonomousDraft, type AutonomousDraft, type AutonomousFragment } from "./autonomous/state";
import { validateAutonomousLayout, type AutonomousLayout } from "./autonomous/layout";
import { cropContextBitmap, cutCropEdges, importCropRect, importImageSize, pixelCropBox, type PixelBox } from "./crop";
import { ImportPreviewHost, type AutonomousPreview, type PreviewView } from "./previewHost";
import { isIgnoredName, resolveWorkspaceEntry } from "../workspace/files";
import { appendSourceRevisions, sourceImageHash, sourceRevisionChanges, workingReferenceInput } from "./referenceSources";
import { freezeExternalPdfSource, type ExternalPdfSourcePage } from "./externalPdfSources";
import { pdfFigureRepairCandidates } from "./pdfFigureCandidates";
import { assignPdfSourceRoles } from "./pdfReferenceSource";
import { pdfNativeCheckLines } from "./pdfNativeText";
import { preserveImportPage } from "./draft";
import { assemblyProgress, compileUnfinishedReferenceDraft, sourceLayoutLabels } from "./referenceDraft";

/** Source pixels and template are immutable. Copy editable state only so each
 * write remains atomic without duplicating every page's encoded image. */
function cloneSession(session: ExternalSession): ExternalSession {
  const { input, template, ...state } = session;
  return { ...structuredClone(state), template, input: { ...input, warnings: [...input.warnings],
    units: input.units.map(({ images, ...unit }) => ({ ...structuredClone(unit), images })) } };
}

/** After a whole draft is delivered, the session stays open to proofread it; an unfinished draft does not. */
const proofreadable = (session: ExternalSession) => !session.result || session.result.record.conversion?.status === "converted";

// Content left out or placed twice, an original page never looked at, and checks that report 未通过 cannot be delivered as finished.
const FINISH_BLOCKING = /未通过|必须恰好引用一次|尚无对应的文档片段|尚未查看原稿/;

interface ExternalSession {
  version: 1; id: string; root: string; sourceName: string; sourceCopy: string; input: PreparedImport;
  template: ChalkLeeDocument; draft: AutonomousDraft; viewedPreviewPages: number[]; previewRevision?: string;
  result?: ImportResult; agent?: string; stopped?: boolean;
  /** The draft as last delivered; finishing again without changes returns that result. */
  deliveredRevision?: string;
  /** The draft a finish last refused for issues the original may simply have; finishing it again unchanged delivers it. */
  finishRevision?: string;
  viewedSourceImages?: Record<string, { hash: string; full: boolean }>;
  /** Absent only in sessions created before the PDF reference protocol. */
  pdfSources?: { ready: boolean; pages: { unitId: string; recognition: "native-text" | "visual" | "source-image"; reason: string }[] };
}

export interface ExternalImportOptions {
  workspace(): Promise<string>;
  worker: Pick<ConversionWorkerHost, "prepare">;
  editorUrl(file?: string): string;
  changed(path: string, kind?: "added" | "changed"): void;
  editors?: AgentEditorBridge;
  layouts?: AgentWorkspaceOptions["layouts"];
  renderPage?: AgentWorkspaceOptions["renderPage"];
  /** Mirrors sessions into the desktop task list; rejecting "open" keeps an agent off a source ChalkLee is converting. */
  track?(event: ExternalConversionEvent): Promise<void>;
}

interface ExternalClient { connectionId?: string; agent?: string; signal?: AbortSignal }

/** Render a ChalkLee through the real editor and print path; at most three page images. `stop` is the request's own stop, such as ChalkLee AI's stop button. */
export async function renderChalkLeePreview(bytes: Uint8Array, pages: number[] | undefined, shutdown: AbortSignal, stop?: AbortSignal) {
  const host = new ImportPreviewHost(), signal = stop ? AbortSignal.any([shutdown, stop]) : shutdown;
  try {
    const value = await host.render(bytes, signal);
    const selected = pages ?? Array.from({ length: Math.min(3, value.pageCount) }, (_, i) => i + 1);
    if (selected.some(page => page > value.pageCount)) throw new Error(`文档共 ${value.pageCount} 页，请选择有效页码；首次预览可省略 pages。`);
    const images = await host.pages(value.pdf, selected, signal);
    // The editor's pages print as the same pages; should they ever differ, the printed count stands.
    const layout = value.layout && value.layout.used.length !== value.pageCount
      ? { ...value.layout, note: `编辑区分为 ${value.layout.used.length} 页，打印为 ${value.pageCount} 页，页数以 pageCount 为准` } : value.layout;
    return { pageCount: value.pageCount, audit: value.audit, layout, unmatchedCss: value.unmatchedCss ?? [], renderedHtml: value.renderedHtml, htmlTruncated: value.htmlTruncated, images: images.images };
  } finally { host.close(); }
}

/** The toolbar's PDF export, rendered without the window. */
export async function renderChalkLeePdf(bytes: Uint8Array, view: PreviewView, signal: AbortSignal) {
  const host = new ImportPreviewHost();
  return host.exportPdf(bytes, AbortSignal.any([signal, AbortSignal.timeout(120_000)]), view);
}

/** Page images and text of an original PDF. */
export async function renderSourcePages(pdf: Uint8Array, pages: number[], shutdown: AbortSignal, stop?: AbortSignal) {
  const host = new ImportPreviewHost();
  try { return await host.source(pdf, pages, AbortSignal.any([shutdown, ...(stop ? [stop] : []), AbortSignal.timeout(60_000)])); }
  finally { host.close(); }
}

export class ExternalImportService {
  private sessions = new Map<string, ExternalSession>();
  private previews = new Map<string, { host: ImportPreviewHost; revision: string; value: AutonomousPreview }>();
  private pending: Promise<unknown> = Promise.resolve();
  private releaseTimer?: ReturnType<typeof setTimeout>;
  private controller = new AbortController();
  readonly workspaceService: AgentWorkspaceService;
  constructor(private readonly options: ExternalImportOptions) {
    this.workspaceService = new AgentWorkspaceService({
      ...options, renderPreview: (bytes, pages, signal) => renderChalkLeePreview(bytes, pages, this.controller.signal, signal),
      renderPdf: (bytes, view) => renderChalkLeePdf(bytes, view, this.controller.signal),
      renderDocx: async (bytes, view) => renderChalkLeeDocx(await readChalkLeeArchive(bytes), view),
      renderSource: (pdf, pages, signal) => renderSourcePages(pdf, pages, this.controller.signal, signal),
      history: async file => readImportHistory(await options.workspace(), file),
      agentName: () => "外部 Agent"
    });
  }
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.pending.then(() => {
      clearTimeout(this.releaseTimer);
      return task();
    });
    // The queue must not retain the last tool response (which can include page images).
    this.pending = next.then(() => undefined, () => undefined).finally(() => {
      this.releaseTimer = setTimeout(() => {
        this.sessions.clear();
        for (const preview of this.previews.values()) preview.host.close();
        this.previews.clear();
      }, 30000);
      this.releaseTimer.unref();
    });
    return next;
  }
  async close() {
    this.controller.abort();
    for (const preview of this.previews.values()) preview.host.close();
    await this.pending;
    clearTimeout(this.releaseTimer); this.sessions.clear(); this.previews.clear();
  }
  private async store(session: ExternalSession) {
    const directory = await openConversionStorage(session.root, "external-imports", session.id);
    const temporary = path.join(directory, `${randomUUID()}.next`);
    try {
      await writeFile(temporary, JSON.stringify(session), { mode: 0o600, flag: "wx" });
      await rename(temporary, path.join(directory, "session.json"));
    } finally { await rm(temporary, { force: true }); }
  }
  private client = new AsyncLocalStorage<ExternalClient>();
  withClient<T>(client: ExternalClient, task: () => Promise<T>): Promise<T> { return this.client.run(client, task); }
  private notify(event: ExternalConversionEvent) {
    void this.options.track?.(event).catch(error => console.error("[external-import:track]", error));
  }
  /** Track actual work separately from the bridge's connection heartbeat. */
  private async duringSession<T>(id: string, task: () => Promise<T>): Promise<T> {
    const client = this.client.getStore();
    await this.options.track?.({ kind: "call-start", sessionId: id, connectionId: client?.connectionId, ...(client?.agent ? { agent: client.agent } : {}) });
    const cancelled = () => this.notify({ kind: "cancelled", sessionId: id });
    client?.signal?.addEventListener("abort", cancelled, { once: true });
    if (client?.signal?.aborted) cancelled();
    try { client?.signal?.throwIfAborted(); return await task(); }
    finally {
      client?.signal?.removeEventListener("abort", cancelled);
      await this.options.track?.({ kind: "call-end", sessionId: id });
    }
  }
  private runSession<T>(id: string, task: () => Promise<T>): Promise<T> {
    const client = this.client.getStore();
    return this.duringSession(id, () => this.run(async () => { client?.signal?.throwIfAborted(); return task(); }));
  }
  private async session(id: string) {
    const session = await this.load(id);
    if (session.stopped) throw new Error("用户已在 ChalkLee 中停止这次转换，不要继续写入。用户要求重新转换时，再调用 conversion_open 建立新会话。");
    return session;
  }
  private remember(session: ExternalSession) {
    // Every successful operation is persisted. Retain only the active source;
    // completed sessions and workspace history need no resident page images.
    this.sessions.clear();
    if (!session.result && !session.stopped) this.sessions.set(session.id, session);
  }
  private async load(id: string, workspaceRoot?: string) {
    if (!/^[\da-f-]{36}$/.test(id)) throw new Error("无效的转换会话 ID。");
    const root = workspaceRoot ?? await realpath(await this.options.workspace());
    let session = this.sessions.get(id);
    if (!session) {
      const directory = await conversionStorageDirectory(root, "external-imports", id);
      const file = path.join(directory, "session.json");
      if ((await lstat(file)).isSymbolicLink()) throw new Error("转换进度不能是符号链接。");
      session = JSON.parse(await readFile(file, "utf8")) as ExternalSession;
      if (session.version !== 1 || session.id !== id || session.root !== root) throw new Error("转换进度与当前工作区不一致。");
      this.remember(session);
    }
    if (session.root !== root) throw new Error("请在 ChalkLee 打开此转换会话所属工作区。");
    return session;
  }
  /** A session of this workspace for listing; null for another workspace's or an unreadable one. */
  private async peek(id: string, root: string) {
    try { return await this.load(id, root); } catch { return null; }
  }
  private async entry(candidate = ".", directory = false) {
    const root = await realpath(await this.options.workspace());
    const entry = await resolveWorkspaceEntry(root, path.resolve(root, candidate));
    if (path.relative(root, entry.path).split(path.sep).some(isIgnoredName)) throw new Error("不能操作应用内部文件。");
    if (directory && entry.kind !== "directory") throw new Error("请选择文件夹。");
    return { root, ...entry };
  }
  openDocument(candidate: string, agent = "外部 Agent") {
    return this.run(async () => {
      this.client.getStore()?.signal?.throwIfAborted();
      const entry = await this.entry(candidate);
      if (entry.kind !== "file" || !/\.(pdf|docx?|tex|md|markdown)$/i.test(entry.path)) throw new Error("请选择工作区中的 PDF、DOC、DOCX、LaTeX 或 Markdown，外部文件先用 document_import 导入。");
      const source = await snapshotConversionSource(entry.root, { sourcePath: entry.path });
      const id = randomUUID();
      // Shown as converting before page rendering, which can take a while on long sources.
      await this.options.track?.({ kind: "open", sessionId: id, agent, connectionId: this.client.getStore()?.connectionId, workspaceRoot: source.workspaceRoot, source: source.source, snapshot: source.snapshot, sourceHash: source.sourceHash });
      return this.duringSession(id, async () => {
        try {
          const input = await this.options.worker.prepare({ ...source, id, attempt: 1 }, this.controller.signal, () => {});
          const title = source.source.name.replace(/\.(pdf|docx?|tex|md|markdown)$/i, "");
          const session: ExternalSession = { version: 1, id, root: entry.root, sourceName: source.source.name, sourceCopy: source.snapshot.path, input,
            template: makeDocument(title, input, path.relative(entry.root, source.snapshot.path).split(path.sep).join("/")), draft: newAutonomousDraft(), viewedPreviewPages: [], agent,
            ...(sourceFormat(source.source.name) === "pdf" ? { pdfSources: { ready: false, pages: [] } } : {}) };
          await this.store(session); this.remember(session);
          return this.describe(session);
        } catch (error) {
          this.notify({ kind: "failed", sessionId: id, error: error instanceof Error ? error.message : "原稿准备失败。" });
          throw error;
        }
      });
    });
  }
  /** The desktop stops an agent's conversion by closing its session; later calls explain why they fail. */
  stopSession(workspaceRoot: string, id: string) {
    return this.run(async () => {
      let session: ExternalSession;
      try { session = await this.load(id, workspaceRoot); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; } // Preparation failed before saving.
      if (session.result || session.stopped) return;
      session.stopped = true; await this.store(session); this.sessions.delete(id);
      this.previews.get(id)?.host.close(); this.previews.delete(id);
    });
  }
  private describe(session: ExternalSession) {
    const sourceKind = sourceFormat(session.sourceName);
    const units = session.input.units.map(unit => ({ unitId: unit.id, page: unit.page, label: unit.label,
      sourceMode: session.pdfSources && !session.pdfSources.ready ? session.pdfSources.pages.some(page => page.unitId === unit.id) ? "prepared-source" : "pending-source" : unit.nativeReferences ? "native-references" : "page-image",
      hasTextLayer: Boolean(unit.text?.trim()),
      ...(sourceKind === "pdf" ? { nativeCandidate: unit.pdfText?.candidate ?? false, recommendedMode: unit.pdfText?.candidate ? "native-check" : "transcript", reason: unit.pdfText?.reason } : {}) }));
    return { sessionId: session.id, source: session.input.sourcePath, previewUrl: this.options.editorUrl(session.input.sourcePath),
      sourceKind, unitCount: units.length, units,
      ...(sourceKind === "pdf" ? { pageCount: units.length } : {}), warnings: session.input.warnings,
      ...(session.pdfSources ? { sourcePreparation: this.sourcePreparation(session) } : {}),
      revision: session.draft.revision, fragments: session.draft.fragments.map(({ key, order, unitIds }) => ({ key, order, unitIds })), result: session.result };
  }
  private sourcePreparation(session: ExternalSession) {
    if (!session.pdfSources) return undefined;
    const prepared = new Set(session.pdfSources.pages.map(page => page.unitId));
    return { ready: session.pdfSources.ready, preparedUnits: [...prepared], pendingUnits: session.input.units.filter(unit => !prepared.has(unit.id)).map(unit => unit.id),
      next: session.pdfSources.ready ? "read_source 读取固定引用，每次最多十二个部分；按完整题或题组写入 fragments，完成后 finish 自动检查并保存。"
        : "read_source 每次查看最多三张完整原页，然后 write_fragments.sourcePages 保存这三页。box 仅用于放大，不能代替完整原页。已准备页面无需重复识别。" };
  }
  listSessions() {
    return this.run(async () => {
      const root = await realpath(await this.options.workspace());
      const sessions = [];
      // Sessions are kept with the app for every workspace; list this workspace's.
      for (const id of await conversionStorageNames(root, "external-imports")) {
        const session = await this.peek(id, root);
        if (!session) continue;
        sessions.push({ sessionId: id, source: session.input.sourcePath, revision: session.draft.revision, result: session.result?.file.path, ...(session.stopped ? { stopped: true } : {}) });
      }
      return sessions;
    });
  }
  readSource(id: string, sources: { unitId: string; sourceImageId?: string; box?: PixelBox }[], includeContent = false) {
    return this.runSession(id, async () => {
      const session = await this.session(id), output = [];
      if (!sources.length || sources.length > 12) throw new Error("每次最多读取十二个部分的引用。");
      const pictures = sources.filter(selected => {
        const unit = session.input.units.find(unit => unit.id === selected.unitId);
        return !unit?.nativeReferences || session.pdfSources && !session.pdfSources.ready || selected.sourceImageId || selected.box;
      });
      if (pictures.length > 3) throw new Error("实际图像每次最多查看三张；固定引用每次可读取十二个部分。");
      for (const selected of sources) {
        const unit = session.input.units.find(unit => unit.id === selected.unitId);
        if (!unit) throw new Error("原稿部分不存在。");
        if (unit.nativeReferences && (!session.pdfSources || session.pdfSources.ready) && !selected.sourceImageId && !selected.box) {
          if (!session.draft.seenUnits.includes(unit.id)) session.draft.seenUnits.push(unit.id);
          const working = workingReferenceInput(session.input, session.draft.sourceRevisions).units.find(item => item.id === unit.id)!;
          // Text and layout labels are enough to organize questions; node trees are only needed to locate a correction.
          const blocks = new Map(working.blocks.map(block => [block.attrs.id, block]));
          const sourceEntries = wordSourceEntries(working.blocks, working.sourceRoles, working.sourceQuestionNumbers).map(entry => {
            const labels = sourceLayoutLabels(blocks.get(entry.ref), entry.text);
            return labels.length ? { ...entry, labels } : entry;
          });
          output.push({ unitId: unit.id, label: unit.label, page: unit.page, sourceMode: "native-references", sourceEntries,
            ...(includeContent ? { blocks: working.blocks, ...(session.draft.sourceRevisions?.some(revision => revision.unitId === unit.id) ? { originalBlocks: unit.blocks } : {}) } : {}), sourceRevisions: sourceRevisionChanges(session.draft.sourceRevisions),
            images: unit.images.map(image => ({ id: image.id, role: image.role, widthPt: image.widthPt, heightPt: image.heightPt, sourcePixelSize: importImageSize(image.dataUrl) })) });
          continue;
        }
        // While a page is prepared, figure candidates found in its pixels are listed and can be viewed like any source image.
        const preparing = !!session.pdfSources && !session.pdfSources.ready && !session.pdfSources.pages.some(page => page.unitId === unit.id);
        const sourceImages = preparing && unit.page ? pdfFigureRepairCandidates(unit).images : unit.images;
        const image = sourceImages.find(image => image.id === (selected.sourceImageId ?? unit.id));
        if (!image) throw new Error("原稿图片不存在。原生配图的局部图像请提供 sourceImageId；查看整个部分时不传 box。");
        const size = importImageSize(image.dataUrl);
        const region = selected.box ? importCropRect(image.dataUrl, pixelCropBox(selected.box, size)) : undefined;
        const seen = (session.viewedSourceImages ??= {});
        const imageHash = sourceImageHash(session.input, unit, image);
        seen[image.id] = { hash: imageHash, full: !selected.box || seen[image.id]?.hash === imageHash && seen[image.id].full };
        if (!selected.box && image.id === unit.id && !session.draft.seenUnits.includes(unit.id)) session.draft.seenUnits.push(unit.id);
        output.push({ unitId: unit.id, ...(!unit.pdfText ? { textLayer: unit.text } : {}), nativeText: pdfNativeCheckLines(unit), nativeCandidate: unit.pdfText?.candidate ?? false, nativeReason: unit.pdfText?.reason, omittedMargins: unit.pdfText?.omittedMargins,
          fullPageViewed: Boolean(seen[unit.id]?.full), sourceMode: session.pdfSources && !session.pdfSources.ready ? "pending-source" : "page-image",
          images: sourceImages.filter(image => !image.id.endsWith("_context")).map(({ dataUrl: _pixels, ...image }) => image), imageBounds: "pageBounds 为整页 0–1000 的 [x,y,宽,高]", sourcePixelSize: size, pixelRect: region?.rect ?? { x: 0, y: 0, ...size },
          dataUrl: region ? region.image.crop(region.rect).toDataURL() : image.dataUrl });
      }
      await this.store(session); return output;
    });
  }
  cropFigures(id: string, figures: { id: string; unitId: string; sourceImageId?: string; box: PixelBox; alt: string; widthPt?: number }[]) {
    return this.runSession(id, async () => {
      const session = await this.session(id), next = cloneSession(session);
      if (!proofreadable(next)) throw new Error("此转换已交付，请创建新会话。");
      if (next.pdfSources && !next.pdfSources.ready) throw new Error("请先在 sourcePages.transcript 中定位题图并固定全部页面引用。");
      if (new Set(figures.map(figure => figure.id)).size !== figures.length) throw new Error("同批裁图 ID 不能重复。");
      const output = [];
      for (const figure of figures) {
        const unit = next.input.units.find(unit => unit.id === figure.unitId);
        const image = unit?.images.find(image => image.id === (figure.sourceImageId ?? unit.id));
        if (!unit || !image || !next.draft.seenUnits.includes(unit.id)) throw new Error("请先 read_source 查看对应完整原稿。");
        if (next.input.units.some(unit => unit.images.some(image => image.id === figure.id))) throw new Error("裁图 ID 不能覆盖原稿图片。");
        const original = importCropRect(image.dataUrl, [0, 0, 1000, 1000]), crop = pixelCropBox(figure.box, original.size);
        if (crop[2] * crop[3] > 850000) throw new Error("请只裁取配图，正文和公式应转为可编辑内容。");
        const value = { id: figure.id, unitId: figure.unitId, sourceImageId: figure.sourceImageId, alt: figure.alt, widthPt: figure.widthPt, crop };
        next.draft.figures = [...next.draft.figures.filter(previous => previous.id !== figure.id), value];
        const region = importCropRect(image.dataUrl, crop);
        const bitmap = original.image.toBitmap();
        output.push({ id: figure.id, dataUrl: autonomousFigureImage(next.input, value).dataUrl,
          contextDataUrl: cropContextBitmap(bitmap, original.size, region.rect).dataUrl, pixelRect: region.rect,
          sourcePixelSize: original.size, cutEdges: cutCropEdges(bitmap, original.size, region.rect), revision: next.draft.revision + 1 });
      }
      next.draft.revision++; await this.store(next); this.remember(next); return output;
    });
  }
  writeFragments(id: string, update: { expectedRevision: number; sourcePages?: ExternalPdfSourcePage[]; fragments?: AutonomousFragment[]; edits?: AutonomousEdit[]; sourceEdits?: SourceFragmentEdit[]; removeKeys?: string[]; layout?: AutonomousLayout }) {
    return this.runSession(id, async () => {
      const session = await this.session(id), next = cloneSession(session);
      if (!proofreadable(session)) throw new Error("此转换已交付，请创建新会话。");
      if (update.expectedRevision !== session.draft.revision) throw new Error("转换进度已变化，请 read_draft 后按最新 revision 重试。");
      if (update.sourcePages?.length) {
        if (session.result || !next.pdfSources || next.pdfSources.ready) throw new Error("来源片段已固定或已交付，请读取现有 ref；交付前局部修订使用 sourceEdits。");
        if (update.fragments?.length || update.edits?.length || update.sourceEdits?.length || update.removeKeys?.length || update.layout) throw new Error("请先单独保存 sourcePages；读取固定引用后再组题。");
        if (update.sourcePages.length > 3 || new Set(update.sourcePages.map(page => page.unitId)).size !== update.sourcePages.length) throw new Error("每次最多保存三个不同页面的来源。");
        for (const source of update.sourcePages) {
          const index = next.input.units.findIndex(unit => unit.id === source.unitId), unit = next.input.units[index];
          if (!unit || next.pdfSources.pages.some(page => page.unitId === source.unitId)) throw new Error("原稿页不存在或已固定，请读取已有引用。");
          const frozen = freezeExternalPdfSource(unit, source, image => {
            const seen = session.viewedSourceImages?.[image.id];
            return Boolean(seen?.full && seen.hash === sourceImageHash(session.input, unit, image));
          });
          const errors = chalkLeeSchemaErrors({ ...next.template, content: { type: "doc", content: frozen.unit.blocks } });
          if (errors.length) throw new Error(`来源片段格式无效：${errors.slice(0, 3).join("；")}`);
          next.input.units[index] = frozen.unit; next.input.warnings.push(...frozen.warnings);
          next.pdfSources.pages.push({ unitId: unit.id, recognition: frozen.recognition, reason: frozen.reason });
        }
        next.pdfSources.ready = next.pdfSources.pages.length === next.input.units.length;
        if (next.pdfSources.ready) assignPdfSourceRoles(next.input.units);
        next.input.warnings = [...new Set(next.input.warnings)];
        // Reading page pixels is different from reading the newly fixed refs.
        next.draft.seenUnits = []; next.draft.revision++;
        await this.store(next); this.remember(next);
        // Grouping has not started. Missing refs at this stage are expected,
        // not hundreds of repair instructions to repeat after every page.
        return { revision: next.draft.revision, sourcePreparation: this.sourcePreparation(next), sourceRevisions: [], sourceRevisionCount: 0, summary: { mainQuestions: [] as string[], subquestions: 0, options: 0, tables: 0, formulas: 0, images: 0 }, answers: undefined, issues: [] as string[] };
      }
      if (next.pdfSources && !next.pdfSources.ready) throw new Error("请先用 write_fragments.sourcePages 保存全部 PDF 页面内容，再 read_source 读取固定 ref 组题。");
      if (!update.fragments?.length && !update.edits?.length && !update.sourceEdits?.length && !update.removeKeys?.length && !update.layout) throw new Error("请提供要写入或修改的内容。");
      if (update.sourceEdits?.length) {
        if (session.result) throw new Error("转换已交付，后续修改请通过文档编辑完成，不能回改来源片段。");
        const working = workingReferenceInput(session.input, session.draft.sourceRevisions);
        if (update.sourceEdits.some(edit => !working.units.some(unit => next.draft.seenUnits.includes(unit.id) && unit.blocks.some(block => block.attrs.id === edit.ref)))) throw new Error("请先读取待修订片段的完整原文。");
        next.draft.sourceRevisions = appendSourceRevisions(session.input, next.draft.sourceRevisions ?? [], update.sourceEdits, (unit, image, full) => {
          const seen = session.viewedSourceImages?.[image.id];
          return Boolean(seen && seen.hash === sourceImageHash(session.input, unit, image) && (!full || seen.full));
        });
      }
      const fragments = update.fragments ?? [], removals = update.removeKeys ?? [], edits = update.edits ?? [];
      if (new Set(fragments.map(fragment => fragment.key)).size !== fragments.length) throw new Error("片段 key 不能重复。");
      if (edits.some(edit => removals.includes(edit.key) || fragments.some(fragment => fragment.key === edit.key))) throw new Error("同批不能完整替换和局部修改同一片段。");
      if (removals.some(key => !next.draft.fragments.some(fragment => fragment.key === key))) throw new Error("删除的片段不存在。");
      next.draft.fragments = next.draft.fragments.filter(fragment => !removals.includes(fragment.key));
      for (const fragment of fragments) {
        if (!fragment.unitIds.length || fragment.unitIds.some(unit => !next.draft.seenUnits.includes(unit))) throw new Error("只能写入已经查看整页的原稿内容。");
        next.draft.fragments = [...next.draft.fragments.filter(value => value.key !== fragment.key), { ...fragment, warnings: fragment.warnings ?? [], continuesPrevious: fragment.continuesPrevious ?? false }];
      }
      if (edits.length) next.draft.fragments = applyAutonomousEdits(next.draft.fragments, edits, new Set(next.draft.seenUnits));
      if (update.layout) { validateAutonomousLayout(update.layout); next.draft.layout = { ...next.draft.layout, ...update.layout }; }
      if (next.draft.fragments.length > 2000 || JSON.stringify(next.draft.fragments).length > 8000000) throw new Error("转换内容过大，请拆分文档。");
      next.draft.sourceChecks = next.input.units.flatMap(unit => {
        const fragments = next.draft.fragments.filter(fragment => fragment.unitIds.includes(unit.id));
        return fragments.length ? [{ unitId: unit.id, fragmentKeys: fragments.map(fragment => fragment.key), questionNumbers: [], note: "外部 Agent 写入的来源归属，内容须由外部 Agent 对照原稿核对。" }] : [];
      });
      next.draft.revision++;
      const compiled = compileAutonomousDraft(next.input, next.template, next.draft);
      await this.store(next); this.remember(next);
      return { revision: next.draft.revision, sourcePreparation: this.sourcePreparation(next), sourceRevisions: sourceRevisionChanges(next.draft.sourceRevisions), sourceRevisionCount: next.draft.sourceRevisions?.length ?? 0, summary: compiled.summary, answers: compiled.answers,
        ...assemblyProgress(next.input, next.draft, assessAutonomousDraft(next.input, next.draft, compiled)) };
    });
  }
  readDraft(id: string, keys?: string[]) {
    return this.runSession(id, async () => {
      const session = await this.session(id), compiled = compileAutonomousDraft(session.input, session.template, session.draft);
      const preparing = !!session.pdfSources && !session.pdfSources.ready;
      const issues = preparing ? [] : assessAutonomousDraft(session.input, session.draft, compiled);
      const tagging = !session.result && (!session.pdfSources || session.pdfSources.ready) && !issues.length
        ? await conversionTaggingRequest(session.root, compiled.document, path.relative(session.root, session.input.sourcePath)) : null;
      return { ...this.describe(session), fragments: session.draft.fragments.filter(fragment => !keys || keys.includes(fragment.key)), figures: session.draft.figures,
        sourceRevisions: sourceRevisionChanges(session.draft.sourceRevisions), sourceRevisionCount: session.draft.sourceRevisions?.length ?? 0,
        summary: compiled.summary, answers: compiled.answers, ...(preparing ? { issues } : assemblyProgress(session.input, session.draft, issues)), ...(tagging ? { tagging: { ...tagging, revision: session.draft.revision } } : {}), layout: session.draft.layout };
    });
  }
  private async renderPreview(session: ExternalSession, compiled = compileAutonomousDraft(session.input, session.template, session.draft)) {
    const revision = autonomousRevision(session.draft);
    let preview = this.previews.get(session.id);
    if (!preview || preview.revision !== revision) {
      const host = new ImportPreviewHost();
      try {
        const value = await host.render(await validatedImportArchive(compiled.document, compiled.assets), this.controller.signal);
        preview = { host, revision, value }; this.previews.get(session.id)?.host.close(); this.previews.set(session.id, preview);
        if (session.previewRevision !== revision) session.viewedPreviewPages = [];
        session.previewRevision = revision;
      } catch (error) { host.close(); throw error; }
    }
    return preview;
  }
  preview(id: string, pages?: number[]) {
    return this.runSession(id, async () => {
      const session = await this.session(id);
      if (session.pdfSources && !session.pdfSources.ready) throw new Error("PDF 来源尚未固定，请先保存全部 sourcePages 并按引用组题。");
      const preview = await this.renderPreview(session);
      const selected = pages ?? Array.from({ length: Math.min(3, preview.value.pageCount) }, (_, index) => index + 1);
      if (selected.some(page => page > preview!.value.pageCount)) throw new Error("预览页码超出范围。");
      const images = await preview.host.pages(preview.value.pdf, selected, this.controller.signal);
      session.viewedPreviewPages = [...new Set([...session.viewedPreviewPages, ...selected])];
      await this.store(session);
      return { pageCount: preview.value.pageCount, revision: session.draft.revision, audit: preview.value.audit,
        remainingPages: Array.from({ length: preview.value.pageCount }, (_, index) => index + 1).filter(page => !session.viewedPreviewPages.includes(page)), images: images.images };
    });
  }
  finish(id: string, agentName: string, draft = false, tags?: ExternalConversionTags & { revision: number }) {
    return this.runSession(id, async () => {
      let session = await this.session(id);
      const proofreading = !!session.result;
      if (session.result && (draft || !proofreadable(session) || session.deliveredRevision === autonomousRevision(session.draft))) return { ...session.result, previewUrl: this.options.editorUrl(session.result.file.path) };
      if (tags && tags.revision !== session.draft.revision) throw new Error("标签对应的转换进度已变化，请 read_draft 后重新确认分类。");
      if (tags && (draft || proofreading)) throw new Error("知识点标签随首次完整转换交付，已交付文档请使用正常题目编辑。");
      if (!draft && session.pdfSources && !session.pdfSources.ready) throw new Error("请先固定全部 PDF sourcePages，再读取引用并完成组题。");
      if (draft && session.pdfSources && !session.pdfSources.ready) {
        session = cloneSession(session);
        for (const unit of session.input.units.filter(unit => !unit.nativeReferences)) {
          const page = unit.images.find(image => image.id === unit.id);
          if (!page) throw new Error("PDF 缺少原页，无法保留未完成内容。");
          const fallback = preserveImportPage(unit, page);
          unit.blocks = fallback.blocks; unit.nativeReferences = true;
          unit.images = [page, { id: fallback.asset.id, dataUrl: page.dataUrl, widthPt: page.widthPt, heightPt: page.heightPt }];
          session.pdfSources!.pages.push({ unitId: unit.id, recognition: "source-image", reason: "识别尚未完成，保留原页图像" });
        }
        assignPdfSourceRoles(session.input.units); session.pdfSources!.ready = true;
      }
      const compiled = draft && session.input.units.every(unit => unit.nativeReferences)
        ? compileUnfinishedReferenceDraft(session.input, session.template, session.draft)
        : compileAutonomousDraft(session.input, session.template, session.draft, draft);
      const issues = assessAutonomousDraft(session.input, session.draft, compiled);
      if (!draft) {
        // As for ChalkLee AI: missing content, a failed structure check and answer conflicts always stop delivery.
        const blocking = issues.filter(issue => FINISH_BLOCKING.test(issue));
        blocking.push(...compiled.notices.filter(notice => /答案(?:章节不一致|已有答案或解析)/.test(notice.message)).map(notice => notice.message));
        if (blocking.length) throw new Error(blocking.join("\n"));
        const preview = await this.renderPreview(session, compiled);
        if (preview.value.audit.issues.length) throw new Error(preview.value.audit.issues.join("\n"));
        // Other issues are asked about once; the same draft finished again is what the original says, and the
        // teacher sees the conversion's own notes about it (such as two copies of a question kept for checking).
        const revision = autonomousRevision(session.draft);
        if (issues.length && session.finishRevision !== revision) {
          session.finishRevision = revision; await this.store(session);
          throw new Error(`${issues.join("\n")}\n请对照原稿处理；确认原稿本来如此、无法再改时，不修改直接再次调用 finish。`);
        }
      } else compiled.notices.push(...issues.map(message => ({ message })));
      const title = session.sourceName.replace(/\.(pdf|docx?|tex|md|markdown)$/i, ""), credentials = { model: `external:${agentName}`, baseUrl: "external-agent", apiKey: "" };
      if (proofreading) {
        // A second delivery is the proofread of the draft the teacher already has: it goes into that document in place.
        const proofread = finalizeImportDocument({ input: session.input, title, sourceName: session.sourceName, credentials }, compiled.document, compiled.assets, compiled.notices,
          { strategy: "autonomous-v1", status: "converted", proofread: "done", ...(session.input.units.every(unit => unit.nativeReferences) ? { sourceReferences: true } : {}), ...(session.draft.sourceRevisions?.length ? { sourceRevisions: session.draft.sourceRevisions } : {}), structureModel: `external:${agentName}`, calls: [], cachedUnits: 0,
            answers: compiled.answers, agent: { rounds: 0, resumed: false, actions: [], previewPages: this.previews.get(id)?.value.pageCount ?? 0 } });
        const updated = await applyProofread({ root: session.root, file: session.result!.file, by: agentName, editors: this.options.editors, changed: this.options.changed }, proofread);
        session.result = { file: updated.file, record: updated.record }; session.deliveredRevision = autonomousRevision(session.draft); await this.store(session);
        this.notify({ kind: "finished", sessionId: id, result: session.result });
        this.previews.get(id)?.host.close(); this.previews.delete(id); this.sessions.delete(id);
        return { ...session.result, previewUrl: this.options.editorUrl(updated.file.path), proofread: { applied: updated.applied, keptTeacherEdits: updated.kept } };
      }
      const result = await saveImportDocument({ root: session.root, input: session.input, title, sourceName: session.sourceName, credentials }, compiled.document, compiled.assets, compiled.notices,
        { strategy: "autonomous-v1", status: draft ? "draft" : "converted", ...(session.input.units.every(unit => unit.nativeReferences) ? { sourceReferences: true } : {}), ...(session.draft.sourceRevisions?.length ? { sourceRevisions: session.draft.sourceRevisions } : {}), structureModel: `external:${agentName}`, calls: [], cachedUnits: 0,
          answers: compiled.answers, agent: { rounds: 0, resumed: false, actions: [], previewPages: this.previews.get(id)?.value.pageCount ?? 0 } }, this.controller.signal, () => {}, tags);
      session.result = result; session.deliveredRevision = autonomousRevision(session.draft); await this.store(session); this.remember(session); this.options.changed(result.file.path);
      this.notify({ kind: "finished", sessionId: id, result });
      this.previews.get(id)?.host.close(); this.previews.delete(id);
      return { ...result, previewUrl: this.options.editorUrl(result.file.path),
        ...(draft ? {} : { next: "转换完成。请打开结果，简短报告文档位置和已知待核对项，然后结束本次转换。" }) };
    });
  }
  async editorUrl(candidate?: string) {
    const entry = candidate ? await this.entry(candidate) : undefined;
    return { previewUrl: this.options.editorUrl(entry?.path) };
  }
}
