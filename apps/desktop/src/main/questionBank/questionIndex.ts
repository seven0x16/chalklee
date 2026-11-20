import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { openChalkLeeArchiveForReading, readChalkLeeArchive, readChalkLeeArchiveMetadata, type ChalkLeeArchiveReader } from "@chalklee/format";
import type { WorkspaceDirectoryNode, WorkspaceFileNode } from "../../shared/contracts";
import {
  assignDuplicateGroups,
  extractQuestionBankEntries,
  indexQuestionBankEntry,
  joinWorkspacePath,
  normalizeQuestionBankRequest,
  prepareQuestionBankSearch,
  publicQuestionBankEntry,
  questionContentHash,
  questionCopies,
  summarizeQuestionBank,
  type IndexedQuestion,
  type PreparedQuestionBankSearch,
  type QuestionBankChange,
  type QuestionBankEntry,
  type QuestionBankIndexStatus,
  type QuestionBankOverview,
  type QuestionBankSearchRequest,
  type QuestionBankSearchResponse,
  type QuestionBasketItem,
  type QuestionBasketReference,
  type QuestionSnapshot,
  type QuestionThumbnail
} from "../../shared/questionBank/search";
import { documentKind, inspectWorkspaceDocument } from "../workspace/files";
import { openWorkspaceArchiveValidationCache, type WorkspaceArchiveValidationCache } from "../workspace/archiveValidationCache";
import { workspaceStorageDirectory } from "../workspace/storage";
import { EMPTY_QUESTION_TAG_TREE, normalizeQuestionTagTree, type QuestionTagTree } from "../../shared/questionBank/tagTree";
import { pictureFigurePrint, sameFigurePrint } from "./figurePrints";

// Bump when QuestionBankEntry changes shape or meaning so stale caches are re-indexed.
const CACHE_VERSION = 8;
const BASKET_VERSION = 1;
const TAG_TREE_VERSION = 1;
const MAX_BASKET_ITEMS = 300;
const INDEX_CONCURRENCY = 4;
/** Recently read papers, so a page of library cards from one paper parses it once. */
const ARCHIVE_CACHE = 6;
const ARCHIVE_ASSET_CACHE_BYTES = 4 * 1024 * 1024;
const SEARCH_CACHE_SIZE = 4;
const SEARCH_CACHE_MATCHES = 80_000;
const SEARCH_CACHE_TAGS = 1_000;
const RECENT_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

type CachedEntry = Omit<QuestionBankEntry, "path">;
interface IndexedDocument {
  relativePath: string;
  size: number;
  modifiedAt: number;
  createdAt?: number | Promise<number>;
  failed: boolean;
  questions: IndexedQuestion[];
}
interface IndexCache {
  version: number;
  documents: Array<{ relativePath: string; size: number; modifiedAt: number; failed: boolean; entries: CachedEntry[] }>;
  /** Figure prints by figure id; null for a picture that cannot be compared by its look. */
  figures?: Record<string, string | null>;
}

type JsonNode = { type?: string; attrs?: Record<string, any>; content?: JsonNode[] };

/**
 * Workspace-wide question index. Saved ChalkLee content only: unsaved editor
 * changes appear after the document is saved. Results are cached under
 * `.chalklee/question-bank/` and refreshed per file from watcher events.
 */
export class QuestionBankIndex {
  private root: string | null = null;
  private generation = 0;
  private opening: Promise<void> = Promise.resolve();
  private documents = new Map<string, IndexedDocument>();
  private questions: IndexedQuestion[] = [];
  private overviewCache?: { calculatedAt: number; expiresAt: number; value: QuestionBankOverview };
  private searches = new Map<string, PreparedQuestionBankSearch>();
  private revision = 0;
  private tagRevision = 0;
  private status: QuestionBankIndexStatus = { state: "idle", indexedDocuments: 0, totalDocuments: 0, questionCount: 0, failedDocuments: 0 };
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private basketWrite: Promise<unknown> = Promise.resolve();
  private tagTree: QuestionTagTree = EMPTY_QUESTION_TAG_TREE;
  private tagTreeLoad: Promise<unknown> = Promise.resolve();
  private tagTreeWrite: Promise<unknown> = Promise.resolve();
  private archives = new Map<string, { fingerprint: string; archive: Promise<ChalkLeeArchiveReader> }>();
  private verifiedArchives?: Pick<WorkspaceArchiveValidationCache, "has">;
  /** How figures look, read only for questions whose wording already matches another paper's. */
  private figurePrints = new Map<string, string | null>();
  private printing: Promise<void> | null = null;

