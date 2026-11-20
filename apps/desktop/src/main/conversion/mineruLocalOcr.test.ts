import { setTimeout as delay } from "node:timers/promises";
import JSZip from "jszip";
import { afterEach, expect, it, vi } from "vitest";
import { MineruLocalPageRecognizer } from "./mineruLocalOcr";
import { OcrError } from "./ocrReference";
import { ocrPageTranscript } from "./ocrTranscript";
import { pageRecognizer } from "./pageOcr";

vi.mock("node:timers/promises", { spy: true });

const png = Buffer.from("mocked page data").toString("base64");
const signal = new AbortController().signal;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const url = (input: unknown) => String(input);
const authorization = (init: RequestInit | undefined) => new Headers(init?.headers).get("Authorization");

it("parses a page through MinerU 4.x tasks, sending the key only to the service itself", async () => {
  const archive = new JSZip();
  archive.file("structured_content.json", JSON.stringify({ pages: [{ page_idx: 0, blocks: [
    { type: "paragraph_title", bbox: [0.1, 0.05, 0.5, 0.07], level: 2, content: "一、单选题" },
    { type: "text", bbox: [0.1, 0.1, 0.8, 0.14], content: "6. 如图，求 $x$ 的值。" },
    { type: "image", bbox: [0.2, 0.2, 0.4, 0.4], content: "", captions: [{ bbox: [0.25, 0.41, 0.35, 0.43], content: "第6题图" }], footnotes: [] },
    { type: "equation", bbox: [0.3, 0.45, 0.6, 0.5], content: "x^2=4" },
    { type: "page_number", bbox: [0.45, 0.95, 0.55, 0.97], content: "第1页" }
  ] }] }));
  const zip = await archive.generateAsync({ type: "uint8array" });
  const upload = "https://storage.example.org/upload/page";
  vi.mocked(delay).mockResolvedValue(undefined);
  const request = vi.fn()
    .mockResolvedValueOnce(Response.json({ status: "ok", version: "4.2.3" }))
    .mockResolvedValueOnce(Response.json({ task_id: "job_1", status: "waiting-file", files: [{ file_id: "file-1", status: "waiting-file", upload: { url: upload, headers: { "Content-Type": "application/octet-stream" } } }] }, { status: 202 }))
    .mockResolvedValueOnce(new Response(null))
    .mockResolvedValueOnce(Response.json({ task_id: "job_1", status: "running", files: [{ file_id: "file-1", status: "running" }] }))
    .mockResolvedValueOnce(Response.json({ task_id: "job_1", status: "completed", files: [{ file_id: "file-1", status: "completed", result_url: "http://192.168.1.20:8000/v1/files/file-1/content" }] }))
    .mockResolvedValueOnce(new Response(new Uint8Array(zip)));
  vi.stubGlobal("fetch", request);
  const page = await pageRecognizer({ provider: "mineru-local", baseUrl: "http://192.168.1.20:8000", apiKey: "local-key" }).recognize(png, "a/b:c.png", signal);
  expect(request.mock.calls.map(call => url(call[0]))).toEqual([
    "http://192.168.1.20:8000/v1/health", "http://192.168.1.20:8000/v1/tasks", upload,
    "http://192.168.1.20:8000/v1/tasks/job_1", "http://192.168.1.20:8000/v1/tasks/job_1", "http://192.168.1.20:8000/v1/files/file-1/content"
  ]);
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ files: [{ file_name: "a_b_c.png", bytes: 16 }], output_formats: ["default"] });
  expect(request.mock.calls.map(call => authorization(call[1]))).toEqual([null, "Bearer local-key", null, "Bearer local-key", "Bearer local-key", "Bearer local-key"]);
  expect(new Headers(request.mock.calls[2][1].headers).get("Content-Type")).toBe("application/octet-stream");
  expect(page.imageCandidates).toEqual([{ id: "block_3", type: "image", sourceImageId: "page_1", box: [200, 200, 200, 200] }]);
  // The caption, boxed apart from its figure, names the question; the page number is left out.
  expect(ocrPageTranscript(page)).toMatchObject({
    markdown: "## 一、单选题\n\n6. 如图，求 $x$ 的值。\n\n[[figure_1]]\n\n$$x^2=4$$",
    figures: [{ id: "figure_1", crop: [200, 200, 200, 200], alt: "第6题图", questionNumber: "6" }]
  });
});

it("parses a page through /file_parse on MinerU 2.x and 3.x, which have no /v1/health", async () => {
  const contentList = [
    { type: "text", text: "7. 计算：", bbox: [10, 20, 800, 40], page_idx: 0 },
    { type: "list", sub_type: "text", list_items: ["A. 1", "B. 2"], bbox: [10, 50, 800, 90], page_idx: 0 },
    { type: "image", bbox: [100, 200, 300, 400], image_caption: ["第7题图"], page_idx: 0 }
  ];
  const request = vi.fn()
    .mockResolvedValueOnce(Response.json({ detail: "Not Found" }, { status: 404 }))
    .mockResolvedValueOnce(Response.json({ backend: "hybrid-engine", version: "3.4.5", results: { page: { content_list: JSON.stringify(contentList) } } }));
  vi.stubGlobal("fetch", request);
  const recognizer = pageRecognizer({ provider: "mineru-local", baseUrl: "http://127.0.0.1:8000" });
  const page = await recognizer.recognize(png, "page.png", signal);
  expect(request.mock.calls.map(call => url(call[0]))).toEqual(["http://127.0.0.1:8000/v1/health", "http://127.0.0.1:8000/file_parse"]);
  const form = request.mock.calls[1][1].body as FormData;
  expect([form.get("return_content_list"), form.get("return_md"), (form.get("files") as File).name]).toEqual(["true", "false", "page.png"]);
  expect(authorization(request.mock.calls[1][1])).toBeNull();
  expect(page.layouts.map(layout => layout.text ?? layout.type)).toEqual(["7. 计算：", "A. 1\nB. 2", "image", "第7题图"]);
  // The service's version is asked once per conversion.
  request.mockResolvedValueOnce(Response.json({ results: { page: { content_list: contentList } } }));
  await recognizer.recognize(png, "page.png", signal);
  expect(url(request.mock.calls[2][0])).toBe("http://127.0.0.1:8000/file_parse");
});

