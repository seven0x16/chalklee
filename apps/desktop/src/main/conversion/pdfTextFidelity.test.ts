import { describe, expect, it, vi } from "vitest";
import type { ImportUnit } from "../../shared/conversion/types";
import type { ImportTranscript } from "./transcript";
vi.mock("./review", () => ({ cropImportImage: (image: string) => image }));
vi.mock("./model", () => ({ runImportAgent: vi.fn() }));
vi.mock("./pdfUnderlineCrops", () => ({ pdfUnderlineBoxes: vi.fn(() => []), pdfTextUnderlineBoxes: vi.fn(() => []) }));
import { pdfTextUnderlineBoxes, pdfUnderlineBoxes } from "./pdfUnderlineCrops";
import { runImportAgent } from "./model";
import { applyPdfTextChecks, applyScannedTextEdits, checkPdfTranscriptText, pdfMissingTextLines, pdfTextConflicts } from "./pdfTextFidelity";
const unit = (text: string): ImportUnit => ({ id: "page_1", page: 1, label: "第1页", blocks: [], images: [{ id: "page_1", dataUrl: "source", widthPt: 600, heightPt: 800 }],
  pdfText: { candidate: true, reason: "", blocks: [], omittedMargins: [], lines: [{ ref: "line_1", text, box: [80, 200, 800, 20] }] } });
const transcript = (markdown: string): ImportTranscript => ({ markdown, figures: [], uncertainties: [], warnings: [] });
const decisions = (source: string) => JSON.stringify({ checks: [{ id: "text_1", source }] });