  constructor(private readonly options: { changed?(change: QuestionBankChange): void; rebuildDelayMs?: number; persistDelayMs?: number } = {}) {}

  /** Start indexing a newly opened workspace; resolves once every document has been read. */
  open(root: string, tree: WorkspaceDirectoryNode, validationCacheDirectory?: string): Promise<void> {
    return this.opening = this.openWorkspace(root, tree, validationCacheDirectory);
  }

  private async openWorkspace(root: string, tree: WorkspaceDirectoryNode, validationCacheDirectory?: string): Promise<void> {
    const generation = ++this.generation;
    this.clearTimers();
    this.root = root;
    this.documents.clear();
    this.questions = [];
    this.overviewCache = undefined;
    this.searches.clear();
    this.archives.clear();
    this.verifiedArchives = undefined;
    this.figurePrints.clear();
    this.tagTree = EMPTY_QUESTION_TAG_TREE;
    this.tagTreeLoad = this.loadTagTree(root).then(tagTree => this.updateTagTree(tagTree, generation));
    const files = chalkLeeFiles(tree);
    const [{ documents: cache, figures }, , verifiedArchives] = await Promise.all([
      this.readCache(root), this.tagTreeLoad,
      validationCacheDirectory ? openWorkspaceArchiveValidationCache(validationCacheDirectory, root) : undefined
    ]);
    if (generation !== this.generation) return;
    this.verifiedArchives = verifiedArchives;
    this.figurePrints = figures;
    const pending: WorkspaceFileNode[] = [];
    for (const file of files) {
      const relativePath = this.relative(file.path);
      const cached = cache.get(relativePath);
      if (cached && !cached.failed && cached.size === file.size && cached.modifiedAt === file.modifiedAt) {
        this.documents.set(file.path, { relativePath, size: cached.size, modifiedAt: cached.modifiedAt, createdAt: file.createdAt, failed: cached.failed,
          questions: cached.entries.map(entry => indexQuestionBankEntry({ ...entry, path: file.path, relativePath })) });
      } else pending.push(file);
    }
    this.status = { state: pending.length ? "indexing" : "ready", indexedDocuments: files.length - pending.length, totalDocuments: files.length, questionCount: 0, failedDocuments: 0 };
    this.rebuild();
    if (!pending.length) return;
    let next = 0;
    const worker = async () => {
      while (next < pending.length && generation === this.generation) {
        const file = pending[next++];
        await this.indexFile(root, file.path, generation);
        if (generation !== this.generation) return;
        this.status = { ...this.status, indexedDocuments: this.status.indexedDocuments + 1 };
        this.scheduleRebuild();
      }
    };
    await Promise.all(Array.from({ length: Math.min(INDEX_CONCURRENCY, pending.length) }, worker));
    if (generation !== this.generation) return;
    this.status = { ...this.status, state: "ready" };
    this.rebuild();
    if (pending.length) this.schedulePersist();
  }

  close() {
    this.generation++;
    this.clearTimers();
    this.root = null;
    this.documents.clear();
    this.questions = [];
    this.overviewCache = undefined;
    this.searches.clear();
    this.archives.clear();
    this.verifiedArchives = undefined;
    this.figurePrints.clear();
    this.tagTree = EMPTY_QUESTION_TAG_TREE;
    this.status = { state: "idle", indexedDocuments: 0, totalDocuments: 0, questionCount: 0, failedDocuments: 0 };
  }

