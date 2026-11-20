import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { createChalkLeeArchive, readChalkLeeArchive, validateChalkLeeSemantics, type ChalkLeeRootNode } from "@chalklee/format";
import {
  chalkLeeExternalSourceBlankId,
  chalkLeeFixedQuestionBlankLabels,
  chalkLeeImageExtension,
  chalkLeeImageWidthPreset,
  chalkLeePageBackgroundSize,
  chalkLeeQuestionKindLabel,
  chalkLeeQuestionMoveSourceBlankIds,
  applyChalkLeeTextStyleAttributeToRange,
  chalkLeeTitleFromContent,
  createEmptyChalkLeeDocument,
  createQuestionGroupTemplate,
  createQuestionTemplate,
  createTableTemplate,
  equalChalkLeeTableColumnWidths,
  insertChalkLeeTableColumnWidth,
  mergeChalkLeeTextStyleAttribute,
  nextOptionLabel,
  parseChalkLeeInlineOptionSequence,
  parseQuestionText,
  parseQuestionTextBatch,
  parseQuestionTextBatchDetailed,
  questionBatchReplacementContent,
  regenerateChalkLeeNodeIds,
  readChoiceAnswerLabels,
  readChalkLeeTableColumnWidths,
  removeChalkLeeTableColumnWidth,
  removeChoiceOption,
  reorderChoiceOption,
  sanitizeChalkLeeEditorJson,
  resizeChalkLeeTableColumnBoundary,
  resizeChalkLeeTableRowHeight,
  chalkLeeChoiceAllowsMultipleAnswers,
  toggleChoiceAnswer
} from "./editing";

function deterministicIds() {
  let value = 0;
  return () => `node_${++value}`;
}

const realisticEightChoiceQuestions = `1. 如图是某太空金属3D打印机打印的一个零件模型，它的主视图是（　）
A. 选项图A
B. 选项图B
C. 选项图C
D. 选项图D
答案：B
解析：从正面观察，左侧立柱遮挡底部结构，故选B。
2. 下列运算正确的是（　）
A. (-a²)³=-a⁶
B. a²b·ab=a³b²
C. ab-a=b
D. (a+b)²=a²+b²
答案：A
解析：根据幂的乘方与积的乘方法则判断。
3. 若CB∥OA，∠CBO=122°，∠BON=90°，则入射角∠AON的度数为（　）
A. 22°
B. 32°
C. 35°
D. 122°
答案：B
解析：由平行线性质与余角关系可得32°。
4. 不透明箱中有m个球，其中红球4个；大量重复试验中摸到红球的频率稳定在0.5附近，可估算m为（　）
A. 8
B. 12
C. 15
D. 20
答案：A
解析：4/m≈0.5，所以m≈8。
5. 不等式组x+2>0，-x+2≥0的解集是（　）
A. x<-2
B. -2<x≤2
C. x≥2
D. x≤-2
答案：B
解析：分别求解后取公共部分。
6. 一边靠墙的矩形仓库面积为672m²，另三边栅栏总长76m。设垂直墙边的栅栏AB长为xm，符合题意的方程是（　）
A. ½x(76-x)=672
B. ½x(76-2x)=672
C. x(76-2x)=672
D. x(76-x)=672
答案：C
解析：平行墙边长为76-2x，面积为x(76-2x)。
7. 对二次函数A和B，若A的顶点在B的顶点上方，则称A是B的“仰顶函数”。若任意实数m下，y=x²+4x+6-n都是y=x²+2mx-4m的仰顶函数，则n的范围是（　）
A. n<-2
B. n≤2
C. n>2
D. n>-2
答案：A
解析：比较两抛物线顶点纵坐标并求恒成立条件。
8. 四边形ABCD中，AB=2，∠ADC=150°，AC=2√3，∠BAC=90°，BD平分∠ABC，则BD长为（　）
A. 2√2
B. 3
C. √3+1
D. 3√3/2
答案：C
解析：利用直角三角形和角平分线关系求解。`;

const realisticFiveFillQuestions = `9. 在平面直角坐标系xOy中，点P到x轴、y轴的距离分别为2、5，请写出一个符合条件的点P的坐标：______。
答案：(2，5)
解析：横坐标绝对值为5、纵坐标绝对值为2，符合条件的坐标有四个，写出一个即可。
10. 三支不同颜色的彩笔与三个对应笔帽随机配对，每个笔帽和笔芯颜色都不匹配的概率是______。
答案：1/3
解析：三件物品的错排有2种，总排列有6种，概率为2/6=1/3。
11. 快递员取一件快递的收益比送一件多1元，送件数是取件数的2倍。若送、取快递获益相同，则取一件快递的收益为______元。
答案：2
解析：设送一件收益x元，则2x=x+1，解得x=1，所以取一件收益2元。
12. 过原点的直线与反比例函数y=k/x相交于A、B，延长BA至C使A为BC中点，过C作CD⊥x轴交第一象限图象于E。若△CBE面积为32，则k=______。
答案：6
解析：设A=(a，k/a)，利用中心对称求B、C坐标，再用三角形面积公式得到|k|=6；由E在第一象限得k=6。
13. 在Rt△ABC中，∠ACB=90°，BC=3，AB=5。△ABC绕AC中点O逆时针旋转后得到A'B'C'，当A'B'经过C时，BB'的长为______。
答案：2√5
解析：由旋转保持长度与对应角相等，结合勾股定理求得BB'=2√5。`;

const realisticSevenSolutionQuestions = `14. 计算：-1²+(2024-π)⁰+2cos60°-|4-√27|-(-1/2)⁻²。
答案：-7+3√3
解析：分别计算乘方、零次幂、特殊角三角函数、绝对值和负整数指数幂，再合并同类项。
15. 在数学课上，老师展示两道习题的解答过程。习题1计算2/(x+1)-(x-3)/(x²-1)，习题2解方程x²-4x-5=0。（1）指出两份解答最先出错的步骤；（2）任选一题写出正确过程。
答案：习题1第二步；习题2第三步。
解析：习题1通分后的分子应为2x-2-(x-3)=x+1；习题2开平方时应取正负两个根。
16. 某校从七、八、九年级各随机抽取学生参加科学竞赛。九年级成绩为8，8，5，10，9，7，9，8。（1）求九年级成绩的众数与中位数；（2）比较两个年级成绩方差；（3）根据各年级“非常愿意参加讲座”的比例估计全校比例。
答案：（1）众数8，中位数8；（2）根据原始数据计算比较；（3）按各年级人数加权平均。
解析：先排序求集中趋势，再用方差定义比较波动，比例估计必须使用加权平均而非简单平均。
17. 某校研究性学习小组利用斜坡观测实物高度。已知斜坡坡度i=1:2.4、斜坡长39米，教师眼睛到斜坡距离1.2米，并给出车辆与路牌的位置关系。（1）求斜坡高度；（2）求牌杆BQ高度；（3）求指示牌BP高度。
答案：（1）15米；（2）结合平行线求得；（3）结合相似三角形求得。
解析：由坡度构造5-12-13直角三角形，再分别使用平行线与相似三角形建立比例。
18. 如图，AB是⊙O的直径，AF平分∠EAC，且∠E=90°，AG=BG。（1）证明EC是⊙O的切线；（2）若AG=2√2，AF=2√3，求AE的长。
答案：（1）证明OC⊥EC；（2）AE=4。
解析：连接OC，利用等腰三角形、角平分线和圆周角定理证明垂直；再由勾股关系求长度。
19. 实践与操作：制作筝形风筝。两条互相垂直的骨架AC、BD长度和为80cm，四边形面积为600cm²。（1）求两条骨架长度；（2）建立坐标系求经过E、F、G三点的抛物线；（3）求无拼接筝形纸片的最小面积。
答案：（1）AC=60cm，BD=20cm；（2）由三点坐标待定系数；（3）根据平行关系与面积函数求最小值。
解析：面积条件给出AC·BD/2=600，与和为80联立；后两问分别使用待定系数法和二次函数最值。
20. 如图，在菱形ABCD中，点E在对角线BD上，点F与点B关于AE对称，射线AE分别与DF、BC交于G、H。（1）在∠ABC=90°且F落在AC上时求∠G及AE·AG；（2）猜想∠G与∠ABC的关系并证明；（3）已知cos∠ABC=3/5，求EH/HG。
答案：（1）45°，8；（2）∠G=1/2∠ABC；（3）根据两种位置分类求值。
解析：利用轴对称、菱形对角线性质与相似三角形；最后一问需对F所在边分类讨论。`;

