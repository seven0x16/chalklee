import { CHALKLEE_RUNNING_SLOTS, chalkLeePageSize, chalkLeeRunningTextFromEditing, validateChalkLeeBoxStyleCss, validateChalkLeeDesign } from "@chalklee/format";
import type { ChalkLeeBoxStyle, ChalkLeeCover, ChalkLeeCoverStyle, ChalkLeeDocument, ChalkLeeHeaderFooter, ChalkLeeHeadingNumbering, ChalkLeePageAppearance, ChalkLeeQuestionNumbering, ChalkLeePageDecoration, ChalkLeeQuestionStyle, ChalkLeeRunningLine, ChalkLeeRunningLineStyle, ChalkLeeTableOfContents, ChalkLeeTableOfContentsStyle } from "@chalklee/format";
import { CHALKLEE_BOX_PRESETS } from "../document/boxPresets";
import { CHALKLEE_COVER_PRESETS, CHALKLEE_QUESTION_NUMBERING_PRESETS, CHALKLEE_RUNNING_PRESETS, CHALKLEE_TOC_PRESETS, chalkLeeCoverPresetByName, chalkLeeQuestionNumberingPresetByName, chalkLeeRunningPresetByName, chalkLeeTocPresetByName } from "../document/paperPresets";
import { applyChalkLeeLayout, type ChalkLeeLayout } from "../document/layouts";

export type AgentDesignPatch = {
  design?: { css: string; name?: string } | null;
  /** Small changes to the current CSS: each `find` must occur exactly once. */
  cssEdits?: Array<{ find: string; replace: string }>;
  /** Rules added after the current CSS, so they win over earlier ones. */
  appendCss?: string;
  page?: Partial<Pick<ChalkLeePageAppearance, "size" | "orientation" | "widthPt" | "heightPt" | "columnCount" | "columnGapPt" | "printBackground">> & { marginsPt?: Partial<ChalkLeePageAppearance["marginsPt"]> };
  /** Year and grade as in document properties; null returns to what the paper names itself. */
  metadata?: { year?: number | null; grade?: number | null };
  /** Box styles by name; text names a preset; null removes one no box uses. */
  boxStyles?: Record<string, ChalkLeeBoxStyle | string | null>;
  /** Question styles by name, such as a framed 例题; null removes one no question uses. */
  questionStyles?: Record<string, ChalkLeeQuestionStyle | null>;
  /** The style of boxes without their own; null returns to the app's plain frame. */
  boxStyleRef?: string | null;
  /** The whole header and footer; null returns to the plain page-count footer, {} shows none. A line's style may name a preset. */
  headerFooter?: AgentHeaderFooter | null;
  headingNumbering?: ChalkLeeHeadingNumbering | null;
  /** Every question number of the document; text names a preset, null returns to the standard bold "1.". */
  questionNumbering?: ChalkLeeQuestionNumbering | string | null;
  /** The whole cover; {} is the standard one, null removes it. Its style may name a preset. */
  cover?: (Omit<ChalkLeeCover, "style"> & { style?: ChalkLeeCoverStyle | string }) | null;
  /** The whole contents; {} is the standard one, null removes it. Its style may name a preset. */
  tableOfContents?: (Omit<ChalkLeeTableOfContents, "style"> & { style?: ChalkLeeTableOfContentsStyle | string }) | null;
  /** Every drawing on the page itself, replacing the current ones; null or [] removes them. */
  pageDecorations?: ChalkLeePageDecoration[] | null;
  /** Another layout as a whole, applied before the other changes. */
  layout?: ChalkLeeLayout;
};