  /** Re-read one ChalkLee after it was added, saved or changed on disk. */
  async update(filePath: string): Promise<void> {
    const root = this.root, generation = this.generation;
    if (!root || documentKind(filePath) !== "chalklee" || isInternalPath(root, filePath)) return;
    await this.opening;
    if (generation !== this.generation) return;
    const known = this.documents.has(filePath);
    await this.indexFile(root, filePath, generation);
    if (generation !== this.generation) return;
    if (!known && this.documents.has(filePath)) {
      this.status = { ...this.status, totalDocuments: this.status.totalDocuments + 1, indexedDocuments: this.status.indexedDocuments + 1 };
    }
    this.scheduleRebuild();
    this.schedulePersist();
  }

  /** Forget a removed file, or every file below a removed directory. */
  async remove(entryPath: string) {
    if (!this.root) return;
    const generation = this.generation;
    await this.opening;
    if (generation !== this.generation) return;
    let removed = 0;
    for (const filePath of [...this.documents.keys()]) {
      if (filePath === entryPath || filePath.startsWith(`${entryPath}${path.sep}`)) { this.documents.delete(filePath); removed++; }
    }
    if (!removed) return;
    this.overviewCache = undefined;
    this.status = { ...this.status, totalDocuments: Math.max(0, this.status.totalDocuments - removed), indexedDocuments: Math.max(0, this.status.indexedDocuments - removed) };
    this.scheduleRebuild();
    this.schedulePersist();
  }

  search(input: QuestionBankSearchRequest | unknown): QuestionBankSearchResponse {
    const { limit, ...request } = normalizeQuestionBankRequest(input);
    const tagCount = request.tagUnits?.reduce((count, unit) => count + unit.length, 0) ?? 0;
    const key = tagCount <= SEARCH_CACHE_TAGS ? JSON.stringify(request) : null;
    let prepared = key === null ? undefined : this.searches.get(key);
    if (prepared && key !== null) {
      this.searches.delete(key);
      this.searches.set(key, prepared);
    } else {
      prepared = prepareQuestionBankSearch(this.questions, request, { tagTree: this.tagTree });
      if (key !== null && prepared.total <= SEARCH_CACHE_MATCHES) this.rememberSearch(key, prepared);
    }
    return { revision: this.revision, searchVersion: this.searchVersion, ...prepared.page(limit), status: this.status };
  }

  private get searchVersion() {
    return `${this.generation}:${this.revision}:${this.tagRevision}`;
  }

  searchIfChanged(input: unknown, knownVersion: string): QuestionBankSearchResponse | null {
    return this.status.state === "ready" && knownVersion === this.searchVersion ? null : this.search(input);
  }

  private rememberSearch(key: string, prepared: PreparedQuestionBankSearch) {
    let retained = prepared.total;
    for (const search of this.searches.values()) retained += search.total;
    for (const [oldest, search] of this.searches) {
      if (this.searches.size < SEARCH_CACHE_SIZE && retained <= SEARCH_CACHE_MATCHES) break;
      this.searches.delete(oldest);
      retained -= search.total;
    }
    this.searches.set(key, prepared);
  }

  /** Workspace totals; a ChalkLee counts as recent when its file was created within the last week. */
  async overview(now = Date.now()): Promise<QuestionBankOverview> {
    if (!this.root) return { documents: 0, questions: 0, tags: 0, recentDocuments: 0, recentQuestions: 0 };
    const cached = this.overviewCache;
    if (cached && now >= cached.calculatedAt && now < cached.expiresAt) return { ...cached.value };

    const documents = this.documents.size, questions = this.questions;
    const recent = new Set<string>(), pending: Promise<void>[] = [];
    const threshold = now - RECENT_PERIOD_MS;
    let expiresAt = Infinity;
    const countRecent = (filePath: string, createdAt: number) => {
      if (createdAt > threshold) {
        recent.add(filePath);
        expiresAt = Math.min(expiresAt, createdAt + RECENT_PERIOD_MS);
      }
    };
    for (const [filePath, document] of this.documents) {
      const createdAt = document.createdAt;
      if (typeof createdAt === "number") {
        countRecent(filePath, createdAt);
      } else {
        // A caller may supply a tree without creation times. Share that lookup and retry transient failures.
        const lookup = createdAt ?? (document.createdAt = stat(filePath).then(info => document.createdAt = info.birthtimeMs, () => {
          document.createdAt = undefined;
          return 0;
        }));
        pending.push(lookup.then(value => countRecent(filePath, value)));
      }
    }
    if (pending.length) await Promise.all(pending);
    const value = { documents, recentDocuments: recent.size, ...summarizeQuestionBank(questions, recent) };
    // Waiting for disk may overlap a workspace switch or an index change.
    if (!pending.length) this.overviewCache = { calculatedAt: now, expiresAt, value };
    return { ...value };
  }

