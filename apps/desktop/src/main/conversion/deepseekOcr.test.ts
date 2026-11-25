import { describe, expect, it, vi } from "vitest";
import { DeepSeekPageRecognizer, markdownTable, normalizeDeepSeekOcr } from "./deepseekOcr";
import { OcrError } from "./ocrReference";
import { ocrPageTranscript } from "./ocrTranscript";

const A4 = { width: 1190, height: 1684 };
const block = (type: string, box: number[], text = "") => `<｜ref｜>${type}<｜/ref｜><｜box｜>[[${box.join(",")}]]<｜/box｜> ${text}\n`;

describe("DeepSeek OCR pages", () => {
  it("reads blocks into the same transcript as other OCR models", () => {
    const page = normalizeDeepSeekOcr([
      block("sub_title", [100, 50, 400, 70], "## 一、选择题"),
      block("text", [100, 80, 700, 100], "1. 计算 $\\frac{1}{2}+1$ 的值（）"),
      block("text", [120, 110, 200, 125], "A. 1"),
      block("text", [300, 110, 380, 125], "B. 2"),
      block("image", [500, 140, 700, 260]),
      block("image_caption", [560, 265, 640, 280], "<center>第1题图</center>"),
      block("footer", [300, 950, 700, 965], "第1页 共4页")
    ].join(""), A4);
    expect(page.layouts.map(layout => layout.type)).toEqual(["paragraph_title", "text", "text", "text", "image", "figure_title", "footer"]);
    expect(page.layouts[4].box).toEqual([500, 140, 200, 120]);
    expect(ocrPageTranscript(page).markdown).toBe("## 一、选择题\n\n1. 计算 $\\frac{1}{2}+1$ 的值（）\n\n[[figure_1]]\n\nA. 1  B. 2");
  });

  it("keeps option figures that come back inside the box of their letter", () => {
    const page = normalizeDeepSeekOcr([
      block("text", [100, 80, 700, 96], "2. 下面哪个图形是轴对称图形（）"),
      block("text", [120, 110, 230, 135], "A."),
      block("text", [300, 110, 410, 135], "B."),
      block("text", [480, 116, 490, 128], "C"),
      block("image", [500, 105, 580, 140])
    ].join(""), A4);
    const transcript = ocrPageTranscript(page);
    expect(transcript.markdown).toBe("2. 下面哪个图形是轴对称图形（）\n\nA.  [[figure_1]]\n\nB.  [[figure_2]]\n\nC  [[figure_3]]");
    expect(transcript.figures.map(figure => figure.optionLabel)).toEqual(["A", "B", "C"]);
    const [first] = transcript.figures;
    expect(first.crop![0]).toBeGreaterThan(120);
    expect(first.crop![0] + first.crop![2]).toBe(230);
  });

  it("writes tables as Markdown and blanks outside formulas", () => {
    expect(markdownTable("<table><tr><td rowspan=\"2\">作物</td><td colspan=\"2\">产量</td></tr><tr><td>今年</td><td>去年</td></tr><tr><td>水稻</td><td>3 | 4</td><td>5</td></tr></table>"))
      .toBe("| 作物 | 产量 |  |\n| --- | --- | --- |\n|  | 今年 | 去年 |\n| 水稻 | 3 \\| 4 | 5 |");
    const page = normalizeDeepSeekOcr(block("text", [100, 80, 700, 96], "(1) 加速度 $a = \\_\\_\\_\\_\\_\\_ \\text{m/s}^2$；") + block("table", [100, 100, 500, 160], "<table><tr><td>t/s</td><td>0</td></tr></table>"), A4);
    expect(ocrPageTranscript(page).markdown).toBe("(1) 加速度 $a =$______$\\text{m/s}^2$；\n\n| t/s | 0 |\n| --- | --- |");
    // Comparison signs in a cell's formulas are not tags; a display formula with a blank keeps its other formulas whole.
    expect(markdownTable("<table><tr><td>范围</td><td>$x < 5$ 且 $x > 0$</td><td><b>甲</b>&lt;乙</td></tr></table>"))
      .toBe("| 范围 | $x < 5$ 且 $x > 0$ | 甲<乙 |\n| --- | --- | --- |");
    const display = normalizeDeepSeekOcr(block("text", [100, 80, 700, 96], "\\[v = \\_\\_\\_\\_ \\text{m/s}\\] 且 $t = 2$"), A4);
    expect(ocrPageTranscript(display).markdown).toBe("$v =$______$\\text{m/s}$ 且 $t = 2$");
  });

  it("treats a page without recognized blocks as not recognized", () => {
    expect(() => normalizeDeepSeekOcr("", A4)).toThrow("没有识别出这一页的内容");
    expect(() => normalizeDeepSeekOcr("只有文字", A4)).toThrow("没有返回内容位置");
    expect(() => normalizeDeepSeekOcr(block("text", [300, 80, 200, 96], "坐标反了"), A4)).toThrow("坐标无效");
  });
});

