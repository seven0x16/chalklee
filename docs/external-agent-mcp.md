# 外部 AI 应用连接（MCP）

WorkBuddy、豆包工作、千问办公、Codex、Claude Code、Cursor 等支持 MCP 的 AI 应用可以连接 ChalkLee，用它们自己的模型查找、修改、组卷和转换资料文件夹里的文档。

- 连接期间需要保持 ChalkLee 打开，AI 应用操作的是 ChalkLee 当前打开的资料文件夹。
- AI 应用使用自己的模型，读不到 ChalkLee 设置里保存的 API Key。
- 修改与老师在 ChalkLee 里手动操作的效果相同：保留版本、可以撤销，不覆盖已有文件。

## 在 AI 应用中添加 ChalkLee

1. 打开 ChalkLee 的设置，进入“外部连接”。
2. 打开“允许外部 AI 应用连接”，状态显示为“运行中”。
3. 在“在外部 AI 应用中添加 ChalkLee”下选择你的应用，按页面上的步骤复制配置。列表里没有的应用选“其他”，里面有通用的 JSON 配置、逐项填写的命令和参数，以及 HTTP 连接方式。
4. 在 AI 应用里新建对话，直接说要做的事，例如“把《期中练习》的第 3 题改成选择题”。

配置中的路径指向当前安装的 ChalkLee，移动或重新安装应用后需要重新复制。连接不上时，请确认 ChalkLee 正在运行、已打开资料文件夹、外部连接已开启，并使用最新复制的配置。

## 连接方式

### stdio

设置中复制的配置用 ChalkLee 自身的可执行文件运行桥接程序，不需要另外安装 Node.js：

```json
{
  "mcpServers": {
    "chalklee": {
      "command": "<ChalkLee 可执行文件>",
      "args": ["<应用内的 mcp-bridge.js>"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

桥接程序从应用数据目录中的 `agent-connection.json` 读取服务地址和凭据，只把 MCP 消息写入 stdout。应用数据目录的默认位置：

| 系统 | 目录 |
| --- | --- |
| macOS | `~/Library/Application Support/ChalkLee/` |
| Windows | `%APPDATA%/ChalkLee/` |
| Linux | `$XDG_CONFIG_HOME/ChalkLee/`，未设置时为 `~/.config/ChalkLee/` |

### Streamable HTTP

支持 Streamable HTTP 的客户端可以直接连接本机的 `/mcp` 端点，默认地址为 `http://127.0.0.1:5274/mcp`，请求头带 `Authorization: Bearer <token>`。实际地址和 token 以连接文件为准，token 在 ChalkLee 每次启动时更换。`CHALKLEE_MCP_PORT` 可以指定端口。服务只监听本机 IPv4 回环地址。

### 从源码运行时

在仓库根目录安装依赖、构建并启动应用：

```sh
npm ci
npm run build
npm start
```

在应用中打开一个资料文件夹，再生成指向当前仓库的连接配置，把输出合并到客户端已有的配置中：

```sh
npm run mcp:config
```

```json
{
  "mcpServers": {
    "chalklee": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/chalklee/apps/desktop/out/main/mcp-bridge.js"]
    }
  }
}
```

使用自定义数据目录时，执行 `npm run mcp:config -- --connection /absolute/path/agent-connection.json`。

## 工具一览

客户端通过 `tools/list` 获取当前版本的工具名称、描述、参数 JSON Schema 和操作标记。下表按用途列出主要工具，完整参数以服务返回为准。

| 用途 | 工具 |
| --- | --- |
| 查看目录、查找文件、新建文件夹 | `workspace_list`、`workspace_search`、`workspace_create_folder` |
| 文档信息、复制导入、新建、读取与打开 | `document_info`、`document_import`、`document_create`、`document_read`、`document_open`、`document_show` |
| 文档结构与题目读取 | `document_outline`、`document_questions` |
| 修改题目与其他内容 | `question_update`、`content_insert`、`content_update`、`content_move`、`content_delete` |
| 搜题、选题篮与组卷 | `question_search`、`question_basket`、`question_insert` |
| 题库标签整理 | `question_tags` |
| 移动、改名、复制、移到废纸篓，整理目录与撤销整理 | `file_move`、`file_copy`、`file_trash`、`file_organize` |
| 版本历史 | `document_versions` |
| 转换任务与“不需要转换”标记 | `conversion_tasks` |
| 插件 | `plugins` |
| 排版、页面预览和 PDF／Word 导出 | `document_style_read`、`document_style_update`、`document_preview`、`document_export` |
| 转换原稿 | `conversion_guide`、`conversion_open`、`list_import_sessions`、`read_source`、`crop_figures`、`write_fragments`、`read_draft`、`preview_document`、`finish` |