  /** The saved question with its referenced images, read fresh from disk for preview or insertion. */
  async snapshot(filePath: string, questionId: string, includeSolutionAssets = true): Promise<QuestionSnapshot> {
    const root = this.requireRoot();
    if (documentKind(filePath) !== "chalklee") throw new Error("只能从 ChalkLee 中读取题目。");
    const archive = await this.readArchive(root, filePath);
    const node = findQuestionNode(archive.document.content.content as JsonNode[], questionId);
    if (!node) throw new Error("题目已不存在，可能已被删除，请重新搜索。");
    const number = this.findEntry(filePath, questionId)?.number ?? "";
    const contentHash = questionContentHash(node);
    const location = { path: filePath, relativePath: this.relative(filePath), documentTitle: documentTitle(filePath), questionId, number, contentHash };
    const assetIds = new Set<string>();
    const visibleAssetIds = includeSolutionAssets ? undefined : new Set<string>();
    collectAssetIds(node, assetIds, visibleAssetIds);
    const assets: QuestionSnapshot["assets"] = [];
    const deferredAssetIds: string[] = [];
    for (const asset of archive.manifest.assets) {
      if (!assetIds.has(asset.id)) continue;
      if (visibleAssetIds && !visibleAssetIds.has(asset.id)) { deferredAssetIds.push(asset.id); continue; }
      const data = await archive.readAsset(asset.id);
      assets.push({ id: asset.id, path: asset.path, mediaType: asset.mediaType, sha256: asset.sha256, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer });
    }
    return {
      location,
      contentHash,
      node: structuredClone(node) as QuestionSnapshot["node"],
      assets,
      ...(deferredAssetIds.length ? { deferredAssetIds } : {})
    };
  }

  /** The question's first figure, stem first, for compact basket rows; null when it has none. */
  async thumbnail(filePath: string, questionId: string): Promise<QuestionThumbnail | null> {
    const root = this.requireRoot();
    if (documentKind(filePath) !== "chalklee") return null;
    const archive = await this.readArchive(root, filePath);
    const node = findQuestionNode(archive.document.content.content as JsonNode[], questionId);
    if (!node) return null;
    const assetId = firstImageAssetId(node);
    if (!assetId) return null;
    const asset = archive.manifest.assets.find(candidate => candidate.id === assetId);
    if (!asset) return null;
    const data = await archive.readAsset(assetId);
    return { mediaType: asset.mediaType, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer };
  }

  /** The saved copies the library shows as one question with this one, this one first; empty when it is not indexed. */
  copies(filePath: string, questionId: string): QuestionBankEntry[] {
    this.requireRoot();
    // Group by what is saved now, not by the last debounced rebuild.
    if (this.rebuildTimer) this.rebuild();
    return questionCopies(this.questions, filePath, questionId).map(publicQuestionBankEntry);
  }

  async entry(filePath: string, questionId: string): Promise<QuestionBankEntry | null> {
    this.requireRoot();
    await this.update(filePath);
    const question = this.findEntry(filePath, questionId);
    return question ? publicQuestionBankEntry(question) : null;
  }

  async readBasket(): Promise<QuestionBasketItem[]> {
    const root = this.requireRoot();
    await this.basketWrite;
    let references: QuestionBasketReference[] = [];
    try {
      const file = path.join(await workspaceStorageDirectory(root, ["question-bank"], false), "basket.json");
      const parsed = JSON.parse(await readFile(file, "utf8"));
      if (parsed?.version === BASKET_VERSION && Array.isArray(parsed.items)) references = sanitizeBasket(parsed.items);
    } catch { /* No basket yet, or an unreadable one: start empty. */ }
    return references.map(reference => this.resolveBasketItem(reference));
  }