describe("source image verification of native/OCR differences", () => {
  it("sends a reading that skipped a whole question back to the page, naming the lines", async () => {
    const texts = ["23. What bad effects may AI bring to children?", "A. They may find it hard to use AI tools.", "24. What does the underlined phrase mean?",
      "A. To exchange true feelings.", "25. Which is the best title of the passage?", "A. Ways for Teenagers to Use AI Wisely",
      "B. Teenagers' Increasing Dependence on AI", "第二节 阅读下面短文，并从方框里的句子中选择"];
    const page = unit("");
    page.pdfText!.lines = texts.map((text, index) => ({ ref: `line_${index + 1}`, text, box: [80, 200 + index * 30, 800, 20] }));
    const skipped = transcript([...texts.slice(0, 4), texts[7]].join("\n"));
    expect(pdfMissingTextLines(page, skipped)).toEqual([texts.slice(4, 7).join(" / ")]);
    await expect(checkPdfTranscriptText({ apiKey: "test", baseUrl: "", model: "" }, skipped, page, new AbortController().signal)).rejects.toThrow(/漏掉了原稿文字层中的整行内容.*25\. Which is the best title/);
    // A text layer kept off the page for its drawn lines still shows what the reading skipped; a garbled one does not.
    const rejected = { ...page, pdfText: { ...page.pdfText!, candidate: false } };
    await expect(checkPdfTranscriptText({ apiKey: "test", baseUrl: "", model: "" }, skipped, rejected, new AbortController().signal)).rejects.toThrow(/25\. Which is the best title/);
    const garbled = { ...rejected, pdfText: { ...rejected.pdfText, lines: rejected.pdfText.lines.map(line => ({ ...line, text: line.text.replace(/[A-Za-z]/g, "Ꮖ").replace(/\p{Script=Han}/gu, "□") })) } };
    expect(pdfMissingTextLines(garbled, skipped)).toEqual([]);
    // Labels inside a figure stay in the picture, and a formula's scattered pieces read differently.
    const figured = { ...skipped, figures: [{ id: "figure_1", crop: [60, 310, 900, 100] }] } as unknown as ImportTranscript;
    expect(pdfMissingTextLines(page, figured)).toEqual([]);
    page.pdfText!.lines = [...page.pdfText!.lines.slice(0, 4), { ref: "f1", text: "𝑃 = 𝑊 / 𝑡 = 20×3600 kW", box: [80, 320, 800, 20] }, { ref: "f2", text: "𝐼 = 𝑃 / 𝑈 = 1.2×10 6 𝑊 / 2400𝐴", box: [80, 350, 800, 20] }];
    expect(pdfMissingTextLines(page, skipped)).toEqual([]);
  });

  it("uses a source line to correct a repeated formula without changing its other occurrence", () => {
    const original = transcript("$O=90$\n\n$O=90$\nA. one");
    expect(applyScannedTextEdits(original, JSON.stringify({ edits: [{ line: 3, before: "$O=90$", after: "$\\angle O=90$" }] })).markdown)
      .toBe("$O=90$\n\n$\\angle O=90$\nA. one");
    for (const edit of [
      { line: 2, before: "$O=90$", after: "$X=90$" },
      { line: 9, before: "$O=90$", after: "$X=90$" },
      { line: 4, before: "A. one", after: "B. one" },
      { before: "$O=90$", after: "$X=90$" }
    ]) expect(() => applyScannedTextEdits(original, JSON.stringify({ edits: [edit] }))).toThrow();
    expect(original.markdown).toBe("$O=90$\n\n$O=90$\nA. one");
  });
  it("ignores unchanged suggestions even when the quoted source repeats", () => {
    const original = transcript("same\n\nsame");
    expect(applyScannedTextEdits(original, JSON.stringify({ edits: [{ before: "same", after: "same" }] }))).toEqual(original);
  });
  it("rejects HTML emphasis inside a formula even when a patch only quotes its numerator", () => {
    const original = transcript("1. $\\frac{ER}{PQ}=\\frac{FR}{DO}$，保留说明。");
    expect(() => applyScannedTextEdits(original, JSON.stringify({ edits: [{ before: "ER", after: "<u>ER</u>" }] }))).toThrow(/公式内部/);
    expect(applyScannedTextEdits(original, JSON.stringify({ edits: [{ before: "保留说明", after: "<u>保留说明</u>" }] })).markdown)
      .toBe("1. $\\frac{ER}{PQ}=\\frac{FR}{DO}$，<u>保留说明</u>。");
    expect(applyScannedTextEdits(original, JSON.stringify({ edits: [{ before: "ER", after: "\\underline{ER}" }] })).markdown)
      .toContain("\\frac{\\underline{ER}}{PQ}");
  });
  it("checks printed credit names independently without changing body text", async () => {
    const page = { ...unit(""), pdfText: undefined };
    const original = transcript("命题人：陈青\n审题人：林明\n1. 保留原题。");
    vi.mocked(runImportAgent).mockReset().mockResolvedValueOnce('{"edits":[]}')
      .mockResolvedValueOnce('{"tiles":["detail_tile_1"]}')
      .mockResolvedValueOnce(JSON.stringify({ edits: [{ before: "命题人：陈青", after: "命题人：陈菁" }] }))
      .mockResolvedValueOnce('{"checks":[{"id":"edit_1","supported":true}]}');
    expect((await checkPdfTranscriptText({ apiKey: "test", baseUrl: "", model: "" }, original, page, new AbortController().signal)).markdown)
      .toBe("命题人：陈菁\n审题人：林明\n1. 保留原题。");
    vi.mocked(runImportAgent).mockReset().mockResolvedValueOnce('{"edits":[]}')
      .mockResolvedValueOnce('{"tiles":["detail_tile_1"]}')
      .mockResolvedValueOnce(JSON.stringify({ edits: [{ before: "保留原题", after: "修改原题" }] }));
    await expect(checkPdfTranscriptText({ apiKey: "test", baseUrl: "", model: "" }, original, page, new AbortController().signal)).rejects.toThrow(/只能修改姓名/);
  });
  it("restores only independently confirmed separators in circled-number choices", async () => {
    const page = { ...unit(""), pdfText: undefined };
    const original = transcript("9. Choose the structure.\nA. ①②③④\nB. ①②③④");
    vi.mocked(runImportAgent).mockReset().mockResolvedValueOnce('{"edits":[]}')
      .mockResolvedValueOnce('{"tiles":["detail_tile_1"]}')
      .mockResolvedValueOnce(JSON.stringify({ edits: [{ before: "A. ①②③④", after: "A. ①\\②③\\④" }] }))
      .mockResolvedValueOnce('{"checks":[{"id":"edit_1","supported":true}]}');
    const result = await checkPdfTranscriptText({ apiKey: "test", baseUrl: "", model: "" }, original, page, new AbortController().signal);
    expect(result.markdown).toBe("9. Choose the structure.\nA. ①\\②③\\④\nB. ①②③④");
    expect(original.markdown).not.toContain("\\");
    expect(vi.mocked(runImportAgent).mock.calls[1][2]).toHaveLength(10);
    expect(vi.mocked(runImportAgent).mock.calls[2][2].map(image => image.id)).toEqual(["source_text_detail_1"]);
    expect(vi.mocked(runImportAgent).mock.calls[3][2]).toEqual(vi.mocked(runImportAgent).mock.calls[2][2]);
    vi.mocked(runImportAgent).mockReset().mockResolvedValueOnce('{"edits":[]}')
      .mockResolvedValueOnce('{"tiles":["detail_tile_1"]}')
      .mockResolvedValueOnce(JSON.stringify({ edits: [{ before: "A. ①②③④", after: "A. ①\\③②④" }] }));
    await expect(checkPdfTranscriptText({ apiKey: "test", baseUrl: "", model: "" }, original, page, new AbortController().signal)).rejects.toThrow(/数字/);
  });
  it("rejects invalid detail crops before asking for a text correction", async () => {
    const original = transcript("命题人：陈青");
    for (const tiles of [["unknown"], ["detail_tile_1", "detail_tile_1"], [1], null]) {
      vi.mocked(runImportAgent).mockReset().mockResolvedValueOnce('{"edits":[]}')
        .mockResolvedValueOnce(JSON.stringify({ tiles }));
      await expect(checkPdfTranscriptText({ apiKey: "test", baseUrl: "", model: "" }, original, { ...unit(""), pdfText: undefined }, new AbortController().signal)).rejects.toThrow(/有效图片编号/);
      expect(vi.mocked(runImportAgent)).toHaveBeenCalledTimes(2);
    }
  });
  it("restores an underline missed by the page proofread while retaining existing bold text", async () => {
    const page = { ...unit(""), pdfText: undefined };
    const source = transcript("A reading passage " + "printed words ".repeat(20) + '\n21. What does "**achievement**" mean?');
    vi.mocked(pdfUnderlineBoxes).mockReturnValueOnce([[100, 100, 200, 40]]);
    vi.mocked(runImportAgent).mockReset().mockResolvedValueOnce('{"edits":[]}')
      .mockResolvedValueOnce(JSON.stringify({ edits: [{ before: "**achievement**", after: "**<u>achievement</u>**" }] }))
      .mockResolvedValueOnce('{"checks":[{"id":"edit_1","supported":true}]}');
    const result = await checkPdfTranscriptText({ apiKey: "test", baseUrl: "", model: "" }, source, page, new AbortController().signal);
    expect(result.markdown).toContain("**<u>achievement</u>**");
    expect(result.markdown.replace(/<\/?u>/g, "")).toBe(source.markdown);
    expect(vi.mocked(runImportAgent).mock.calls[1][2].map(image => image.id)).toEqual(["source_underline_1"]);
  });
  it("restores an underlined sentence on a scanned Chinese prose page, not on a page of formulas", async () => {
    const page = { ...unit(""), pdfText: undefined };
    const passage = "室女者，鲁漆室邑之女也。".repeat(30) + "今鲁君老悖，太子少愚，愚伪日起。";
    vi.mocked(pdfTextUnderlineBoxes).mockReturnValue([[120, 480, 620, 40]]);
    vi.mocked(runImportAgent).mockReset().mockResolvedValueOnce('{"edits":[]}')
      .mockResolvedValueOnce(JSON.stringify({ edits: [{ before: "今鲁君老悖，太子少愚，愚伪日起。", after: "<u>今鲁君老悖，太子少愚，愚伪日起。</u>" }] }))
      .mockResolvedValueOnce('{"checks":[{"id":"edit_1","supported":true}]}');
    const result = await checkPdfTranscriptText({ apiKey: "test", baseUrl: "", model: "" }, transcript(passage), page, new AbortController().signal);
    expect(result.markdown).toContain("<u>今鲁君老悖，太子少愚，愚伪日起。</u>");
    expect(vi.mocked(runImportAgent).mock.calls[1][6]).toBe("source-underline-check");
    // Long strokes on a page of formulas are drawings and arrows: no underline check there.
    vi.mocked(runImportAgent).mockReset().mockResolvedValueOnce('{"edits":[]}');
    await checkPdfTranscriptText({ apiKey: "test", baseUrl: "", model: "" }, transcript("反应 $2H_2+O_2$ 生成水。".repeat(40)), page, new AbortController().signal);
    expect(vi.mocked(runImportAgent)).toHaveBeenCalledTimes(1);
    vi.mocked(pdfTextUnderlineBoxes).mockReturnValue([]);
  });
  it("verifies formula positions against pixels even when a native text layer is usable", async () => {
    const original = transcript("1. 元素 $^{A}_{Z}X$ 的同位素。\nA. $^{A+1}_{Z}X$");
    vi.mocked(runImportAgent).mockReset()
      .mockResolvedValueOnce(JSON.stringify({ edits: [
        { before: "$^{A}_{Z}X$", after: "$^{Z}_{A}X$" },
        { before: "$^{A+1}_{Z}X$", after: "$^{Z}_{A+1}X$" }
      ] }))
      .mockResolvedValueOnce(JSON.stringify({ checks: [{ id: "edit_1", supported: true }, { id: "edit_2", supported: true }] }));
    const page = unit("1. 元素 ZX 的同位素。");
    page.pdfText!.scriptRegions = [{ box: [100, 200, 80, 40], base: "X", aboveLeft: "Z", belowLeft: "A" }];
    const result = await checkPdfTranscriptText({ apiKey: "test", baseUrl: "", model: "" }, original, page, new AbortController().signal);
    expect(result.markdown).toBe("1. 元素 $^{Z}_{A}X$ 的同位素。\nA. $^{Z}_{A+1}X$");
    expect(vi.mocked(runImportAgent).mock.calls[0][2]).toHaveLength(7);
    expect(JSON.parse(vi.mocked(runImportAgent).mock.calls[0][1]).scriptRegions[0]).toMatchObject({ aboveLeft: "Z", belowLeft: "A" });
    expect(original.markdown).toContain("$^{A}_{Z}X$");
  });
  it("checks scan-only text and applies only independently confirmed source corrections", async () => {
    const page = { ...unit(""), pdfText: undefined };
    const original = transcript("1. 原式 $x-1$，选项氦核。\n[[figure_1]]");
    vi.mocked(runImportAgent).mockReset().mockResolvedValueOnce(JSON.stringify({ edits: [{ before: "$x-1$", after: "$x+1$" }, { before: "氦核", after: "He核" }] }))
      .mockResolvedValueOnce(JSON.stringify({ checks: [{ id: "edit_1", supported: false }, { id: "edit_2", supported: true }] }));
    const result = await checkPdfTranscriptText({ apiKey: "test", baseUrl: "", model: "" }, original, page, new AbortController().signal);
    expect(result.markdown).toBe("1. 原式 $x-1$，选项He核。\n[[figure_1]]");
    expect(original.markdown).toContain("氦核");
    expect(vi.mocked(runImportAgent).mock.calls[0][2]).toHaveLength(6);
  });
  it("repairs ambiguous local references without retranscribing or applying an unverified edit", async () => {
    const page = { ...unit(""), pdfText: undefined };
    const original = transcript("First word is repeated. Second word is printed.");
    vi.mocked(runImportAgent).mockReset()
      .mockResolvedValueOnce(JSON.stringify({ edits: [{ before: "word", after: "<u>word</u>" }] }))
      .mockResolvedValueOnce(JSON.stringify({ edits: [{ before: "Second word", after: "Second <u>word</u>" }] }))
      .mockResolvedValueOnce('{"checks":[{"id":"edit_1","supported":true}]}');
    const result = await checkPdfTranscriptText({ apiKey: "test", baseUrl: "", model: "" }, original, page, new AbortController().signal);
    expect(result.markdown).toBe("First word is repeated. Second <u>word</u> is printed.");
    expect(original.markdown).not.toContain("<u>");
    expect(vi.mocked(runImportAgent).mock.calls.map(call => call[6])).toEqual(["source-scan-text-check", "source-scan-patch-repair", "source-scan-text-confirm"]);
  });
  it("rejects ambiguous, overlapping and structural scan corrections", () => {
    const original = transcript("1. x+x\nA. one\n[[figure_1]]");
    for (const edits of [[{ before: "x", after: "y" }], [{ before: "x+x", after: "y" }, { before: "+x", after: "+y" }],
      [{ before: "[[figure_1]]", after: "图" }], [{ before: "1. x+x", after: "2. x+x" }], [{ before: "A. one", after: "B. one" }]]) {
      expect(() => applyScannedTextEdits(original, JSON.stringify({ edits }))).toThrow();
    }
  });
  it("restores visible local emphasis without changing the printed words or their question", () => {
    const source = transcript("16. What does this traditional technique refer to?");
    const result = applyScannedTextEdits(source, JSON.stringify({ edits: [{ before: "this traditional technique", after: "<u>this traditional technique</u>" }] }));
    expect(result.markdown).toBe("16. What does <u>this traditional technique</u> refer to?");
  });
  it("compares whole-line labels without treating spacing or a title year as a question number", () => {
    const original = transcript("2025 年考试\n2、本卷共 6 个人题。\nA. $x-1$");
    const result = applyScannedTextEdits(original, JSON.stringify({ edits: [
      { before: "2025 年考试", after: "2025年考试" },
      { before: "2、本卷共 6 个人题。", after: "2、 本卷共 6 个大题。" },
      { before: "$x-1$", after: "$x+1$" }
    ] }));
    expect(result.markdown).toBe("2025年考试\n2、 本卷共 6 个大题。\nA. $x+1$");
    expect(() => applyScannedTextEdits(original, JSON.stringify({ edits: [{ before: "2、本卷", after: "3、本卷" }] }))).toThrow(/题号/);
  });
  it("locates an omitted printed digit beside a numbered blank without altering the blank", () => {
    const page = unit("At first.she felt ____1____ 7about herself.");
    const original = transcript("At first. she felt **____1____** about herself.");
    // Formatting at the patch boundary is deliberately excluded from automatic edits.
    expect(pdfTextConflicts(page, original.markdown)).toEqual([]);
    const plain = transcript("At first. she felt ____1____ about herself.");
    const found = pdfTextConflicts(page, plain.markdown);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ native: " 7", transcript: " " });
    expect(applyPdfTextChecks(plain, found, decisions("native")).markdown).toBe("At first. she felt ____1____ 7about herself.");
    expect(plain.markdown).toBe("At first. she felt ____1____ about herself.");
  });
  it("checks short negation, signs and decimals and applies edits in offset order", () => {
    const original = transcript("It is safe. Value 1 and 15 here.");
    const found = pdfTextConflicts(unit("It is not safe. Value -1 and 1.5 here."), original.markdown);
    expect(found).toHaveLength(3);
    const raw = JSON.stringify({ checks: found.map(({ id }) => ({ id, source: "native" })) });
    expect(applyPdfTextChecks(original, found, raw).markdown).toBe("It is not safe. Value -1 and 1.5 here.");
  });
  it("does not edit formulas or silently prefer the native layer", async () => {
    expect(pdfTextConflicts(unit("Use $x+1$ now."), "Use $x+2$ now.")).toEqual([]);
    const original = transcript("The value is 7 today.");
    const page = unit("The value is 1 today.");
    vi.mocked(runImportAgent).mockResolvedValueOnce(decisions("transcript"));
    expect(await checkPdfTranscriptText({ apiKey: "test", baseUrl: "", model: "" }, original, page, new AbortController().signal)).toEqual(original);
    expect(vi.mocked(runImportAgent).mock.lastCall?.[6]).toBe("source-text-check");
  });
  it("retains a visible marker, crop location and warning when the image is unclear", () => {
    const original = transcript("The value is 7 today.");
    const found = pdfTextConflicts(unit("The value is 1 today."), original.markdown);
    const result = applyPdfTextChecks(original, found, decisions("unclear"));
    expect(result.markdown).toContain("7 [待核对]");
    expect(result.uncertainties).toHaveLength(1);
    expect(result.warnings[0]).toContain("待核对");
  });
  it("rejects missing, repeated or invented decisions", () => {
    const original = transcript("The value is 7 today.");
    const found = pdfTextConflicts(unit("The value is 1 today."), original.markdown);
    for (const raw of ['{}', '{"checks":[]}', '{"checks":[{"id":"unknown","source":"native"}]}', decisions("guess"), 'null']) {
      expect(() => applyPdfTextChecks(original, found, raw)).toThrow();
    }
  });
  it("does not check unreliable text, formatting-only changes or unanchored page edges", () => {
    const page = unit("Keep the original text.");
    expect(pdfTextConflicts(page, "**Keep** the  original text.")).toEqual([]);
    expect(pdfTextConflicts({ ...page, pdfText: { ...page.pdfText!, candidate: false } }, "Keep corrected text.")).toEqual([]);
    expect(pdfTextConflicts(page, "the original text.")).toEqual([]);
  });
});