function allIds(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const object = value as { attrs?: { id?: unknown }; content?: unknown[] };
  return [
    ...(typeof object.attrs?.id === "string" ? [object.attrs.id] : []),
    ...(object.content?.flatMap(allIds) ?? [])
  ];
}

describe("ChalkLee editing templates", () => {
  it("creates a valid blank document ready for immediate editing", () => {
    const document = createEmptyChalkLeeDocument("  新讲义  ", deterministicIds(), "2026-08-29T00:00:00.000Z");
    expect(document.metadata).toMatchObject({
      title: "新讲义",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z"
    });
    expect(document.content.content.map((node) => node.type)).toEqual(["heading", "paragraph"]);
    expect(document.content.content[0]).toMatchObject({
      attrs: { textAlign: "center", lineHeight: 1.95, spaceAfterPt: 0 },
      content: [{ marks: [{ type: "bold" }, { type: "textStyle", attrs: { fontSizePt: 16 } }] }]
    });
    expect(document.appearance.page.marginsPt).toEqual({ top: 45.5, right: 54, bottom: 72, left: 54 });
    expect(document.appearance.body).toEqual({
      fontFamilies: ["Times New Roman", "Songti SC", "SimSun", "Noto Serif SC", "serif"],
      fontSizePt: 10.5,
      lineHeight: 1.485714,
      color: "#000000"
    });
    expect(document.appearance.defaults).toEqual({
      questionStyleRef: "question.exam",
      optionStyleRef: "option.exam",
      answerStyleRef: "answer.standard",
      analysisStyleRef: "analysis.standard"
    });
    expect(validateChalkLeeSemantics(document)).toEqual([]);
    expect(chalkLeeTitleFromContent(document.content, "旧标题")).toBe("新讲义");
  });

  it("falls back when a document has no usable level-one title", () => {
    expect(chalkLeeTitleFromContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] }, "原标题")).toBe("原标题");
    expect(chalkLeeTitleFromContent({ type: "doc", content: [{ type: "heading", attrs: { level: 1 } }] }, "原标题")).toBe("原标题");
  });

  it.each(["choice", "single-choice"] as const)("creates a complete %s question with unique stable ids", (template) => {
    const question = createQuestionTemplate(template, deterministicIds());
    const regions = question.content ?? [];
    const options = regions[1]?.content ?? [];
    const ids = allIds(question);

    // Answers and analyses are added when the teacher writes them, not as empty boxes.
    expect(regions.map((region) => region.type)).toEqual(["questionStem", "optionGroup"]);
    expect(options.map((option) => option.attrs?.label)).toEqual(["A", "B", "C", "D"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps a unified choice question and multiple correct answers after saving and reopening", async () => {
    const createId = deterministicIds();
    const document = createEmptyChalkLeeDocument("选择题", createId);
    const question = createQuestionTemplate("choice", createId);
    const optionLabels = question.content![1].content!.map(option => String(option.attrs!.label));
    const allowsMultiple = chalkLeeChoiceAllowsMultipleAnswers(question.attrs!.kind);
    const first = toggleChoiceAnswer([], "A", allowsMultiple, optionLabels);
    const both = toggleChoiceAnswer(first, "C", allowsMultiple, optionLabels);
    expect(first).toEqual(["A"]);
    expect(both).toEqual(["A", "C"]);
    expect(toggleChoiceAnswer(both, "A", allowsMultiple, optionLabels)).toEqual(["C"]);
    question.content!.push({ type: "questionAnswer", attrs: { id: createId() }, content: [{ type: "paragraph", attrs: { id: createId() }, content: [{ type: "text", text: both.join("、") }] }] });
    document.content = sanitizeChalkLeeEditorJson({ type: "doc", content: [question] }) as ChalkLeeRootNode;

    const reopened = await readChalkLeeArchive(await createChalkLeeArchive(document));
    expect(validateChalkLeeSemantics(reopened.document)).toEqual([]);
    expect(reopened.document.content).toEqual(document.content);
    expect(reopened.document.content.content[0]).toMatchObject({ type: "question", attrs: { kind: "choice" } });
  });

  it("creates fill-in and free-response questions without fake options", () => {
    const fill = createQuestionTemplate("fill-blank", deterministicIds());
    const response = createQuestionTemplate("free-response", deterministicIds());

    expect(fill.content?.[0]?.content?.[0]?.content?.some((node) => node.type === "blank")).toBe(true);
    expect(fill.content?.[1]?.content).toEqual([]);
    expect(response.content?.[1]?.content).toEqual([]);
  });

  it("restores required empty region arrays after an editor JSON round trip", () => {
    const question = structuredClone(createQuestionTemplate("free-response", deterministicIds()));
    delete question.content?.[1]?.content;
    const document = createEmptyChalkLeeDocument("空选项保存回归", deterministicIds(), "2026-08-29T00:00:00.000Z");
    document.content = sanitizeChalkLeeEditorJson({ type: "doc", content: [question] }) as ChalkLeeRootNode;

    expect(document.content.content[0]?.type).toBe("question");
    if (document.content.content[0]?.type !== "question") return;
    expect(document.content.content[0].content[1].content).toEqual([]);
    expect(validateChalkLeeSemantics(document)).toEqual([]);
  });

  it("removes renderer-only option style attributes before saving", () => {
    const sanitized = sanitizeChalkLeeEditorJson({
      type: "optionGroup",
      attrs: {
        id: "options_1",
        layout: "four-column",
        runtimeStyle: { rowGap: "0pt" },
        runtimeMarker: "label",
        runtimeCss: "color:#123456",
        runtimeLabel: "参考答案",
        runtimeAuthoringSource: {
          kind: "question-number",
          paragraph: { type: "paragraph", content: [{ type: "text", text: "1. " }] }
        }
      },
      content: []
    });

    expect(sanitized.attrs).toEqual({ id: "options_1", layout: "four-column" });
  });

  it("removes untrusted question authoring provenance recursively", () => {
    const sanitized = sanitizeChalkLeeEditorJson({
      type: "doc",
      content: [{
        type: "question",
        attrs: {
          id: "question_1",
          kind: "free-response",
          number: { mode: "auto" },
          runtimeAuthoringSource: {
            kind: "question-number",
            paragraph: {
              type: "paragraph",
              attrs: { id: "stem_body" },
              content: [{ type: "text", text: "99. " }]
            }
          }
        },
        content: [{
          type: "questionStem",
          attrs: { id: "stem" },
          content: [{ type: "paragraph", attrs: { id: "stem_body" } }]
        }]
      }]
    });

    expect(sanitized.content?.[0]?.attrs).toEqual({
      id: "question_1",
      kind: "free-response",
      number: { mode: "auto" }
    });
  });

  it("creates a movable reading group containing a complete subquestion", () => {
    const group = createQuestionGroupTemplate(deterministicIds());
    expect(group.content?.map((region) => region.type)).toEqual(["questionMaterial", "subQuestionList"]);
    expect(group.content?.[1]?.content?.[0]?.type).toBe("question");
    const ids = allIds(group);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("accepts v0.2 shared options, stem-only subquestions, and real blank links", () => {
    const document = createEmptyChalkLeeDocument("共享选项题组", deterministicIds(), "2026-08-29T00:00:00.000Z");
    document.content.content = [{
      type: "questionGroup",
      attrs: { id: "group", kind: "sentence-restoration", number: { mode: "none" } },
      content: [
        {
          type: "questionMaterial",
          attrs: { id: "material" },
          content: [{
            type: "paragraph",
            attrs: { id: "material_paragraph" },
            content: [{ type: "text", text: "Passage " }, { type: "blank", attrs: { id: "blank_1", label: "1" } }]
          }]
        },
        {
          type: "optionGroup",
          attrs: { id: "shared_options", layout: "one-column" },
          content: [
            { type: "option", attrs: { id: "option_a", label: "A" }, content: [{ type: "paragraph", attrs: { id: "option_a_p" }, content: [{ type: "text", text: "Choice A" }] }] },
            { type: "option", attrs: { id: "option_b", label: "B" }, content: [{ type: "paragraph", attrs: { id: "option_b_p" }, content: [{ type: "text", text: "Choice B" }] }] }
          ]
        },
        {
          type: "subQuestionList",
          attrs: { id: "subquestions" },
          content: [{
            type: "question",
            attrs: {
              id: "question_1",
              kind: "single-choice",
              number: { mode: "fixed", label: "1" },
              sourceBlankId: "blank_1"
            },
            content: [{
              type: "questionStem",
              attrs: { id: "question_1_stem" },
              content: [{ type: "paragraph", attrs: { id: "question_1_stem_p" } }]
            }]
          }]
        }
      ]
    }];

    expect(validateChalkLeeSemantics(document)).toEqual([]);
    const group = document.content.content[0];
    if (group?.type !== "questionGroup") return;
    const list = group.content.find((region) => region.type === "subQuestionList");
    if (!list) return;
    list.content[0].attrs.sourceBlankId = "material_paragraph";
    expect(validateChalkLeeSemantics(document)).toContainEqual(expect.objectContaining({ code: "missing-source-blank" }));
  });

  it("creates editable table grids with bounded dimensions and unique ids", () => {
    const table = createTableTemplate(2, 3, deterministicIds());
    expect(table.content).toHaveLength(2);
    expect(table.content?.every((row) => row.content?.length === 3)).toBe(true);
    expect(table.content?.[0]?.content?.[0]?.content?.[0]?.type).toBe("paragraph");
    const ids = allIds(table);
    expect(new Set(ids).size).toBe(ids.length);

    expect(createTableTemplate(0, 99, deterministicIds()).content).toHaveLength(1);
    expect(createTableTemplate(0, 99, deterministicIds()).content?.[0]?.content).toHaveLength(12);
  });

  it("keeps table column widths stable across resize, insert, and remove", () => {
    expect(readChalkLeeTableColumnWidths([120, 180, 180], 3)).toEqual([120, 180, 180]);
    expect(readChalkLeeTableColumnWidths([120, 180], 3)).toBeNull();
    expect(equalChalkLeeTableColumnWidths(3, 480)).toEqual([160, 160, 160]);
    expect(resizeChalkLeeTableColumnBoundary([100, 100, 100], 0, 30)).toEqual([130, 70, 100]);
    expect(resizeChalkLeeTableColumnBoundary([100, 100, 100], 0, 100)).toEqual([164, 36, 100]);

    const inserted = insertChalkLeeTableColumnWidth([120, 180, 180], 3, 1);
    expect(inserted).toEqual([90, 120, 135, 135]);
    expect(inserted?.reduce((sum, width) => sum + width, 0)).toBe(480);

    const narrowInserted = insertChalkLeeTableColumnWidth([262.5, 62.5, 162.5], 3, 1);
    expect(narrowInserted?.every((width) => width >= 36)).toBe(true);
    expect(narrowInserted?.reduce((sum, width) => sum + width, 0)).toBe(487.5);

    const removed = removeChalkLeeTableColumnWidth(inserted, 4, 1);
    expect(removed).toHaveLength(3);
    expect(removed?.reduce((sum, width) => sum + width, 0)).toBe(480);
  });

  it("clamps persisted table row height while preserving precise drag deltas", () => {
    expect(resizeChalkLeeTableRowHeight(24, 12)).toBe(36);
    expect(resizeChalkLeeTableRowHeight(24, -100)).toBe(18);
    expect(resizeChalkLeeTableRowHeight(Number.NaN, 4.25)).toBe(22.3);
  });

  it("reports a persisted table column width count mismatch", () => {
    const document = createEmptyChalkLeeDocument("表格列宽校验", deterministicIds(), "2026-08-30T00:00:00.000Z");
    const table = createTableTemplate(2, 3, deterministicIds());
    table.attrs = { ...table.attrs, columnWidthsPt: [120, 120] };
    document.content.content = [table as ChalkLeeRootNode["content"][number]];
    expect(validateChalkLeeSemantics(document)).toContainEqual(expect.objectContaining({ code: "table-column-width-count" }));
  });

  it("reports invalid persisted table row heights", () => {
    const document = createEmptyChalkLeeDocument("表格行高校验", deterministicIds(), "2026-08-30T00:00:00.000Z");
    const table = createTableTemplate(2, 2, deterministicIds());
    if (!table.content?.[0]) return;
    table.content[0].attrs = { ...table.content[0].attrs, heightPt: -1 };
    document.content.content = [table as ChalkLeeRootNode["content"][number]];
    expect(validateChalkLeeSemantics(document)).toContainEqual(expect.objectContaining({ code: "table-row-height" }));
  });

  it("accepts contiguous repeated table headers and rejects broken header semantics", () => {
    const document = createEmptyChalkLeeDocument("表格标题行校验", deterministicIds(), "2026-08-30T00:00:00.000Z");
    const table = createTableTemplate(3, 2, deterministicIds());
    if (!table.content?.[0] || !table.content[1] || !table.content[2]) return;
    table.content[0].attrs = { ...table.content[0].attrs, repeatAsHeader: true };
    document.content.content = [table as ChalkLeeRootNode["content"][number]];
    expect(validateChalkLeeSemantics(document)).toEqual([]);

    table.content[0].attrs = { ...table.content[0].attrs, repeatAsHeader: undefined };
    table.content[2].attrs = { ...table.content[2].attrs, repeatAsHeader: true };
    expect(validateChalkLeeSemantics(document)).toContainEqual(expect.objectContaining({ code: "table-header-row-order" }));

    table.content[0].attrs = { ...table.content[0].attrs, repeatAsHeader: true };
    table.content[2].attrs = { ...table.content[2].attrs, repeatAsHeader: undefined };
    if (table.content[0].content?.[0]?.attrs) table.content[0].content[0].attrs.rowspan = 2;
    expect(validateChalkLeeSemantics(document)).toContainEqual(expect.objectContaining({ code: "table-header-rowspan" }));
  });

  it("recognizes a pasted choice question without losing visible sections", () => {
    const parsed = parseQuestionText(`12. 下列说法正确的是（ ）
A. 选项甲
B．选项乙
C、选项丙
D: 选项丁
答案：B
解析：根据定义可知。`, deterministicIds());

    expect(parsed).toMatchObject({ optionCount: 4, hasAnswer: true, hasAnalysis: true });
    expect(parsed?.node.attrs?.number).toEqual({ mode: "fixed", label: "12" });
    expect(parsed?.node.content?.[1]?.content?.map((option) => option.attrs?.label)).toEqual(["A", "B", "C", "D"]);
    expect(parsed?.node.content?.[2]?.content?.[0]?.content?.[0]?.text).toBe("B");
    expect(parsed?.node.content?.[3]?.content?.[0]?.content?.[0]?.text).toBe("根据定义可知。");
    const ids = allIds(parsed?.node);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("recognizes a compact same-line teacher draft with fixed number and empty regions", () => {
    const source = "21. 收到\n\nA. s sd B. sd C.s \n\n答案：\n\n解析：";
    const result = parseQuestionTextBatchDetailed(source, deterministicIds());

    expect(result.unrecognizedSegments).toEqual([]);
    expect(result.drafts).toHaveLength(1);
    const draft = result.drafts[0];
    expect(draft).toMatchObject({ optionCount: 3, hasAnswer: false, hasAnalysis: false });
    expect(draft.node.attrs?.number).toEqual({ mode: "fixed", label: "21" });
    expect(draft.node.content?.[0]?.content?.[0]?.content?.[0]?.text).toBe("收到");
    expect(draft.node.content?.[1]?.content?.map((option) => ({
      label: option.attrs?.label,
      text: option.content?.[0]?.content?.[0]?.text
    }))).toEqual([
      { label: "A", text: "s sd" },
      { label: "B", text: "sd" },
      { label: "C", text: "s" }
    ]);
    expect(draft.node.content?.[2]?.content).toEqual([expect.objectContaining({ type: "paragraph" })]);
    expect(draft.node.content?.[2]?.content?.[0]).not.toHaveProperty("content");
    expect(draft.node.content?.[3]?.content).toEqual([expect.objectContaining({ type: "paragraph" })]);
    expect(draft.node.content?.[3]?.content?.[0]).not.toHaveProperty("content");
    const ids = allIds(draft.node);
    expect(new Set(ids).size).toBe(ids.length);

    const document = createEmptyChalkLeeDocument("同行选项", deterministicIds(), "2026-09-04T00:00:00.000Z");
    document.content.content = [draft.node as ChalkLeeRootNode["content"][number]];
    expect(validateChalkLeeSemantics(document)).toEqual([]);
  });

  it("tokenizes inline options with UTF-16 offsets and rejects a marker before A", () => {
    const parsed = parseChalkLeeInlineOptionSequence("题😀 A. 甲 B.乙 C.s ");
    expect(parsed?.options.map(({ label, markerFrom, content }) => ({ label, markerFrom, content }))).toEqual([
      { label: "A", markerFrom: 4, content: "甲" },
      { label: "B", markerFrom: 9, content: "乙" },
      { label: "C", markerFrom: 13, content: "s" }
    ]);
    expect(parseChalkLeeInlineOptionSequence("B. 说明 A.甲 B.乙")).toBeNull();
    expect(parseChalkLeeInlineOptionSequence("题干 Ａ。甲 Ｂ。乙 Ｃ。丙")?.options.map(({ label, content }) => ({ label, content }))).toEqual([
      { label: "A", content: "甲" },
      { label: "B", content: "乙" },
      { label: "C", content: "丙" }
    ]);
    expect(parseQuestionText("21. 收到\nA.B", deterministicIds())).toBeNull();
  });

  it.each([
    ["duplicate", "1.stem\nA.a\nB.b B.duplicate"],
    ["skipped", "1.stem\nA.a\nB.b D.skipped"],
    ["backward", "1.stem\nA.a\nB.b A.stray"]
  ])("fails the whole question closed for a %s inline marker", (_case, source) => {
    expect(parseQuestionText(source, deterministicIds())).toBeNull();
    const result = parseQuestionTextBatchDetailed(source, deterministicIds());
    expect(result.drafts).toEqual([]);
    expect(result.unrecognizedSegments).toHaveLength(1);
    expect(result.unrecognizedSegments[0]).toMatchObject({ reasonCode: "options-not-contiguous" });
  });

  it("recognizes a free-response question and rejects incomplete option lists", () => {
    expect(parseQuestionText("3、计算 x + 1。\n答案：2", deterministicIds())?.optionCount).toBe(0);
    expect(parseQuestionText("题干\nA. 唯一选项", deterministicIds())).toBeNull();
  });

  it("recognizes valid questions while preserving incomplete segments for review", () => {
    const drafts = parseQuestionTextBatch(`1. 第一题
A. 甲
B. 乙
答案：A
2、第二题
A. 丙
B. 丁
答案：B`, deterministicIds());
    expect(drafts).toHaveLength(2);
    expect(drafts.map((draft) => draft.node.attrs?.number)).toEqual([
      { mode: "fixed", label: "1" },
      { mode: "fixed", label: "2" }
    ]);
    const ids = drafts.flatMap((draft) => allIds(draft.node));
    expect(new Set(ids).size).toBe(ids.length);

    const partial = parseQuestionTextBatchDetailed(
      "1. 完整题\nA. 甲\nB. 乙\n2. 不完整题\nA. 唯一选项\n3. 另一道完整题\nA. 丙\nB. 丁",
      deterministicIds()
    );
    expect(partial.drafts).toHaveLength(2);
    expect(partial.unrecognizedSegments).toMatchObject([{ kind: "text", reason: "unrecognized" }]);
    expect(partial.unrecognizedSegments[0]?.source).toContain("2. 不完整题");
    expect(questionBatchReplacementContent(partial, deterministicIds()).map((node) => node.type)).toEqual([
      "question",
      "paragraph",
      "paragraph",
      "question"
    ]);
  });

  it("does not mistake exam frontmatter for a free-response question", () => {
    const result = parseQuestionTextBatchDetailed(`姓名：____________　班级：________　学号：________
考试时间：120分钟　满分：100分
注意事项：1. 答题前填写个人信息；2. 选择题请填涂答案；3. 解答题须写出必要过程。
一、选择题（本大题共8小题，每小题3分，共24分）`, deterministicIds());

    expect(result.drafts).toEqual([]);
    expect(result.unrecognizedSegments).toHaveLength(1);
    expect(result.unrecognizedSegments[0]?.source).toContain("注意事项");
  });

  it("recognizes the teacher baseline's realistic eight-question batch", () => {
    const result = parseQuestionTextBatchDetailed(realisticEightChoiceQuestions, deterministicIds());

    expect(result.drafts).toHaveLength(8);
    expect(result.unrecognizedSegments).toEqual([]);
    expect(result.drafts.every((draft) => draft.optionCount === 4 && draft.hasAnswer && draft.hasAnalysis)).toBe(true);
    expect(result.drafts.map((draft) => draft.node.attrs?.number)).toEqual(
      Array.from({ length: 8 }, (_, index) => ({ mode: "fixed", label: String(index + 1) }))
    );
  });

  it("recognizes the teacher's complete 8/5/7 exam batches with semantic fill blanks", () => {
    const choice = parseQuestionTextBatchDetailed(realisticEightChoiceQuestions, deterministicIds());
    const fill = parseQuestionTextBatchDetailed(realisticFiveFillQuestions, deterministicIds());
    const solution = parseQuestionTextBatchDetailed(realisticSevenSolutionQuestions, deterministicIds());
    const drafts = [...choice.drafts, ...fill.drafts, ...solution.drafts];

    expect(drafts).toHaveLength(20);
    expect(choice.drafts.map((draft) => draft.node.attrs?.kind)).toEqual(
      Array.from({ length: 8 }, () => "single-choice")
    );
    expect(fill.drafts.map((draft) => draft.node.attrs?.kind)).toEqual(
      Array.from({ length: 5 }, () => "fill-blank")
    );
    expect(fill.drafts.map((draft) => draft.blankCount)).toEqual([1, 1, 1, 1, 1]);
    expect(fill.drafts.every((draft) => allIds(draft.node).some((id) => id.startsWith("node_")))).toBe(true);
    expect(fill.drafts.every((draft) => draft.node.content?.[0]?.content?.some((paragraph) =>
      paragraph.content?.some((inline) => inline.type === "blank")
    ))).toBe(true);
    expect(solution.drafts.map((draft) => draft.node.attrs?.kind)).toEqual(
      Array.from({ length: 7 }, () => "free-response")
    );
    expect(solution.drafts.map((draft) => draft.node.attrs?.number)).toEqual(
      Array.from({ length: 7 }, (_, index) => ({ mode: "fixed", label: String(index + 14) }))
    );
    expect(drafts.every((draft) => draft.hasAnswer && draft.hasAnalysis)).toBe(true);
    expect([...choice.unrecognizedSegments, ...fill.unrecognizedSegments, ...solution.unrecognizedSegments]).toEqual([]);
  });

  it("keeps multiline subquestions and numbered solution steps inside their outer question", () => {
    const result = parseQuestionTextBatchDetailed(`17. 完成下面的综合题。
（1）先求斜坡高度；
（2）再求标志牌高度。
1. 第一步先画出辅助线；
2. 第二步列出比例式。
答案：
1.步骤一先建立直角三角形。
2.步骤二代入比例计算。
解析：
1.步骤一使用勾股定理。
2.步骤二使用相似三角形。
18. 计算 2+3。
答案：5
解析：直接计算。`, deterministicIds());

    expect(result.drafts).toHaveLength(2);
    expect(result.unrecognizedSegments).toEqual([]);
    expect(result.drafts.map((draft) => draft.node.attrs?.number)).toEqual([
      { mode: "fixed", label: "17" },
      { mode: "fixed", label: "18" }
    ]);
    expect(result.drafts[0]?.stemPreview).toContain("（1）先求斜坡高度");
    expect(result.drafts[0]?.stemPreview).toContain("（2）再求标志牌高度");
    expect(result.drafts[0]?.stemPreview).toContain("1. 第一步先画出辅助线");
    const answerText = result.drafts[0]?.node.content?.[2]?.content
      ?.flatMap((paragraph) => paragraph.content ?? [])
      .map((inline) => inline.text ?? "")
      .join(" ");
    const analysisText = result.drafts[0]?.node.content?.[3]?.content
      ?.flatMap((paragraph) => paragraph.content ?? [])
      .map((inline) => inline.text ?? "")
      .join(" ");
    expect(answerText).toContain("1.步骤一");
    expect(answerText).toContain("2.步骤二");
    expect(analysisText).toContain("1.步骤一");
    expect(analysisText).toContain("2.步骤二");
  });

  it("recognizes a pure parenthesized-number choice batch without splitting parenthesized subquestions", () => {
    const parenthesized = parseQuestionTextBatchDetailed(`（1）第一道独立选择题
A. 甲
B. 乙
答案：A
（2）第二道独立选择题
A. 丙
B. 丁
答案：B`, deterministicIds());
    expect(parenthesized.drafts).toHaveLength(2);
    expect(parenthesized.drafts.map((draft) => draft.node.attrs?.number)).toEqual([
      { mode: "fixed", label: "1" },
      { mode: "fixed", label: "2" }
    ]);

    const outer = parseQuestionTextBatchDetailed(`17. 完成证明题
（1）证明第一步；
（2）证明第二步。
答案：见证明过程
解析：依次证明。`, deterministicIds());
    expect(outer.drafts).toHaveLength(1);
    expect(outer.drafts[0]?.stemPreview).toContain("（2）证明第二步");
  });

  it("preserves an incomplete middle question and explains the exact source lines", () => {
    const result = parseQuestionTextBatchDetailed(`1. 第一题
A. 甲
B. 乙
答案：A

2. 残缺的中间题
A. 只有一个选项

3. 第三题
A. 丙
B. 丁
答案：B`, deterministicIds());

    expect(result.drafts.map((draft) => draft.node.attrs?.number)).toEqual([
      { mode: "fixed", label: "1" },
      { mode: "fixed", label: "3" }
    ]);
    expect(result.unrecognizedSegments).toHaveLength(1);
    expect(result.unrecognizedSegments[0]).toMatchObject({
      reason: "unrecognized",
      reasonCode: "incomplete-options",
      lineRange: { start: 6, end: 7 }
    });
    expect(result.unrecognizedSegments[0]?.reasonDetail).toContain("至少补齐连续的 A、B");
    expect(result.unrecognizedSegments[0]?.preview).toContain("2. 残缺的中间题");
  });

  it("rejects B/D option lists without A and requires contiguous labels", () => {
    expect(parseQuestionText(`4. 错误选项起点
B. 乙
D. 丁`, deterministicIds())).toBeNull();
    expect(parseQuestionText(`4. 跳过了B
A. 甲
C. 丙`, deterministicIds())).toBeNull();

    const result = parseQuestionTextBatchDetailed(`4. 错误选项起点
B. 乙
D. 丁`, deterministicIds());
    expect(result.drafts).toEqual([]);
    expect(result.unrecognizedSegments[0]?.reasonDetail).toContain("从 B 开始");
  });

  it("keeps low-confidence numbered prose in strict mode and converts it only when explicitly requested", () => {
    const source = "1. 注意事项：请先填写姓名，再按要求作答。";
    const strict = parseQuestionTextBatchDetailed(source, deterministicIds());
    const explicit = parseQuestionTextBatchDetailed(source, deterministicIds(), { mode: "explicit" });

    expect(strict.drafts).toEqual([]);
    expect(strict.unrecognizedSegments[0]).toMatchObject({
      reason: "unrecognized",
      reasonCode: "low-confidence",
      lineRange: { start: 1, end: 1 }
    });
    expect(explicit.drafts).toHaveLength(1);
    expect(explicit.drafts[0]?.node.attrs?.kind).toBe("free-response");
  });

  it("allows an explicit section heading to restart numbering without swallowing the heading", () => {
    const result = parseQuestionTextBatchDetailed(`8. 上一大题最后一题
A. 甲
B. 乙
答案：A
解析：逐项判断。
二、填空题（每题 3 分）
1. 新大题第一题的答案是______。
答案：1
解析：直接填写。`, deterministicIds());

    expect(result.drafts.map((draft) => draft.node.attrs?.number)).toEqual([
      { mode: "fixed", label: "8" },
      { mode: "fixed", label: "1" }
    ]);
    expect(result.segments.map((segment) => segment.kind)).toEqual(["question", "text", "question"]);
    expect(result.unrecognizedSegments[0]).toMatchObject({
      reason: "preamble",
      reasonCode: "preamble",
      source: "二、填空题（每题 3 分）",
      lineRange: { start: 6, end: 6 }
    });
  });

  it("infers multiple-choice, true-false, fill-blank, and free-response kinds", () => {
    const result = parseQuestionTextBatchDetailed(`1. 选择所有正确结论
A. 甲
B. 乙
C. 丙
D. 丁
答案：A、C
2. 选择另外两个正确结论
A. 甲
B. 乙
C. 丙
D. 丁
答案：AC
3. 判断命题真假
A. 正确
B. 错误
答案：A
4. 判断 1=1。
答案：正确
5. 请计算 x+1。
答案：2`, deterministicIds());

    expect(result.drafts.map((draft) => draft.node.attrs?.kind)).toEqual([
      "multiple-choice",
      "multiple-choice",
      "true-false",
      "true-false",
      "free-response"
    ]);
  });

  it("splits inline answer and analysis markers without changing their text", () => {
    const parsed = parseQuestionText(`6. 下列结论正确的是
A. 甲
B. 乙
C. 丙
答案：A、C；解析：逐项验证可知。`, deterministicIds());

    expect(parsed).toMatchObject({ optionCount: 3, hasAnswer: true, hasAnalysis: true });
    expect(parsed?.node.attrs?.kind).toBe("multiple-choice");
    expect(parsed?.node.content?.[2]?.content?.[0]?.content?.[0]?.text).toBe("A、C");
    expect(parsed?.node.content?.[3]?.content?.[0]?.content?.[0]?.text).toBe("逐项验证可知。");
  });

  it("turns underscore and parenthesized placeholders into semantic blanks while preserving surrounding text", () => {
    const parsed = parseQuestionText(`9. 坐标为(______,______)，概率是______，结论填在（　）内。
答案：(2,5)，1/3，成立
解析：依次填写。`, deterministicIds());

    expect(parsed?.node.attrs?.kind).toBe("fill-blank");
    expect(parsed?.blankCount).toBe(4);
    const stemContent = parsed?.node.content?.[0]?.content?.[0]?.content ?? [];
    expect(stemContent.filter((inline) => inline.type === "blank")).toHaveLength(4);
    expect(stemContent.map((inline) => inline.text ?? (inline.type === "blank" ? "[blank]" : "")).join(""))
      .toBe("坐标为([blank],[blank])，概率是[blank]，结论填在[blank]内。");
    expect(parsed?.node.content?.[2]?.content?.[0]?.content?.[0]?.text).toBe("(2,5)，1/3，成立");
    expect(parsed?.node.content?.[3]?.content?.[0]?.content?.[0]?.text).toBe("依次填写。");

    const choice = parseQuestionText(`1. 正确答案是（　）
A. 甲
B. 乙
答案：A`, deterministicIds());
    expect(choice?.blankCount).toBe(0);
    expect(choice?.node.attrs?.kind).toBe("single-choice");
  });

  it("treats standard blank syntax as sufficient evidence in strict batches without answers or analysis", () => {
    const result = parseQuestionTextBatchDetailed(`1. 横线留空写在______处。
2. 全角横线留空写在＿＿＿＿处。
3. 括号留空写在（　）内。`, deterministicIds());

    expect(result.unrecognizedSegments).toEqual([]);
    expect(result.drafts).toHaveLength(3);
    expect(result.drafts.map((draft) => draft.node.attrs?.kind)).toEqual([
      "fill-blank",
      "fill-blank",
      "fill-blank"
    ]);
    expect(result.drafts.map((draft) => draft.blankCount)).toEqual([1, 1, 1]);
    expect(result.drafts.every((draft) => !draft.hasAnswer && !draft.hasAnalysis)).toBe(true);
    expect(result.drafts.map((draft) => draft.node.content?.[0]?.content?.[0]?.content?.map((inline) =>
      inline.text ?? (inline.type === "blank" ? "[blank]" : "")
    ).join(""))).toEqual([
      "横线留空写在[blank]处。",
      "全角横线留空写在[blank]处。",
      "括号留空写在[blank]内。"
    ]);
  });

  it("keeps preamble text in order and does not treat decimals as question numbers", () => {
    const result = parseQuestionTextBatchDetailed(`一、选择题
1. 第一题
A. 甲
B. 乙
2.4 不是一道新题`, deterministicIds());

    expect(result.drafts).toHaveLength(1);
    expect(result.unrecognizedSegments).toMatchObject([{ reason: "preamble", source: "一、选择题" }]);
  });
});

describe("ChalkLee editor helpers", () => {
  it("does not coerce exact imported image widths into lossy presets", () => {
    expect(chalkLeeImageWidthPreset(null)).toBe("auto");
    expect(chalkLeeImageWidthPreset(180)).toBe("small");
    expect(chalkLeeImageWidthPreset(300)).toBe("medium");
    expect(chalkLeeImageWidthPreset(430)).toBe("large");
    expect(chalkLeeImageWidthPreset(118)).toBe("custom");
  });

  it("maps every ChalkLee page-background fit mode to valid CSS", () => {
    expect(chalkLeePageBackgroundSize("cover")).toBe("cover");
    expect(chalkLeePageBackgroundSize("contain")).toBe("contain");
    expect(chalkLeePageBackgroundSize("stretch")).toBe("100% 100%");
    expect(chalkLeePageBackgroundSize("tile")).toBe("auto");
  });

  it("regenerates duplicated node ids and keeps internal blank links attached to the copy", () => {
    const duplicate = regenerateChalkLeeNodeIds({
      type: "questionGroup",
      attrs: { id: "group_original" },
      content: [
        {
          type: "questionMaterial",
          attrs: { id: "material_original" },
          content: [{
            type: "paragraph",
            attrs: { id: "paragraph_original" },
            content: [{ type: "blank", attrs: { id: "blank_original" } }]
          }]
        },
        {
          type: "subQuestionList",
          attrs: { id: "list_original" },
          content: [{
            type: "question",
            attrs: { id: "question_original", sourceBlankId: "blank_original" }
          }]
        }
      ]
    }, deterministicIds());

    const ids = allIds(duplicate);
    const blankId = duplicate.content?.[0]?.content?.[0]?.content?.[0]?.attrs?.id;
    const sourceBlankId = duplicate.content?.[1]?.content?.[0]?.attrs?.sourceBlankId;
    expect(ids).not.toContain("group_original");
    expect(new Set(ids).size).toBe(ids.length);
    expect(sourceBlankId).toBe(blankId);
  });

  it("keeps externally linked passage blanks aligned with moved and renumbered questions", () => {
    const linked = (id: string, sourceBlankId: string, label: string) => ({
      type: "question",
      attrs: { id, sourceBlankId, number: { mode: "fixed", label } },
      content: [{ type: "questionStem", attrs: { id: `${id}_stem` } }]
    });
    const first = linked("question_1", "blank_1", "1");
    const second = linked("question_2", "blank_2", "2");
    expect(chalkLeeExternalSourceBlankId(first)).toBe("blank_1");
    expect(chalkLeeQuestionMoveSourceBlankIds(second, first)).toEqual(["blank_1", "blank_2"]);
    expect(chalkLeeQuestionMoveSourceBlankIds(second, { ...first, attrs: { ...first.attrs, sourceBlankId: null } })).toBeNull();
    expect(chalkLeeFixedQuestionBlankLabels([first, second])).toEqual({ blank_1: "1", blank_2: "2" });

    const ownsBlank = {
      ...first,
      content: [{ type: "questionStem", content: [{ type: "paragraph", content: [{ type: "blank", attrs: { id: "blank_1" } }] }] }]
    };
    expect(chalkLeeExternalSourceBlankId(ownsBlank)).toBeNull();
  });

  it("labels every kind by how it is answered, mapping earlier names onto the one vocabulary", () => {
    expect(chalkLeeQuestionKindLabel("choice")).toBe("选择题");
    expect(chalkLeeQuestionKindLabel("single-choice")).toBe("单选题");
    expect(chalkLeeQuestionKindLabel("reading", true)).toBe("阅读理解");
    expect(chalkLeeQuestionKindLabel("english.cloze-choice", true)).toBe("完形填空");
    expect(chalkLeeQuestionKindLabel("grammarFill", true)).toBe("语法填空");
    expect(chalkLeeQuestionKindLabel("custom.lab")).toBe("解答题");
    expect(chalkLeeQuestionKindLabel("free-response")).toBe("解答题");
    expect(chalkLeeChoiceAllowsMultipleAnswers("multiple-choice")).toBe(true);
    expect(chalkLeeChoiceAllowsMultipleAnswers("general.multiple-choice")).toBe(true);
    expect(chalkLeeChoiceAllowsMultipleAnswers("single-choice")).toBe(false);
    expect(chalkLeeChoiceAllowsMultipleAnswers("choice")).toBe(true);
    expect(chalkLeeChoiceAllowsMultipleAnswers("true-false")).toBe(false);
  });

  it("changes one text-style attribute without flattening the other run formatting", () => {
    expect(mergeChalkLeeTextStyleAttribute({ fontFamily: "Times New Roman", fontSizePt: 16 }, "color", "#B42318")).toEqual({
      fontFamily: "Times New Roman",
      fontSizePt: 16,
      color: "#B42318"
    });
    expect(mergeChalkLeeTextStyleAttribute({ fontFamily: "Times New Roman", color: "#B42318" }, "color", null)).toEqual({
      fontFamily: "Times New Roman"
    });
    expect(mergeChalkLeeTextStyleAttribute({ color: "#B42318" }, "color", null)).toBeNull();
    expect(mergeChalkLeeTextStyleAttribute({ fontSizePt: 12 }, "backgroundColor", "#FFF59D")).toEqual({
      fontSizePt: 12,
      backgroundColor: "#FFF59D"
    });
  });

  it("preserves each selected run's font size when applying one shared color", () => {
    const schema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*" },
        text: {}
      },
      marks: {
        textStyle: {
          attrs: {
            fontFamily: { default: null },
            fontSizePt: { default: null },
            color: { default: null },
            backgroundColor: { default: null }
          }
        }
      }
    });
    const textStyle = schema.marks.textStyle;
    const title = schema.text("Title", [textStyle.create({ fontSizePt: 16 })]);
    const body = schema.text(" body", [textStyle.create({ fontSizePt: 12 })]);
    const doc = schema.node("doc", null, [schema.node("paragraph", null, [title, body])]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1, 1 + title.nodeSize + body.nodeSize)
    });
    const transaction = state.tr;

    applyChalkLeeTextStyleAttributeToRange(
      transaction,
      state.selection.from,
      state.selection.to,
      textStyle,
      "color",
      "#B42318"
    );

    const runs = transaction.doc.firstChild?.content.content ?? [];
    expect(runs.map((run) => run.marks[0]?.attrs)).toEqual([
      expect.objectContaining({ fontSizePt: 16, color: "#B42318" }),
      expect.objectContaining({ fontSizePt: 12, color: "#B42318" })
    ]);
  });

  it("uses the first available option label", () => {
    expect(nextOptionLabel(["A", "C"])).toBe("B");
    expect(nextOptionLabel(["a", "B"])).toBe("C");
  });

  it("reads and toggles single- and multiple-choice answers in option order", () => {
    expect(readChoiceAnswerLabels("答案：C、A", ["A", "B", "C", "D"])).toEqual(["A", "C"]);
    expect(toggleChoiceAnswer(["A"], "C", false, ["A", "B", "C", "D"])).toEqual(["C"]);
    expect(toggleChoiceAnswer(["A", "C"], "C", true, ["A", "B", "C", "D"])).toEqual(["A"]);
    expect(toggleChoiceAnswer(["C"], "A", true, ["A", "B", "C", "D"])).toEqual(["A", "C"]);
  });

  it("reads only the letters an answer starts with, not letters in its explanation", () => {
    const labels = ["A", "B", "C", "D"];
    expect(readChoiceAnswerLabels("B．因为 A 项与题意不符", labels)).toEqual(["B"]);
    expect(readChoiceAnswerLabels("【答案】ＡＣ", labels)).toEqual(["A", "C"]);
    expect(readChoiceAnswerLabels("bd", labels)).toEqual(["B", "D"]);
    expect(readChoiceAnswerLabels("Because it is cheap", labels)).toEqual([]);
    expect(readChoiceAnswerLabels("a lot of", labels)).toEqual([]);
  });

  it("keeps an explanation and later lines when option changes rewrite the answer letters", () => {
    const question = createQuestionTemplate("single-choice", deterministicIds());
    question.content = [
      ...question.content!.filter((region) => region.type !== "questionAnswer"),
      { type: "questionAnswer", attrs: { id: "answer" }, content: [
        { type: "paragraph", attrs: { id: "answer_line" }, content: [{ type: "text", text: "C", marks: [{ type: "bold" }] }, { type: "text", text: "，因为 A 项错误" }] },
        { type: "paragraph", attrs: { id: "answer_more" }, content: [{ type: "text", text: "另见教材第 12 页" }] }
      ] }
    ];
    const moved = reorderChoiceOption(question, 2, -1, deterministicIds());
    expect(moved?.content?.find((region) => region.type === "questionAnswer")?.content).toEqual([
      { type: "paragraph", attrs: { id: "answer_line" }, content: [{ type: "text", text: "B", marks: [{ type: "bold" }] }, { type: "text", text: "，因为 A 项错误" }] },
      { type: "paragraph", attrs: { id: "answer_more" }, content: [{ type: "text", text: "另见教材第 12 页" }] }
    ]);
    const removed = removeChoiceOption(question, 2, deterministicIds());
    expect(removed?.content?.find((region) => region.type === "questionAnswer")?.content?.map((paragraph) => paragraph.content?.map((text) => text.text).join(""))).toEqual(["因为 A 项错误", "另见教材第 12 页"]);
  });

  it("relabels moved options and keeps the answer attached to option content", () => {
    const question = createQuestionTemplate("multiple-choice", deterministicIds());
    const options = question.content?.[1]?.content ?? [];
    options.forEach((option, index) => {
      option.content = [{ type: "paragraph", attrs: { id: `content_${index}` }, content: [{ type: "text", text: `内容${index + 1}` }] }];
    });
    question.content!.push({ type: "questionAnswer", attrs: { id: "answer_region" }, content: [{ type: "paragraph", attrs: { id: "answer" }, content: [{ type: "text", text: "A、C" }] }] });

    const moved = reorderChoiceOption(question, 2, -1, deterministicIds());
    expect(moved?.content?.[1]?.content?.map((option) => ({
      label: option.attrs?.label,
      text: option.content?.[0]?.content?.[0]?.text
    }))).toEqual([
      { label: "A", text: "内容1" },
      { label: "B", text: "内容3" },
      { label: "C", text: "内容2" },
      { label: "D", text: "内容4" }
    ]);
    expect(moved?.content?.find((region) => region.type === "questionAnswer")?.content?.[0]?.content?.[0]?.text).toBe("A、B");
    expect(reorderChoiceOption(question, 0, -1, deterministicIds())).toBeNull();
  });

  it("moves options without an answer region and relabels after deletion", () => {
    const question = createQuestionTemplate("single-choice", deterministicIds());
    question.content = question.content?.filter((region) => region.type !== "questionAnswer");

    const moved = reorderChoiceOption(question, 1, -1, deterministicIds());
    expect(moved?.content?.find((region) => region.type === "optionGroup")?.content?.map((option) => option.attrs?.label)).toEqual(["A", "B", "C", "D"]);

    const withAnswer = createQuestionTemplate("multiple-choice", deterministicIds());
    const options = withAnswer.content?.find((region) => region.type === "optionGroup")?.content ?? [];
    options.forEach((option, index) => {
      option.content = [{ type: "paragraph", attrs: { id: `delete_content_${index}` }, content: [{ type: "text", text: `内容${index + 1}` }] }];
    });
    withAnswer.content!.push({ type: "questionAnswer", attrs: { id: "delete_answer_region" }, content: [{ type: "paragraph", attrs: { id: "delete_answer" }, content: [{ type: "text", text: "B、D" }] }] });

    const removed = removeChoiceOption(withAnswer, 1, deterministicIds());
    const remainingOptions = removed?.content?.find((region) => region.type === "optionGroup")?.content ?? [];
    expect(remainingOptions.map((option) => ({ label: option.attrs?.label, text: option.content?.[0]?.content?.[0]?.text }))).toEqual([
      { label: "A", text: "内容1" },
      { label: "B", text: "内容3" },
      { label: "C", text: "内容4" }
    ]);
    expect(removed?.content?.find((region) => region.type === "questionAnswer")?.content?.[0]?.content?.[0]?.text).toBe("C");
    expect(removeChoiceOption(withAnswer, 8, deterministicIds())).toBeNull();
  });

  it("maps supported image media types to safe archive extensions", () => {
    expect(chalkLeeImageExtension("image/jpeg")).toBe("jpg");
    expect(chalkLeeImageExtension("image/svg+xml")).toBe("svg");
    expect(chalkLeeImageExtension("image/png")).toBe("png");
  });
});