  async writeBasket(items: unknown): Promise<QuestionBasketItem[]> {
    const root = this.requireRoot();
    const references = sanitizeBasket(items);
    const write = this.basketWrite.then(async () => {
      const directory = await workspaceStorageDirectory(root, ["question-bank"], true);
      await writeAtomic(path.join(directory, "basket.json"), JSON.stringify({ version: BASKET_VERSION, items: references }));
    });
    this.basketWrite = write.catch(() => undefined);
    await write;
    return references.map(reference => this.resolveBasketItem(reference));
  }

  /** Documents with questions carrying any of these tags, as last indexed, and how many such questions each has. */
  documentsWithTags(tags: readonly string[]): Array<{ path: string; questions: number }> {
    const wanted = new Set(tags);
    return [...this.documents].flatMap(([filePath, document]) => {
      const questions = document.questions.filter(question => question.tags.some(tag => wanted.has(tag))).length;
      return questions ? [{ path: filePath, questions }] : [];
    });
  }

  /** The teacher's tag groups for this workspace; empty until any is made. */
  async readTagTree(): Promise<QuestionTagTree> {
    this.requireRoot();
    await this.tagTreeLoad;
    await this.tagTreeWrite;
    return this.tagTree;
  }

  async writeTagTree(input: unknown): Promise<QuestionTagTree> {
    const root = this.requireRoot();
    const generation = this.generation;
    const tagTree = normalizeQuestionTagTree(input);
    // After the initial load, so a slow read cannot replace what was just written.
    const write = Promise.all([this.tagTreeLoad, this.tagTreeWrite]).then(async () => {
      await writeWorkspaceTagTree(root, tagTree);
      this.updateTagTree(tagTree, generation);
    });
    this.tagTreeWrite = write.catch(() => undefined);
    await write;
    return tagTree;
  }

  private loadTagTree(root: string): Promise<QuestionTagTree> { return readWorkspaceTagTree(root); }

  private updateTagTree(tagTree: QuestionTagTree, generation: number) {
    if (generation !== this.generation) return;
    this.tagTree = tagTree;
    this.searches.clear();
    this.tagRevision++;
  }

  private resolveBasketItem(reference: QuestionBasketReference): QuestionBasketItem {
    // Per-document lookup sees a just re-indexed file before the debounced rebuild.
    const exact = this.findEntry(joinWorkspacePath(this.root ?? "", reference.relativePath), reference.questionId);
    // Renamed or moved documents keep their question IDs: follow the same content.
    const moved = exact ? undefined : [...this.documents.values()].flatMap(document => document.questions)
      .find(question => question.questionId === reference.questionId && question.contentHash === reference.contentHash);
    const question = exact ?? moved;
    if (!question) return { ...reference, status: this.status.state === "ready" ? "missing" : "pending", entry: null };
    return {
      ...reference,
      relativePath: question.relativePath,
      status: question.contentHash === reference.contentHash ? "ready" : "changed",
      entry: publicQuestionBankEntry(question)
    };
  }

  /** Verify the path and file fingerprint before reusing a parsed paper. Callers copy what they return. */
  private async readArchive(root: string, filePath: string) {
    const verifiedArchives = this.verifiedArchives;
    const { canonicalFile, fileStats } = await inspectWorkspaceDocument(root, filePath);
    const { dev, ino, size, mtimeMs, ctimeMs } = fileStats;
    const fingerprint = `${dev}:${ino}:${size}:${mtimeMs}:${ctimeMs}`;
    const cached = this.archives.get(canonicalFile);
    if (cached?.fingerprint === fingerprint) {
      this.archives.delete(canonicalFile);
      this.archives.set(canonicalFile, cached);
      return cached.archive;
    }
    const archive = readFile(canonicalFile).then(async (bytes): Promise<ChalkLeeArchiveReader> => {
      // The scan verified the entire archive. Compare the bytes we actually read,
      // including when a file was replaced between stat and readFile.
      if (verifiedArchives?.has(createHash("sha256").update(bytes).digest("hex"))) {
        return cachePreviewAssets(await openChalkLeeArchiveForReading(bytes));
      }
      const { document, manifest, assets } = await readChalkLeeArchive(bytes);
      return { document, manifest, readAsset: async id => assets[id] };
    });
    this.archives.set(canonicalFile, { fingerprint, archive });
    if (this.archives.size > ARCHIVE_CACHE) this.archives.delete(this.archives.keys().next().value!);
    archive.catch(() => { if (this.archives.get(canonicalFile)?.archive === archive) this.archives.delete(canonicalFile); });
    return archive;
  }

