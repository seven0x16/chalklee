import { documentKindFamily, isHtmlKind, isLatexKind, isMarkdownKind, type DocumentKind } from "../../shared/document/kinds";
import { decodeLatexSource } from "../../shared/latex/source";
import { readMarkdownSource, decodeMarkdownFile, encodeMarkdownFile, markdownRevision } from "../../shared/markdown/source";
import { lstat, readdir, readFile, realpath, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { parseWord, type WordBlock } from "@chalklee/word";
import { chalkLeeOwnAppearanceItems, chalkLeePageDecorationArea, chalkLeePageSize, createChalkLeeArchive, normalizeChalkLeeDocument, readChalkLeeArchive, readChalkLeeArchiveMetadata, validateChalkLeeSemantics, type ChalkLeeArchiveAssetInput } from "@chalklee/format";
import { assertImportDocument, validatedImportArchive } from "../../shared/conversion/importDocument";
import { agentDocumentRevision, agentQuestionInventory, patchAgentQuestions, type AgentTextSnapshot, type AgentEditorSnapshot, type AgentQuestionEdit } from "../../shared/agent/editing";
import type { AgentEditorBridge } from "./editorBridge";
import type { ChalkLeeDocument } from "@chalklee/format";
import { AGENT_DESIGN_GUIDE, patchAgentDesign, type AgentDesignPatch } from "../../shared/agent/design";
import { createEmptyChalkLeeDocument } from "../../shared/document/newDocument";
import { chalkLeeLayoutFromDocument, chalkLeeLayoutName, type ChalkLeeLayout } from "../../shared/document/layouts";
import { workspaceEntryName } from "../../shared/workspace/names";
import { createWorkspaceChalkLee, createWorkspaceDirectory, documentKind, isIgnoredName, readWorkspaceDocument, resolveWorkspaceEntry, scanWorkspace, writeWorkspaceDocument } from "../workspace/files";
import { applyHtmlEdits, createWorkspacePage, readWorkspacePage, writeWorkspacePage } from "../workspace/htmlPages";
import type { HtmlPageShots } from "../workspace/htmlPageShots";
import type { HtmlPageStep } from "../workspace/htmlPages";
import { EXPORT_SUFFIX } from "../workspace/pdfExport";
import { agentDocumentOutline, agentDocumentText, insertAgentBlocks, moveAgentNodes, removeAgentNodes, updateAgentBlocks, type AgentBlockEdit, type AgentContentPosition } from "../../shared/agent/documentEditing";
import { agentContentBlocks } from "./content";
import { AGENT_IMAGE_FILE, hasAgentImages, resolveAgentImages, type AgentImageSources } from "./images";
import type { ImportHistory } from "../../shared/conversion/types";
import type { DocumentVersionReason } from "../../shared/document/versions";
import { questionReviewNotices } from "../../shared/conversion/questionReview";
import type { PreviewView, SourcePages } from "../conversion/previewHost";
import { chalkLeeFixedNumberRunsAfterEdit, chalkLeeSequentialNumbersAsAuto } from "../../shared/document/numbering";
import type { DocumentOutputOptions } from "../../shared/document/output";
import { questionAttributeValues, questionAttributesOf, questionCopyPatch, questionPaperName, type QuestionAttributeChange, type QuestionCopyEdit } from "../../shared/questionBank/search";
import { editedQuestionNode, questionContentKey, questionCopyWithEdit, questionFaceKey, type QuestionContentChange, type QuestionContentNode, type QuestionForEdit } from "../../shared/questionBank/contentEdit";

/** Picture sources available for an edit besides PDF pages in the workspace. */
export interface ImagePictures { attachment?: AgentImageSources["attachment"]; outside?: boolean }

/** One question's tags before and after a tag rename. */
export interface TagChange { questionId: string; before: string[]; after: string[] }
/** A block edit as the tools receive it: a replacement in the concise content format, or words to change. */
export type AgentBlockEditInput = { id: string; block: unknown } | { id?: string; find: string; replace: string }
  | { wrap: string[]; label?: string; style?: string } | { id: string; label?: string | null; style?: string | null; unwrap?: boolean; role?: string | null };
export interface AgentExportOptions extends DocumentOutputOptions { answers: boolean; analysis: boolean; name?: string; format?: "pdf" | "docx" }

export interface AgentWorkspaceOptions {
  workspace(): Promise<string>;
  editorUrl(file?: string): string;
  changed(path: string, kind?: "added" | "changed"): void;
  editors?: AgentEditorBridge;
  renderPreview?(bytes: Uint8Array, pages?: number[], signal?: AbortSignal): Promise<unknown>;
  /** The real print path, as the toolbar's 导出 with answers or analysis shown or hidden. */
  renderPdf?(bytes: Uint8Array, view: PreviewView): Promise<Uint8Array>;
  renderDocx?(bytes: Uint8Array, view: PreviewView): Promise<Uint8Array>;
  /** Page images and text of an original PDF. */
  renderSource?(pdf: Uint8Array, pages: number[], signal?: AbortSignal): Promise<SourcePages>;
  /** Screens of a workspace HTML page as it runs, with the errors it reported. */
  renderPage?(file: string, screens?: number[], steps?: HtmlPageStep[]): Promise<HtmlPageShots>;
  /** Built-in and saved layouts, for document_style_read and applying one by name. */
  layouts?: { list(): Promise<Array<ChalkLeeLayout & { builtIn: boolean }>>; find(name: string): Promise<ChalkLeeLayout | null>; save(layout: ChalkLeeLayout): Promise<unknown> };
  /** The conversion record of a converted ChalkLee, for its questions still to be checked. */
  history?(file: string): Promise<ImportHistory | null>;
  /** Who edits through this service, for the version kept before each edit (e.g. "ChalkLee AI", "外部 Agent"). */
  agentName?(): string;
  /** How the version kept before each edit is labelled; the teacher's own edits elsewhere in the app count as editing. */
  version?: { reason: DocumentVersionReason; by?: string };
  /**
   * One run of ChalkLee AI: its edits to an open paper undo in one step, and each edited document's content
   * from before the run is kept so the run can be undone from its reply.
   */
  editGroup?: string;
}

interface RunEdit { name: string; before: Uint8Array; revision: string; mixed: boolean; page?: true; markdown?: true }
/** Workspace-relative paths put back, and those left as they are with the reason. */
export interface AgentRunUndo { restored: string[]; skipped: Array<{ path: string; reason: string }> }

const DOCX_TEXT_LIMIT = 8000;
const MAX_PICTURE_FILE_BYTES = 20 * 1024 * 1024;
const SYSTEM_LITTER = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

/** Plain paragraphs of a Word document, for telling what it is without converting it. */
async function docxText(data: Uint8Array) {
  const zip = await JSZip.loadAsync(data);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("文件不是有效 DOCX。");
  const decode = (text: string) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map(match => [...match[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<m:t(?: [^>]*)?>([^<]*)<\/m:t>/g)].map(part => part[1] ?? (part[2] !== undefined ? part[2] : "\t")).join(""))
    .map(text => decode(text).trim()).filter(Boolean);
  const text = paragraphs.join("\n");
  return { paragraphs: paragraphs.length, text: text.slice(0, DOCX_TEXT_LIMIT), truncated: text.length > DOCX_TEXT_LIMIT };
}

/** General document operations, independent of conversion sessions and models. */
export class AgentWorkspaceService {
  private pending: Promise<unknown> = Promise.resolve();
  /** Documents this run edited, in the order first edited. */
  private readonly runEdits = new Map<string, RunEdit>();
  constructor(private readonly options: AgentWorkspaceOptions) {}

  /** The documents this run changed, relative to the workspace. */
  editedDocuments() {
    return [...this.runEdits.values()].map(edit => edit.name);
  }

  /**
   * Puts back each document this run changed as it was before the run, unless it has changed since or was also
   * changed by someone else during the run. Putting back is itself an edit, kept as a version and undoable in the paper.
   */
  async undoRunEdits(): Promise<AgentRunUndo> {
    const restored: string[] = [], skipped: AgentRunUndo["skipped"] = [];
    for (const [file, edit] of [...this.runEdits].reverse()) {
      const name = edit.name;
      try {
        if (edit.markdown) {
          if (edit.mixed) throw new Error("修改期间文档还有其他改动，请在文档中撤销");
          await this.updatePage(file, edit.revision, { html: readMarkdownSource(edit.before) });
          restored.push(name); continue;
        }
        if (edit.page) {
          if (edit.mixed) throw new Error("修改期间网页还有其他改动，没有恢复");
          await this.run(async () => {
            const root = await this.options.workspace();
            if ((await readWorkspacePage(root, file)).revision !== edit.revision) throw new Error("之后又有修改，没有恢复");
            await writeWorkspacePage(root, file, edit.before, edit.revision, { reason: "restore" });
            this.options.changed(file, "changed");
          });
          restored.push(name);
          continue;
        }
        if (edit.mixed) throw new Error("修改期间文档还有其他改动，请在文档中撤销");
        const current = await this.currentDocument(file);
        if (current.revision !== edit.revision) throw new Error("之后又有修改，请在文档中撤销");
        const before = await readChalkLeeArchive(edit.before);
        const assets = before.manifest.assets.map(asset => ({ id: asset.id, path: asset.path, mediaType: asset.mediaType, data: before.assets[asset.id] }));
        await this.updateDocument(file, edit.revision, () => before.document, [], "document", assets, { notice: "已撤销 ChalkLee AI 的这次修改", ownStep: true });
        restored.push(name);
      } catch (error) {
        skipped.push({ path: name, reason: error instanceof Error ? error.message : "无法撤销" });
      }
    }
    this.runEdits.clear();
    return { restored, skipped };
  }
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.pending.then(task, task); this.pending = next.catch(() => undefined); return next;
  }
  private async entry(candidate = ".", directory = false) {
    const root = await realpath(await this.options.workspace());
    const requested = path.resolve(root, candidate);
    if ((await lstat(requested)).isSymbolicLink()) throw new Error("不能操作符号链接。");
    const entry = await resolveWorkspaceEntry(root, requested);
    if (path.relative(root, entry.path).split(path.sep).some(isIgnoredName)) throw new Error("不能操作应用内部文件。");
    if (directory && entry.kind !== "directory") throw new Error("请选择文件夹。");
    if (!directory && entry.kind === "file" && !documentKind(entry.path)) throw new Error("仅支持 PDF、Word、Markdown、HTML 和 ChalkLee 文档。");
    return { root, ...entry };
  }
  /** The workspace this service currently works in. */
  async root() { return realpath(await this.options.workspace()); }
  async list(directory = ".") { const entry = await this.entry(directory, true); return scanWorkspace(entry.path, { workspaceRoot: entry.root }); }
  async search(query: string, directory = ".", kind?: DocumentKind, limit = 100) {
    const snapshot = await this.list(directory);
    const matches: { name: string; path: string; kind: string; size?: number; modifiedAt?: number }[] = [];
    let total = 0;
    const visit = (node: typeof snapshot.root.children[number]) => {
      if ((!kind || node.kind === "file" && documentKindFamily(node.extension) === documentKindFamily(kind)) && node.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) {
        total++;
        if (matches.length < limit) matches.push({ name: node.name, path: node.path, kind: node.kind === "file" ? node.extension : "directory", modifiedAt: node.modifiedAt, ...(node.kind === "file" ? { size: node.size } : {}) });
      }
      if (node.kind === "directory") node.children.forEach(visit);
    };
    snapshot.root.children.forEach(visit);
    return { root: snapshot.root.path, matches, total, truncated: total > matches.length };
  }
  async info(candidate: string) {
    const entry = await this.entry(candidate), stats = await lstat(entry.path);
    return { name: path.basename(entry.path), path: entry.path, relativePath: entry.relativePath, kind: entry.kind === "file" ? documentKind(entry.path)! : "directory", size: stats.size, modifiedAt: stats.mtimeMs, editable: documentKind(entry.path) === "chalklee" || isMarkdownKind(documentKind(entry.path) ?? ""), previewUrl: this.options.editorUrl(entry.path) };
  }
  createFolder(directory: string, name: string) {
    return this.run(async () => { const entry = await this.entry(directory, true), result = await createWorkspaceDirectory(entry.root, entry.path, name); this.options.changed(result.path); return result; });
  }
  createDocument(directory: string, name: string, blocks?: unknown[]) {
    return this.run(async () => {
      const entry = await this.entry(directory, true), title = name.replace(/\.chalklee$/i, "").trim();
      const empty = createEmptyChalkLeeDocument(title), nodes = blocks?.length ? agentContentBlocks(blocks) : [];
      // Content opening with a first-level heading names the document: it becomes the title line,
      // in the title's standard look, instead of a second title under it.
      const [first] = nodes, heading = empty.content.content[0];
      if (first?.type === "heading" && first.attrs.level === 1 && heading.type === "heading" && heading.content?.[0]?.type === "text") {
        const text = (first.content ?? []).map(node => node.type === "text" ? node.text : "").join("").trim();
        if (text && first.content?.every(node => node.type === "text")) { heading.content = [{ ...heading.content[0], text }]; nodes.shift(); }
      }
      const document = nodes.length ? insertAgentBlocks(empty, nodes, { at: "end" }) : empty;
      const bytes = await validatedImportArchive(document, []);
      const result = await createWorkspaceChalkLee(entry.root, entry.path, name, Uint8Array.from(bytes).buffer);
      this.options.changed(result.path); return { ...result, previewUrl: this.options.editorUrl(result.path) };
    });
  }
  createPage(directory: string, name: string, html: string, markdown = false) {
    return this.run(async () => {
      const entry = await this.entry(directory, true), { path: created, revision } = await createWorkspacePage(entry.root, entry.path, name, html, markdown);
      this.options.changed(created); return { path: created, revision };
    });
  }
  async readPage(candidate: string) {
    const info = await this.info(candidate);
    if (!isHtmlKind(info.kind)) throw new Error("只能读取 HTML 页面。");
    const { data: _data, ...page } = await readWorkspacePage(await this.options.workspace(), info.path);
    return page;
  }
  /** The page's source and revision, and how it looks when run, screen by screen. */
  async previewPage(candidate: string, screens?: number[], steps?: HtmlPageStep[]) {
    if (screens && (screens.length < 1 || screens.length > 3 || screens.some(screen => !Number.isInteger(screen) || screen < 1))) throw new Error("每次查看 1–3 屏，从 1 开始。");
    const page = await this.readPage(candidate);
    if (!this.options.renderPage) return { ...page, shots: null };
    return { ...page, shots: await this.options.renderPage(page.path, screens, steps) };
  }
  /** Writes a whole page or a few exact replacements in it; this run can put it back from its reply. */
  updatePage(candidate: string, revision: string, change: { html?: string; edits?: Array<{ find: string; replace: string }> }) {
    return this.run(async () => {
      const entry = await this.entry(candidate);
      if (isMarkdownKind(documentKind(entry.path) ?? "")) return this.updateMarkdown(entry.path, revision, change);
      if (!isHtmlKind(documentKind(entry.path) ?? "")) throw new Error("只能修改 HTML 或 Markdown；ChalkLee 文档用 content_update 等工具修改。");
      if ((change.html === undefined) === !change.edits?.length) throw new Error("请提供完整的 html，或提供 edits，二者选一。");
      const current = await readWorkspacePage(entry.root, entry.path);
      const next = change.html ?? applyHtmlEdits(current.html, change.edits!);
      if (next === current.html) throw new Error("修改后的网页与原来相同。");
      const saved = await writeWorkspacePage(entry.root, entry.path, next, revision, { reason: "assistant", by: this.options.agentName?.() });
      this.options.changed(entry.path, "changed");
      if (this.options.editGroup) {
        const earlier = this.runEdits.get(entry.path);
        this.runEdits.set(entry.path, { name: path.relative(entry.root, entry.path).split(path.sep).join("/"), before: earlier?.before ?? saved.before, revision: saved.revision,
          mixed: Boolean(earlier && (earlier.mixed || earlier.revision !== revision)), page: true });
      }
      return { path: saved.path, revision: saved.revision, size: saved.size };
    });
  }
  private async currentMarkdown(candidate: string, snapshots?: AgentTextSnapshot[]) {
    const entry = await this.entry(candidate);
    const source = await readWorkspaceDocument(entry.root, entry.path);
    const encoding = decodeMarkdownFile(source.data);
    const live = snapshots ?? await this.options.editors?.readText(entry.path) ?? [];
    if (new Set(live.map(snapshot => snapshot.revision)).size > 1) throw new Error("多个编辑器中的内容不同，请先保存后再修改。");
    if (live.some(snapshot => snapshot.modifiedAt !== source.modifiedAt)) throw new Error("文档已被其他程序修改，请重新加载后再修改。");
    const text = live[0]?.text ?? encoding.text;
    return { entry, source, encoding, text, revision: await markdownRevision(text) };
  }
  private async updateMarkdown(candidate: string, revision: string, change: { html?: string; edits?: Array<{ find: string; replace: string }> }) {
    if ((change.html === undefined) === !change.edits?.length) throw new Error("请提供完整的 markdown，或提供 edits，二者选一。");
    const prepared = await this.options.editors?.prepareText(candidate);
    try {
      const current = await this.currentMarkdown(candidate, prepared?.snapshots);
      if (current.revision !== revision) throw new Error("文档已被修改，请重新读取后再改。");
      const next = (change.html ?? applyHtmlEdits(current.text, change.edits!)).replace(/\r?\n/g, current.encoding.lineSeparator);
      if (next === current.text) throw new Error("修改后的文档与原来相同。");
      const bytes = encodeMarkdownFile(next, current.encoding.bom);
      prepared?.assertLease();
      const savedAt = await prepared?.save();
      prepared?.assertLease();
      const saved = await writeWorkspaceDocument(current.entry.root, current.entry.path, Uint8Array.from(bytes).buffer, savedAt ?? current.source.modifiedAt, { reason: "assistant", by: this.options.agentName?.() });
      const warnings = await prepared?.commit(next, saved) ?? [];
      this.options.changed(current.entry.path, "changed");
      const nextRevision = await markdownRevision(next);
      if (this.options.editGroup) {
        const earlier = this.runEdits.get(current.entry.path);
        this.runEdits.set(current.entry.path, { name: path.relative(current.entry.root, current.entry.path).split(path.sep).join("/"), before: earlier?.before ?? encodeMarkdownFile(current.text, current.encoding.bom), revision: nextRevision, mixed: Boolean(earlier && (earlier.mixed || earlier.revision !== revision)), markdown: true });
      }
      if (warnings.length) throw new Error(`文件已保存，但编辑器同步失败：${warnings.join("；")}`);
      return { path: current.entry.path, revision: nextRevision, size: saved.size };
    } finally { await prepared?.release(); }
  }
  async readDocument(candidate: string) {
    const info = await this.info(candidate);
    if (isMarkdownKind(info.kind)) throw new Error("Markdown 用 document_preview 读取完整原文和 revision，再用 html_update 修改。");
    if (info.kind !== "chalklee") throw new Error(isHtmlKind(info.kind) ? "HTML 网页用 document_preview 查看截图，加 html:true 读取源码。" : "document_read 读取 ChalkLee 内容；PDF/DOC/DOCX/LaTeX/Markdown 原稿用 conversion_open、read_source，或 document_open 在浏览器预览。");
    const archive = await readChalkLeeArchive(await readFile(info.path));
    return { ...info, revision: await agentDocumentRevision(archive.document), document: archive.document, assets: archive.manifest.assets };
  }
  private async currentDocument(candidate: string, snapshots?: AgentEditorSnapshot[], includeResources = false) {
    const info = await this.info(candidate);
    if (info.kind !== "chalklee") throw new Error("文档编辑仅支持 ChalkLee；PDF/DOC/DOCX/LaTeX 请先转换，Markdown 用 html_update 修改。");
    const source = await readWorkspaceDocument(await this.options.workspace(), info.path);
    const archive = await readChalkLeeArchive(source.data);
    const live = snapshots ?? await this.options.editors?.read(info.path, includeResources) ?? [];
    const revisions = await Promise.all(live.map(snapshot => agentDocumentRevision(snapshot.document)));
    if (new Set(revisions).size > 1) throw new Error("多个编辑器中的内容不同，请先保存并重新加载同一文档后再修改。");
    if (live.some(snapshot => snapshot.modifiedAt !== source.modifiedAt)) throw new Error("已打开的文档与磁盘版本不同，请重新加载后再修改。");
    const document = live[0]?.document ?? archive.document;
    return { info: { ...info, modifiedAt: source.modifiedAt, size: source.size }, archive, document, assets: live[0]?.assets, source: live.length ? "editor" : "disk", revision: revisions[0] ?? await agentDocumentRevision(document) };
  }
  /** Conversion reminders that name a question, for ChalkLee AI to check against the original. */
  private async review(file: string) {
    const history = await this.options.history?.(file).catch(() => null);
    if (!history) return null;
    const notes = questionReviewNotices(history.record.warnings);
    return { source: history.source?.path ?? "原稿已改动或不在工作区", notes: new Map([...notes].map(([id, notices]) => [id, notices.map(notice => `${notice.page ? `原稿第 ${notice.page} 页：` : ""}${notice.message}`)])) };
  }
  readQuestions(candidate: string, options: { questionIds?: string[]; query?: string; includeContent?: boolean; limit?: number; offset?: number } = {}) {
    return this.run(async () => {
      const current = await this.currentDocument(candidate);
      const review = await this.review(current.info.path);
      const inventory = agentQuestionInventory(current.document);
      if (options.questionIds?.some(id => !inventory.some(question => question.id === id))) throw new Error("题目 ID 不存在，请重新读取题目列表。");
      const matched = inventory.filter(question => (!options.questionIds || options.questionIds.includes(question.id))
        && (!options.query || `${question.number} ${question.section} ${question.text} ${question.node.attrs.tags?.join(" ") ?? ""}`.toLocaleLowerCase().includes(options.query.toLocaleLowerCase())));
      return { path: current.info.path, revision: current.revision, source: current.source,
        ...(review ? { original: review.source, toCheck: review.notes.size } : {}),
        total: matched.length, offset: options.offset ?? 0, truncated: matched.length > (options.offset ?? 0) + (options.limit ?? 100),
        questions: matched.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 100)).map(({ text, node, ...question }) => ({
          ...question, text: text.slice(0, 500), attrs: node.attrs, ...(review?.notes.get(question.id) ? { toCheck: review.notes.get(question.id) } : {}), ...(options.includeContent ? { content: node.content } : {}) })) };
    });
  }
  /** Headings, paragraphs and questions with ids, for placing new content or finding a question. */
  readOutline(candidate: string) {
    return this.run(async () => {
      const current = await this.currentDocument(candidate);
      const review = await this.review(current.info.path), outline = agentDocumentOutline(current.document);
      if (review) for (const block of outline.blocks) if (review.notes.has(block.id as string)) block.toCheck = review.notes.get(block.id as string)!.length;
      return { path: current.info.path, revision: current.revision, source: current.source, ...(review ? { original: review.source, toCheck: review.notes.size } : {}), ...outline };
    });
  }
  /** The document's text in reading order, with what is unsaved in its editor. */
  readText(candidate: string) {
    return this.run(async () => {
      const current = await this.currentDocument(candidate);
      return { path: current.info.path, revision: current.revision, ...agentDocumentText(current.document) };
    });
  }
  /**
   * Pictures named by source become cropped PNGs; `attachment` reads the pictures sent in the conversation. Image files
   * come from the workspace, outside its internal folder; `outside` lets external agents name any local file too.
   */
  private async withImages<T>(value: T, pictures: ImagePictures = {}) {
    if (!hasAgentImages(value)) return { value, assets: [] as ChalkLeeArchiveAssetInput[] };
    return resolveAgentImages(value, { attachment: pictures.attachment, page: async (candidate, page) => {
      const source = await this.previewSource(candidate, [page]);
      const image = "images" in source ? source.images?.[0] : undefined;
      if (!image) throw new Error("只能从 PDF 原稿的页面中取图。");
      return image.dataUrl;
    }, file: async candidate => {
      const root = await this.root();
      const file = await realpath(path.resolve(root, candidate)).catch(() => { throw new Error(`找不到图片文件：${candidate}`); });
      if (file.split(path.sep).some(part => part.toLowerCase() === ".chalklee")) throw new Error("不能读取应用内部文件。");
      const relative = path.relative(root, file);
      const inside = relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
      if (!inside && !(pictures.outside && path.isAbsolute(candidate))) throw new Error("图片文件须在工作区中；外部 AI 应用可提供工作区外图片的绝对路径。");
      if (!AGENT_IMAGE_FILE.test(file)) throw new Error("图片文件只支持 PNG 和 JPG。");
      const stats = await lstat(file);
      if (!stats.isFile()) throw new Error(`不是图片文件：${candidate}`);
      if (stats.size > MAX_PICTURE_FILE_BYTES) throw new Error("图片文件超过 20 MB。");
      return `data:image/${/\.png$/i.test(file) ? "png" : "jpeg"};base64,${(await readFile(file)).toString("base64")}`;
    } });
  }
  async insertContent(candidate: string, blocks: unknown[], position: AgentContentPosition, expectedRevision?: string, pictures?: ImagePictures) {
    const { value, assets } = await this.withImages(blocks, pictures);
    const nodes = agentContentBlocks(value);
    return this.updateDocument(candidate, expectedRevision, document => insertAgentBlocks(document, nodes, position), [], "content", assets)
      .then(result => ({ ...result, insertedIds: nodes.map(node => node.attrs.id) }));
  }
  /** Deleting is undone like any other edit, and the paper before it is kept as a version; the result says what went. */
  removeContent(candidate: string, ids: string[], expectedRevision?: string) {
    let removed: Array<{ id: string; type: string; label: string }> = [];
    return this.updateDocument(candidate, expectedRevision, document => {
      const outline = agentDocumentOutline(document, 40).blocks;
      removed = [...new Set(ids)].map(id => {
        const entry = outline.find(block => block.id === id);
        const text = String(entry?.text ?? "").trim();
        const label = entry?.type === "question" || entry?.type === "questionGroup" ? (entry.number ? `第 ${entry.number} 题` : "一道题")
          : entry?.type === "box" ? `“${String(entry.label ?? "") || text.slice(0, 10)}”盒子` : text ? `“${text.slice(0, 14)}${text.length > 14 ? "…" : ""}”` : "空行";
        return { id, type: String(entry?.type ?? "paragraph"), label };
      });
      return removeAgentNodes(document, ids);
    }, [], "content").then(result => ({ ...result, removedItems: removed }));
  }
  moveContent(candidate: string, ids: string[], position: AgentContentPosition, expectedRevision?: string) {
    return this.updateDocument(candidate, expectedRevision, document => moveAgentNodes(document, ids, position), [], "content");
  }
  async updateContent(candidate: string, input: AgentBlockEditInput[], expectedRevision?: string, pictures?: ImagePictures) {
    const { value: edits, assets } = await this.withImages(input, pictures);
    const prepared: AgentBlockEdit[] = edits.map(edit => {
      if (!("block" in edit)) return edit as AgentBlockEdit;
      const nodes = agentContentBlocks([edit.block]);
      return { id: edit.id, block: nodes[0] };
    });
    let replaced = 0;
    return this.updateDocument(candidate, expectedRevision, document => { const result = updateAgentBlocks(document, prepared); replaced = result.replaced; return result.document; }, [], "content", assets)
      .then(result => ({ ...result, replaced }));
  }
  async updateQuestions(candidate: string, expectedRevision: string | undefined, input: AgentQuestionEdit[], pictures?: ImagePictures) {
    const { value: edits, assets } = await this.withImages(input, pictures);
    return this.updateDocument(candidate, expectedRevision, document => patchAgentQuestions(document, edits), edits.map(edit => edit.questionId), undefined, assets);
  }
  openDocuments() { return this.options.editors?.paths() ?? []; }
  /**
   * Renames tags on every question of a ChalkLee, sub-questions included; several names may become one. Returns each
   * changed question's tags before and after, so the change can be put back.
   */
  async renameTags(candidate: string, names: ReadonlyMap<string, string>) {
    const changes: TagChange[] = [], ids: string[] = [];
    // The ids fill in as the patch runs, before the open editor replaces those questions.
    const result = await this.updateDocument(candidate, undefined, document => {
      for (const { id, node } of agentQuestionInventory(document)) {
        const before: string[] = Array.isArray(node.attrs.tags) ? node.attrs.tags : [];
        if (!before.some(tag => names.has(tag))) continue;
        const after = [...new Set(before.map(tag => names.get(tag) ?? tag))];
        (node.attrs as { tags?: string[] }).tags = after;
        changes.push({ questionId: id, before: [...before], after });
        ids.push(id);
      }
      return document;
    }, ids);
    return { ...result, changes };
  }
  /** Puts back tags {@link renameTags} changed, on questions that still have them as it left them; returns the ids left alone. */
  async restoreTags(candidate: string, changes: readonly TagChange[]) {
    const kept: string[] = [], ids: string[] = [];
    const result = await this.updateDocument(candidate, undefined, document => {
      const questions = new Map(agentQuestionInventory(document).map(question => [question.id, question.node]));
      for (const change of changes) {
        const node = questions.get(change.questionId);
        const current: string[] = Array.isArray(node?.attrs.tags) ? node!.attrs.tags as string[] : [];
        if (!node || current.join("\u0000") !== change.after.join("\u0000")) { kept.push(change.questionId); continue; }
        if (change.before.length) (node.attrs as { tags?: string[] }).tags = [...change.before];
        else delete (node.attrs as { tags?: string[] }).tags;
        ids.push(change.questionId);
      }
      return document;
    }, ids);
    return { ...result, kept };
  }
  /**
   * A library edit on one copy of a question, worked out against what the paper holds now (an open
   * paper's unsaved state included). Returns the attributes before and after, or null when the copy
   * already read as asked.
   */
  async changeQuestionAttributes(edit: QuestionCopyEdit): Promise<QuestionAttributeChange | null> {
    const found: { change?: Omit<QuestionAttributeChange, "path"> } = {};
    const result = await this.updateDocument(edit.path, undefined, document => {
      const node = agentQuestionInventory(document).find(question => question.id === edit.questionId)?.node;
      // Another copy gone since the index read it has nothing left to bring in line.
      if (!node) { if ("set" in edit) throw new Error("题目已不存在，请重新搜索。"); return document; }
      const current = questionAttributeValues(node.attrs);
      const patch = questionCopyPatch(edit, current);
      if (!Object.keys(patch).length) return document;
      const patched = patchAgentQuestions(document, [{ questionId: edit.questionId, patch: { attrs: patch } }]);
      const after = agentQuestionInventory(patched).find(question => question.id === edit.questionId)!.node;
      found.change = { questionId: edit.questionId, before: questionAttributesOf(current, patch), after: questionAttributesOf(questionAttributeValues(after.attrs), patch) };
      return patched;
    }, [edit.questionId]);
    return result.saved && found.change ? { ...found.change, path: result.path } : null;
  }
  /** Puts back what {@link changeQuestionAttributes} changed, unless the question has changed those attributes since; then it is kept. */
  async restoreQuestionAttributes(change: QuestionAttributeChange) {
    const left = { kept: false };
    const result = await this.updateDocument(change.path, undefined, document => {
      const node = agentQuestionInventory(document).find(question => question.id === change.questionId)?.node;
      if (!node || JSON.stringify(questionAttributesOf(questionAttributeValues(node.attrs), change.after)) !== JSON.stringify(change.after)) { left.kept = true; return document; }
      return patchAgentQuestions(document, [{ questionId: change.questionId, patch: { attrs: change.before } }]);
    }, [change.questionId]);
    return { ...result, kept: left.kept };
  }
  /** Each picture's hash in a saved document, so a copy's pictures can be recognized by what they show. */
  private async assetHashes(candidate: string): Promise<Map<string, string>> {
    const { manifest } = await readChalkLeeArchiveMetadata(await readFile((await this.entry(candidate)).path));
    return new Map(manifest.assets.map(asset => [asset.id, asset.sha256]));
  }
  /** A question as its document holds it now, unsaved edits included, with how many documents an edit to it reaches. */
  readQuestionForEdit(candidate: string, questionId: string, copies: ReadonlyArray<{ path: string; questionId: string }> = []) {
    return this.run(async (): Promise<QuestionForEdit> => {
      const current = await this.currentDocument(candidate, undefined, true);
      const found = agentQuestionInventory(current.document).find(question => question.id === questionId);
      if (!found) throw new Error("题目已不存在，请重新搜索。");
      const node = structuredClone(found.node) as QuestionContentNode;
      const ids = new Set<string>();
      const collect = (part: QuestionContentNode) => { if (part.attrs?.assetId) ids.add(String(part.attrs.assetId)); part.content?.forEach(collect); };
      collect(node);
      const live = new Map(current.assets?.map(asset => [asset.id, asset]));
      const assets = [...ids].flatMap(id => {
        const liveAsset = live.get(id), saved = current.archive.manifest.assets.find(asset => asset.id === id);
        const source = liveAsset ? Buffer.from(liveAsset.dataBase64, "base64") : saved ? current.archive.assets[id] : undefined;
        const described = liveAsset ?? saved;
        if (!source || !described) return [];
        return [{ id, path: described.path, mediaType: described.mediaType, data: source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer }];
      });
      const hashes = new Map(current.archive.manifest.assets.map(asset => [asset.id, asset.sha256]));
      const face = questionFaceKey(node, hashes);
      let syncPapers = 1;
      for (const copy of copies) {
        if (copy.path === current.info.path && copy.questionId === questionId) continue;
        try {
          const other = await this.currentDocument(copy.path);
          const otherNode = agentQuestionInventory(other.document).find(question => question.id === copy.questionId)?.node;
          const otherHashes = new Map(other.archive.manifest.assets.map(asset => [asset.id, asset.sha256]));
          if (otherNode && questionFaceKey(otherNode as QuestionContentNode, otherHashes) === face) syncPapers++;
        } catch { /* A copy that cannot be read is reported when saving. */ }
      }
      const { provenance: _provenance, ...shell } = current.document;
      return { path: current.info.path, questionId, node, assets, syncPapers,
        document: { ...shell, content: { ...current.document.content, content: [found.node] } } as ChalkLeeDocument };
    });
  }
  /**
   * A question edited in the library, saved to its own document and then to the copies that read the same. A failure
   * on the edited document changes nothing; a later one keeps what was saved and names the documents left out.
   */
  async saveQuestionContent(edit: { path: string; questionId: string; before: QuestionContentNode; after: QuestionContentNode }, copies: ReadonlyArray<{ path: string; questionId: string }>) {
    const sourceHashes = await this.assetHashes(edit.path);
    const replace = (node: QuestionContentNode, next: QuestionContentNode) => { node.attrs = next.attrs; node.content = next.content; };
    const changes: QuestionContentChange[] = [], different: string[] = [], failed: string[] = [];
    let error: string | null = null;
    const own: { before?: QuestionContentNode; after?: QuestionContentNode } = {};
    const saved = await this.updateDocument(edit.path, undefined, document => {
      const node = agentQuestionInventory(document).find(question => question.id === edit.questionId)?.node as QuestionContentNode | undefined;
      if (!node) throw new Error("题目已不存在，请重新搜索。");
      if (questionContentKey(node, sourceHashes) !== questionContentKey(edit.before, sourceHashes)) throw new Error("这道题已在别处修改，请重新打开编辑。");
      own.before = structuredClone(node);
      own.after = structuredClone(editedQuestionNode(node, edit.after));
      replace(node, structuredClone(own.after));
      return document;
    }, [edit.questionId]);
    if (saved.saved) changes.push({ path: saved.path, questionId: edit.questionId, before: own.before!, after: own.after! });
    const others = copies.filter(copy => !(copy.path === saved.path && copy.questionId === edit.questionId));
    for (const [index, copy] of others.entries()) {
      try {
        const copyHashes = await this.assetHashes(copy.path);
        const found: { before?: QuestionContentNode; after?: QuestionContentNode; partial?: boolean; apart?: boolean } = {};
        const result = await this.updateDocument(copy.path, undefined, document => {
          const node = agentQuestionInventory(document).find(question => question.id === copy.questionId)?.node as QuestionContentNode | undefined;
          const merged = node ? questionCopyWithEdit(edit.before, edit.after, node, sourceHashes, copyHashes) : null;
          if (!node || !merged) { found.apart = true; return document; }
          found.before = structuredClone(node);
          found.after = structuredClone(merged.node);
          found.partial = merged.partial;
          replace(node, structuredClone(merged.node));
          return document;
        }, [copy.questionId]);
        if (found.apart || found.partial) different.push(questionPaperName(copy.path));
        if (result.saved && found.before && found.after) changes.push({ path: result.path, questionId: copy.questionId, before: found.before, after: found.after });
      } catch (reason) {
        failed.push(...others.slice(index).map(other => questionPaperName(other.path)));
        error = reason instanceof Error ? reason.message : String(reason);
        break;
      }
    }
    return { changes, different, failed, error };
  }
  /** Puts back what {@link saveQuestionContent} wrote, unless the question's content has changed since; then it is kept. */
  async restoreQuestionContent(change: QuestionContentChange) {
    const hashes = await this.assetHashes(change.path);
    const left = { kept: false };
    const result = await this.updateDocument(change.path, undefined, document => {
      const node = agentQuestionInventory(document).find(question => question.id === change.questionId)?.node as QuestionContentNode | undefined;
      if (!node || questionContentKey(node, hashes) !== questionContentKey(change.after, hashes)) { left.kept = true; return document; }
      // Tags, difficulty and score may have been changed since; only the content goes back.
      node.content = structuredClone(change.before.content);
      return document;
    }, [change.questionId]);
    return { ...result, kept: left.kept };
  }
  readStyle(candidate: string) {
    return this.run(async () => {
      const current = await this.currentDocument(candidate);
      const { appearance } = current.document;
      const layouts = await this.options.layouts?.list().catch(() => []) ?? [];
      return { path: current.info.path, revision: current.revision, source: current.source, design: appearance.design ?? null,
        page: appearance.page, body: appearance.body,
        boxStyles: appearance.boxStyles ?? {}, boxStyleRef: appearance.defaults.boxStyleRef ?? null,
        questionStyles: appearance.questionStyles, questionStyleRef: appearance.defaults.questionStyleRef,
        headerFooter: appearance.headerFooter ?? null, headingNumbering: appearance.headingNumbering ?? null, questionNumbering: appearance.questionNumbering ?? null,
        cover: appearance.cover ?? null, tableOfContents: appearance.tableOfContents ?? null, pageDecorations: appearance.pageDecorations ?? [],
        coverArea: (({ width, height }) => ({ widthPt: Math.round(width * 10) / 10, heightPt: Math.round(height * 10) / 10 }))(chalkLeePageSize(appearance.page)),
        decorationAreas: Object.fromEntries((["left", "right", "content"] as const).map(place => {
          const area = chalkLeePageDecorationArea(appearance.page, place);
          return [place, { widthPt: Math.round(area.width * 10) / 10, heightPt: Math.round(area.height * 10) / 10 }];
        })),
        layouts: layouts.map(layout => ({ name: layout.name, builtIn: layout.builtIn })),
        metadata: { year: current.document.metadata.year ?? null, grade: current.document.metadata.grade ?? null },
        ownStyleItems: chalkLeeOwnAppearanceItems(appearance), guide: AGENT_DESIGN_GUIDE };
    });
  }
  async updateStyle(candidate: string, expectedRevision: string | undefined, patch: AgentDesignPatch, layout?: { name: string } | { from: string }, saveLayoutAs?: string) {
    let resolved: ChalkLeeLayout | undefined;
    if (layout && "name" in layout) {
      resolved = await this.options.layouts?.find(layout.name) ?? undefined;
      if (!resolved) throw new Error(`没有名为“${layout.name}”的版式，请用 document_style_read 查看可用的版式。`);
    } else if (layout) {
      const source = await this.run(() => this.currentDocument(layout.from));
      resolved = chalkLeeLayoutFromDocument(source.document, chalkLeeLayoutName(source.document) ?? path.basename(source.info.path).replace(/\.chalklee$/i, ""));
    }
    // A new layout can give boxes and framed questions other styles, and a changed question style redraws its
    // questions: the edit then covers the content as well as the look.
    const content = Boolean(resolved || patch.questionStyles);
    const changed = Object.keys(patch).length || resolved
      ? await this.updateDocument(candidate, expectedRevision, document => patchAgentDesign(document, { ...patch, ...(resolved ? { layout: resolved } : {}) }), [], content ? "document" : "appearance")
      : null;
    if (!saveLayoutAs) {
      if (!changed) throw new Error("请提供要修改的样式，或用 saveLayoutAs 保存当前样式。");
      return changed;
    }
    // The teacher's own layout: this document's look under a name, for any later paper.
    if (!this.options.layouts) throw new Error("当前应用不能保存版式。");
    const current = await this.run(() => this.currentDocument(candidate));
    await this.options.layouts.save(chalkLeeLayoutFromDocument(current.document, saveLayoutAs));
    return { ...(changed ?? { path: current.info.path, revision: current.revision, saved: false, changed: false, updatedQuestionIds: [] }), savedLayout: saveLayoutAs.trim() };
  }
  previewDocument(candidate: string, pages?: number[], expectedRevision?: string, signal?: AbortSignal) {
    return this.run(async () => {
      if (pages && (pages.length < 1 || pages.length > 3 || pages.some(p => !Number.isInteger(p) || p < 1))) throw new Error("每次预览 1–3 页，页码从 1 开始。");
      const current = await this.currentDocument(candidate, undefined, true);
      if (expectedRevision && current.revision !== expectedRevision) throw new Error("文档版本已变化，请重新读取样式后预览。");
      if (!this.options.renderPreview) throw new Error("当前应用未启用文档渲染预览。");
      const assets = current.assets?.map(asset => ({ id: asset.id, path: asset.path, mediaType: asset.mediaType, data: new Uint8Array(Buffer.from(asset.dataBase64, "base64")) }))
        ?? current.archive.manifest.assets.map(asset => ({ ...asset, data: current.archive.assets[asset.id] }));
      const bytes = await createChalkLeeArchive(current.document, assets);
      const result = await this.options.renderPreview(bytes, pages, signal);
      return { ...(result as object), path: current.info.path, revision: current.revision, source: current.source, previewUrl: this.options.editorUrl(current.info.path) };
    });
  }
  /** Pages of an original PDF, or native Word/Markdown text. */
  previewSource(candidate: string, pages?: number[], signal?: AbortSignal) {
    return this.run(async () => {
      const info = await this.info(candidate);
      const data = (await readWorkspaceDocument(await this.options.workspace(), info.path)).data;
      if (isMarkdownKind(info.kind)) {
        const current = await this.currentMarkdown(candidate);
        const text = current.text;
        return { path: info.path, kind: info.kind, revision: current.revision, paragraphs: text.split(/\n\s*\n/).filter(part => part.trim()).length, text, truncated: false };
      }
      if (isLatexKind(info.kind)) {
        // The source as written: the conversion reads it the same way, and nothing here compiles it.
        const text = decodeLatexSource(new Uint8Array(data)).text;
        return { path: info.path, kind: info.kind, paragraphs: text.split(/\n\s*\n/).filter(part => part.trim()).length, text: text.slice(0, DOCX_TEXT_LIMIT), truncated: text.length > DOCX_TEXT_LIMIT };
      }
      if (info.kind === "doc") {
        const document = await parseWord(new Uint8Array(data), { includeEquations: true });
        const paragraphs: string[] = [];
        const visit = (blocks: WordBlock[]) => {
          for (const block of blocks) {
            if (block.kind === "table") block.rows.forEach(row => row.forEach(cell => visit(cell.blocks)));
            else {
              const text = (block.marker ? block.marker + " " : "") + block.inlines.map(inline => inline.kind === "text" ? inline.text : inline.kind === "math" ? inline.latex ?? "[公式待核对]" : "").join("");
              if (text.trim()) paragraphs.push(text.trim());
            }
          }
        };
        document.sections.forEach(section => visit(section.blocks));
        const text = paragraphs.join("\n");
        return { path: info.path, kind: info.kind, paragraphs: paragraphs.length, text: text.slice(0, DOCX_TEXT_LIMIT), truncated: text.length > DOCX_TEXT_LIMIT, warnings: document.warnings };
      }
      if (info.kind === "docx") return { path: info.path, kind: info.kind, ...await docxText(new Uint8Array(data)) };
      if (info.kind !== "pdf") throw new Error("只能查看 PDF、DOC、DOCX、LaTeX 或 Markdown 原稿。");
      if (pages && (pages.length < 1 || pages.length > 3 || pages.some(p => !Number.isInteger(p) || p < 1))) throw new Error("每次查看 1–3 页，页码从 1 开始。");
      if (!this.options.renderSource) throw new Error("当前应用未启用原稿预览。");
      const rendered = await this.options.renderSource(new Uint8Array(data), pages ?? [1, 2, 3], signal);
      if (pages?.some(page => page > rendered.count)) throw new Error(`原稿共 ${rendered.count} 页，请选择有效页码。`);
      return { path: info.path, kind: info.kind, pageCount: rendered.count, images: rendered.images };
    });
  }
  /** Export current editor content next to the ChalkLee under a new name. */
  exportDocument(candidate: string, options: AgentExportOptions) {
    return this.run(async () => {
      const current = await this.currentDocument(candidate, undefined, true);
      const format = options.format ?? "pdf";
      const render = format === "docx" ? this.options.renderDocx : this.options.renderPdf;
      if (!render) throw new Error(`当前应用未启用 ${format === "docx" ? "Word" : "PDF"} 导出。`);
      const assets = current.assets?.map(asset => ({ id: asset.id, path: asset.path, mediaType: asset.mediaType, data: new Uint8Array(Buffer.from(asset.dataBase64, "base64")) }))
        ?? current.archive.manifest.assets.map(asset => ({ ...asset, data: current.archive.assets[asset.id] }));
      const bytes = await render(await createChalkLeeArchive(current.document, assets), { answers: options.answers, analysis: options.analysis,
        ...(options.solutionPlacement ? { solutionPlacement: options.solutionPlacement } : {}) });
      const base = path.basename(current.info.path, path.extname(current.info.path));
      const suffix = options.answers && options.analysis ? EXPORT_SUFFIX : !options.answers && !options.analysis ? "（学生版）" : options.answers ? "（无解析）" : "（无答案）";
      const name = workspaceEntryName((options.name ?? `${base}${suffix}`).replace(/\.(pdf|docx)$/i, ""), "directory");
      for (let index = 1; index < 1000; index++) {
        // Never overwrite originals or earlier exports.
        const destination = path.join(path.dirname(current.info.path), `${name}${index > 1 ? `（${index}）` : ""}.${format}`);
        try { await writeFile(destination, bytes, { flag: "wx" }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") continue; throw error; }
        this.options.changed(destination, "added");
        return { path: destination, source: current.info.path, bytes: bytes.byteLength };
      }
      throw new Error("同名文件过多，请指定文件名。");
    });
  }
  /** Removes a folder only while it is empty, e.g. one an organisation left behind. */
  removeEmptyFolder(candidate: string) {
    return this.run(async () => {
      const entry = await this.entry(candidate, true);
      if (entry.path === entry.root) throw new Error("不能删除工作区根目录。");
      // Finder and Explorer leave these behind in folders that look empty.
      const names = await readdir(entry.path);
      if (names.length && names.every(name => SYSTEM_LITTER.has(name))) await Promise.all(names.map(name => rm(path.join(entry.path, name), { force: true })));
      try { await rmdir(entry.path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOTEMPTY" || (error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`“${entry.relativePath}”不是空文件夹。`); throw error; }
      this.options.changed(entry.path);
      return { path: entry.path };
    });
  }
  /** Without expectedRevision the edit applies to the current content, as an interactive edit would. */
  private updateDocument(candidate: string, expectedRevision: string | undefined, patch: (document: ChalkLeeDocument) => ChalkLeeDocument, questionIds: string[], mutation?: "appearance" | "content" | "document", offered: ChalkLeeArchiveAssetInput[] = [],
    step: { notice?: string; ownStep?: boolean } = {}) {
    return this.run(async () => {
      const entry = await this.entry(candidate);
      if (documentKind(entry.path) !== "chalklee") throw new Error("文档编辑仅支持 ChalkLee；PDF/DOC/DOCX/LaTeX 请先转换，Markdown 用 html_update 修改。");
      const prepared = await this.options.editors?.prepare(entry.path);
      try {
        const current = await this.currentDocument(entry.path, prepared?.snapshots ?? []);
        if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new Error("文档版本已变化，请重新读取题目或样式后再修改。");
        const baseRevision = current.revision;
        // A paper numbered 1, 2, 3… keeps following its order after the edit, as in the editor.
        const numbered = chalkLeeSequentialNumbersAsAuto(current.document);
        const unchangedRevision = numbered === current.document ? baseRevision : await agentDocumentRevision(numbered);
        // Questions added or removed by the edit keep a fixed-number excerpt (4, 5, 6…) continuous.
        const document = chalkLeeFixedNumberRunsAfterEdit(numbered, patch(numbered));
        assertImportDocument(document, false, "这次修改");
        if (await agentDocumentRevision(document) === unchangedRevision) return { path: entry.path, revision: baseRevision, saved: false, changed: false, updatedQuestionIds: [] };
        // Preserve submitted unsaved content and assets before making the agent's edit.
        const editorModifiedAt = await prepared?.save() ?? prepared?.snapshots[0]?.modifiedAt;
        const fresh = await readWorkspaceDocument(entry.root, entry.path);
        const archive = await readChalkLeeArchive(fresh.data);
        if (prepared?.snapshots.length) {
          // The editor's content is the base. A clean editor may hold a normalized form of the file,
          // so the disk only has to be the version the editor last loaded or saved.
          if (fresh.modifiedAt !== editorModifiedAt && await agentDocumentRevision(archive.document) !== baseRevision) throw new Error("保存后的文档版本已变化，请重新读取文档。");
        } else if (fresh.modifiedAt !== current.info.modifiedAt || await agentDocumentRevision(archive.document) !== baseRevision) {
          throw new Error("文件已被其他程序修改，请重新读取文档。");
        }
        document.metadata.updatedAt = new Date().toISOString();
        // Pictures the edit brings join the paper's resources; ones the paper still has are not added twice.
        const added = offered.filter(asset => !archive.manifest.assets.some(existing => existing.id === asset.id));
        const manifest = { ...archive.manifest, assets: [...archive.manifest.assets, ...added.map(asset => ({ id: asset.id, path: asset.path, mediaType: asset.mediaType, byteLength: asset.data.byteLength, sha256: "" }))] };
        // The written document, with every kind in the one vocabulary, is what must be valid.
        const assetIssues = validateChalkLeeSemantics(normalizeChalkLeeDocument(document), manifest);
        if (assetIssues.length) throw new Error(`文档结构校验失败：${assetIssues[0].message}`);
        const bytes = await createChalkLeeArchive(document, [...archive.manifest.assets.map(asset => ({ ...asset, data: archive.assets[asset.id] })), ...added]);
        if (await realpath(await this.options.workspace()) !== entry.root) throw new Error("工作区已切换，请重新读取文档。");
        prepared?.assertLease();
        // The paper as it was before the agent's edit stays available as a version.
        const saved = await writeWorkspaceDocument(entry.root, entry.path, Uint8Array.from(bytes).buffer, fresh.modifiedAt, this.options.version ?? { reason: "assistant", by: this.options.agentName?.() });
        const group = step.ownStep ? undefined : this.options.editGroup;
        const syncWarnings = await prepared?.commit(document, saved, questionIds, mutation, {
          ...(added.length ? { assets: added.map(asset => ({ id: asset.id, path: asset.path, mediaType: asset.mediaType, dataBase64: Buffer.from(asset.data).toString("base64") })) } : {}),
          ...(step.notice ? { notice: step.notice } : {}), ...(group ? { historyGroup: group } : {})
        }) ?? [];
        this.options.changed(entry.path, "changed");
        const revision = await agentDocumentRevision(document);
        if (group) {
          // Something else changing the paper between this run's edits makes the run's own undo unsafe.
          const earlier = this.runEdits.get(entry.path);
          this.runEdits.set(entry.path, { name: path.relative(entry.root, entry.path).split(path.sep).join("/"), before: earlier?.before ?? new Uint8Array(fresh.data), revision,
            mixed: Boolean(earlier && (earlier.mixed || earlier.revision !== baseRevision)) });
        }
        return { path: entry.path, revision, saved: true, ...saved, updatedQuestionIds: questionIds,
          previewUrl: this.options.editorUrl(entry.path), ...(syncWarnings.length ? { syncWarnings } : {}) };
      } finally { await prepared?.release(); }
    });
  }
  importDocument(sourcePath: string, directory = ".", name?: string) {
    return this.run(async () => {
      const target = await this.entry(directory, true), source = await realpath(sourcePath), stats = await lstat(source), kind = documentKind(source);
      if (!stats.isFile() || !kind || stats.size > 100 * 1024 * 1024) throw new Error("请选择不超过 100 MB 的 PDF、Word、Markdown、HTML 或 ChalkLee 文件。");
      const bytes = await readFile(source);
      if (isMarkdownKind(kind)) readMarkdownSource(bytes);
      if (kind === "pdf" && bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("文件不是有效 PDF。");
      if (kind === "chalklee") await readChalkLeeArchive(bytes);
      if (kind === "docx") {
        const zip = await JSZip.loadAsync(bytes);
        if (!zip.file("[Content_Types].xml") || !zip.file("word/document.xml")) throw new Error("文件不是有效 DOCX。");
      }
      const base = workspaceEntryName((name ?? path.basename(source)).replace(/\.(pdf|docx?|tex|md|markdown|html?|chalklee)$/i, ""), "directory");
      for (let index = 0; index < 1000; index++) {
        const destination = path.join(target.path, `${base}${index ? `（导入 ${index + 1}）` : ""}.${kind}`);
        if (destination === source) return this.info(source);
        try { await writeFile(destination, bytes, { flag: "wx" }); this.options.changed(destination); return this.info(destination); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      }
      throw new Error("同名副本过多，请调整文件名。");
    });
  }
}