文档工具的 `path` 是相对于当前资料文件夹的路径；`document_import.sourcePath` 指定要复制导入的本机文件。查看、编辑和导出不需要建立转换会话。

工具定义位于 [`agent/tools/`](../apps/desktop/src/main/agent/tools/)，由[工具目录](../apps/desktop/src/main/agent/tools/catalog.ts)按 `surfaces` 发布给 ChalkLee AI 或 MCP，两边使用同一份定义。

## 读取与修改

修改前先读取文档结构，用稳定的节点 ID 定位题目或内容。接口返回 `revision` 时，把它作为后续写入的 `expectedRevision`；遇到版本冲突时重新读取，不要用旧结果覆盖新内容。`document_read` 返回磁盘上的内容，不包含编辑器中尚未保存的输入。

`question_insert` 插入独立的题目副本，不改变来源文档。`content_insert`、`content_update` 和 `question_update` 中的图片可以写成 `{"type": "image", "path": "本机图片的绝对路径"}`（PNG 或 JPG），也可以用 `path` 加 `page` 裁取资料文件夹中 PDF 原稿的某一页。

### Markdown

- `document_create({name, markdown})` 新建 `.md`，重名不覆盖。
- `document_preview({path})` 返回全文和 `revision`，包括已打开的编辑器中尚未保存的内容。
- `html_update({path, revision, edits: [{find, replace}]})` 逐处替换，或用 `markdown` 提供完整的新原文。版本不匹配时拒绝写入；写入前保留版本，已打开的编辑器中可以撤销。`html_update` 同样用于修改 HTML 网页。
- Markdown 不参加文件夹的批量转换。需要转换成 ChalkLee 时，用 `conversion_open` 指名该文件。

### 技能

资料文件夹根目录“技能”文件夹中的 Markdown 是老师教会的做法，一个技能一个 `.md`，也识别 `技能/<名称>/SKILL.md`。开头 YAML 的 `description` 写它的用途，没有时取正文第一行。其他位置的 SKILL.md 不算技能。

客户端初始化时，服务说明（`instructions`）附带当时的技能名称、路径和用途，不含正文；之后新增或修改的技能以 `workspace_list` 为准，技能条目带 `skill`（用途）。照技能做事前用 `document_preview` 读取全文；保存技能用 `document_create({directory: "技能", name, markdown})`，文件夹不存在时自动创建。

### 需要用户确认的操作

文件操作、版本历史、选题篮、题库标签、转换任务和插件由 ChalkLee 窗口执行，与老师手动操作相同：先保存未保存的修改，同步已打开的标签和路径，不覆盖同名文件，不操作资料文件夹根目录和应用内部文件。窗口不可用时，在修改前拒绝操作。请不要用外部命令直接移动、复制或删除资料文件夹中的文件，那样会丢掉已打开文档中未保存的修改，删除也无法撤销。

ChalkLee AI 在应用内用确认卡片询问的操作，对 MCP 标为 `destructive`，由客户端在对话中征得用户同意：

- `file_trash` 移到系统废纸篓；`document_versions` 的 `restore` 恢复前先把当前内容保存为版本；`plugins` 的 `remove` 删除插件但保留它的数据。执行前先向用户说明。
- 整理目录先调用 `file_organize` 并设置 `preview: true`，把方案交给用户确认后再执行；结果中的 `organizeId` 可通过 `file_organize({undo: organizeId})` 撤销。
- 标签改名或合并先调用 `question_tags({action: "edit", preview: true, ...})`，确认后再执行；结果中的 `tagEditId` 可通过 `question_tags({action: "undo", undo: tagEditId})` 撤销。
- `plugins` 的 `install` 由用户在 ChalkLee 的确认框中批准，客户端不能代为批准。
- `conversion_tasks` 可以查看和停止 ChalkLee 自己的转换、标记“不需要转换”的原稿。继续转换和校对会使用应用设置中的模型额度，只能由老师在界面上操作；外部客户端自己转换时用 `conversion_open`。

