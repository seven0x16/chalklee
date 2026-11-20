import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn(async () => {}) }));
import { BaiduPageRecognizer, checkBaiduOcrAccess } from "./baiduOcr";

const credentials = { apiKey: "ak-private", secretKey: "sk-private" };
const reply = (body: unknown, status = 200) => ({ status, json: async () => body });
afterEach(() => { vi.unstubAllGlobals(); });

describe("Baidu OCR connection check", () => {
  it("passes when the keys work and the service answers for a task that does not exist", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply({ access_token: "token" })).mockResolvedValueOnce(reply({ error_code: 282007, error_msg: "task not exist" }));
    vi.stubGlobal("fetch", fetch);
    await expect(checkBaiduOcrAccess(credentials, new AbortController().signal)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[1][0])).toContain("/paddle-vl-parser/task/query?access_token=token");
  });
  it.each([
    ["unknown client id", "API Key 不正确"],
    ["Client authentication failed", "Secret Key 不正确"]
  ])("names the wrong key (%s)", async (description, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ error: "invalid_client", error_description: description }, 401)));
    await expect(checkBaiduOcrAccess(credentials, new AbortController().signal)).rejects.toThrow(message);
  });
  it("explains a missing interface permission and an exhausted quota", async () => {
    const fetch = vi.fn().mockResolvedValue(reply({ access_token: "token" }));
    vi.stubGlobal("fetch", fetch);
    fetch.mockResolvedValueOnce(reply({ access_token: "token" })).mockResolvedValueOnce(reply({ error_code: 6, error_msg: "No permission to access data" }));
    await expect(checkBaiduOcrAccess(credentials, new AbortController().signal)).rejects.toThrow("没有 PaddleOCR-VL 的调用权限");
    fetch.mockResolvedValueOnce(reply({ access_token: "token" })).mockResolvedValueOnce(reply({ error_code: 17 }));
    await expect(checkBaiduOcrAccess(credentials, new AbortController().signal)).rejects.toThrow("额度已用完");
  });
  it("never shows the credential-bearing request URL in network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed: https://aip.baidubce.com/oauth/2.0/token?client_secret=sk-private")));
    await expect(checkBaiduOcrAccess(credentials, new AbortController().signal)).rejects.toThrow(/^无法连接百度智能云，请检查网络后重试。$/);
  });
});

describe("Baidu OCR page recognition", () => {
  const parsed = { pages: [{ page_num: 0, page_angle: 0, meta: { page_width: 1000, page_height: 2000 }, layouts: [{ layout_id: "a", type: "text", position: [100, 200, 300, 40], text: "1. 题目" }], tables: [], images: [] }] };
  const route = (handlers: Record<string, Array<unknown>>) => vi.fn(async (url: string, _init?: RequestInit) => {
    const key = Object.keys(handlers).find(prefix => url.includes(prefix))!;
    return reply(handlers[key].length > 1 ? handlers[key].shift() : handlers[key][0]);
  });
  it("submits a page image, waits for the task and returns its layout in page coordinates", async () => {
    const fetch = route({ "oauth": [{ access_token: "token" }], "task/query": [{ result: { status: "running" } }, { result: { status: "success", parse_result_url: "https://result.example/page.json" } }], "paddle-vl-parser/task?": [{ result: { task_id: "task-1" } }], "result.example": [parsed] });
    vi.stubGlobal("fetch", fetch);
    const page = await new BaiduPageRecognizer(credentials).recognize("cGFnZQ==", "page_1.png", new AbortController().signal);
    expect(page.layouts).toEqual([{ id: "a", type: "text", box: [100, 100, 300, 20], text: "1. 题目" }]);
    const submit = fetch.mock.calls.find(([url]) => String(url).includes("paddle-vl-parser/task?"))!;
    expect(String(submit[1]?.body)).toContain("file_name=page_1.png");
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("oauth"))).toHaveLength(1);
  });
  it("waits out rate limits, renews an expired token, and never sends a failed submission twice", async () => {
    vi.stubGlobal("fetch", route({ "oauth": [{ access_token: "token" }], "paddle-vl-parser/task?": [{ error_code: 18 }, { error_code: 111 }, { result: { task_id: "task-1" } }], "task/query": [{ result: { status: "success", parse_result_url: "https://result.example/page.json" } }], "result.example": [parsed] }));
    await expect(new BaiduPageRecognizer(credentials).recognize("cGFnZQ==", "page_1.png", new AbortController().signal)).resolves.toMatchObject({ layouts: [{ id: "a" }] });
    const fetch = vi.fn().mockResolvedValueOnce(reply({ access_token: "token" })).mockRejectedValueOnce(new TypeError("socket hang up"));
    vi.stubGlobal("fetch", fetch);
    await expect(new BaiduPageRecognizer(credentials).recognize("cGFnZQ==", "page_1.png", new AbortController().signal)).rejects.toThrow("无法连接百度智能云");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("marks key and quota problems as affecting the whole account", async () => {
    vi.stubGlobal("fetch", route({ "oauth": [{ access_token: "token" }], "paddle-vl-parser/task?": [{ error_code: 17 }] }));
    await expect(new BaiduPageRecognizer(credentials).recognize("cGFnZQ==", "page_1.png", new AbortController().signal)).rejects.toMatchObject({ account: true, message: expect.stringContaining("额度已用完") });
    vi.stubGlobal("fetch", route({ "oauth": [{ access_token: "token" }], "paddle-vl-parser/task?": [{ result: { task_id: "task-1" } }], "task/query": [{ result: { status: "failed", task_error: "image too small" } }] }));
    await expect(new BaiduPageRecognizer(credentials).recognize("cGFnZQ==", "page_1.png", new AbortController().signal)).rejects.toMatchObject({ account: false, message: "百度智能云识别失败：image too small" });
  });
});