  private async indexFile(root: string, filePath: string, generation: number) {
    const relativePath = this.relative(filePath);
    let createdAt: number | undefined;
    try {
      const { canonicalFile, fileStats } = await inspectWorkspaceDocument(root, filePath);
      createdAt = fileStats.birthtimeMs;
      const { document, manifest } = await readChalkLeeArchiveMetadata(await readFile(canonicalFile));
      const assetHashes = new Map(manifest.assets.map(asset => [asset.id, asset.sha256]));
      const entries = extractQuestionBankEntries(document, { path: filePath, relativePath, documentTitle: documentTitle(filePath), assetHashes });
      if (generation !== this.generation) return;
      this.documents.set(filePath, { relativePath, size: fileStats.size, modifiedAt: fileStats.mtimeMs, createdAt, failed: false, questions: entries.map(indexQuestionBankEntry) });
    } catch (error) {
      if (generation !== this.generation) return;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") this.documents.delete(filePath);
      else this.documents.set(filePath, { relativePath, size: -1, modifiedAt: -1, createdAt, failed: true, questions: [] });
    }
    this.overviewCache = undefined;
  }

  private findEntry(filePath: string, questionId: string) {
    const document = this.documents.get(filePath);
    return document?.questions.find(question => question.questionId === questionId);
  }

  private rebuild() {
    if (this.rebuildTimer) { clearTimeout(this.rebuildTimer); this.rebuildTimer = null; }
    const questions = [...this.documents.values()].flatMap(document => document.questions);
    // Figures that differ in bytes are compared by look once read; until then the questions stay apart.
    const unread = new Set<string>();
    assignDuplicateGroups(questions, (left, right) => {
      const prints = [left, right].map(figure => {
        const print = this.figurePrints.get(figure);
        if (print === undefined && figure.startsWith("sha256:")) unread.add(figure);
        return print;
      });
      return prints.every(print => print != null) && sameFigurePrint(prints[0]!, prints[1]!);
    });
    this.questions = questions;
    this.overviewCache = undefined;
    this.searches.clear();
    if (unread.size) this.printFigures(unread, questions);
    this.revision++;
    const failedDocuments = [...this.documents.values()].filter(document => document.failed).length;
    this.status = { ...this.status, questionCount: questions.length, failedDocuments };
    this.options.changed?.({ revision: this.revision, status: this.status });
  }

  /** Reads how these figures look from a paper holding each, then regroups; one batch at a time. */
  private printFigures(figures: ReadonlySet<string>, questions: readonly IndexedQuestion[]) {
    const root = this.root, generation = this.generation;
    if (this.printing || !root) return;
    const papers = new Map<string, Set<string>>();
    for (const question of questions) for (const figure of question.figures) {
      if (!figures.has(figure) || [...papers.values()].some(needed => needed.has(figure))) continue;
      papers.set(question.path, (papers.get(question.path) ?? new Set()).add(figure));
    }
    this.printing = (async () => {
      for (const [filePath, needed] of papers) {
        const archive = await this.readArchive(root, filePath).catch(() => null);
        if (generation !== this.generation) return;
        if (archive) for (const asset of archive.manifest.assets) {
          const figure = `sha256:${asset.sha256}`;
          if (!needed.has(figure)) continue;
          const data = await archive.readAsset(asset.id).catch(() => undefined);
          if (generation !== this.generation) return;
          this.figurePrints.set(figure, pictureFigurePrint(asset.mediaType, data));
        }
        // A paper that cannot be read leaves its figures apart from every other.
        for (const figure of needed) if (!this.figurePrints.has(figure)) this.figurePrints.set(figure, null);
      }
    })().finally(() => {
      this.printing = null;
      if (generation !== this.generation) return;
      this.scheduleRebuild();
      this.schedulePersist();
    });
  }