export const AGENT_DESIGN_GUIDE = {
  workflow: "读取样式和 revision → 修改 CSS：小改动用 cssEdits 替换原 CSS 中的片段或用 appendCss 在末尾追加规则（后写的覆盖前面的），整体重新设计才用 design.css 完整替换（未提供 page 保留纸张参数）→ document_preview 查看真实页面截图（需要选择 CSS 目标时传 html:true 读取实际卷面 HTML）→ 按新 revision 迭代。直接使用这些工具即可，无需本地命令、另建网页、启动浏览器调试或转换会话，不需要刷新已打开的编辑器。",
  selectors: {
    ":root": "映射到当前文档的 article.chalklee-paper（不是页面 html）。设置字体、颜色、行高和 --design-* 自定义变量；覆盖内联值时使用 !important。",
    "h1, h2, h3, h4, h5, h6": "可编辑标题",
    "p[data-node-id]": "可编辑段落；已有段落排版有内联样式，必要时使用 !important",
    '[data-node-id="ID"]': "指定段落、标题、题目、表格等；id 来自文档内容或预览 HTML",
    "[data-chalklee-question]": "题目（含题组中的小题）的外框、底色、内边距、间距",
    "[data-chalklee-question-group]": "题组",
    '[data-question-style="question.example"]': "使用某个题目样式的题（如例题框）",
    '[data-question-kind="single-choice"]': "某种题型的题",
    '[data-chalklee-region="stem"]': "题干",
    '[data-chalklee-region="material"]': "题组共享材料",
    '[data-chalklee-region="answer"], [data-chalklee-region="analysis"]': "答案与解析",
    "[data-chalklee-subquestions]": "题组中的小题列表",
    "[data-chalklee-solution]": "答案与解析放在卷末时的整块",
    "[data-chalklee-options]": "选项区；排成几栏用 question_update 的 optionLayout，不用 CSS",
    "[data-chalklee-option]": "单个选项",
    "[data-chalklee-option-label]": "选项标号（A、B、C…）",
    "[data-chalklee-box]": "盒子（带标题的知识卡片，如学习目标、定义、注意）；边框、底色、圆角和标题用 boxStyles 设置，只属于某个盒子样式的装饰写在该样式的 css 里（见 guide.boxStyle），文档 CSS 只调整盒子里的文字",
    '[data-box-style="box.note"]': "使用某个盒子样式的所有盒子，如给“注意”盒子里的加粗文字换色",
    "[data-chalklee-frame-label]": "盒子和题框的标题（不填色的标题可用 CSS 调整文字）",
    "[data-chalklee-table]": "表格，可设置 td、tr 的边框、底色和内边距（单元格都是 td，没有 th）",
    "[data-chalklee-table] tr[data-repeat-header]": "表格的列标题行（插入时写了 \"header\":true），跨页时续页重复的那一行也会选中",
    "[data-chalklee-image], [data-chalklee-image-caption]": "配图和图注",
    "[data-chalklee-inline-math], [data-chalklee-block-math]": "公式外围样式；保留数学字体",
    "[data-chalklee-answer-lines], [data-chalklee-answer-line]": "作答横线及其中的一行",
    '[data-role="subtitle"]': "标了用途的段落或标题（subtitle 副标题、byline 作者与日期、lead 导语、key 重点句、note 说明、quote 引文）；按用途写的样式随版式带到其他文档",
    "h2::before, h3::before": "标题自动编号（headingNumbering 开启时）；可设颜色、字重和与标题文字的间距"
  },
  /** Class names that are not part of the promise above; CSS written with them may stop matching after an update. */
  internalSelector: "只用上面这些选择器：它们是稳定的约定，应用升级后照常有效。以 .chalklee- 开头的类名是内部结构，升级后可能失效。",
  pageDecorations: "页面装饰画在纸张本身上，不是正文，用 pageDecorations 设置：place 为 left（左页边）、right（右页边）或 content（正文区域，画在文字下方，如水印、正文外框），pages 为 all、first、rest（首页以外）、odd、even（content 只能 all 或 first）。svg 是一张完整的 SVG，铺满所在区域：document_style_read 的 decorationAreas 给出各区域大小（pt），可以给根元素写同样大小的 viewBox，也可以用百分比布局以适应任何页边距；竖排文字用 <svg x=\"50%\" y=\"50%\" overflow=\"visible\"><text transform=\"rotate(-90)\" text-anchor=\"middle\" dominant-baseline=\"central\">…</text></svg>。{title} 会替换为文档标题。字体用本机字体（Songti SC、SimSun、PingFang SC 等）。不能有脚本、网址或外部文件。画在页边的内容（卷头、密封线、装订线、侧栏）放在 left 或 right，同时用 page.marginsPt 把这一侧页边加宽到能放下（约 80–90pt）。",
  boxStyle: `设计盒子样式（老师在盒子属性点“用 ChalkLee AI 设计”，或说“给这个盒子换个样式”）：消息附带的盒子就是要换样式的那个。先 document_style_read 看现有 boxStyles，再用 document_style_update 的 boxStyles 新增一个样式（键名用 box. 开头的英文，如 box.leaf；name 写老师看到的中文名，如“树叶便签”），然后用 content_update 的 {id:盒子id, style:键名} 只给这个盒子换上；老师说“全部盒子”时再设 boxStyleRef 并给其他盒子换上。样式分两部分。字段：border、backgroundColor、borderRadiusPt、paddingPt、spaceBeforePt、spaceAfterPt 和标题 frame（label 写 "" 让盒子保留自己的标题；design、labelPosition、labelStyle、accentColor）。装饰写在 css，每个选择器以 [data-chalklee-box] 开头：[data-chalklee-box] 是盒子本身（背景图案、阴影、文字颜色）；[data-chalklee-box] > [data-chalklee-frame-label] 是标题（位置、字体、边框，::before 放小图标）；[data-chalklee-box] > [data-chalklee-frame-decoration] 是覆盖整个盒子的装饰层，用它的 background 和 ::before、::after 画胶带、角饰、斜纹、对话尾巴等；[data-chalklee-box] p 是盒子里的段落。字段生成的边框、底色、内边距和圆角写在盒子元素上，CSS 要改它们时加 !important。标题默认跨在上边线上，放进框内时设 top、left、transform:none、padding:0、background:transparent。图案和图标用 url("data:image/svg+xml,…")（encodeURIComponent 编码，SVG 属性用单引号）。规则同文档 CSS：不能有网址、动画、转义和 :root。黑白打印要清楚：浅底配深色边线，图案要淡；大面积深色只适合投屏，完成后提醒老师。预设样式可以直接用名称作为样式值，如 boxStyles:{"box.preset-grid":"方格纸"}；可用的预设：${CHALKLEE_BOX_PRESETS.map(preset => `${preset.name}（${preset.group}）`).join("、")}。完成后用 document_preview 看效果，告诉老师样式名，并提示可以在盒子样式中“保存当前”，以后在其他文档里也能用。`,
  questionNumbering: `题号（老师说“题号加粗”“题号改成圆圈”“题号换个颜色”）是整份文档的一项设置，全卷题号一起变，不按单题设置，也不要把题号写进题干。用 document_style_update 的 questionNumbering：style 为大题号写法（dot 1.、comma 1、、paren (1)、circle ①、plain 只写数字），subStyle 为题组中的小题号（paren (1)、dot 1.、circle ①），fontWeight（normal、bold，默认 bold）、color（#RRGGBB）、frame（true 时数字放在细框里，配 style:plain）；也可以直接写预设名：${CHALKLEE_QUESTION_NUMBERING_PRESETS.map(preset => preset.name).join("、")}；null 恢复标准（深蓝加粗的“1.”，小题“(1)”）。手动编号只是一个数字（如 3、(3)、③）时按写法显示，带字母或文字的（如“例1”）按原样显示。底色块、圆角等更多装饰在设计 CSS 中用变量：:root、[data-question-style] 或 [data-chalklee-subquestions] 上设 --design-number-color、--design-number-weight、--design-number-background、--design-number-border、--design-number-radius、--design-number-box（题号框宽度，如 1.7em）、--design-number-align；题号没有可以直接选中的元素。Word 保留写法、字重、颜色和细框。`,
  paperElements: `页眉、页脚的外观（老师在它们的样式面板写一句想要的样子，消息是“给页眉／页脚设计一个新样式：……”，或在对话里说“页眉换成双线”）：只改这一个元素的外观，不改文字和左中右位置，除非老师同时要求。先 document_style_read 看现有 headerFooter，再用 document_style_update 写回完整的 headerFooter，保留原有文字。页眉页脚的样式写在 header.style 或 footer.style：fontSizePt、color、fontWeight（normal、bold）、letterSpacingEm 和 rule（style 为 solid、dashed、dotted、double，widthPt、color，bothSides:true 时文字上下各一条线）；打印时页眉页脚只能印出文字和线条，不能有底色、图片和其他装饰。可以直接用预设名作为 style 的值。页眉页脚预设：${CHALKLEE_RUNNING_PRESETS.map(preset => preset.name).join("、")}。黑白打印要清楚。完成后用 document_preview 看效果，告诉老师改了什么。`,
  cover: `封面用 cover（老师说“加个封面”“做个封面”，或在封面样式面板写一句想要的样子，消息是“给封面设计一个新样式：……”）：{} 是标准样子，null 去掉。封面单独占第一页，不显示页眉页脚，正文页码从 1 起算；不要在正文开头另画封面图形，也不要为它插分页符。文字字段 title（省略时用文档标题，"" 不显示）、subtitle、subject（学科年级）、author（学校或教师）、date，没写的不显示；每次给出完整的 cover，保留原有文字。style：align（center、left）、titleTop（标题在页面高度的位置，0.08–0.8，默认 0.34）、titleSizePt（12–72，默认 30）、titleWeight、titleColor、color（其他文字）、fontFamilies（标题字体）、svg（铺满整张纸、在文字下方的底图，规则同 pageDecorations，用百分比布局以适应各种纸张；document_style_read 的 coverArea 给出整页大小 pt）；也可以写预设名：${CHALKLEE_COVER_PRESETS.map(item => item.name).join("、")}。底图避开标题和底部信息所在的位置，深色底图配浅色文字；完成后用 document_preview 看第一页。`,
  tableOfContents: `目录用 tableOfContents（老师说“加个目录”“生成目录”，或在目录样式面板写一句想要的样子，消息是“给目录设计一个新样式：……”）：{} 是标准样子，null 去掉。目录排在封面之后、正文之前，单独占页，按正文的标题自动生成并带页码，正文变了自动更新，不要手写目录内容，也不要为它插分页符。只单独作为文档标题的那个一级标题不列。levels 为列出的标题级数（1–3，默认 2，从列出的最高一级算起）；title 默认“目录”，"" 不显示。每次给出完整的 tableOfContents。style：leader（dots 点线、line 细线、none 无）、titleAlign（center、left）、firstLevelBold（默认 true）、color（条目和页码）、accentColor（标题和一级条目）、fontFamilies；也可以写预设名：${CHALKLEE_TOC_PRESETS.map(item => item.name).join("、")}。`,
  slides: "课件、一页一题、上课投屏用：原文档不动，先 file_copy 复制一份，再用 file_move 改名为“原名（课件）.chalklee”，之后只改这份副本（两份之间的题目不会同步，完成后告诉老师）。在副本上用 page:{size:\"slide\",orientation:\"landscape\",marginsPt 约 30–40pt} 换成 16:9 课件纸张；给默认题目样式（document_style_read 的 questionStyleRef）设 breakBefore:\"page\"，每道题自动另起一页，调整题序后仍然一题一页；正文字号放大到 20–28pt，标题 32pt 以上，行距宽松，配色对比强，投影上看得清。题目太长时会自然延续到下一页。需要的话用 cover 加封面、tableOfContents 加目录。老师点“放映”即可全屏一屏一页。",
  animation: "动画讲解（如“做个动画讲解”“把解题过程做成动画”）：在该题的解析里用 question_update 写入图形 {type:\"graphic\",svg,printSvg,widthPercent,caption}，保留原有解析文字。SVG 根元素写 viewBox（如 0 0 640 360），按解题步骤分段出现：每一步的元素先 opacity=\"0\"，用 <set attributeName=\"opacity\" to=\"1\" begin=\"Ns\" fill=\"freeze\"/> 或 <animate> 依次显示，每步 1.5–3 秒，几何图形可以用 animateTransform、animateMotion 演示移动和旋转；整段动画结束后停在最后一步（fill=\"freeze\"），需要循环时整组 repeatCount=\"indefinite\"。printSvg 是全部步骤都显示的最后一帧，打印、PDF 和 Word 用它。文字用本机字体（PingFang SC、Songti SC），字号不小于 16（按 viewBox 计）；不能写脚本、事件、网址或外部文件。写完用 document_preview 看一眼，屏幕截图只是动画的某一时刻。",
  background: "底纹（如“加个淡淡的底纹”“方格纸背景”）：用 pageDecorations 的 place:\"content\" 画在正文区域、文字下方，铺满正文区域即可，不铺满整张纸；颜色要很淡（如 #000 的 4%–8% 或浅色主题色），线条细，保证文字清楚；完成后提醒老师彩色或深色底纹复印、黑白打印时可能发灰。",
  supported: "标准 CSS 规则、渐变、字体、边框、圆角、间距、网格、--design-* 变量；@media all/screen/print。样式自动限制在当前卷面。每份文档独立保存，不随应用主题改变。有彩色底纹时设置 page.printBackground:true，使预览和打印保留底纹。标题内已有字号标记时用 h1 span { font-size:inherit !important; } 统一标题字号。题号自动跟随卡片内边距；答案解析的左侧留白不足时标签自动进入文字流，避免叠字。盒子、题框、页眉页脚、标题编号和整体版式分别用 boxStyles／boxStyleRef、questionStyles（再用 question_update 的 styleRef 和 frameLabel 给单题加框）、headerFooter、headingNumbering、layout 参数设置。装饰：::before、::after 可以用 content 写装饰文字和符号，可以 position:relative/absolute 定位、transform 旋转缩放、overflow 裁切，背景和装饰图案用写在 CSS 里的图片 url(\"data:image/svg+xml,…\")（SVG 用 encodeURIComponent 编码，属性用单引号），如分隔花边、角标、条幅、底纹。",
  constraints: ":root 只设置字体、颜色、行高及变量。纸张尺寸、页边距、分栏使用 page（单位 pt），不使用 CSS @page。正文、题目和公式留在正常流中，装饰不遮挡文字：content 和 float 只用于 ::before、::after、::marker，position 只能 static、relative、absolute，z-index 为 -5 到 3，overflow 只能 visible、hidden、clip；不支持动画、过渡、网址或文件引用、下载字体、CSS 嵌套或反斜杠转义（装饰字符直接写）。字体使用本机字体。分页空隙与编辑控件由应用管理。盒子与题框的填色标题、页眉页脚不受 CSS 影响，颜色用 boxStyles 的 accentColor 和 headerFooter 的 color。彩色版式在黑白打印下也要层次清楚。",
  example: ':root { --design-accent: #1565c0; color: #18253b !important; font-family: "Songti SC", serif !important; }\nh1 { color: var(--design-accent); font-size: 24pt !important; border-bottom: 2pt solid var(--design-accent); padding-bottom: 8pt; }\n[data-chalklee-question] { border: 1pt solid #d8e4f5 !important; border-radius: 8pt; padding: 12pt !important; margin-bottom: 14pt !important; background: #f8fbff; }'
};