describe("DeepSeek OCR requests", () => {
  const png = () => {
    const header = Buffer.alloc(33);
    header.writeUInt32BE(0x89504e47, 0); header.writeUInt32BE(0x0d0a1a0a, 4); header.writeUInt32BE(13, 8);
    header.write("IHDR", 12, "ascii"); header.writeUInt32BE(A4.width, 16); header.writeUInt32BE(A4.height, 20);
    return header.toString("base64");
  };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const recognized = (text: string, finish = "stop") => reply(200, { object: "ocr.result", page_count: 1, pages: [{ index: 0, text, finish_reason: finish }] });

  it("uploads the page for layout recognition with the DeepSeek key and waits out rate limits", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(reply(429, { error: { message: "Too many requests" } }))
      .mockResolvedValueOnce(recognized(block("text", [100, 80, 700, 96], "1. 题目")));
    const result = await new DeepSeekPageRecognizer({ apiKey: "sk-test", fetch }).recognize(png(), "page-1.png", new AbortController().signal);
    expect(result.layouts).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/v1/tools/ocr");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    const body = Buffer.from(init.body).toString("latin1");
    expect(body).toContain("name=\"purpose\"\r\n\r\nrich_layout_recognition");
    expect(body).toContain("filename=\"page-1.png\"");
  });

  it("stops using OCR for key and balance problems but only skips the page otherwise", async () => {
    // Each request gets a fresh reply, as a page sent again would.
    const attempt = (response: Response) => new DeepSeekPageRecognizer({ apiKey: "sk-test", fetch: vi.fn(async () => response.clone()) })
      .recognize(png(), "page.png", new AbortController().signal).then(() => undefined, (error: OcrError) => [error.message, error.account]);
    expect(await attempt(reply(401, { error: { message: "Authentication Fails" } }))).toEqual(["DeepSeek API Key 无效，请检查后重新填写。", true]);
    expect(await attempt(reply(402, { error: { message: "Insufficient Balance" } }))).toEqual(["DeepSeek 账户余额不足，请充值后重试。", true]);
    expect(await attempt(reply(200, { error: { message: "recognition failed" } }))).toEqual(["DeepSeek OCR 识别未完成：recognition failed", false]);
    expect(await attempt(recognized(block("text", [100, 80, 700, 96], "1. 题"), "length"))).toEqual(["DeepSeek OCR 的识别结果不完整。", false]);
    expect(await attempt(recognized(""))).toEqual(["OCR 没有识别出这一页的内容。", false]);
  });

  it("asks once more when a page comes back empty", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(recognized("")).mockResolvedValueOnce(recognized(block("text", [100, 80, 700, 96], "1. 题目")));
    const result = await new DeepSeekPageRecognizer({ apiKey: "sk-test", fetch }).recognize(png(), "page.png", new AbortController().signal);
    expect(result.layouts).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