describe("pasting a whole paper", () => {
  const regionText = (draft: { node: { content?: Array<{ type?: string; content?: Array<{ content?: Array<{ text?: string }> }> }> } }, type: string) =>
    draft.node.content?.find((region) => region.type === type)?.content?.map((paragraph) => paragraph.content?.map((text) => text.text).join("") ?? "");

  it("recognizes 解答题 that only have a stem when their numbers follow the recognized questions", () => {
    const result = parseQuestionTextBatchDetailed([
      "2026 学年第一学期期中测试",
      "一、选择题",
      "1. 下列数中最大的是（　）",
      "A. 1 B. 2 C. 3 D. 4",
      "2. 计算 2+3 的结果是（　）",
      "A. 4 B. 5 C. 6 D. 7",
      "二、解答题",
      "3. 解方程 2x+1=5。",
      "4. 化简 (a+b)²-(a-b)²。"
    ].join("\n"), deterministicIds());
    expect(result.drafts.map((draft) => draft.node.attrs?.number?.label)).toEqual(["1", "2", "3", "4"]);
    expect(result.drafts.map((draft) => draft.node.attrs?.kind)).toEqual(["single-choice", "single-choice", "free-response", "free-response"]);
    expect(result.unrecognizedSegments.map((segment) => segment.source)).toEqual(["2026 学年第一学期期中测试\n一、选择题", "二、解答题"]);
  });

  it("keeps numbered notes before the questions as text", () => {
    const result = parseQuestionTextBatchDetailed([
      "注意事项：",
      "1. 本试卷共 4 页。",
      "2. 答题前填写姓名。",
      "一、选择题",
      "1. 下列数中最大的是（　）",
      "A. 1 B. 2 C. 3 D. 4"
    ].join("\n"), deterministicIds());
    expect(result.drafts).toHaveLength(1);
    expect(result.unrecognizedSegments.map((segment) => segment.source).join("\n")).toContain("2. 答题前填写姓名。");
  });

  it("gives each question its answer from the answer key at the end", () => {
    const result = parseQuestionTextBatchDetailed([
      "1. 下列数中最大的是（　）",
      "A. 1 B. 2 C. 3 D. 4",
      "2. 下列是偶数的是（　）",
      "A. 1 B. 2 C. 3 D. 4",
      "3. 下列说法正确的有（　）",
      "A. 甲 B. 乙 C. 丙 D. 丁",
      "4. 3 的相反数是______。",
      "5. 解方程 2x+1=5。",
      "参考答案",
      "一、选择题",
      "1-2 DB",
      "3. AC 4. -3 5. x=2",
      "解析：移项得 2x=4，",
      "所以 x=2。"
    ].join("\n"), deterministicIds());
    expect(result.drafts.map((draft) => regionText(draft, "questionAnswer"))).toEqual([["D"], ["B"], ["AC"], ["-3"], ["x=2"]]);
    expect(result.drafts.map((draft) => draft.node.attrs?.kind)).toEqual(["single-choice", "single-choice", "multiple-choice", "fill-blank", "free-response"]);
    expect(regionText(result.drafts[4], "questionAnalysis")).toEqual(["移项得 2x=4，", "所以 x=2。"]);
    expect(result.unrecognizedSegments).toEqual([]);
    expect(questionBatchReplacementContent(result, deterministicIds()).map((node) => node.type)).toEqual(Array(5).fill("question"));
  });

  it.each([
    ["an answer line", ["答案：1. B 2. C"]],
    ["a 题号／答案 table", ["题号\t1\t2", "答案\tB\tC"]]
  ])("reads the answer key from %s", (_format, key) => {
    const result = parseQuestionTextBatchDetailed([
      "1. 下列是偶数的是（　）",
      "A. 1 B. 2 C. 3 D. 4",
      "2. 下列是 3 的倍数的是（　）",
      "A. 1 B. 2 C. 3 D. 4",
      ...key
    ].join("\n"), deterministicIds());
    expect(result.drafts.map((draft) => regionText(draft, "questionAnswer"))).toEqual([["B"], ["C"]]);
    expect(result.unrecognizedSegments).toEqual([]);
  });

  it("keeps the answer key as written when a question already had its own answer", () => {
    const result = parseQuestionTextBatchDetailed([
      "1. 下列是偶数的是（　）",
      "A. 1 B. 2 C. 3 D. 4",
      "2. 下列是 3 的倍数的是（　）",
      "A. 1 B. 2 C. 3 D. 4",
      "答案：C",
      "参考答案",
      "1. B 2. D"
    ].join("\n"), deterministicIds());
    expect(result.drafts.map((draft) => regionText(draft, "questionAnswer"))).toEqual([["B"], ["C"]]);
    expect(result.unrecognizedSegments.map((segment) => segment.source)).toEqual(["参考答案\n1. B 2. D"]);
  });

  it("does not take numbered steps under a question's own answer for the paper's answers", () => {
    const result = parseQuestionTextBatchDetailed([
      "5. 证明三角形全等。",
      "答案：",
      "1. 先找公共边。",
      "6. 计算 2+3。",
      "答案：5"
    ].join("\n"), deterministicIds());
    expect(result.drafts.map((draft) => draft.node.attrs?.number?.label)).toEqual(["5", "6"]);
    expect(regionText(result.drafts[0], "questionAnswer")).toEqual(["1. 先找公共边。"]);
  });
});