/** Selectors in the CSS that rely on the application's internal class names, at most five. */
export function agentDesignInternalSelectors(css: string | undefined): string[] {
  const found = new Set<string>();
  for (const match of (css ?? "").matchAll(/\.chalklee-[a-z0-9-]+/g)) {
    found.add(match[0]);
    if (found.size >= 5) break;
  }
  return [...found];
}

export function patchAgentDesign(document: ChalkLeeDocument, patch: AgentDesignPatch): ChalkLeeDocument {
  const partial = Boolean(patch.cssEdits?.length || patch.appendCss?.trim());
  const layoutChange = patch.boxStyles !== undefined || patch.questionStyles !== undefined || patch.boxStyleRef !== undefined || patch.headerFooter !== undefined || patch.headingNumbering !== undefined || patch.questionNumbering !== undefined || patch.layout !== undefined || patch.pageDecorations !== undefined || patch.cover !== undefined || patch.tableOfContents !== undefined;
  if (patch.design === undefined && !partial && !patch.page && !patch.metadata && !layoutChange) throw new Error("请提供 design、cssEdits、appendCss、page、metadata、boxStyles、headerFooter、headingNumbering、questionNumbering、cover、tableOfContents、pageDecorations 或 layout 修改。");
  if (patch.design !== undefined && partial) throw new Error("design 会完整替换 CSS，不能与 cssEdits 或 appendCss 同时使用。");
  const next = patch.layout ? applyChalkLeeLayout(document, patch.layout) : structuredClone(document);
  patchAgentLayout(next, patch);
  if (patch.design !== undefined) {
    if (patch.design === null) delete next.appearance.design;
    else { validateChalkLeeDesign(patch.design.css); next.appearance.design = structuredClone(patch.design); }
  }
  if (partial) {
    let css = next.appearance.design?.css ?? "";
    for (const edit of patch.cssEdits ?? []) {
      const count = edit.find ? css.split(edit.find).length - 1 : 0;
      if (count !== 1) throw new Error(count ? `“${edit.find.slice(0, 60)}”在 CSS 中出现了 ${count} 次，请包含更多上下文使其唯一。` : `当前 CSS 中找不到“${edit.find.slice(0, 60)}”，请重新读取样式。`);
      css = css.replace(edit.find, () => edit.replace);
    }
    if (patch.appendCss?.trim()) {
      // Appending rules the sheet already has changes nothing on the page; say so instead of growing the sheet.
      const flat = (value: string) => value.replace(/\s+/g, " ").trim();
      if (flat(css).includes(flat(patch.appendCss))) throw new Error("这段 CSS 已经在文档中，再追加一次不会改变页面。页面没有变化时多半是选择器没有选中目标：看 document_preview 返回的 unmatchedCss，或用 html:true 核对实际卷面结构后换一种写法。");
      css = `${css.trimEnd()}${css.trim() ? "\n" : ""}${patch.appendCss.trim()}\n`;
    }
    validateChalkLeeDesign(css);
    next.appearance.design = { ...next.appearance.design, css };
  }
  if (patch.page) {
    const page = { ...next.appearance.page, ...patch.page, marginsPt: { ...next.appearance.page.marginsPt, ...patch.page.marginsPt } };
    const { width, height } = chalkLeePageSize(page);
    const m = page.marginsPt, count = page.columnCount ?? 1, gap = page.columnGapPt ?? 24;
    if (![width, height].every(v => Number.isFinite(v) && v >= 144 && v <= 14400)
      || !Object.values(m).every(v => Number.isFinite(v) && v >= 0 && v <= 360)
      || m.top + m.bottom > height - 36 || m.left + m.right > width - 36
      || !Number.isInteger(count) || count < 1 || count > 12 || !Number.isFinite(gap) || gap < 0
      || (width - m.left - m.right - (count - 1) * gap) / count < 72) throw new Error("纸张设置无效：请保留足够正文空间，每栏至少 72pt，页边距不超过 360pt。");
    next.appearance.page = page;
  }
  if (patch.metadata) {
    const { year, grade } = patch.metadata;
    if (year != null && !(Number.isInteger(year) && year >= 1990 && year <= 2100)) throw new Error("年份无效：请填写 1990–2100 之间的年份。");
    if (grade != null && !(Number.isInteger(grade) && grade >= 1 && grade <= 12)) throw new Error("年级无效：请用 1–12 表示一年级到高三。");
    for (const key of ["year", "grade"] as const) {
      if (patch.metadata[key] === null) delete next.metadata[key];
      else if (patch.metadata[key] !== undefined) next.metadata[key] = patch.metadata[key]!;
    }
  }
  return next;
}