## 排版与导出

### 样式

`document_style_read` 返回当前的排版数据、可套用的版式名称和版本；`ownStyleItems` 列出这份文档自己改过的纸张、正文和题目样式项，其余跟随应用的[标准样式](chalklee-format.md#标准样式)。`document_style_update` 可以修改：

| 字段 | 内容 |
| --- | --- |
| `appearance.design` | 文档自己的 CSS，只作用于文档内容，规则见[文档 CSS](chalklee-format.md#文档-css) |
| `page` | 纸张和页边距；`page.top` 等同 `page.marginsPt.top`。课件用 `{size: "slide", orientation: "landscape"}` 换成 16:9，见[课件](chalklee-format.md#课件) |
| `boxStyles`、`boxStyleRef` | 盒子样式，可以带 `name` 和装饰用的 `css`，见[盒子](chalklee-format.md#盒子)；值也可以写预设名，如“方格纸” |
| `headerFooter` | 页眉页脚，页眉、页脚可各带 `style`，也可以写预设名，如“双线” |
| `cover` | 封面：`{}` 为标准样子，`null` 去掉；`style` 可以写预设名，如“深色” |
| `tableOfContents` | 目录：`{}` 为标准样子，`null` 去掉；`style` 可以写预设名，如“细线” |
| `pageDecorations` | 页面装饰，如左页边的卷头、正文下方的水印 |
| `headingNumbering` | 标题编号 |
| `questionNumbering` | 全卷题号的写法和样子，也可以写预设名，如“圆圈” |
| `layout` | `{name}` 套用内置或用户保存的版式，`{from}` 套用另一份 ChalkLee 的版式；盒子按标题对应同名的盒子样式 |

CSS 选择器只用[稳定标记](chalklee-format.md#稳定标记)。新写入的 CSS 用到 `.chalklee-` 开头的内部类名时，结果中的 `selectorWarning` 会提醒改写。给题目样式设 `breakBefore: "page"` 可以让每道题另起一页。

### 题框、盒子和图形

- **题框**：`question_update` 的 `attrs.styleRef` 与 `attrs.frameLabel` 给单道题加带标题的题框，题框样式在 `questionStyles` 中定义。
- **段落用途**：`content_update` 的 `{id, role}` 标明段落或标题的用途，供 CSS 按 `[data-role]` 设计样式。
- **盒子**：学习目标、定义、注意等盒子是内容的一部分。`content_insert` 插入 `{"type": "box", "label": "定义", "body": […]}`；`content_update` 用 `{wrap: [ids], label?, style?}` 把正文中相连的段落或题目原样放进盒子，用 `{id, label?, style?}` 修改标题或换成新样式，用 `{id, unwrap: true}` 取消盒子并保留内容。插入题目时 `position: {after: 盒子里某一行的 id}` 即插进盒子。盒子里的题照常编号、进入题库和导出，盒子不能嵌套。
- **图形**：封面、标题横幅、知识结构图、示意图和分步动画讲解用 `content_insert` 插入 `{"type": "graphic", "svg": "<svg viewBox=…>…</svg>", "printSvg?": "…", "widthPercent?": 60, "caption?": "…"}`，也可以写进 `stem`、`answer`、`analysis`、`material`、盒子的 `body` 等数组，或用 `question_update` 放进题目的解析。SVG 自带的动画在屏幕上播放，打印、PDF 和 Word 使用 `printSvg`，规则见[文档结构](chalklee-format.md#文档结构)。
- **分页**：需要另起一页时，用 `content_insert` 插入 `{"type": "pageBreak"}`。

### 预览检查

用 `document_preview` 检查修改后的实际页面，需要检查卷面结构时可以请求 `html: true`；返回的 HTML 只用于检查，不能代替 `.chalklee` 中的文档树。除所选页面的截图外，结果中的 `layout` 覆盖全部页面：

| 字段 | 内容 |
| --- | --- |
| `used` | 每页正文的占用比例（0～1） |
| `split` | 从一页延续到下一页的题目和盒子，`fitsOnPage` 表示一页放得下 |
| `strandedHeadings` | 落在页底、与下文分开的标题 |
| `tooWide` | 超出正文宽度的图片和表格 |
| `unmatchedCss` | 文档 CSS 中在卷面上一个元素也没选中的选择器 |

追加文档中已有的同一段 CSS 会被拒绝。

### 导出

`document_export` 把 PDF 或 Word 保存到文档所在的文件夹，重名不覆盖。

- `format` 默认为 `pdf`，传入 `docx` 导出可编辑的 Word 文档。
- `answers` 和 `analysis` 控制是否导出答案与解析；`solutionPlacement` 默认为 `after-question`，放在每道题后，传入 `end` 时在卷末另页汇总，保留大题标题、题号和小题号。
- 导出设置不改变文档和编辑区的显示状态。

Word 保留结构化内容、基础文字格式、图片、表格、常见公式、页面设置、盒子（带边框的单元格）、页眉页脚和标题编号，不转换自定义 CSS、题框装饰和图片环绕，分页由 Word 自行决定；无法转换的公式保留原 LaTeX。

## 转换原稿

外部 AI 应用可以用自己的模型转换 PDF、DOC、DOCX、LaTeX 和 Markdown，整个过程不调用 ChalkLee 设置中的模型。开始前先调用 `conversion_guide()`，读取与当前应用版本匹配的完整规则（也可以读取资源 `chalklee://authoring`）；每个指南版本只需读取一次。参数、引用格式、裁图坐标和完成检查都以指南为准，本节只介绍流程。

```text
conversion_guide → conversion_open
  PDF：read_source → write_fragments.sourcePages（逐页固定原稿内容）
  各格式：read_source → write_fragments（按引用组题）
        → read_draft → [preview_document 按需查看] → finish（自动渲染检查并保存）
```

- **准备原稿**：DOC、DOCX、LaTeX 和 Markdown 打开后即可组题（LaTeX 的 `sourceKind` 为 `latex`）。PDF 需要先逐页固定内容，每次最多三页，每页确认原生文字或提交整页转录。全部页面准备好后才能组题，中断后已准备的页面不会重做。
- **组题**：`write_fragments` 按引用把原稿内容组织成章节、题目、小问、题组和答案，每段原稿内容恰好使用一次；可以同时提交少量有原图依据的识别纠错。保存失败时整批回滚。
- **检查进度**：`write_fragments` 和 `read_draft` 报告还没写入的引用和其他检查问题。引用齐备后，`read_draft.tagging` 提供打知识点标签所需的题目和已有标签，标签随 `finish` 一起提交。
- **完成**：`finish` 自动渲染当前版本并检查，通过后保存。结果另存在原稿所在的文件夹，重名时生成副本，原稿不变。漏写或重复使用原稿内容、内容或公式在组装后丢失或改变、未查看的原稿页、答案归属冲突等问题必须修正。其余问题带编号返回，核对原稿后确属原稿如此的，再次 `finish` 时在 `keep` 中写这一条的编号和理由（原稿哪里是这样印的）即可交付；保留的结构疑点和用 ChalkLee AI 转换时一样，在文档顶部逐处提示用户核对。`finish(draft: true)` 保存未完成的结果，保存后会话只读。

### 中断与接手

stdio 桥接每 15 秒上报一次心跳。断连、45 秒没有收到心跳，或 2 分钟没有转换调用且没有正在执行的转换工具时，任务显示为等待继续；后续的转换调用会接着已有进度继续。收到客户端的取消通知时，已经开始的保存仍会完整结束。

中断的转换可以交给另一款已连接的 AI 应用，不需要原来的聊天记录。ChalkLee 中“交给外部 AI 应用”复制的内容带有转换会话 ID：先读 `conversion_guide`，再用 `read_draft({sessionId})` 读取已有进度和剩余问题，沿用同一会话处理剩余内容，不要重新调用 `conversion_open`。没有会话 ID 时，用 `list_import_sessions` 查找对应原稿的会话。写入沿用最新的 `revision`，过期的版本会被拒绝；用户已停止的会话不能继续写入。

工具定义见 [`conversionSessionTools.ts`](../apps/desktop/src/main/agent/tools/conversionSessionTools.ts)。

## 返回结果与文档链接

工具通常返回 JSON 文字，预览和原稿读取还会返回图片。`document_open` 等工具返回可以在浏览器中打开的文档 URL，其中包含本机访问凭据，只供本机客户端使用，不能作为公开的分享链接。

浏览器中可以查看原稿、编辑 ChalkLee，并通过“在 ChalkLee 中打开”回到桌面应用。浏览器和桌面使用同一份文件的版本与保存检查，不支持多人同时编辑。
