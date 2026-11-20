import { setTimeout as delay } from "node:timers/promises";
import { mineruContentBlocks, zipText } from "./mineruOcr";
import { OcrError, type OcrReference, type PageRecognizer } from "./ocrReference";
import { structuredOcrPage, type StructuredBlock } from "./structuredOcr";

const LABEL = "MinerU 本地服务";
const NO_SERVICE = "这个地址没有找到 MinerU 解析服务，请检查服务地址。";
/** A self-hosted computer works on few pages at a time; the rest wait here rather than time out in its queue. */
const PAGES_AT_ONCE = 2;
/** Once a page's turn comes. The first page may wait for models to load, and a computer without a GPU is slow. */
const PAGE_TIMEOUT = 10 * 60_000;
const POLL_INTERVAL = 1000;
const MAX_JSON = 16 * 1024 * 1024;
/** MinerU 4.x block types under the names the transcript reads. */
const TYPES: Record<string, string> = { equation: "display_formula", page_number: "number" };

export interface MineruLocalConnection { baseUrl: string; apiKey?: string }
type Api = "tasks" | "file_parse";
/** A parsed page before its blocks are checked, with the scale of their boxes. */
interface ParsedPage { blocks: StructuredBlock[]; size?: { width: number; height: number } }

/** Turns at a service: each conversion's pages, and a connection test meanwhile, share them. */
const turns = new Map<string, <T>(signal: AbortSignal, task: () => Promise<T>) => Promise<T>>();
function turnsAt(baseUrl: string) {
  let turn = turns.get(baseUrl);
  if (!turn) {
    let active = 0;
    const waiting: (() => void)[] = [];
    turn = async (signal, task) => {
      signal.throwIfAborted();
      if (active < PAGES_AT_ONCE) active++;
      else await new Promise<void>((resolve, reject) => {
        const start = () => { signal.removeEventListener("abort", cancel); resolve(); };
        const cancel = () => { waiting.splice(waiting.indexOf(start) >>> 0, 1); reject(signal.reason); };
        waiting.push(start);
        signal.addEventListener("abort", cancel, { once: true });
      });
      try { return await task(); }
      finally {
        // The turn passes straight to the next page, if one is waiting.
        const next = waiting.shift();
        if (next) next(); else active--;
      }
    };
    turns.set(baseUrl, turn);
  }
  return turn;
}

async function errorCode(response: Response): Promise<string> {
  try {
    const body: any = JSON.parse((await response.text()).slice(0, 4096));
    const code = body?.error?.code ?? body?.detail?.[0]?.type ?? body?.message;
    return typeof code === "string" ? code.slice(0, 80) : "";
  } catch { return ""; }
}

/**
 * Pages recognized by MinerU on the teacher's own computer or server: 4.x through its V1 Tasks API,
 * 2.2 to 3.x through `/file_parse`. Which one is asked of the service itself.
 */
export class MineruLocalPageRecognizer implements PageRecognizer {
  private api?: Promise<Api>;

  constructor(private readonly connection: MineruLocalConnection) {}

  private url(path: string) { return `${this.connection.baseUrl}${path}`; }