type AgentHeaderFooter = Omit<ChalkLeeHeaderFooter, "header" | "footer"> & {
  header?: Omit<ChalkLeeRunningLine, "style"> & { style?: ChalkLeeRunningLineStyle | string };
  footer?: Omit<ChalkLeeRunningLine, "style"> & { style?: ChalkLeeRunningLineStyle | string };
};

function agentRunningPreset(place: "header" | "footer", name: string): ChalkLeeRunningLineStyle {
  const preset = chalkLeeRunningPresetByName(name) ?? CHALKLEE_RUNNING_PRESETS.find(item => item.id === name.trim());
  if (!preset) throw new Error(`${place === "header" ? "页眉" : "页脚"}样式：“${name.slice(0, 20)}”不是预设名（${CHALKLEE_RUNNING_PRESETS.map(item => item.name).join("、")}）。`);
  return structuredClone(preset.style);
}

function agentCoverPreset(name: string): ChalkLeeCoverStyle {
  const preset = chalkLeeCoverPresetByName(name) ?? CHALKLEE_COVER_PRESETS.find(item => item.id === name.trim());
  if (!preset) throw new Error(`封面样式：“${name.slice(0, 20)}”不是预设名（${CHALKLEE_COVER_PRESETS.map(item => item.name).join("、")}）。`);
  return structuredClone(preset.style);
}

