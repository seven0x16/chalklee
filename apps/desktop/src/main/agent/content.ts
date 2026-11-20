import { regenerateImportIds } from "../../shared/conversion/importDocument";
import type { ChalkLeeBlockNode } from "@chalklee/format";
import { expandPdfImportBlocks } from "../conversion/pdfReply";
import { AGENT_OPTION_LAYOUTS, agentGraphicNode } from "../../shared/agent/editing";

/** Concise block format shared with conversion fragments, documented for the model. */
export const AGENT_CONTENT_FORMAT = '每个块是对象：段落 {"type":"paragraph","text":"文字 $x^2$"}；标题 {"type":"heading","level":1,"text":"一、选择题"}；段落和标题可加 "role" 标明用途（小写英文，如 subtitle 副标题、byline 作者与日期、lead 导语、key 重点句、note 说明、quote 引文），CSS 用 [data-role="subtitle"] 按用途设计样式；表格 {"type":"table","rows":[["甲","乙"],["1","2"]],"widths":[1,3],"header":true}，widths 可省略，省略时按内容自动分配列宽，给出时依次是各列的相对宽度，留空书写的列要给足；第一行是列标题时写 "header":true，表格跨页时续页重复这一行；独立公式在段落中写单行 $$...$$。题目 {"type":"question","kind":"choice|blank|solution","stem":["题干"],"options":[{"label":"A","content":["选项"]}],"optionLayout":"auto|inline|one-column|two-column|four-column","answer":["B"],"analysis":["解析"],"score":5,"difficulty":"easy|medium|hard","tags":["知识点"]}，number 省略时自动编号，"" 表示不编号，"3" 表示固定题号。题组 {"type":"questionGroup","kind":"reading","material":["材料"],"questions":[小题…]}；阅读、完形等题组的小题要接着全卷编号时（文章本身不编号，小题如 33–36），题组写 "number":"continue"，不要给题组设 ""，也不要手写小题题号。盒子（讲义中带标题和边框的知识卡片，如学习目标、定义、注意、方法总结）{"type":"box","label":"定义","style":"box.definition","body":["段落",{"type":"table","rows":[…]}]}，body 写法同 stem，只放段落、公式、表格、图片和图形，不放标题；要框住几道题（随堂练习、变式训练），先插入题目，再用 content_update 的 wrap 把它们放进盒子，或用 position:{after:盒子里某一行的 id} 把题目插进盒子；style 是 document_style_read 返回的盒子样式名，省略时用文档默认盒子样式，label 省略时用样式自带的标题。stem/options.content/answer/analysis/material 为数组，字符串按换行分段，$...$ 为可编辑公式，<b>粗体</b>、<i>斜体</i>、<u>下划线</u>（不能写其他 HTML 标签），连续下划线 ____ 为填空。图片 {"type":"image","attachment":1,"crop":[x,y,宽,高],"alt":"题图"} 取对话中附带的第 1 张图片，{"type":"image","path":"期中.pdf","page":2,"crop":[…]} 取工作区 PDF 原稿第 2 页，或 {"type":"image","path":"素材/图1.png"} 取 PNG／JPG 图片文件（工作区中的；外部 AI 应用也可用本机绝对路径）；crop 按原图 0–1000 计算，只圈插图本身并留少量白边，省略则用整张；可单独成块，也可放进 stem、options.content、answer、analysis、material 数组。分页符 {"type":"pageBreak"}：其后的内容从新的一页开始，打印时不显示。分割线 {"type":"divider"}：横贯正文的一条细线，用来分隔正文中的不同部分，只放在正文中。作答横线 {"type":"answerLines","count":8}：解答题、书面表达等留给学生书写的横线，count 为行数（1–40），放在题目 stem 数组的末尾。图形 {"type":"graphic","svg":"<svg viewBox=…>…</svg>","printSvg":"…","widthPercent":60,"caption":"图注"}：封面、标题横幅、知识结构图、示意图和分步动画讲解，用一张完整的 SVG 画出，根元素要有 viewBox，按 widthPercent（正文宽度的 10–100%，默认 100）缩放；可以用 SVG 自带的动画（animate、animateTransform、animateMotion、set 或 SVG 内的 CSS 动画），屏幕上播放，打印、PDF 和 Word 用 printSvg（如动画的最后一帧），没有时用动画开始前的样子；不能有脚本、事件、foreignObject、网址或文件引用，图片写成 data:image/…；可单独成块，也可放进 stem、answer、analysis、material、body 数组。';

