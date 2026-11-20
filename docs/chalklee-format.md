# ChalkLee 文档格式

`.chalklee` 是 ChalkLee 可编辑文档的原生格式：一个 ZIP 容器，容器格式版本为 `0.1`，其中的文档结构版本为 `chalklee/0.3`。两个版本相互独立。

字段的规范定义见[文档 Schema](../packages/format/schema/document.schema.json)和[清单 Schema](../packages/format/schema/manifest.schema.json)，本文说明它们的结构和规则。

## 文件结构

```text
example.chalklee
├─ mimetype
├─ manifest.json
├─ document.json
└─ assets/
   └─ ...
```

- `mimetype` 的内容固定为 `application/vnd.chalklee+zip`，不压缩存储。
- `manifest.json` 标识文档，并列出打包的资源及其相对路径、字节长度和 SHA-256 摘要。
- `document.json` 保存可编辑的内容树、文档样式和可选的来源记录。
- 文档带有资源时才有 `assets/`。资源路径必须位于 `assets/` 之下，不能包含 `..` 段或反斜杠。
- 图片通过 `assetId` 引用打包的资源；内容节点中不保存文件系统的绝对路径或 Base64 data URL。

读取时检查声明的版本、文档标识、资源路径、长度和摘要，版本不受支持或归档损坏时报错。语义校验还检查节点 ID 是否唯一，以及对资源、样式和来源锚点的引用是否有效。实现见[归档读写](../packages/format/src/archive.ts)和[语义校验](../packages/format/src/validate.ts)。

## 内容与标识

普通的文档块和题目等语义容器共用同一棵内容树。文字、公式、表格和图片都是可编辑内容，渲染出的 HTML 不作为保存的依据。脚本等可执行内容不是合法节点。

块和语义区域都有在文档内唯一的稳定 ID。移动题目时保留 ID；复制题目时为它及其子节点生成新 ID，重新映射内部引用，并可以复用文档内不可变的资源。

题号与题干文字分开保存，支持 `auto`、`fixed` 和 `none`。无论是否显示题号，每道题都占一个序号；题组的小题从 1 起编号。题组也可以用 `continue`：题组本身不显示、也不占题号，它的小题沿用全卷的题号，写法与全卷题目相同，例如阅读材料的小题接着前面的题目编号。普通题目把 `continue` 当作 `auto`。

光标位置、选区、菜单、侧栏、缩放、滚动和临时识别状态都不是文档内容。隐藏答案或解析不会删除它们的内容。原稿仍是工作区中的独立文件，来源记录不嵌入完整原稿，也不与原稿实时同步。

## 文档结构

题目可以没有选项、答案和解析。主要的结构规则：