it("stops asking a service that cannot be reached, has no MinerU or refuses the key; other failures are per page", async () => {
  const failure = async (...responses: (Response | Error)[]) => {
    const request = vi.fn();
    for (const response of responses) {
      if (response instanceof Error) request.mockRejectedValueOnce(response); else request.mockResolvedValueOnce(response);
    }
    vi.stubGlobal("fetch", request);
    const error = await pageRecognizer({ provider: "mineru-local", baseUrl: "http://127.0.0.1:8000" }).recognize(png, "page.png", signal).catch(caught => caught);
    expect(error).toBeInstanceOf(OcrError);
    return [error.message, error.account];
  };
  expect(await failure(new TypeError("fetch failed"))).toEqual(["无法连接 MinerU 本地服务，请确认服务已经启动、地址正确。", true]);
  expect(await failure(new Response("Not Found", { status: 404 }), new Response("Not Found", { status: 404 }))).toEqual(["这个地址没有找到 MinerU 解析服务，请检查服务地址。", true]);
  expect(await failure(Response.json({ status: "ok" }), Response.json({ error: { code: "invalid_api_key" } }, { status: 401 }))).toEqual(["MinerU 本地服务的 API Key 不正确或没有填写。", true]);
  expect(await failure(new Response("", { status: 404 }), Response.json({ results: { page: { content_list: [{ type: "text", text: "1.", page_idx: 0 }] } } })))
    .toEqual(["这个 MinerU 版本返回的版面没有坐标，请升级到 2.2 或更高版本。", true]);
  expect(await failure(new Response("", { status: 404 }), Response.json({ message: "Task execution failed" }, { status: 409 }))).toEqual(["MinerU 未能解析这一页。", false]);
  expect(await failure(Response.json({ status: "ok" }), Response.json({ error: { code: "invalid_request" } }, { status: 400 }))).toEqual(["MinerU 本地服务请求失败（HTTP 400，invalid_request）。", false]);
  expect(await failure(new Response("", { status: 404 }), Response.json({ results: { page: {} } }))).toEqual(["MinerU 本地服务没有返回带坐标的版面。", false]);
});

it("hands a service two pages at a time and passes each finished turn on", async () => {
  const pending: ((response: Response) => void)[] = [];
  const request = vi.fn((input: unknown) => url(input).endsWith("/v1/health")
    ? Promise.resolve(new Response("", { status: 404 }))
    : new Promise<Response>(resolve => pending.push(resolve)));
  vi.stubGlobal("fetch", request);
  const recognizer = pageRecognizer({ provider: "mineru-local", baseUrl: "http://127.0.0.1:8100" });
  const result = () => Response.json({ results: { page: { content_list: [{ type: "text", text: "1. 题目", bbox: [10, 10, 500, 40], page_idx: 0 }] } } });
  const pages = [0, 1, 2].map(() => recognizer.recognize(png, "page.png", signal));
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(pending).toHaveLength(2);
  pending[0](result());
  await vi.waitFor(() => expect(pending).toHaveLength(3));
  pending[1](result()); pending[2](result());
  await expect(Promise.all(pages)).resolves.toHaveLength(3);
});

it("passes a connection check once the service returns a parse, though a page of large digits has no content to it", async () => {
  const archive = new JSZip();
  archive.file("structured_content.json", JSON.stringify({ pages: [{ page_idx: 0, blocks: [] }] }));
  const zip = new Uint8Array(await archive.generateAsync({ type: "uint8array" }));
  vi.mocked(delay).mockResolvedValue(undefined);
  const service = () => vi.fn()
    .mockResolvedValueOnce(Response.json({ status: "ok" }))
    .mockResolvedValueOnce(Response.json({ task_id: "job_1", files: [{ file_id: "file-1", status: "pending" }] }, { status: 202 }))
    .mockResolvedValueOnce(Response.json({ task_id: "job_1", files: [{ file_id: "file-1", status: "completed", result_url: "/v1/files/file-1/content" }] }))
    .mockResolvedValueOnce(new Response(zip));
  vi.stubGlobal("fetch", service());
  await expect(new MineruLocalPageRecognizer({ baseUrl: "http://127.0.0.1:8000" }).check(png, signal)).resolves.toBeUndefined();
  vi.stubGlobal("fetch", service());
  await expect(new MineruLocalPageRecognizer({ baseUrl: "http://127.0.0.1:8000" }).recognize(png, "page.png", signal)).rejects.toThrow("没有识别出这一页的内容");
});