/** A graphic written concisely, anywhere in the blocks, becomes its node. */
function agentGraphics(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(agentGraphics);
  if (!value || typeof value !== "object") return value;
  const item = value as Record<string, any>;
  return item.type === "graphic" ? agentGraphicNode(item) : Object.fromEntries(Object.entries(item).map(([key, child]) => [key, agentGraphics(child)]));
}

/** Expand the concise format into validated-shape ChalkLee nodes with fresh ids. */
export function agentContentBlocks(blocks: unknown[]): ChalkLeeBlockNode[] {
  if (!Array.isArray(blocks) || !blocks.length || blocks.length > 200) throw new Error("每次插入 1–200 个内容块。");
  const prepared = blocks.map(block => {
    if (!block || typeof block !== "object" || Array.isArray(block)) throw new Error("内容块必须是对象。");
    const value = agentGraphics(block) as Record<string, any>;
    // A picture arrives here already resolved from its source into the paper's own image node.
    const picture = value.type === "image" && typeof value.attrs?.assetId === "string";
    if (value.type === "image" && !picture) throw new Error("图片需要来源：attachment 为对话中的图片编号，path 与 page 为工作区 PDF 原稿的页码，或 path 为 PNG／JPG 图片文件；可加 crop 裁取。");
    if (!picture && value.type !== "graphic" && (value.attrs || value.ref)) throw new Error("请使用简洁格式（type、text、stem、options 等字段），不要传入 attrs 或 ref。");
    if (!["paragraph", "heading", "table", "question", "questionGroup", "image", "graphic", "box", "pageBreak", "divider"].includes(value.type)) throw new Error(`不支持的内容类型：${String(value.type)}。可用 paragraph、heading、table、image、graphic、box、question、questionGroup、pageBreak、divider。`);
    const layouts = [value, ...(Array.isArray(value.questions) ? value.questions : [])].map((item: any) => item?.optionLayout).filter(layout => layout !== undefined);
    if (layouts.some(layout => !(AGENT_OPTION_LAYOUTS as readonly unknown[]).includes(layout))) throw new Error("optionLayout 只能是 auto、inline、one-column、two-column 或 four-column。");
    // Sub-questions are always questions; models often omit their type.
    return value.type === "questionGroup" && Array.isArray(value.questions) ? { ...value, questions: value.questions.map((child: any) => ({ type: "question", ...child })) } : value;
  });
  // Page breaks and dividers carry nothing to expand; the rest keep one node per block.
  const bare = (block: Record<string, any>) => block.type === "pageBreak" || block.type === "divider";
  // Underscores are blanks, as the format promises and as typing makes them.
  const flowing = expandPdfImportBlocks(prepared.filter(block => !bare(block)), [], { unlabeledBlanks: true }) as any[];
  const expanded = prepared.map(block => bare(block) ? { type: block.type, attrs: {} } : flowing.shift());
  const finish = (node: any, source: Record<string, any>) => {
    if (node.type !== "question" && node.type !== "questionGroup") return;
    if (source.number === undefined || source.number === null) node.attrs.number = { mode: "auto" };
    // A reading passage whose questions run on from the paper's numbers.
    if (node.type === "questionGroup" && source.number === "continue") node.attrs.number = { mode: "continue" };
    if (["easy", "medium", "hard"].includes(source.difficulty)) node.attrs.difficulty = source.difficulty;
    if (Array.isArray(source.tags)) node.attrs.tags = source.tags.filter((tag: unknown) => typeof tag === "string" && tag.trim()).map((tag: string) => tag.trim().slice(0, 200)).slice(0, 100);
    const body = node.type === "question" ? "questionStem" : "questionMaterial";
    if (!node.content.some((region: any) => region.type === body)) node.content.unshift({ type: body, content: [{ type: "paragraph", content: [] }] });
    if (node.type === "questionGroup") {
      const list = node.content.find((region: any) => region.type === "subQuestionList");
      if (!list?.content.length) throw new Error("题组需要至少一道小题（questions）。");
      list.content.forEach((child: any, index: number) => finish(child, source.questions?.[index] ?? {}));
    }
  };
  expanded.forEach((node, index) => finish(node, prepared[index]));
  return regenerateImportIds(expanded) as ChalkLeeBlockNode[];
}