- 题目一定有富文本题干；选项、答案和解析可选，各至多一个，并按此顺序排列。
- 题组一定有材料和小题列表，可以有一组共用的选项，以及题组级的答案和解析。
- 拆分出的小题可以通过 `attrs.sourceBlankId` 引用材料中的行内空。
- 空可以带显示用的 `attrs.label`，与它的稳定 ID 和答案无关。
- 标题的间距和行高是明确保存的文档属性。
- 有序列表段落可以用正整数 `attrs.listStart` 开始或重新开始编号，例如从 21 开始。后面相邻的列表项省略它，接着编号；遇到非列表段落时这一段编号结束。列表编号与题号无关，只在所在的语义区域内计数。
- 表格可以为每个逻辑列保存一个以磅为单位的宽度，在屏幕、打印、PDF 和 Word 中各列按这些宽度的比例分配表格宽度；省略时按内容决定列宽。
- 盒子（`box`）可以包含段落、独立公式、表格、图片、图形、答题线、题目和题组。盒子只出现在顶层，因此不能嵌套，题目里也不能放盒子。盒子里的题目与全文一起编号，其他方面与普通题目相同，详见[盒子](#盒子)。
- 分隔线（`type: "divider"`，只有 `attrs.id`）是横跨正文宽度的细线，用来分隔正文的各个部分。它只出现在顶层，在屏幕、打印、PDF 和 Word 中显示相同。
- 图形（`type: "graphic"`）是用 SVG 画的图，如封面、横幅、知识结构图或动画讲解。它可以放在正文和盒子中，也可以放在题目的题干、材料、选项、答案或解析中。`attrs.svg` 是一个完整的 `<svg>`，根元素必须有 `viewBox`；图形宽度为正文宽度的 `widthPercent`（10–100，默认 100），并保持 viewBox 的比例。`printSvg` 是打印、PDF 和 Word 显示的版本，例如动画的最后一帧；没有它时显示去掉动画后的初始画面。`textAlign`、`alt` 和 `caption` 可选。图形只作为图片显示：SVG 自带的 SMIL 和 CSS 动画在屏幕上播放；脚本、事件属性、`foreignObject`、嵌入页面、`@import` 以及对图形之外任何内容的引用（`data:image/…` 图片和 `#id` 片段除外）都会被拒绝。`svg` 和 `printSvg` 合计最多 200,000 个字符。Word 中以图片形式插入打印版本。

语义校验会拒绝重复的 ID、缺失的资源或样式、重复的选项标号、错误的区域顺序，以及 `sourceBlankId` 指向的节点不是空的情况。

## 题目结构

```text
question                        题目
├─ questionStem                 题干，必有
├─ optionGroup                  选项，可选
├─ questionAnswer               答案，可选
└─ questionAnalysis             解析，可选

questionGroup                   题组
├─ questionMaterial             材料，必有
├─ optionGroup                  题组共用的选项，可选
├─ subQuestionList              小题列表，必有
├─ questionAnswer               答案，可选
└─ questionAnalysis             解析，可选
```

每个可选区域至多出现一次，语义校验检查它们的顺序。

## 图片

块级图片为 `image`，段落内的图片为 `imageInline`，两者共用以下属性：

| 属性 | 含义 |
| --- | --- |
| `assetId` | 必填，引用清单中的资源 |
| `widthPt`、`heightPt` | 显示尺寸，单位为磅 |
| `alt`、`caption` | 替代文字和图注 |
| `textAlign` | `left`、`center` 或 `right` |
| `spaceBeforePt`、`spaceAfterPt` | 前后间距，单位为磅 |
| `layout` | 块级图片的排列方式：`block`、`wrap-left` 或 `wrap-right`，省略时为 `block` |
| `imagePairId` | 成对显示的共用标识，两张图片仍各自属于自己的题目 |

成对显示不会在内容树中添加重复资源、渲染坐标或临时排版节点。图片始终按 ID 引用打包的资源。

## 表格

`table.attrs.columnWidthsPt` 为每个逻辑列保存一个正数宽度，合并单元格按它覆盖的列计算；省略时按内容决定列宽。行的 `attrs.heightPt` 是目标最小高度，内容需要更多空间时不会被截掉。

开头连续的若干行可以设 `attrs.repeatAsHeader: true`。重复的表头只出现在分页后的显示中，不保存在文档树里。表头的跨行合并必须在这组行之内，编辑行时保持这组行连续。

## 来源记录

### 从题库插入的题目

从工作区搜题插入的题目是独立的副本：每个块都获得新 ID，题组内部的 `sourceBlankId` 重新映射，顶层题号改为 `auto`，目标文档中没有的样式引用被去掉，引用的图片复制进目标归档并按 SHA-256 去重。

每份副本都记录来源。`chalklee` 类型的来源标识来源文档，锚点的定位器标识来源题目：

```json
{
  "sources": [{ "id": "source_1", "type": "chalklee", "fileName": "甲卷.chalklee", "relativePath": "初三/甲卷.chalklee" }],
  "anchors": [{ "nodeId": "node_new", "sourceId": "source_1", "locator": { "kind": "chalklee", "nodeId": "question_12" } }]
}
```

`relativePath` 是相对于工作区根目录的路径。来源还可以带 `sha256`、可选的 `label` 和 `coverage: "whole" | "partial"`。

### 转换的原稿

PDF、DOC 和 DOCX 原稿的来源类型及定位器类型分别为 `pdf`、`doc` 和 `docx`；Markdown（`.md`、`.markdown`）为 `markdown`，记录按 UTF-8 字节计算的 SHA-256；LaTeX（`.tex`）为 `latex`，SHA-256 只按主文件的字节计算，不含它引用的子文件和图片。这几类来源省略 `coverage` 时视为 `whole`；部分引用和未完成的转换不代表完整转换。`label` 和 `coverage` 需要当前的文档结构版本。

### 锚点的保留

保存时去掉所属节点已删除或已撤销的锚点，以及不再锚定任何内容的 `chalklee` 来源。转换产生的来源描述整份文档的出处，因此保留。副本不与来源同步，锚点只用于追溯和定位。

## 标准样式

`appearance` 只保存文档改过的部分。`appearance.page`、`appearance.body`、`appearance.defaults` 中的每一项，以及 `questionStyles`、`optionStyles`、`answerStyles`、`analysisStyles` 中的每个命名样式，要么省略，要么整项属于文档自己：页边距、字体列表和一个命名样式各算一项。

省略的项取应用的标准样式，即 [appearance.ts](../packages/format/src/appearance.ts) 中的 `CHALKLEE_STANDARD_APPEARANCE`。因此标准样式改变时，从未改过这些项的文档随之变化；完全使用标准样式的文档保存为 `"appearance": {}`。读取时用 `chalkLeeResolvedAppearance` 得到完整样式，写入时用 `chalkLeeAppearanceChanges` 只保留差异。

`chalklee/0.2` 的文件保存了所有项，仍然可以读取。其中与 0.2 时新文档默认值相同的项视为从未改过，下次保存时去掉，并写为 `chalklee/0.3`。因此标准样式改变时，这类文档的版面可能略有变化，例如分页位置移动一行。

## 课件

`appearance.page.size` 可以为 `slide`，即用于投屏教学的 16:9 纸张：竖向为 540 × 960 pt，按幻灯片的用法设 `orientation: "landscape"` 时为 960 × 540 pt。

题目样式设 `breakBefore: "page"` 时，使用该样式的每道题在屏幕、打印、PDF 和 Word 中都另起一页；超过一页的题接到下一页，小题与所在题组保持在一起。给默认题目样式设 `breakBefore: "page"`，每页放一道题，增删题目或调整顺序后依然如此。

## 分栏

`appearance.page.columnCount` 可选，为 1–12 的整数，默认 1；`appearance.page.columnGapPt` 可选，为非负磅值，默认 24 pt。没有这两个字段的文件保持单栏。

分栏作用于整份文档：内容自上而下填满一栏，再从左到右换栏，然后进入下一张纸；最后一张纸不做平衡。手动插入的 `pageBreak` 从下一张纸的第一栏开始。长段落、题目和表格可以跨栏。栏间距和分页占位只是显示效果，不插入内容，也不改变保存的题目样式。

## 文档 CSS

文档可以带可选的 `appearance.design: { name?: string, css: string }`。CSS 保存在归档的 `document.json` 中，只有这一份，最多 100,000 个字符。没有这个字段的文档保持原来的样子。可编辑的内容仍是文档树和资源，HTML 由编辑器生成，不作为替代的内容树保存。

渲染时解析 CSS，并把选择器的作用范围限制在本编辑器的内容之内。`:root` 指这份文档的纸张，可以设置字体排印和 `--design-*` 变量。应用界面、其他文档、编辑控件、已填充的题框标题和分页占位都不受影响。打印副本保留同一份限定范围的样式，并优先于打印的默认样式。纸张尺寸通过 `appearance.page` 设置，不通过 CSS。

装饰可以使用：`::before`、`::after` 和 `::marker` 上的生成文字与浮动，`position: relative | absolute`，-5 到 3 的 `z-index`，变换，`overflow: hidden | clip`，以及以 `data:image/…` URL 写进 CSS 的图片（SVG、PNG、JPEG、GIF 或 WebP）。网络和文件引用、字体下载、fixed 或 sticky 定位、动画、过渡、转义和嵌套都会被拒绝。

段落和标题可以带 `attrs.role`，用一个简短的小写名称说明用途，如 `subtitle`、`byline`、`lead` 或 `key`。它显示为 `data-role`，文档 CSS 可以据此按用途设计样式，同一段 CSS 套用到其他文档时依然有效。

### 稳定标记

文档 CSS 只应通过以下标记选择内容。它们在编辑器的纸张和打印副本上都存在，以后的版本只增不减；以 `.chalklee-` 开头的类名属于内部实现，可能随时变化。

| 标记 | 元素 |
| --- | --- |
| `h1`–`h6`、`p` | 标题和段落 |
| `[data-node-id="…"]` | 按稳定 ID 选择任意块或区域 |
| `[data-role="…"]` | 按用途选择段落和标题 |
| `[data-chalklee-question]`、`[data-chalklee-question-group]` | 题目（包括小题）和题组 |
| `[data-question-style="…"]`、`[data-question-kind="…"]` | 按样式名和题型选择题目 |
| `[data-chalklee-region="stem" \| "material" \| "answer" \| "analysis"]` | 题目的各个区域 |
| `[data-chalklee-subquestions]`、`[data-chalklee-solution]` | 题组的小题列表；汇总在文末的答案和解析 |
| `[data-chalklee-options]`、`[data-chalklee-option]`、`[data-chalklee-option-label]` | 选项组、单个选项、选项标号 |
| `[data-chalklee-box]`、`[data-box-style="…"]` | 盒子，以及按样式名选择盒子 |
| `[data-chalklee-frame-label]` | 盒子或题框的标题 |
| `[data-chalklee-frame-decoration]` | 盒子的装饰层，覆盖整个盒子 |
| `[data-chalklee-table]`、`[data-chalklee-image]`、`[data-chalklee-image-caption]` | 表格、图片和图注 |
| `[data-chalklee-inline-math]`、`[data-chalklee-block-math]` | 行内公式和独立公式 |
| `[data-chalklee-answer-lines]`、`[data-chalklee-answer-line]` | 答题线和其中的一条线 |

[外部 AI 应用连接](external-agent-mcp.md)提供读取、修改和预览这些样式数据的工具。

## 题目样式

`appearance.questionStyles` 用于讲义中按需添加的题目装饰。`question` 和 `questionGroup` 通过 `attrs.styleRef` 选择样式；装饰不会插入可编辑的题干、选项、答案或解析中。

`question.attrs.frameLabel` 和 `questionGroup.attrs.frameLabel` 只为这一道题覆盖题框标题，最多 120 个字符。省略时沿用样式的标题，空字符串隐藏标题但保留边框。修改单道题的标题不会改动共用的样式。

```json
{
  "backgroundColor": "#f0f8f5",
  "border": { "style": "solid", "widthPt": 0.8, "color": "#66a99a" },
  "borderRadiusPt": 3,
  "paddingPt": { "top": 12, "right": 16, "bottom": 14, "left": 16 },
  "spaceBeforePt": 15,
  "spaceAfterPt": 22,
  "gapPt": 9,
  "breakInside": "avoid",
  "frame": {
    "label": "随堂练习",
    "labelPosition": "top-left",
    "labelStyle": "filled",
    "accentColor": "#2d7b6b"
  }
}
```

`frame` 可选。`labelPosition` 默认为 `top-left`，也支持 `top-center` 和 `left`；`labelStyle` 默认为 `plain`，也可以用 `filled`。`accentColor` 缺省时取边框颜色。标题为空时隐藏标题但不去掉边框，标题最多 120 个字符。`spaceBeforePt` 和 `spaceAfterPt` 是题目外的间距，`gapPt` 是题目内部各区域之间的间距，单位都是磅。

可选的 `frame.design` 选择 `line`、`ribbon`、`fold`、`dashed`、`rail`、`double` 或 `band` 装饰，省略时保持原来的题框样子。装饰与颜色、边框样式和宽度、圆角及标题位置相互独立，由样式数据生成，不添加到可编辑内容中。

`runtimeFrame`、`runtimeStyle` 等运行时的显示属性不保存在文档中。一个样式被多个节点共用时，若只想改其中一个，应另建一个样式定义，并更新该节点的 `styleRef`。

## 盒子

`box` 是顶层块，在印出的标题下框住一段内容，如讲义中的“学习目标”“定义”“注意”。它可以包含段落、独立公式、表格、图片、图形、答题线、题目和题组；标题和其他盒子放在盒子外面。盒子本身不编号，也不是题目；盒子里的题目照常编号、进入题库和导出。

```json
{ "type": "box", "attrs": { "id": "box_1", "styleRef": "box.note", "label": "注意" }, "content": [ { "type": "paragraph", "attrs": { "id": "p_1" } } ] }
```

`appearance.boxStyles` 把样式名映射到与 `questionStyles` 相同的结构（边框、背景、圆角、内边距、间距和 `frame`），另有两个可选字段：`name` 是老师看到的样式名称，如“方格纸”，最多 40 个字符；`css` 是该样式盒子的装饰，最多 20,000 个字符。

盒子使用自己的 `styleRef`，没有时用 `appearance.defaults.boxStyleRef`，再没有时用应用的普通边框。尚未定义的 `styleRef` 会保留，在加入同名样式（例如套用版式）之前按默认样式显示。`attrs.label` 是盒子自己的标题，省略时显示样式的 `frame.label`，`""` 隐藏标题。修改盒子的标题不会改动它的样式。

盒子样式的 `css` 只作用于使用该样式的盒子，在纸张和打印副本上都生效。每个选择器都以盒子本身 `[data-chalklee-box]` 开头，之后可以接 `> [data-chalklee-frame-label]`（标题）、`> [data-chalklee-frame-decoration]`（覆盖整个盒子的装饰层，用于绘制装饰及其 `::before`、`::after`）或盒子里的内容。规则与[文档 CSS](#文档-css) 相同：图片只能用 `data:image/…` URL，不允许网络或文件引用、动画、转义、嵌套和 `:root`，生成文字只能用在 `::before`、`::after` 和 `::marker` 上。`border`、`padding` 等字段直接写在盒子元素上，CSS 要替换它们需要加 `!important`。盒子样式的 CSS 违反这些规则时文档不会被保存；导出 Word 时保留边框和背景，不带 CSS。

```json
"box.grid": { "name": "方格纸", "border": { "style": "solid", "widthPt": 0.75, "color": "#7aa7c7" },
  "css": "[data-chalklee-box] { background-image: linear-gradient(#dbe9f4 .5pt, transparent .5pt), linear-gradient(90deg, #dbe9f4 .5pt, transparent .5pt); background-size: 9pt 9pt; }" }
```

## 页眉页脚

`appearance.headerFooter` 保存每页重复的页眉和页脚：

```json
{
  "header": { "left": "{title}", "right": "第 {page} 页／共 {pages} 页", "rule": true },
  "footer": { "center": "© 数学教研组" },
  "differentFirstPage": true,
  "fontSizePt": 9,
  "color": "#374151"
}
```

每一行可以有 `left`、`center`、`right` 三段文字，以及与正文之间的可选分隔线 `rule`。`{page}`、`{pages}` 和 `{title}` 分别替换为页码、总页数和文档标题。`differentFirstPage` 让第一页（例如封面）不显示页眉和页脚。`fontFamilies`、`fontSizePt`、`color` 和 `ruleColor` 可选。

没有 `headerFooter` 的文档在页脚居中显示 `第 {page} 页／共 {pages} 页`，`{}` 表示页眉页脚都不显示。编辑器、打印、PDF 和 Word 使用同一设置，打印时的页眉页脚由页边距区域生成。

每一行可以带自己的 `style`，没写的部分取上面的共用设置：

```json
"header": { "left": "{title}", "style": { "fontSizePt": 9, "color": "#111111", "fontWeight": "bold",
  "rule": { "style": "double", "widthPt": 0.5, "color": "#111111" } } }
```

`fontWeight` 为 `normal` 或 `bold`，`letterSpacingEm`（0–1）设置字间距。`rule` 替代这一行的 `rule` 开关：`style` 为 `solid`（默认）、`dashed`、`dotted` 或 `double`；`widthPt` 是每条线的宽度，默认 0.5；`color` 默认取 `ruleColor`；`bothSides: true` 在文字另一侧再加一条线，让文字夹在两条线之间。页眉页脚只包含文字和线条，因此无论是否打印背景都会显示。

## 封面

`appearance.cover` 为文档添加封面，省略时没有封面。封面单独占一页，排在正文之前：应用把它画满第一张纸（包括页边距），不显示页眉、页脚和页面装饰。页码从正文第一页开始计算，`{pages}` 只计正文的页数。

```json
{ "title": "高一数学讲义", "subtitle": "第一章 函数", "subject": "高一数学", "author": "实验中学", "date": "2026 年 11 月" }
```

所有字段都可选，省略时不显示，只有 `title` 例外：未给出时显示文档标题，`""` 不显示。`title` 和 `subtitle` 最多 60 个字符，其余字段最多 40 个字符。`{}` 是只有文档标题的封面。可选的 `style` 改变封面的样子：

```json
{ "align": "center", "titleTop": 0.34, "titleSizePt": 30, "titleWeight": "bold", "titleColor": "#1c2024", "color": "#60646c", "fontFamilies": ["Songti SC"], "svg": "<svg>…</svg>" }
```

`align` 为 `center` 或 `left`。`titleTop`（0.08–0.8）以页面高度的比例确定标题和副标题距顶部的位置，其余字段排在下边距之上。`svg` 画满整张纸、位于文字之下，规则与[页面装饰](#页面装饰)相同；用百分比布局，以适应各种纸张。打印时封面是一张没有页边距的纸；在 Word 中封面是单独的一节，图形衬在文字下方，正文所在的节从 1 开始编页码。

## 目录

`appearance.tableOfContents` 添加目录，省略时没有目录。目录与封面一样单独占页，排在封面之后、正文之前，不显示页眉、页脚和页面装饰。应用列出正文中的顶层标题及其所在页码，并自动保持更新，所以文档只保存目录的样子：

```json
{ "levels": 2, "title": "目录", "style": { "leader": "dots", "titleAlign": "center", "firstLevelBold": true, "color": "#1c2024", "accentColor": "#1c2024", "fontFamilies": ["Songti SC"] } }
```

所有属性都可选。正文以一级标题开头、且全文只有这一个一级标题时，它是文档标题，不列入目录。`levels`（1–3，默认 2）从列出的最高一级标题往下数；开启 `headingNumbering` 时条目带自动编号。`title` 最多 20 个字符，`""` 不显示标题。`leader` 是条目通向页码的引导线：`dots`、`line` 或 `none`。`accentColor` 是目录标题和顶层条目的颜色。

每个条目占一行，条目多时接到下一页，页码从正文第一页开始计算。在 Word 中目录是单独的一节，包含一个目录域，Word 打开文档时按自己的分页更新页码。

## 页面装饰

`appearance.pageDecorations` 最多保存十二个画在页面上的图形，如左页边的卷头或正文下方的水印：

```json
{ "place": "left", "pages": "first", "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\">…</svg>" }
```

`place` 为 `left` 或 `right`（两侧页边距），或 `content`（正文区域，画在文字之下）。`pages` 为 `all`（默认）、`first`、`rest`（除第一页外的每一页）、`odd` 或 `even`；`content` 图形只能用于所有页面或第一页。

SVG 填满所在区域，区域的磅值尺寸由纸张和页边距决定：把根元素的 viewBox 设为这个尺寸，或用百分比布局。`{title}` 替换为文档标题。图形只作为图片显示：脚本、事件属性、嵌入页面以及对图形之外任何内容的引用（`data:image/…` 图片除外）都会被拒绝。两侧的图形印在所选页面的页边距中，正文区域的图形在每页重复或只在第一页显示。导出 Word 时不包含页面装饰。

## 标题编号

`appearance.headingNumbering: { style: "decimal" | "chinese", fromLevel?: 1 | 2 | 3 }` 从 `fromLevel`（默认 2）开始，为至多三级标题编号。`decimal` 生成 1、1.1、1.1.1，`chinese` 生成 一、（一）、1.。编号只在显示和输出时生成，不属于标题文字。文档 CSS 可以通过标题的 `::before` 设计编号样式。

## 题号

`appearance.questionNumbering` 设置全文题号的写法和样子：

```json
{ "style": "dot", "subStyle": "paren", "fontWeight": "bold", "color": "#0D74CE", "frame": false }
```

所有字段都可选：

- `style` 是题号的写法：`dot`（1.）、`comma`（1、）、`paren`（(1)）、`circle`（① 到 ㊿，之后为 51.）或 `plain`（只有数字，通常与 `frame` 一起用）。
- `subStyle` 是题组中小题的写法：`paren`、`dot` 或 `circle`。
- `fontWeight` 为 `normal` 或 `bold`，`color` 为十六进制颜色，`frame: true` 给题号加细框。

没有这项设置的文档使用 `dot`、`paren`、加粗、深蓝 `#113264`，不加框。

题号只在显示和输出时生成，不属于题目文字。固定题号（`number: { mode: "fixed", label }`）只含数字时，无论写成 `3`、`3.`、`3、`、`(3)`、`（3）` 还是 `③`，都按样式显示；带字母或文字的标号（如 `例1`）按原样印出。

文档 CSS 可以用以下变量重新设计题号，设在 `:root`、`[data-question-style]` 或 `[data-chalklee-subquestions]` 上：`--design-number-color`、`--design-number-weight`、`--design-number-background`、`--design-number-border`、`--design-number-radius`、`--design-number-box`（题号框的宽度）和 `--design-number-align`。导出 Word 时保留写法、粗细、颜色和边框。