function agentTocPreset(name: string): ChalkLeeTableOfContentsStyle {
  const preset = chalkLeeTocPresetByName(name) ?? CHALKLEE_TOC_PRESETS.find(item => item.id === name.trim());
  if (!preset) throw new Error(`目录样式：“${name.slice(0, 20)}”不是预设名（${CHALKLEE_TOC_PRESETS.map(item => item.name).join("、")}）。`);
  return structuredClone(preset.style);
}

function agentQuestionNumberingPreset(name: string): ChalkLeeQuestionNumbering {
  const preset = chalkLeeQuestionNumberingPresetByName(name) ?? CHALKLEE_QUESTION_NUMBERING_PRESETS.find(item => item.id === name.trim());
  if (!preset) throw new Error(`题号样式：“${name.slice(0, 20)}”不是预设名（${CHALKLEE_QUESTION_NUMBERING_PRESETS.map(item => item.name).join("、")}）。`);
  return structuredClone(preset.numbering);
}

/** A box style as written by the model: the style itself, or a preset by name. */
function agentBoxStyle(name: string, value: ChalkLeeBoxStyle | string): ChalkLeeBoxStyle {
  let style: ChalkLeeBoxStyle;
  if (typeof value === "string") {
    const wanted = value.trim();
    const preset = CHALKLEE_BOX_PRESETS.find(item => item.name === wanted || item.id === wanted);
    if (!preset) throw new Error(`盒子样式 ${name}：“${wanted.slice(0, 20)}”不是预设样式名（${CHALKLEE_BOX_PRESETS.map(item => item.name).join("、")}）。`);
    style = structuredClone(preset.style);
  } else style = structuredClone(value);
  if (style.css) {
    try { validateChalkLeeBoxStyleCss(style.css); }
    catch (error) { throw new Error(`盒子样式 ${name} 的 css：${error instanceof Error ? error.message : String(error)}`); }
  }
  return style;
}