  /** The key goes only to the service itself, not to storage it may hand out links to. */
  private async request(url: string, init: RequestInit, signal: AbortSignal, notFound = `${LABEL}找不到这个解析任务。`): Promise<Response> {
    let target: URL;
    try { target = new URL(url); } catch { throw new OcrError(`${LABEL}返回了无效的地址。`); }
    if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) throw new OcrError(`${LABEL}返回了无效的地址。`);
    const headers = new Headers(init.headers);
    if (this.connection.apiKey && target.origin === new URL(this.connection.baseUrl).origin) headers.set("Authorization", `Bearer ${this.connection.apiKey}`);
    let response: Response;
    try {
      response = await fetch(target, { ...init, headers, redirect: "error", signal });
    } catch {
      signal.throwIfAborted();
      // A service that cannot be reached would fail every page.
      throw new OcrError(`无法连接 ${LABEL}，请确认服务已经启动、地址正确。`, true);
    }
    if (response.ok) return response;
    const code = await errorCode(response);
    if (response.status === 401 || response.status === 403) throw new OcrError(`${LABEL}的 API Key 不正确或没有填写。`, true);
    if (response.status === 404 || response.status === 405) throw new OcrError(notFound, notFound === NO_SERVICE);
    if (response.status === 503) throw new OcrError(`${LABEL}暂时不可用，可能还在加载模型，请稍后重试。`);
    // 3.x answers a parse that failed this way.
    if (response.status === 409) throw new OcrError("MinerU 未能解析这一页。");
    throw new OcrError(`${LABEL}请求失败（HTTP ${response.status}${code ? `，${code}` : ""}）。`);
  }

  private async json(response: Response, signal: AbortSignal): Promise<any> {
    try {
      const text = await response.text();
      if (text.length > MAX_JSON) throw new Error("too large");
      return JSON.parse(text);
    } catch {
      signal.throwIfAborted();
      throw new OcrError(`${LABEL}返回了无法读取的结果。`);
    }
  }

  /** 4.x answers `/v1/health`, even when it asks for a key; earlier versions do not have it. */
  private async detect(signal: AbortSignal): Promise<Api> {
    let response: Response;
    try {
      response = await fetch(this.url("/v1/health"), { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
    } catch {
      signal.throwIfAborted();
      throw new OcrError(`无法连接 ${LABEL}，请确认服务已经启动、地址正确。`, true);
    }
    const body: any = await response.json().catch(() => undefined);
    return (response.ok || response.status === 503) && body && typeof body === "object" && "status" in body ? "tasks" : "file_parse";
  }

  async recognize(png: string, fileName: string, signal: AbortSignal): Promise<OcrReference> {
    const { blocks, size } = await this.parse(png, fileName, signal);
    return structuredOcrPage("mineru-local", blocks, size);
  }

  /**
   * Has the service parse a page and return its result, without asking that anything was found:
   * MinerU finds no content on a page that is only a few large digits.
   */
  async check(png: string, signal: AbortSignal): Promise<void> {
    await this.parse(png, "chalklee-ocr-test.png", signal);
  }

  private async parse(png: string, fileName: string, signal: AbortSignal): Promise<ParsedPage> {
    const page = Buffer.from(png, "base64");
    // The service keeps only the file's name, and refuses paths.
    const name = fileName.replace(/[\\/:\p{Cc}]/gu, "_") || "page.png";
    return turnsAt(this.connection.baseUrl)(signal, async () => {
      const timeout = AbortSignal.timeout(PAGE_TIMEOUT);
      const taskSignal = AbortSignal.any([signal, timeout]);
      try {
        const api = this.api ??= this.detect(taskSignal).catch(error => { this.api = undefined; throw error; });
        return (await api) === "tasks" ? await this.task(page, name, taskSignal) : await this.fileParse(page, name, taskSignal);
      } catch (error) {
        signal.throwIfAborted();
        if (timeout.aborted) throw new OcrError(`${LABEL}等待识别结果超时。`);
        throw error;
      }
    });
  }

  /** 2.x and 3.x parse the upload while the request waits, and return the content list as JSON text. */
  private async fileParse(page: Buffer, name: string, signal: AbortSignal): Promise<ParsedPage> {
    const form = new FormData();
    form.append("files", new Blob([new Uint8Array(page)], { type: "image/png" }), name);
    form.append("return_content_list", "true");
    form.append("return_md", "false");
    const response = await this.request(this.url("/file_parse"), { method: "POST", body: form }, signal, NO_SERVICE);
    const result = await this.json(response, signal);
    const parsed = result?.results && typeof result.results === "object" ? Object.values(result.results)[0] as any : undefined;
    let list = parsed?.content_list;
    if (typeof list === "string") {
      try { list = JSON.parse(list); } catch { throw new OcrError(`${LABEL}返回的版面无法读取。`); }
    }
    if (!Array.isArray(list)) throw new OcrError(`${LABEL}没有返回带坐标的版面。`);
    // 2.1 lists content without where it is on the page.
    if (list.length && !list.some(item => Array.isArray(item?.bbox))) throw new OcrError("这个 MinerU 版本返回的版面没有坐标，请升级到 2.2 或更高版本。", true);
    return { blocks: mineruContentBlocks(list) };
  }

  /** 4.x takes a task, then the page uploaded to the link it gives, and offers a ZIP once the page is parsed. */
  private async task(page: Buffer, name: string, signal: AbortSignal): Promise<ParsedPage> {
    const created = await this.json(await this.request(this.url("/v1/tasks"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [{ file_name: name, bytes: page.length }], output_formats: ["default"] })
    }, signal, NO_SERVICE), signal);
    const taskId = created?.task_id, fileId = created?.files?.[0]?.file_id;
    if (typeof taskId !== "string" || !taskId || typeof fileId !== "string") throw new OcrError(`${LABEL}没有创建解析任务。`);
    try {
      const upload = created.files[0].upload;
      if (upload) {
        if (typeof upload.url !== "string") throw new OcrError(`${LABEL}返回了无效的上传地址。`);
        const headers = Object.fromEntries(Object.entries(upload.headers ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
        const uploaded = await this.request(new URL(upload.url, `${this.connection.baseUrl}/`).href, { method: "PUT", headers, body: new Uint8Array(page) }, signal);
        await uploaded.body?.cancel();
      }
      for (;;) {
        await delay(POLL_INTERVAL, undefined, { signal });
        const detail = await this.json(await this.request(this.url(`/v1/tasks/${encodeURIComponent(taskId)}`), {}, signal), signal);
        const file = Array.isArray(detail?.files) ? detail.files.find((item: any) => item?.file_id === fileId) : undefined;
        if (file?.status === "failed" || file?.status === "canceled") {
          const reason = typeof file.error?.message === "string" ? file.error.message.slice(0, 200) : "";
          throw new OcrError(`MinerU 未能解析这一页${reason ? `（${reason}）` : ""}。`);
        }
        if (file?.status === "completed" && typeof file.result_url === "string") {
          const result = await this.request(new URL(file.result_url, `${this.connection.baseUrl}/`).href, {}, signal);
          return structuredContent(await zipText(result, /^structured_content\.json$/i, signal));
        }
      }
    } catch (error) {
      // A page given up on is not left running on the teacher's computer.
      if (signal.aborted) void fetch(this.url(`/v1/tasks/${encodeURIComponent(taskId)}/cancel`), {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
        ...(this.connection.apiKey ? { headers: { Authorization: `Bearer ${this.connection.apiKey}` } } : {})
      }).then(response => response.body?.cancel(), () => undefined);
      throw error;
    }
  }
}

/**
 * One page of a 4.x result: blocks in reading order with boxes in 0..1. Captions and notes of a figure or table
 * carry their own boxes; one without a box sits on its figure's.
 */
function structuredContent(text: string | undefined): ParsedPage {
  if (text === undefined) throw new OcrError(`${LABEL}没有返回带坐标的版面。`);
  let result: any;
  try { result = JSON.parse(text); } catch { throw new OcrError(`${LABEL}返回的版面无法读取。`); }
  const pages = result?.pages;
  if (!Array.isArray(pages) || pages.length !== 1 || !Array.isArray(pages[0]?.blocks)) throw new OcrError("MinerU 返回的页数与原稿不一致。");
  const notes = (items: unknown, type: string, box: unknown) => Array.isArray(items)
    ? items.filter(item => typeof item?.content === "string" && item.content.trim()).map(item => ({ type, box: item.bbox ?? box, text: item.content }))
    : [];
  return {
    blocks: pages[0].blocks.flatMap((block: any) => [
      { type: TYPES[block?.type] ?? block?.type, box: block?.bbox, text: block?.content },
      ...notes(block?.captions, "figure_title", block?.bbox), ...notes(block?.footnotes, "text", block?.bbox)
    ]),
    size: { width: 1, height: 1 }
  };
}
