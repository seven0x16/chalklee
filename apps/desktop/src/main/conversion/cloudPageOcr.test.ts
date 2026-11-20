import { setTimeout as delay } from "node:timers/promises";
import JSZip from "jszip";
import { afterEach, expect, it, vi } from "vitest";
import { pageRecognizer } from "./pageOcr";
import { ocrPageTranscript } from "./ocrTranscript";

vi.mock("node:timers/promises", { spy: true });

const png = Buffer.from("mocked page data").toString("base64");
const signal = new AbortController().signal;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("normalizes GLM-OCR server pixels for image crops and retains formulas", async () => {
  const request = vi.fn(async () => Response.json({
    data_info: { pages: [{ width: 1600, height: 2000 }] },
    layout_details: [[
      { label: "text", content: "6. 如图，计算面积。", bbox_2d: [160, 100, 1200, 150] },
      { label: "figure", bbox_2d: [160, 200, 800, 600] },
      { label: "formula", content: "S=ab", bbox_2d: [160, 700, 400, 800] }
    ]]
  }));
  vi.stubGlobal("fetch", request);
  const reference = await pageRecognizer({ provider: "glm-ocr", apiKey: "test" }).recognize(png, "page.png", signal);
  expect(reference.imageCandidates[0].box).toEqual([100, 100, 400, 200]);
  expect(ocrPageTranscript(reference).markdown).toContain("$$S=ab$$");
  expect(request).toHaveBeenCalledWith("https://open.bigmodel.cn/api/paas/v4/layout_parsing", expect.objectContaining({
    body: JSON.stringify({ model: "glm-ocr", file: `data:image/png;base64,${png}` })
  }));
});

it("reads Qwen's workspace-specific structured response and rejects truncated output", async () => {
  const layout = [
    { category: "table", bbox: [20, 30, 400, 200], content: "<table><tr><td>数量</td></tr><tr><td>2</td></tr></table>" },
    { category: "image", bbox: [400, 100, 800, 200], content: "<img src='images/figure.jpg'/>" }
  ];
  const response = (finish_reason: string) => Response.json({ choices: [{ finish_reason, message: { content: JSON.stringify(layout) } }] });
  const request = vi.fn().mockResolvedValueOnce(response("stop")).mockResolvedValueOnce(response("length"));
  vi.stubGlobal("fetch", request);
  const recognizer = pageRecognizer({ provider: "qwen-ocr", apiKey: "test", workspaceId: "llm-test" });
  const result = await recognizer.recognize(png, "page.png", signal);
  expect(ocrPageTranscript(result).markdown).toContain("| 数量 |");
  expect(result.imageCandidates[0].box).toEqual([400, 100, 400, 100]);
  expect(request.mock.calls[0][0]).toBe("https://llm-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions");
  await expect(recognizer.recognize(png, "page.png", signal)).rejects.toThrow("未返回完整结果");
});

it("uploads one MinerU page, polls and extracts text and figure locations from its ZIP", async () => {
  const upload = "https://mineru.oss-cn-shanghai.aliyuncs.com/api-upload/test";
  const download = "https://cdn-mineru.openxlab.org.cn/result.zip";
  const archive = new JSZip();
  archive.file("page_content_list.json", JSON.stringify([
    { type: "text", text: "6. 如图。", bbox: [10, 20, 800, 40], page_idx: 0 },
    { type: "image", bbox: [100, 200, 300, 400], img_caption: ["第6题图"], page_idx: 0 }
  ]));
  const data = await archive.generateAsync({ type: "uint8array" });
  vi.mocked(delay).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
  const request = vi.fn()
    .mockResolvedValueOnce(Response.json({ code: 0, data: { batch_id: "batch-test", file_urls: [upload] } }))
    .mockResolvedValueOnce(new Response(null))
    .mockResolvedValueOnce(Response.json({ code: 0, data: { extract_result: [{ state: "running" }] } }))
    .mockResolvedValueOnce(Response.json({ code: 0, data: { extract_result: [{ state: "done", full_zip_url: download }] } }))
    .mockResolvedValueOnce(new Response(new Uint8Array(data)));
  vi.stubGlobal("fetch", request);
  const result = pageRecognizer({ provider: "mineru", apiKey: "test" }).recognize(png, "page.png", signal);
  await expect(result).resolves.toMatchObject({ imageCandidates: [{ box: [100, 200, 200, 200] }] });
  expect(request.mock.calls.map(call => call[0])).toEqual([
    "https://mineru.net/api/v4/file-urls/batch", upload,
    "https://mineru.net/api/v4/extract-results/batch/batch-test",
    "https://mineru.net/api/v4/extract-results/batch/batch-test", download
  ]);
  expect(request.mock.calls[1][1].headers).toBeUndefined();
  expect(request.mock.calls[4][1].headers).toBeUndefined();
});