/** Box styles, header and footer, heading numbers, cover and contents; the whole document is checked afterwards. */
function patchAgentLayout(next: ChalkLeeDocument, patch: AgentDesignPatch) {
  const appearance = next.appearance;
  if (patch.boxStyles) {
    const styles = { ...appearance.boxStyles };
    const used = new Set<string>();
    for (const node of next.content.content) if (node.type === "box" && node.attrs.styleRef) used.add(node.attrs.styleRef);
    // The default stays in use unless this same change replaces it.
    const defaultRef = patch.boxStyleRef === undefined ? appearance.defaults.boxStyleRef : patch.boxStyleRef ?? undefined;
    if (defaultRef) used.add(defaultRef);
    for (const [name, style] of Object.entries(patch.boxStyles)) {
      if (!/^[A-Za-z0-9._-]{1,80}$/.test(name)) throw new Error(`盒子样式名“${name}”只能使用字母、数字、点、短横和下划线。`);
      if (style === null) {
        if (used.has(name)) throw new Error(`盒子样式 ${name} 仍在使用，请先给这些盒子换样式。`);
        delete styles[name];
      } else styles[name] = agentBoxStyle(name, style);
    }
    if (Object.keys(styles).length) appearance.boxStyles = styles;
    else delete appearance.boxStyles;
  }
  if (patch.questionStyles) {
    const styles = { ...appearance.questionStyles };
    const used = new Set<string>([appearance.defaults.questionStyleRef]);
    const visit = (node: any) => { if ((node.type === "question" || node.type === "questionGroup") && node.attrs?.styleRef) used.add(node.attrs.styleRef); node.content?.forEach(visit); };
    next.content.content.forEach(visit);
    for (const [name, style] of Object.entries(patch.questionStyles)) {
      if (!/^[A-Za-z0-9._-]{1,80}$/.test(name)) throw new Error(`题目样式名“${name}”只能使用字母、数字、点、短横和下划线。`);
      if (style === null) {
        if (used.has(name)) throw new Error(`题目样式 ${name} 仍在使用，请先用 question_update 给这些题换样式。`);
        delete styles[name];
      } else styles[name] = structuredClone(style);
    }
    appearance.questionStyles = styles;
  }
  if (patch.boxStyleRef === null) delete appearance.defaults.boxStyleRef;
  else if (patch.boxStyleRef !== undefined) {
    if (!appearance.boxStyles?.[patch.boxStyleRef]) throw new Error(`没有名为 ${patch.boxStyleRef} 的盒子样式，请先在 boxStyles 中定义。`);
    appearance.defaults.boxStyleRef = patch.boxStyleRef;
  }
  if (patch.headerFooter === null) delete appearance.headerFooter;
  else if (patch.headerFooter !== undefined) {
    const { header, footer, ...shared } = structuredClone(patch.headerFooter);
    const headerFooter: ChalkLeeHeaderFooter = shared;
    for (const [place, written] of [["header", header], ["footer", footer]] as const) {
      if (!written) continue;
      const { style, ...line } = written;
      // Teachers and the model may write the fields by their Chinese names.
      for (const slot of CHALKLEE_RUNNING_SLOTS) if (typeof line[slot] === "string") line[slot] = chalkLeeRunningTextFromEditing(line[slot]!);
      headerFooter[place] = style === undefined ? line : { ...line, style: typeof style === "string" ? agentRunningPreset(place, style) : style };
    }
    appearance.headerFooter = headerFooter;
  }
  if (patch.cover === null) delete appearance.cover;
  else if (patch.cover !== undefined) {
    const { style, ...cover } = structuredClone(patch.cover);
    const resolved = typeof style === "string" ? agentCoverPreset(style) : style;
    appearance.cover = resolved && Object.keys(resolved).length ? { ...cover, style: resolved } : cover;
  }
  if (patch.tableOfContents === null) delete appearance.tableOfContents;
  else if (patch.tableOfContents !== undefined) {
    const { style, ...toc } = structuredClone(patch.tableOfContents);
    const resolved = typeof style === "string" ? agentTocPreset(style) : style;
    appearance.tableOfContents = resolved && Object.keys(resolved).length ? { ...toc, style: resolved } : toc;
  }
  if (patch.pageDecorations === null || patch.pageDecorations?.length === 0) delete appearance.pageDecorations;
  else if (patch.pageDecorations) appearance.pageDecorations = structuredClone(patch.pageDecorations);
  if (patch.headingNumbering === null) delete appearance.headingNumbering;
  else if (patch.headingNumbering !== undefined) appearance.headingNumbering = { ...patch.headingNumbering };
  if (patch.questionNumbering === null) delete appearance.questionNumbering;
  else if (patch.questionNumbering !== undefined) {
    const numbering = typeof patch.questionNumbering === "string" ? agentQuestionNumberingPreset(patch.questionNumbering) : { ...patch.questionNumbering };
    if (Object.keys(numbering).length) appearance.questionNumbering = numbering;
    else delete appearance.questionNumbering;
  }
}
