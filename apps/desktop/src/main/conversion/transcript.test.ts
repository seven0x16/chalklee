import { describe, expect, it } from "vitest";
import { lockTranscript, normalizeTranscriptBox, parseTranscript, restoreTranscript, type ImportTranscript } from "./transcript";
import { isPlausibleImportFormula } from "../../shared/conversion/importDocument";
import { expandPdfImportBlocks } from "./pdfReply";

const unit = { id: "page_2", page: 2, label: "第2页", blocks: [], images: [] };
const source: ImportTranscript = { markdown: "6. 计算 $\\frac{1}{2}$，如图 [[figure_1]]\n7. 求 $x^2$ [待核对]", figures: [{ id: "figure_1", crop: [100, 200, 200, 100], alt: "第6题图" }], uncertainties: [], warnings: [] };
const draft = () => [{ type: "question", number: "6", stem: ["计算 [[math_1]]，如图", { type: "image", figureId: "figure_1" }] }, { type: "question", number: "7", stem: ["求 [[math_2]] [待核对]"] }];

describe("source-locked PDF transcription", () => {
  it.each(["在点 H、F 间固定轻绳", "在点 A、B 之间连接轻绳"])("keeps a stem diagram after prose letter names (%s)", text => {
    const markdown = `6. ${text}，结果如图所示。\n[[figure_1]]\nA. 第一种变化\nB. 第二种变化\nC. 第三种变化\nD. 第四种变化`;
    expect(parseTranscript(JSON.stringify({ ...source, markdown, figures: [{ ...source.figures[0], questionNumber: "6" }] }), unit).markdown).toBe(markdown);
  });
  it("does not move a stem diagram into a wrapped parenthetical place name", () => {
    const markdown = "6. 在实验区域（区域\nA）观察变化，结果如图所示。\n[[figure_1]]\nA. 第一种变化\nB. 第二种变化\nC. 第三种变化\nD. 第四种变化";
    const raw = { ...source, markdown, figures: [{ ...source.figures[0], questionNumber: "6" }] };
    expect(parseTranscript(JSON.stringify(raw), unit).markdown).toBe(markdown);
  });
  it.each(["【答案】A\n【解析】解：其主视图为", "答案：A\n解析：其主视图为", "**【详解】**其主视图为"])("keeps solution diagrams after their printed answer labels (%s)", labels => {
    const markdown = `1. 选择主视图\n[[figure_1]]\nA. [[figure_2]]\nB. 其他图形\n${labels}\n[[figure_3]]\n2. 下一题`;
    const figures = [1, 2, 3].map(index => ({ id: `figure_${index}`, crop: [100, index * 100, 100, 80], alt: "主视图", questionNumber: "1", ...(index === 2 ? { optionLabel: "A" } : {}) }));
    expect(parseTranscript(JSON.stringify({ markdown, figures, uncertainties: [], warnings: [] }), unit).markdown).toBe(markdown);
  });
  it.each([true, false])("puts every cell of a labeled image matrix into its own option (header=%s)", header => {
    const labels = "| | A | B |";
    const rows = ["| red | [[figure_1]] | [[figure_2]] |", "| blue | [[figure_3]] | [[figure_4]] |"];
    const table = header ? [labels, "| --- | --- | --- |", ...rows] : ["| | | |", "| --- | --- | --- |", ...rows, labels];
    const raw = { ...source, markdown: "4. Choose the pattern.\n" + table.join("\n") + "\n5. Next question.", figures: Array.from({ length: 4 }, (_, i) => ({
      id: `figure_${i + 1}`, crop: [100 + i * 100, 200, 80, 80], alt: "pattern", questionNumber: "4", optionLabel: i % 2 ? "B" : "A"
    })) };
    const result = parseTranscript(JSON.stringify(raw), unit);
    expect(result.markdown).toBe("4. Choose the pattern.\nA. red [[figure_1]]\nblue [[figure_3]]\nB. red [[figure_2]]\nblue [[figure_4]]\n5. Next question.");
    expect(result.figures).toEqual(raw.figures);
    raw.figures[1].optionLabel = "A";
    expect(() => parseTranscript(JSON.stringify(raw), unit)).toThrow("选项位置");
  });
  it("keeps diagrams in their printed options when a parent has several choice subquestions", () => {
    const markdown = "9. 实验\n(1) 判断\nA. 增大\nB. 减小\n(2) 计算\n(3) 选择电路\nA. [[figure_1]]\nB. [[figure_2]]";
    const figures = ["A", "B"].map((optionLabel, index) => ({ id: `figure_${index + 1}`, crop: [100, 200, 200, 100], alt: "电路图", questionNumber: "9", optionLabel }));
    expect(parseTranscript(JSON.stringify({ markdown, figures, uncertainties: [], warnings: [] }), unit).markdown).toBe(markdown);
    expect(() => parseTranscript(JSON.stringify({ markdown: markdown.replace("A. [[figure_1]]", "[[figure_1]]\nA. 无图"), figures, uncertainties: [], warnings: [] }), unit)).toThrow("缺少明确");
  });
  it("places a diagram inside a printed or continued answer subquestion", () => {
    const raw = { markdown: "⑵ 原稿方案\n[[figure_1]]\n⑶ 下一小问", figures: [{ id: "figure_1", crop: [100, 100, 200, 100], questionNumber: "(2)", alt: "方案图" }], uncertainties: [], warnings: [], hasAnswers: true };
    expect(parseTranscript(JSON.stringify(raw), unit).markdown).toBe(raw.markdown);
    const continued = { ...raw, markdown: "续接方案\n[[figure_1]]\n⑶ 下一小问" };
    expect(parseTranscript(JSON.stringify(continued), { ...unit, continuation: { type: "question", number: "(2)", parentNumbers: ["27"] } }).figures[0].questionNumber).toBe("(2)");
  });
  it("normalizes explicitly declared corners before review and does not reinterpret reviewed caches", () => {
    const raw = { ...source, coordinateFormat: "xyxy", figures: [{ id: "figure_1", crop: [600, 700, 900, 950], alt: "图" }], uncertainties: [{ box: [10, 20, 110, 220], reason: "小字" }] };
    const parsed = parseTranscript(JSON.stringify(raw), unit);
    expect(parsed.figures[0].crop).toEqual([600, 700, 300, 250]);
    expect(parsed.uncertainties[0].box).toEqual([10, 20, 100, 200]);
    expect(parseTranscript(JSON.stringify(parsed), unit)).toEqual(parsed);
    expect(normalizeTranscriptBox({ left: 600, top: 700, right: 900, bottom: 950 })).toEqual([600, 700, 300, 250]);
    expect(normalizeTranscriptBox([100, 100, 200, 200])).toEqual([100, 100, 200, 200]);
    expect(normalizeTranscriptBox([100, 100, 200, 200], "xyxy")).toEqual([100, 100, 100, 100]);
    expect(() => normalizeTranscriptBox([600, 700, 900, 950])).toThrow();
    expect(() => normalizeTranscriptBox([600, 700, 300, 250], "xyxy")).toThrow();
    expect(() => parseTranscript(JSON.stringify({ ...raw, coordinateFormat: "auto" }), unit)).toThrow("坐标格式");
  });
  it("locks answer-only formula ownership and refuses generated answers on a question-only page", () => {
    const raw = { markdown: "参考答案\n1. $x=2$\n2. $y=3$", figures: [], uncertainties: [], warnings: [], hasAnswers: true };
    const blocks = [{ type: "heading", text: "参考答案" }, { type: "answerEntry", number: "1", answer: ["[[math_1]]"] }, { type: "answerEntry", number: "2", answer: ["[[math_2]]"] }];
    expect(() => restoreTranscript(blocks, lockTranscript(raw), unit)).not.toThrow();
    expect(() => restoreTranscript([blocks[0], { ...blocks[1], answer: ["[[math_2]]"] }, { ...blocks[2], answer: ["[[math_1]]"] }], lockTranscript(raw), unit)).toThrow("属于第 1 题");
    expect(() => restoreTranscript(blocks, lockTranscript({ ...raw, hasAnswers: false }), unit)).toThrow("原文没有答案");
  });
  it("keeps a reviewed material image with its source prose and rejects a question-owned placement", () => {
    const text = "Mrs Peterson can teach you to make models with old magazines.";
    const raw = { markdown: text + "\n[[figure_1]]", figures: [{ id: "figure_1", crop: [100, 100, 200, 200], alt: "纸模型", materialAnchor: text }], uncertainties: [], warnings: [] };
    const locked = lockTranscript(parseTranscript(JSON.stringify(raw), unit));
    expect(() => restoreTranscript([{ type: "question", number: "31", stem: [text, { type: "image", figureId: "figure_1" }] }], locked, unit)).toThrow("阅读材料");
    expect(() => restoreTranscript([{ type: "questionGroup", material: [text, { type: "image", figureId: "figure_1" }] }], locked, unit)).not.toThrow();
  });
  it("compares aligned source prose by its content while still rejecting omitted prose", () => {
    const raw = { markdown: '<div style="text-align: center;">A</div>\n<div style="text-align: right;">Sara helped her friends finish their studies.</div>', figures: [], uncertainties: [], warnings: [] };
    expect(() => restoreTranscript([{ type: "paragraph", text: "A" }, { type: "paragraph", text: "Sara helped her friends finish their studies." }], lockTranscript(raw), unit)).not.toThrow();
    expect(() => restoreTranscript([{ type: "paragraph", text: "A" }], lockTranscript(raw), unit)).toThrow("正文未完整保留");
  });
  it("rejects a dropped reading passage even when every question is retained on a scanned page", () => {
    const raw = { markdown: "A\nSara could not afford university, but her teacher helped her finish her studies.\n11 Who helped Sara?\nA Her teacher.\nB. Her father.\nII．阅读理解", figures: [], uncertainties: [], warnings: [] };
    const q = { type: "question", number: "11", stem: ["Who helped Sara?"], options: [{ label: "A", content: ["Her teacher."] }, { label: "B", content: ["Her father."] }] };
    expect(() => restoreTranscript([q], lockTranscript(raw), unit)).toThrow("正文未完整保留");
    expect(() => restoreTranscript([{ type: "questionGroup", material: ["A", "Sara could not afford university, but her teacher helped her finish her studies."], questions: [q] }, { type: "heading", text: "II．阅读理解" }], lockTranscript(raw), unit)).not.toThrow();
  });
  it("preserves price dollars as text while retaining neighboring editable equations", () => {
    const locked = lockTranscript({ markdown: "Price:$2,999 | Price:$1,599 | Cost:$30\nCompute $x^2$", figures: [], uncertainties: [], warnings: [] });
    expect(locked.formulas).toEqual({ math_1: "x^2" });
    const result: any = expandPdfImportBlocks(restoreTranscript([{ type: "paragraph", text: locked.markdown }], locked, unit), []);
    expect(result[0].content.filter((n: any) => n.type === "mathInline")).toEqual([{ type: "mathInline", attrs: { latex: "x^2" } }]);
    expect(result[0].content[0].text).toContain("Price:$2,999 | Price:$1,599 | Cost:$30");
    expect(() => lockTranscript({ ...source, markdown: "Compute $x^2" })).toThrow("定界符");
  });
  it("recognizes printed answer brackets and bold numeric anchors without moving option diagrams", () => {
    const markdown = "（ ）17. Why?\nA. first\nB. second\n**（ ）18.** How?\nA. [[figure_1]]\nB. next";
    const parsed = parseTranscript(JSON.stringify({ markdown, figures: [{ id: "figure_1", crop: [100, 100, 100, 100], alt: "A图", questionNumber: "18", optionLabel: "A" }], uncertainties: [], warnings: [] }), unit);
    expect(parsed.markdown).toBe(markdown);
  });
  it("expands serialized figure references while rejecting duplicates and wrong ownership", () => {
    const transcript = lockTranscript({ markdown: "A\nReading [[figure_1]]", figures: [{ id: "figure_1", crop: [100, 100, 100, 100], alt: "共享图", materialLabel: "A" }], warnings: [], uncertainties: [] });
    const material = ['A', 'Reading {\\"type\\":\\"image\\",\\"figureId\\":\\"figure_1\\"}'];
    const result: any = restoreTranscript([{ type: "questionGroup", material }], transcript, unit);
    expect(result[0].material[2]).toMatchObject({ type: "image", crop: [100, 100, 100, 100] });
    expect(() => restoreTranscript([{ type: "questionGroup", material: [...material, "[[figure_1]]"] }], transcript, unit)).toThrow("实际为 2 次");
    expect(() => restoreTranscript([{ type: "question", number: "1", stem: material }], transcript, unit)).toThrow("共享material");
  });
  it("ends the last question at a Chinese section heading before a new shared option bank", () => {
    const raw = { markdown: "30. ______\nFinal sentence.\n第三节 信息匹配\nA. Library\nB. Park\n31. Linda needs books.", figures: [], uncertainties: [], warnings: [] };
    const blocks = [{ type: "question", number: "30", stem: ["______", "Final sentence."] }, { type: "heading", text: "第三节 信息匹配" }, { type: "questionGroup", material: ["A. Library", "B. Park"], questions: [{ type: "question", number: "31", stem: ["Linda needs books."] }] }];
    expect(() => restoreTranscript(blocks, lockTranscript(raw), unit)).not.toThrow();
  });
  it("rejects unsafe ignore requests without dropping source assets or aborting a text page", () => {
    const input = { ...unit, images: [
      { id: "page_2", dataUrl: "", widthPt: 600, heightPt: 800 },
      { id: "body", dataUrl: "", widthPt: 100, heightPt: 100, pageBounds: [200, 200, 200, 200] as [number, number, number, number] },
      { id: "footer", dataUrl: "", widthPt: 100, heightPt: 20, pageBounds: [400, 950, 100, 20] as [number, number, number, number] }
    ] };
    const parsed = parseTranscript(JSON.stringify({ markdown: "阅读材料正文", figures: [], uncertainties: [], warnings: [], ignoredAssetIds: ["page_2", "body", "missing", "footer"] }), input);
    expect(parsed.ignoredAssetIds).toEqual(["footer"]);
    expect(parsed.warnings).toHaveLength(1);
    expect(input.images.map(image => image.id)).toEqual(["page_2", "body", "footer"]);
  });
  it("keeps a reading illustration in shared material rather than forcing a numeric owner", () => {
    const parsed = parseTranscript(JSON.stringify({ markdown: "A\nShared reading [[figure_1]]\n11. Which is true?", figures: [{ id: "figure_1", crop: [100, 200, 100, 100], alt: "插图", questionNumber: "Passage A" }], uncertainties: [], warnings: [] }), unit);
    expect(parsed.figures[0]).toMatchObject({ materialLabel: "A" });
    expect(parsed.figures[0].questionNumber).toBeUndefined();
    const group = { type: "questionGroup", material: ["A", "Shared reading", { type: "image", figureId: "figure_1" }], questions: [{ type: "question", number: "11", stem: ["Which is true?"] }] };
    expect(() => restoreTranscript([group], lockTranscript(parsed), unit)).not.toThrow();
    expect(() => restoreTranscript([{ ...group, material: ["A", "Shared reading"], questions: [{ ...group.questions[0], stem: [...group.questions[0].stem, { type: "image", figureId: "figure_1" }] }] }], lockTranscript(parsed), unit)).toThrow("共享material");
  });
  it("allows the preceding question's diagram only in the leading page continuation", () => {
    const input = { ...unit, continuation: { type: "question" as const, number: "16" } };
    const raw = { markdown: "[[figure_1]]\n统计表与小问\n17. 下一道题", figures: [{ id: "figure_1", crop: [100, 100, 100, 100], questionNumber: "16", alt: "统计图" }], uncertainties: [], warnings: [] };
    expect(parseTranscript(JSON.stringify(raw), input).markdown).toBe(raw.markdown);
    expect(() => parseTranscript(JSON.stringify(raw), unit)).toThrow("第 16 题");
    expect(() => parseTranscript(JSON.stringify({ ...raw, markdown: "17. 下一道题\n[[figure_1]]" }), input)).toThrow("第 16 题");
  });
  it("defers cross-page ownership while retaining figure validation and source order", () => {
    const raw = { markdown: "续页条件\n[[figure_1]]\n22. 下一题", figures: [{ id: "figure_1", crop: [100, 100, 100, 100], questionNumber: "21", alt: "续页图" }], uncertainties: [], warnings: [] };
    const options = { deferUnresolvedFigures: true };
    expect(parseTranscript(JSON.stringify(raw), unit, options)).toMatchObject(raw);
    expect(() => parseTranscript(JSON.stringify({ ...raw, markdown: "续页条件" }), unit, options)).toThrow("标记缺失");
    expect(() => parseTranscript(JSON.stringify({ ...raw, figures: [{ ...raw.figures[0], crop: [950, 100, 100, 100] }] }), unit, options)).toThrow("范围");
    const local = { ...raw, markdown: "21. 原题\n22. 下一题\n[[figure_1]]" };
    const placed = parseTranscript(JSON.stringify(local), unit, options).markdown;
    expect(placed.indexOf("[[figure_1]]")).toBeLessThan(placed.indexOf("22."));
  });
  it("preserves a continued option image without assigning it to the next printed question", () => {
    const raw = { markdown: "A. [[figure_1]]\nB. 另一选项\n6. 下一道题\nA. 新选项", figures: [{ id: "figure_1", crop: [100, 100, 100, 100], alt: "数轴选项", optionLabel: "A" }], uncertainties: [], warnings: [] };
    expect(parseTranscript(JSON.stringify(raw), unit, { deferUnresolvedFigures: true })).toMatchObject(raw);
    expect(() => parseTranscript(JSON.stringify(raw), unit)).toThrow("题号");
  });
  it("accepts figure options printed in lowercase and keeps their printed prefixes", () => {
    const raw = { markdown: "(4)不能用作溶剂的是\na. 乙醚 b. 乙二醇 c. [[figure_1]] d. [[figure_2]]", figures: [
      { id: "figure_1", crop: [100, 100, 200, 200], alt: "吗啉", optionLabel: "c" },
      { id: "figure_2", crop: [300, 100, 400, 200], alt: "四氢呋喃", optionLabel: "d." }], uncertainties: [], warnings: [], coordinateFormat: "xyxy" };
    const parsed = parseTranscript(JSON.stringify(raw), unit, { deferUnresolvedFigures: true });
    expect(parsed.figures.map(figure => figure.optionLabel)).toEqual(["C", "D"]);
    expect(parsed.markdown).toContain("c. [[figure_1]] d. [[figure_2]]");
    expect(() => parseTranscript(JSON.stringify({ ...raw, figures: [{ ...raw.figures[0], optionLabel: "z" }, raw.figures[1]] }), unit, { deferUnresolvedFigures: true })).toThrow("选项标签");
  });
  it("keeps the printed position of a leading figure when preparing whole-document references", () => {
    const raw = { markdown: "[[figure_1]]\n13. 下一题", figures: [{ id: "figure_1", crop: [100, 100, 100, 100], alt: "续页图", questionNumber: "13" }], uncertainties: [], warnings: [] };
    expect(parseTranscript(JSON.stringify(raw), unit, { deferUnresolvedFigures: true, preserveFigurePositions: true }).markdown).toBe(raw.markdown);
  });
  it("keeps a shared figure printed right above its question, after a numbered notice", () => {
    const raw = { markdown: "注意事项：1. 答卷前填写姓名。\n2. 作答选择题时涂黑。\n3. 保持答题卡整洁。\n一、选择题\n把能源的不可能三角变成了可能三角（图1）。据此完成1~2题。\n[[figure_1]]\n图1\n1. 关键性因素是\nA.\n2. 意义是\nA.",
      figures: [{ id: "figure_1", crop: [100, 100, 600, 200], alt: "能源三角", questionNumber: "1" }], uncertainties: [], warnings: [] };
    expect(parseTranscript(JSON.stringify(raw), unit, { deferUnresolvedFigures: true, preserveFigurePositions: true }).markdown).toBe(raw.markdown);
  });
  it("uses explicit figure ownership below later questions when preparing whole-document references", () => {
    const raw = { markdown: "11. 如图求值 $x+1$\n12. 如图证明\n[[figure_1]]\n[[figure_2]]", figures: [
      { id: "figure_1", crop: [100, 100, 100, 100], alt: "第11题图", questionNumber: "11" },
      { id: "figure_2", crop: [300, 100, 100, 100], alt: "第12题图", questionNumber: "12" }
    ], uncertainties: [], warnings: [] };
    const parsed = parseTranscript(JSON.stringify(raw), unit, { deferUnresolvedFigures: true, preserveFigurePositions: true });
    expect(parsed.markdown.indexOf("[[figure_1]]")).toBeLessThan(parsed.markdown.indexOf("12."));
    expect(parsed.markdown.indexOf("[[figure_2]]")).toBeGreaterThan(parsed.markdown.indexOf("12."));
    expect(parsed.markdown.replace(/\[\[figure_\d+\]\]|\s/g, "")).toBe(raw.markdown.replace(/\[\[figure_\d+\]\]|\s/g, ""));
  });
  it("preserves numbered prose without making exam instructions or booking steps into questions", () => {
    const raw = { markdown: "注意事项\n1. 请在答题卡上填写姓名\n2. 请保持卷面整洁\n# Reading\nBooking Steps\n1. Choose a date\n2. Enter your name\n16. Which date is available?", figures: [], uncertainties: [], warnings: [] };
    const blocks = [{ type: "paragraph", text: "注意事项\n1. 请在答题卡上填写姓名\n2. 请保持卷面整洁" }, { type: "questionGroup", material: ["Reading", "Booking Steps\n1. Choose a date\n2. Enter your name"], questions: [{ type: "question", number: "16", stem: ["Which date is available?"] }] }];
    expect(() => restoreTranscript(blocks, lockTranscript(raw), unit)).not.toThrow();
    expect(() => restoreTranscript(blocks.slice(1), lockTranscript(raw), unit)).toThrow("第 1 题");
  });
  it("normalizes HTML spaces before checking adjacent English options", () => {
    const raw = { markdown: "4. A. designs&nbsp; B. plans&emsp;&emsp; C. games&ensp; D. sports", figures: [], uncertainties: [], warnings: [] };
    const q = { type: "question", number: "4", stem: [], options: ["designs", "plans", "games", "sports"].map((text, i) => ({ label: String.fromCharCode(65+i), content: [text] })) };
    expect(() => restoreTranscript([q], lockTranscript(raw), unit)).not.toThrow();
    expect(() => restoreTranscript([{ ...q, options: q.options.slice(1) }], lockTranscript(raw), unit)).toThrow("选项 A");
  });
  it("keeps raw LaTeX outside JSON while parsing separate figure metadata", () => {
    const markdown = String.raw`2. 计算 $\frac{1}{2}$，温度 $-18\pm2^\circ\text{C}$。
[[figure_1]]
A. [[figure_2]]
B. $\sqrt{5}$`;
    const metadata = { figures: [{ id: "figure_1", crop: [100, 200, 100, 100], alt: "主图", questionNumber: "2" }, { id: "figure_2", crop: [100, 400, 100, 100], alt: "A图", questionNumber: "2", optionLabel: "A" }], uncertainties: [], warnings: [] };
    const parsed = parseTranscript(`${markdown}\n<chalklee-metadata>\n${JSON.stringify(metadata)}\n</chalklee-metadata>`, unit);
    expect(parsed.markdown).toBe(markdown);
    expect(lockTranscript(parsed).formulas).toEqual({ math_1: String.raw`\frac{1}{2}`, math_2: String.raw`-18\pm2^\circ\text{C}`, math_3: String.raw`\sqrt{5}` });
    expect(parsed.figures[1].optionLabel).toBe("A");
  });
  it.each([String.raw`\frac{1}{2}`, String.raw`\text{C}`, String.raw`\triangle ABC`, String.raw`\backslashsqrt{5}`])("rejects valid JSON with an unescaped LaTeX command before trim erases the evidence: %s", formula => {
    const raw = `{"markdown":"1. $${formula}$","figures":[],"uncertainties":[],"warnings":[]}`;
    expect(() => lockTranscript(parseTranscript(raw, unit))).toThrow("转义损坏");
  });
  it("keeps each geometric option in its labelled option even when every figure survives", () => {
    const original = { markdown: "2. 选择图形\nA. [[figure_1]]\nB. [[figure_2]]", figures: ["A", "B"].map((optionLabel, i) => ({ id: `figure_${i + 1}`, crop: [100, 200, 100, 100] as [number, number, number, number], alt: optionLabel, questionNumber: "2", optionLabel })), uncertainties: [], warnings: [] };
    const locked = lockTranscript(parseTranscript(JSON.stringify(original), unit));
    const options = ["A", "B"].map((label, i) => ({ label, content: [{ type: "image", figureId: `figure_${i + 1}` }] }));
    const question = { type: "question", number: "2", stem: ["选择图形"], options };
    expect(() => restoreTranscript([question], locked, unit)).not.toThrow();
    expect(() => restoreTranscript([{ ...question, options: [{ ...options[0], content: options[1].content }, { ...options[1], content: options[0].content }] }], locked, unit)).toThrow("B 选项");
    expect(() => restoreTranscript([{ ...question, stem: ["选择图形", ...options[0].content], options: [{ ...options[0], content: [] }, options[1]] }], locked, unit)).toThrow("A 选项");
    expect(() => restoreTranscript([{ ...question, number: "3" }], locked, unit)).toThrow("第 2 题");
    const withoutMetadata = lockTranscript({ ...original, figures: original.figures.map(({ questionNumber, optionLabel, ...figure }) => figure) });
    expect(() => restoreTranscript([{ ...question, options: [{ ...options[0], content: options[1].content }, { ...options[1], content: options[0].content }] }], withoutMetadata, unit)).toThrow("A 选项");
  });
  it("uses explicit caption ownership for a diagram printed after a later question", () => {
    const parsed = parseTranscript(JSON.stringify({ markdown: "6. 看图\nA. 是\nB. 否\n8. 求值\n[[figure_1]]", figures: [{ id: "figure_1", crop: [100, 200, 100, 100], questionNumber: "6", alt: "第6题图" }], uncertainties: [], warnings: [] }), unit);
    const locked = lockTranscript(parsed);
    expect(() => restoreTranscript([{ type: "question", number: "6", stem: ["看图", { type: "image", figureId: "figure_1" }], options: [{ label: "A", content: ["是"] }, { label: "B", content: ["否"] }] }, { type: "question", number: "8", stem: ["求值"] }], locked, unit)).not.toThrow();
    expect(() => parseTranscript(JSON.stringify({ ...parsed, figures: [{ ...parsed.figures[0], questionNumber: "99" }] }), unit)).toThrow("第 99 题");
  });
  it("restores formulas and exact figure coordinates without asking the splitting model to recreate them", () => {
    const locked = lockTranscript(parseTranscript(JSON.stringify(source), unit));
    expect(locked.markdown).not.toContain("\\frac");
    const restored = restoreTranscript(draft(), locked, unit);
    expect(JSON.stringify(restored)).toContain("$\\\\frac{1}{2}$");
    expect(restored[0]).toMatchObject({ stem: ["计算 $\\frac{1}{2}$，如图", { type: "image", crop: [100, 200, 200, 100], sourceImage: "page_2" }] });
  });
  it.each(["missing", "duplicate", "invented"])("blocks %s formulas", mode => {
    const blocks = draft();
    blocks[1].stem = [mode === "missing" ? "求数值 [待核对]" : mode === "duplicate" ? "[[math_1]] [[math_2]] [待核对]" : "[[math_999]] [待核对]"];
    expect(() => restoreTranscript(blocks, lockTranscript(source), unit)).toThrow(/引用/);
  });
  it("blocks rewritten formulas, missing figures and erased uncertainty markers", () => {
    const locked = lockTranscript(source);
    const blocks = draft();
    blocks[0].stem[0] = "$x+1$ [[math_1]]";
    expect(() => restoreTranscript(blocks, locked, unit)).toThrow("不能编写");
    const noFigure = draft(); noFigure[0].stem.pop();
    expect(() => restoreTranscript(noFigure, locked, unit)).toThrow("figure_1");
    const noWarning = draft(); noWarning[1].stem = ["求 [[math_2]]"];
    expect(() => restoreTranscript(noWarning, locked, unit)).toThrow("待核对");
  });
  it("rejects incomplete math delimiters and invalid figure bounds instead of caching them", () => {
    expect(() => lockTranscript({ ...source, markdown: "计算 $x+1" })).toThrow("定界符");
    expect(() => parseTranscript(JSON.stringify({ ...source, figures: [{ ...source.figures[0], crop: [900, 0, 200, 100] }] }), unit)).toThrow("范围");
  });
  it("detects a lost short question that contains no formula or figure", () => {
    const source = { markdown: "1. 求值\n2. 说明理由", figures: [], uncertainties: [], warnings: [] };
    expect(() => restoreTranscript([{ type: "question", number: "1", stem: ["求值"] }], lockTranscript(source), unit)).toThrow("第 2 题");
  });
  it("distinguishes preserved source answers from model-generated answers", () => {
    const blocks = draft().map(q => ({ ...q, answer: ["A"] }));
    expect(() => restoreTranscript(blocks, lockTranscript(source), unit)).toThrow("原文没有答案");
    expect(() => restoreTranscript(blocks, lockTranscript({ ...source, hasAnswers: true }), unit)).not.toThrow();
  });
  it("does not mistake a nonempty corrupted native formula for a usable expression", () => {
    expect(isPlausibleImportFormula("\\frac{1}{2}+\\sqrt{x}")).toBe(true);
    expect(isPlausibleImportFormula("\\frac{<u>ER</u>}{PQ}")).toBe(false);
    expect(isPlausibleImportFormula("\\frac{\\underline{ER}}{PQ}<1")).toBe(true);
    expect(isPlausibleImportFormula("a<u>v")).toBe(true);
    expect(isPlausibleImportFormula("\\left\\{x\\right\\}")).toBe(true);
    expect(isPlausibleImportFormula("\\frac{1}{2")).toBe(false);
    expect(isPlausibleImportFormula("APAPAE%B_AC_A")).toBe(false);
    expect(isPlausibleImportFormula("x\uE001y")).toBe(false);
    expect(isPlausibleImportFormula("\frac{1}{2}")).toBe(false);
    expect(isPlausibleImportFormula("-18\text{C}")).toBe(false);
  });
  it("rejects formulas and figures moved to another question even when every reference occurs once", () => {
    const swapped = draft();
    swapped[0].stem[0] = "计算 [[math_2]]，如图";
    swapped[1].stem = ["求 [[math_1]] [待核对]"];
    expect(() => restoreTranscript(swapped, lockTranscript(source), unit)).toThrow("属于第 6 题");
    const figureMoved = draft();
    figureMoved[1].stem.push(figureMoved[0].stem.pop()!);
    expect(() => restoreTranscript(figureMoved, lockTranscript(source), unit)).toThrow("属于第 6 题");
  });
  it("rejects duplicate question numbers but allows numbering restarted in separate source groups", () => {
    const plain = { markdown: "1. 求值\n2. 说明理由", figures: [], uncertainties: [], warnings: [] };
    const first = { type: "question", number: "1", stem: ["求值"] };
    expect(() => restoreTranscript([first, first, { type: "question", number: "2", stem: ["说明理由"] }], lockTranscript(plain), unit)).toThrow("重复了第 1 题");
    expect(() => restoreTranscript([{ type: "heading", text: "第一组" }, first, { type: "heading", text: "第二组" }, first], lockTranscript({ ...plain, markdown: "# 第一组\n1. 求值\n# 第二组\n1. 求值" }), unit)).not.toThrow();
  });
  it("rejects a lost short option and a formula exchanged between options", () => {
    const plain = { markdown: "1. 选择正确选项。\nA. 2\nB. 3\nC. 4\nD. 5", figures: [], uncertainties: [], warnings: [] };
    const options = ["A", "B", "C", "D"].map((label, i) => ({ label, content: [String(i + 2)] }));
    const result = [{ type: "question", number: "1", stem: ["选择正确选项。"], options }];
    expect(() => restoreTranscript(result, lockTranscript(plain), unit)).not.toThrow();
    expect(() => restoreTranscript([{ ...result[0], options: options.slice(0, 3) }], lockTranscript(plain), unit)).toThrow("选项 D");
    const math = lockTranscript({ ...plain, markdown: "1. 求值\nA. $1+1$\nB. $2+2$" });
    expect(() => restoreTranscript([{ ...result[0], stem: ["求值"], options: [{ label: "A", content: ["[[math_2]]"] }, { label: "B", content: ["[[math_1]]"] }] }], math, unit)).toThrow("A 选项");
  });
});