  private scheduleRebuild() {
    if (this.rebuildTimer) return;
    this.rebuildTimer = setTimeout(() => this.rebuild(), this.options.rebuildDelayMs ?? 250);
  }

  private schedulePersist() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    const root = this.root, generation = this.generation;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      if (root && generation === this.generation) void this.writeCache(root).catch(() => undefined);
    }, this.options.persistDelayMs ?? 1500);
  }

  /** Flush pending index work; used by tests and before quitting. */
  async flush() {
    if (this.rebuildTimer) this.rebuild();
    while (this.printing) {
      await this.printing;
      if (this.rebuildTimer) this.rebuild();
    }
    if (this.persistTimer && this.root) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
      await this.writeCache(this.root);
    }
    await this.basketWrite;
    await this.tagTreeWrite;
  }

  private async readCache(root: string) {
    const documents = new Map<string, IndexCache["documents"][number]>(), figures = new Map<string, string | null>();
    try {
      const file = path.join(await workspaceStorageDirectory(root, ["question-bank"], false), "index.json");
      const cache = JSON.parse(await readFile(file, "utf8")) as IndexCache;
      if (cache?.version !== CACHE_VERSION || !Array.isArray(cache.documents)) return { documents, figures };
      for (const document of cache.documents) if (typeof document?.relativePath === "string" && Array.isArray(document.entries)) documents.set(document.relativePath, document);
      for (const [figure, print] of Object.entries(cache.figures ?? {})) if (typeof print === "string" || print === null) figures.set(figure, print);
    } catch { /* Missing or stale cache: index from the files. */ }
    return { documents, figures };
  }

  private async writeCache(root: string) {
    const used = new Set(this.questions.flatMap(question => question.figures));
    const cache: IndexCache = {
      version: CACHE_VERSION,
      documents: [...this.documents.values()].filter(document => document.size >= 0).map(document => ({
        relativePath: document.relativePath, size: document.size, modifiedAt: document.modifiedAt, failed: document.failed,
        entries: document.questions.map(question => {
          const { path: _path, ...entry } = publicQuestionBankEntry(question);
          return entry;
        })
      })),
      figures: Object.fromEntries([...this.figurePrints].filter(([figure]) => used.has(figure)))
    };
    const directory = await workspaceStorageDirectory(root, ["question-bank"], true);
    await writeAtomic(path.join(directory, "index.json"), JSON.stringify(cache));
  }

  private requireRoot() {
    if (!this.root) throw new Error("尚未打开工作区。");
    return this.root;
  }

  private relative(filePath: string) {
    return path.relative(this.root ?? "", filePath).split(path.sep).join("/");
  }

  private clearTimers() {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.rebuildTimer = this.persistTimer = null;
  }
}

/** Share concurrent and recent reads without retaining a whole paper's inflated images. */
function cachePreviewAssets(archive: ChalkLeeArchiveReader): ChalkLeeArchiveReader {
  const sizes = new Map(archive.manifest.assets.map(asset => [asset.id, asset.byteLength]));
  const recent = new Map<string, { data: Promise<Uint8Array>; size: number }>();
  let total = 0;
  return {
    ...archive,
    readAsset(id) {
      const existing = recent.get(id);
      if (existing) {
        recent.delete(id);
        recent.set(id, existing);
        return existing.data;
      }
      const data = archive.readAsset(id);
      const size = sizes.get(id);
      if (size === undefined || size > ARCHIVE_ASSET_CACHE_BYTES) return data;
      const entry = { data, size };
      recent.set(id, entry);
      total += size;
      for (const [key, oldest] of recent) {
        if (total <= ARCHIVE_ASSET_CACHE_BYTES) break;
        recent.delete(key);
        total -= oldest.size;
      }
      void data.catch(() => {
        if (recent.get(id) !== entry) return;
        recent.delete(id);
        total -= size;
      });
      return data;
    }
  };
}