it("reattaches a detached continued-answer image using the explicit parent and source position", () => {
  const source = lockTranscript({ markdown: "续接第二小问的证明\n[[figure_1]]\n⑶ 第三小问的结论", hasAnswers: true, figures: [{ id: "figure_1", questionNumber: "27", crop: [100, 100, 200, 200], alt: "证明图" }], uncertainties: [], warnings: [] });
  const blocks = [{ type: "answerEntry", number: "(2)", parentNumbers: ["27"], answer: ["续接第二小问的证明"] }, { type: "answerEntry", number: "(3)", parentNumbers: ["27"], answer: ["第三小问的结论"] }, { type: "paragraph", text: "[[figure_1]]" }];
  const result: any = restoreTranscript(blocks, source, { ...unit, continuation: { type: "question", number: "(2)", parentNumbers: ["27"] } });
  expect(result).toHaveLength(2);
  expect(result[0].answer[1]).toMatchObject({ type: "image", sourceImage: unit.id });
  expect(result[1].answer).toEqual(["第三小问的结论"]);
});

it("restores a continued-subanswer image placed in a later sibling answer", () => {
  const source = lockTranscript({ markdown: "第二小问的续页证明\n[[figure_1]]\n⑶ 第三小问结论", hasAnswers: true, figures: [{ id: "figure_1", questionNumber: "27", crop: [100, 100, 200, 200], alt: "证明图" }], uncertainties: [], warnings: [] });
  const blocks = [{ type: "answerEntry", number: "(2)", parentNumbers: ["27"], answer: ["第二小问的续页证明"] }, { type: "answerEntry", number: "(3)", parentNumbers: ["27"], answer: ["第三小问结论", { type: "image", figureId: "figure_1" }] }];
  const result: any = restoreTranscript(blocks, source, { ...unit, continuation: { type: "question", number: "(2)", parentNumbers: ["27"] } });
  expect(result[0].answer[1]).toMatchObject({ type: "image", sourceImage: unit.id });
  expect(result[1].answer).toEqual(["第三小问结论"]);
});

it("places an OCR end-of-page diagram beside its unique printed reference in the continued proof", () => {
  const continued = { ...unit, continuation: { type: "question" as const, number: "(2)", parentNumbers: ["27"] } };
  const input = { markdown: "乙方案：如图2，继续证明。\n(3) 第三小问结论\n(4) 第四小问结论\n[[figure_1]]", hasAnswers: true, figures: [{ id: "figure_1", questionNumber: "27", crop: [100, 100, 200, 200], alt: "第27题图2" }], uncertainties: [], warnings: [] };
  const source = parseTranscript(JSON.stringify(input), continued);
  expect(source.markdown.indexOf("[[figure_1]]")).toBeLessThan(source.markdown.indexOf("(3)"));
  const ambiguous = parseTranscript(JSON.stringify({ ...input, markdown: input.markdown.replace("第三小问结论", "如图2，第三小问结论") }), continued);
  expect(ambiguous.markdown.indexOf("[[figure_1]]")).toBeGreaterThan(ambiguous.markdown.indexOf("(3)"));
});