function chalkLeeFiles(directory: WorkspaceDirectoryNode): WorkspaceFileNode[] {
  return directory.children.flatMap(node => node.kind === "directory" ? chalkLeeFiles(node) : node.extension === "chalklee" ? [node] : []);
}

function isInternalPath(root: string, filePath: string) {
  return path.relative(root, filePath).split(path.sep).some(part => part.startsWith("."));
}

const documentTitle = (filePath: string) => path.basename(filePath).replace(/\.chalklee$/i, "");

function findQuestionNode(nodes: JsonNode[], questionId: string): JsonNode | null {
  for (const node of nodes) {
    if ((node.type === "question" || node.type === "questionGroup") && node.attrs?.id === questionId) return node;
    if (node.content) {
      const found = findQuestionNode(node.content, questionId);
      if (found) return found;
    }
  }
  return null;
}

function collectAssetIds(node: JsonNode, ids: Set<string>, visibleIds?: Set<string>) {
  if ((node.type === "image" || node.type === "imageInline") && typeof node.attrs?.assetId === "string") {
    ids.add(node.attrs.assetId);
    visibleIds?.add(node.attrs.assetId);
  }
  const childVisibleIds = node.type === "questionAnswer" || node.type === "questionAnalysis" ? undefined : visibleIds;
  node.content?.forEach(child => collectAssetIds(child, ids, childVisibleIds));
}

function findImageAssetId(node: JsonNode | undefined): string | null {
  if (!node) return null;
  if ((node.type === "image" || node.type === "imageInline") && typeof node.attrs?.assetId === "string") return node.attrs.assetId;
  for (const child of node.content ?? []) {
    const hit = findImageAssetId(child);
    if (hit) return hit;
  }
  return null;
}

/** The stem figure first, then any figure in the question, so the thumbnail says what the question is about. */
function firstImageAssetId(node: JsonNode): string | null {
  const stem = node.content?.find(child => child.type === "questionStem" || child.type === "questionMaterial");
  return findImageAssetId(stem) ?? findImageAssetId(node);
}

function sanitizeBasket(items: unknown): QuestionBasketReference[] {
  if (!Array.isArray(items)) throw new Error("选题篮内容无效。");
  const seen = new Set<string>();
  const result: QuestionBasketReference[] = [];
  for (const item of items.slice(0, MAX_BASKET_ITEMS)) {
    if (!item || typeof item !== "object") continue;
    const { relativePath, questionId, contentHash, addedAt, insertedInto } = item as Record<string, unknown>;
    if (typeof relativePath !== "string" || !relativePath || relativePath.length > 1000 || relativePath.split("/").includes("..") || path.isAbsolute(relativePath)) continue;
    if (typeof questionId !== "string" || !questionId || questionId.length > 200 || typeof contentHash !== "string" || contentHash.length > 64) continue;
    const key = `${relativePath}\u0000${questionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      relativePath, questionId, contentHash,
      addedAt: typeof addedAt === "number" && Number.isFinite(addedAt) ? addedAt : Date.now(),
      insertedInto: Array.isArray(insertedInto) ? [...new Set(insertedInto.filter((value): value is string => typeof value === "string" && value.length <= 1000))].slice(0, 50) : []
    });
  }
  return result;
}

/** A workspace's tag groups as saved, for when its index is not the open one. */
export async function readWorkspaceTagTree(root: string): Promise<QuestionTagTree> {
  try {
    const file = path.join(await workspaceStorageDirectory(root, ["question-bank"], false), "tags.json");
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (parsed?.version === TAG_TREE_VERSION) return normalizeQuestionTagTree(parsed);
  } catch { /* No groups yet, or an unreadable file: start without groups. */ }
  return EMPTY_QUESTION_TAG_TREE;
}

export async function writeWorkspaceTagTree(root: string, tagTree: QuestionTagTree): Promise<void> {
  const directory = await workspaceStorageDirectory(root, ["question-bank"], true);
  await writeAtomic(path.join(directory, "tags.json"), JSON.stringify({ version: TAG_TREE_VERSION, groups: tagTree.groups, tags: tagTree.tags }));
}

async function writeAtomic(filePath: string, text: string) {
  const temporary = `${filePath}.${randomUUID()}.next`;
  try {
    await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
