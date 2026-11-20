import { isConvertibleKind, isHtmlKind } from "../../../shared/document/kinds";
import { SKILLS_FOLDER, isSkillsFolder } from "../../../shared/skills";
import type { ImageContent } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { WorkspaceDirectoryNode, WorkspaceNode } from "../../../shared/contracts";
import type { AgentContentPosition } from "../../../shared/agent/documentEditing";
import { AGENT_DESIGN_GUIDE, agentDesignInternalSelectors, type AgentDesignPatch } from "../../../shared/agent/design";
import { AGENT_OPTION_LAYOUTS } from "../../../shared/agent/editing";
import { AGENT_CONTENT_FORMAT } from "../content";
import { HTML_PAGE_MAX_CHARS, HTML_PAGE_MAX_STEPS } from "../../workspace/htmlPages";
import { isWorkspaceSkill } from "../../workspace/skills";
import {
  BOTH, MCP, PathParam, RevisionParam, WITH_PLUGINS, defineTool, displayName, documentRef, output, pictureSources, relative, requireApp, requireExternal, strict, written,
  type ChalkLeeTool
} from "./toolKit";

const Revision = Type.String({ pattern: "^sha256:[a-f0-9]{64}$" });
/** Enough source for any page an agent writes, without flooding a turn with an oversized one. */
const HTML_PREVIEW_CHARS = 200_000;
const Color = Type.String({ pattern: "^#[0-9A-Fa-f]{6}$" });
const Spacing = Type.Object({ top: Type.Number({ minimum: 0 }), right: Type.Number({ minimum: 0 }), bottom: Type.Number({ minimum: 0 }), left: Type.Number({ minimum: 0 }) }, strict);
const BoxStyle = Type.Object({
  backgroundColor: Type.Optional(Color),
  border: Type.Optional(Type.Object({ style: Type.Union(["solid", "dashed", "dotted", "none"].map(value => Type.Literal(value))), widthPt: Type.Number({ minimum: 0, maximum: 6 }), color: Color }, strict)),
  borderRadiusPt: Type.Optional(Type.Number({ minimum: 0, maximum: 24 })),
  paddingPt: Type.Optional(Spacing),
  spaceBeforePt: Type.Optional(Type.Number({ minimum: 0 })), spaceAfterPt: Type.Optional(Type.Number({ minimum: 0 })),
  frame: Type.Optional(Type.Object({
    label: Type.String({ maxLength: 120, description: "默认标题，如“注意”；套用版式时按它对应盒子" }),
    design: Type.Optional(Type.Union(["line", "ribbon", "fold", "dashed", "rail", "double", "band"].map(value => Type.Literal(value)), { description: "造型：line 素线、ribbon 书签、fold 折角、dashed 信笺、band 题头、double 双线" })),
    labelPosition: Type.Optional(Type.Union(["top-left", "top-center", "left"].map(value => Type.Literal(value)))),
    labelStyle: Type.Optional(Type.Union([Type.Literal("plain"), Type.Literal("filled")], { description: "filled 为色块标题，plain 为文字标题" })),
    accentColor: Type.Optional(Color)
  }, strict)),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 40, description: "老师看到的样式名，如“方格纸”“课堂小提示”" })),
  css: Type.Optional(Type.String({ maxLength: 20000, description: "只作用于这个样式的盒子的装饰 CSS：每个选择器以 [data-chalklee-box] 开头，可接 > [data-chalklee-frame-label]（标题）、> [data-chalklee-frame-decoration]（覆盖整个盒子的装饰层，可用 ::before、::after）或盒子里的内容；规则同文档 CSS，见 document_style_read 的 guide.boxStyle" }))
}, strict);
const RunningLineStyle = Type.Object({
  fontSizePt: Type.Optional(Type.Number({ minimum: 6, maximum: 24 })), color: Type.Optional(Color),
  fontWeight: Type.Optional(Type.Union([Type.Literal("normal"), Type.Literal("bold")])),
  letterSpacingEm: Type.Optional(Type.Number({ minimum: 0, maximum: 1, description: "字距，单位 em" })),
  rule: Type.Optional(Type.Object({
    style: Type.Optional(Type.Union(["solid", "dashed", "dotted", "double"].map(value => Type.Literal(value)), { description: "默认 solid；double 为两条细线" })),
    widthPt: Type.Optional(Type.Number({ minimum: .25, maximum: 3, description: "默认 0.5；double 时为每条线的粗细" })), color: Type.Optional(Color),
    bothSides: Type.Optional(Type.Boolean({ description: "文字上下各一条线" }))
  }, strict))
}, strict);
const RunningLine = Type.Object({
  left: Type.Optional(Type.String({ maxLength: 200 })), center: Type.Optional(Type.String({ maxLength: 200 })), right: Type.Optional(Type.String({ maxLength: 200 })),
  rule: Type.Optional(Type.Boolean({ description: "页眉下方或页脚上方的细线；写了 style 时以 style.rule 为准" })),
  style: Type.Optional(Type.Union([RunningLineStyle, Type.String({ minLength: 1, maxLength: 20, description: "也可以是预设名称，如“双线”“上下线”，见 guide.paperElements" })],
    { description: "这一行的外观：字号、颜色、字重、字距和横线，不改文字；没写的项沿用 headerFooter 的共用设置" }))
}, strict);
const OptionLayout = Type.Union(AGENT_OPTION_LAYOUTS.map(layout => Type.Literal(layout)));
const Blocks = (minItems: number) => Type.Array(Type.Record(Type.String(), Type.Unknown()), { minItems, maxItems: 200 });
const Region = Type.Array(Type.Union([Type.String({ maxLength: 100_000 }), Type.Record(Type.String(), Type.Unknown())]), { maxItems: 200 });
const Position = {
  after: Type.Optional(Type.String({ description: "放在该 id 的块或题目之后" })),
  before: Type.Optional(Type.String({ description: "放在该 id 的块或题目之前" })),
  at: Type.Optional(Type.Union([Type.Literal("start"), Type.Literal("end")], { description: "放在文首或文末；未指定 after/before 时默认文末" }))
};

/** Margins written as page.top and the like join marginsPt. */
function chalkLeeAgentPagePatch(page: Record<string, unknown>): AgentDesignPatch["page"] {
  const { top, right, bottom, left, marginsPt, ...rest } = page;
  const sides = Object.fromEntries(Object.entries({ top, right, bottom, left }).filter(([, value]) => typeof value === "number"));
  return { ...rest, ...(marginsPt || Object.keys(sides).length ? { marginsPt: { ...(marginsPt as object), ...sides } } : {}) } as AgentDesignPatch["page"];
}

const dataImage = (dataUrl: string): ImageContent[] => {
  const match = dataUrl.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  return match ? [{ type: "image", mimeType: match[1], data: match[2] }] : [];
};

function position(args: { after?: string; before?: string; at?: "start" | "end" }): AgentContentPosition {
  if (args.after) return { after: args.after };
  if (args.before) return { before: args.before };
  return { at: args.at ?? "end" };
}

/** Flat entries with workspace-relative paths, which models and scripts reuse directly. */
function listing(root: string, node: WorkspaceDirectoryNode, depth: number, limit = 400) {
  const entries: Array<Record<string, unknown>> = [];
  let truncated = false;
  const visit = (children: WorkspaceNode[], level: number) => {
    for (const child of children) {
      if (entries.length >= limit) { truncated = true; return; }
      if (child.kind === "directory") {
        const expand = level + 1 < depth;
        entries.push({ path: `${relative(root, child.path)}/`, kind: "directory", ...(!expand && child.children.length ? { items: child.children.length } : {}) });
        if (expand) visit(child.children, level + 1);
      } else {
        entries.push({
          path: relative(root, child.path), kind: child.extension, kb: Math.max(1, Math.round(child.size / 1024)), modified: new Date(child.modifiedAt).toLocaleDateString("zh-CN"),
          ...(child.convertedTo?.length ? { convertedTo: child.convertedTo.map(file => relative(root, file)) } : {}),
          ...(child.earlierConversions?.length ? { earlierConversions: child.earlierConversions.map(file => relative(root, file)) } : {}),
          ...(child.noConversion ? { noConversion: true } : {}),
          ...(child.skill ? { skill: child.skill.description || "未写用途" } : {})
        });
      }
    }
  };
  visit(node.children, 0);
  return { entries, truncated };
}

export const DOCUMENT_TOOLS: ChalkLeeTool[] = [
  defineTool({
    name: "workspace_list", label: "查看目录", surfaces: BOTH, kind: "read",
    description: "列出工作区或子目录中的文件夹、PDF、DOC、DOCX、LaTeX、Markdown、HTML 网页和 ChalkLee（可编辑的试卷/讲义），含大小、修改日期，以及 PDF/DOC/DOCX/LaTeX 已转换出的 ChalkLee（convertedTo）；原稿转换后又被改过时，列出改动前转换出的 ChalkLee（earlierConversions），批量转换同样视为已转换；老师标为不需要转换的原稿（如只用来阅读的课本）带 noConversion，批量转换跳过，不要建议转换；根目录“技能”文件夹中的技能带 skill（它的用途）。路径相对于 ChalkLee 当前工作区。",
    notes: { mcp: "相对路径属于应用工作区，不是客户端任务目录。" },
    parameters: Type.Object({
      directory: Type.Optional(Type.String({ description: "子目录，省略为工作区根目录" })),
      depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 6, default: 3, description: "展开层数" }))
    }, strict),
    execute: async ({ directory, depth }, host) => {
      const snapshot = await host.documents.list(directory ?? ".");
      return output({ directory: relative(host.root, snapshot.root.path), documents: snapshot.fileCount, ...listing(host.root, snapshot.root, depth ?? 3) });
    }
  }),
  defineTool({
    name: "workspace_search", label: "查找文件", surfaces: BOTH, kind: "read",
    description: "按文件或文件夹名称搜索工作区，可按文档类型筛选。",
    notes: { assistant: "查找题目内容用 question_search。", mcp: "不会建立转换会话。" },
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 300 }), directory: Type.Optional(Type.String()),
      kind: Type.Optional(Type.Union([Type.Literal("pdf"), Type.Literal("docx"), Type.Literal("doc"), Type.Literal("tex"), Type.Literal("md"), Type.Literal("markdown"), Type.Literal("html"), Type.Literal("chalklee")])),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 60 }))
    }, strict),
    execute: async ({ query, directory, kind, limit }, host) => {
      const found = await host.documents.search(query, directory ?? ".", kind, limit ?? 60);
      return output({ total: found.total, truncated: found.truncated, matches: found.matches.map(match => ({
        path: relative(host.root, match.path), kind: match.kind, ...(match.size !== undefined ? { kb: Math.max(1, Math.round(match.size / 1024)) } : {}),
        ...(match.modifiedAt ? { modified: new Date(match.modifiedAt).toLocaleString("zh-CN") } : {})
      })) });
    }
  }),
  defineTool({
    name: "workspace_create_folder", label: "新建文件夹", surfaces: BOTH, kind: "write",
    description: "在工作区新建文件夹，重名不覆盖。",
    parameters: Type.Object({ directory: Type.Optional(Type.String({ default: ".", description: "上级文件夹，默认工作区根目录" })), name: Type.String({ minLength: 1, maxLength: 180 }) }, strict),
    execute: async ({ directory, name }, host) => output({ created: relative(host.root, (await host.documents.createFolder(directory ?? ".", name)).path) })
  }),
  defineTool({
    name: "document_create", label: "新建文档", surfaces: WITH_PLUGINS, kind: "write",
    description: `新建与界面相同的 ChalkLee 试卷或讲义，可用 blocks 同时写入初始内容；重名不覆盖。传 markdown 时新建可直接编辑的 .md 笔记。传 html 时改为新建 .html 网页（可交互的演示、模拟实验、小练习等），在 ChalkLee 中直接运行。blocks 格式与 content_insert 相同。`,
    notes: { assistant: "新建后在 ChalkLee 中打开。", mcp: "返回文件信息和浏览器编辑 URL。" },
    parameters: Type.Object({
      directory: Type.Optional(Type.String({ default: ".", description: "所在文件夹，默认工作区根目录" })),
      name: Type.String({ minLength: 1, maxLength: 180, description: "文件名，不含扩展名" }), blocks: Type.Optional(Blocks(0)),
      markdown: Type.Optional(Type.String({ maxLength: 10_000_000, description: "Markdown 原文，与 html、blocks 互斥" })),
      html: Type.Optional(Type.String({ minLength: 1, maxLength: HTML_PAGE_MAX_CHARS, description: "完整的 HTML 源码；提供时新建 .html 网页而不是 ChalkLee，不能与 blocks 同时使用" }))
    }, strict),
    execute: async ({ directory, name, blocks, html, markdown }, host) => {
      if (markdown !== undefined && (html !== undefined || blocks !== undefined)) throw new Error("markdown、html 和 blocks 只能选一种。");
      if (html !== undefined && blocks?.length) throw new Error("html 与 blocks 只能二选一：网页用 html，ChalkLee 用 blocks。");
      // The first skill brings its folder with it.
      if (markdown !== undefined && isSkillsFolder(directory)) await host.documents.info(SKILLS_FOLDER).catch(() => host.documents.createFolder(".", SKILLS_FOLDER));
      const created = markdown !== undefined ? await host.documents.createPage(directory ?? ".", name, markdown, true) : html !== undefined ? await host.documents.createPage(directory ?? ".", name, html) : await host.documents.createDocument(directory ?? ".", name, blocks);
      if (host.app) await host.app.ui({ action: "open", path: created.path }).catch(() => undefined);
      return output({ created: relative(host.root, created.path), ...("revision" in created ? { revision: created.revision } : {}),
        ...(host.surface === "mcp" && "previewUrl" in created ? { previewUrl: created.previewUrl } : {}) }, { documents: [documentRef(created.path)] });
    }
  }),
  defineTool({
    name: "document_outline", label: "阅读文档结构", surfaces: BOTH, kind: "read",
    description: "读取 ChalkLee 的结构：标题、纸张设置和全部标题/段落/题目（含 id、题号、题型、分值、难度、标签、已写的答案解析与开头文字）。插入、修改、删除、移动内容前用它确定位置。转换得到的文档还返回原稿位置（original）和每道题关联的转换提醒数（toCheck，详情用 document_questions 读取；界面上不再标出待核对的题）。已打开的文档读取编辑器中的最新内容（含未保存修改）。",
    notes: { assistant: "PDF/DOC/DOCX/LaTeX 原稿用 document_preview 查看内容，需要编辑时用 conversion_start 转换。Markdown 用 document_preview 读取全文和 revision，再用 html_update 修改。", mcp: "PDF/DOC/DOCX/LaTeX 原稿用 document_preview 查看内容；Markdown 用它读取全文和 revision，再用 html_update 修改。" },
    parameters: Type.Object({ path: PathParam }, strict),
    execute: async ({ path: candidate }, host) => {
      const info = await host.documents.info(candidate);
      if (info.kind !== "chalklee") return output({ path: relative(host.root, info.path), kind: info.kind, note: isHtmlKind(info.kind)
        ? "这是 HTML 网页，没有 ChalkLee 结构。用 document_preview 查看截图，加 html:true 读取源码，用 html_update 修改。"
        : "这是只读原稿，不能直接编辑。用 document_preview 查看原稿内容；需要编辑时先转换为 ChalkLee。" }, { documents: [documentRef(info.path)] });
      const outline = await host.documents.readOutline(info.path);
      return output({ ...outline, path: relative(host.root, outline.path), ...(outline.original ? { original: relative(host.root, outline.original) } : {}) }, { documents: [documentRef(info.path)] });
    }
  }),
  defineTool({
    name: "document_questions", label: "读取题目", surfaces: WITH_PLUGINS, kind: "read",
    description: "读取 ChalkLee 的题目列表和 revision：稳定 id、显示题号、parentId、章节、属性和正文摘要（公式为 $LaTeX$）。题号可能重复，修改必须用 id。query 搜索本文档题目的正文、题号和标签，questionIds 指定题目；includeContent:true 返回原生区域内容，修改含图片、表格或格式的区域时用它原样保留。转换得到的文档中，有疑点的题目带 toCheck（转换时记录的待核对说明，含原稿页码），可用 document_preview 查看 original 原稿对应页核对后用 question_update 修正。已打开的文档读取编辑器中的内容（含未保存修改），否则读磁盘。",
    notes: { mcp: "无需转换会话或转换指南。" },
    parameters: Type.Object({
      path: PathParam, questionIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 100 })),
      query: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })), includeContent: Type.Optional(Type.Boolean({ default: false })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })), offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 }))
    }, strict),
    execute: async ({ path: candidate, ...options }, host) => {
      const read = await host.documents.readQuestions(candidate, { ...options, limit: options.limit ?? 50 });
      return output({ ...read, path: relative(host.root, read.path), ...(read.original ? { original: relative(host.root, read.original) } : {}) }, { documents: [documentRef(read.path)] });
    }
  }),
  defineTool({
    name: "question_update", label: "修改题目", surfaces: BOTH, kind: "destructive",
    description: '修改已有 ChalkLee 题目的内容或属性并保存，每批 1–30 道题，失败不写入。先用 document_questions 取得题目 id，传入当时的 expectedRevision 可防止覆盖期间的其他修改。patch 只替换提供的整个区域，未提供的保留：stem 是题干（题组为共享材料）、options:[{label:"A",content:["选项"]}]、answer:["B"]、analysis:["解析 $x^2$"]；字符串按换行生成段落，$...$ 是可编辑行内公式，单行 $$...$$ 是独立公式，<b>粗体</b>、<i>斜体</i>、<u>下划线</u>（不能写其他 HTML 标签），连续下划线 ____ 为填空。区域也可放 document_questions(includeContent:true) 返回的原生块以保留图文和格式，或图片 {"type":"image","attachment":1,"crop":[x,y,宽,高]}（对话中附带的图片）、{"type":"image","path":"原稿.pdf","page":2,"crop":[…]}（工作区 PDF 原稿的页面），crop 按原图 0–1000 计算；[] 清除选项、答案或解析，stem:[] 留空题干。attrs 支持 kind、score、difficulty（easy/medium/hard）、tags、number（{mode:"auto"}/{mode:"none"}/{mode:"fixed",label:"3"}；题组还可以 {mode:"continue"}：题组本身不编号，小题接着全卷编号，如阅读的小题 33–36），score/difficulty 为 null 时清除。optionLayout 设置选项排列：auto 自动、inline 行内、one-column 一行一项、two-column 一行两项、four-column 一行四项。题组与小题用各自的 id。已打开的文档实时更新并可撤销；版本冲突或多个编辑器内容不同会拒绝修改。',
    parameters: Type.Object({
      path: PathParam, expectedRevision: RevisionParam,
      edits: Type.Array(Type.Object({ questionId: Type.String({ minLength: 1 }), patch: Type.Object({
        stem: Type.Optional(Region), answer: Type.Optional(Region), analysis: Type.Optional(Region),
        options: Type.Optional(Type.Array(Type.Object({ label: Type.String({ minLength: 1, maxLength: 80 }), content: Region }, strict), { maxItems: 30 })),
        optionLayout: Type.Optional(OptionLayout),
        attrs: Type.Optional(Type.Object({
          kind: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })), score: Type.Optional(Type.Union([Type.Number({ minimum: 0 }), Type.Null()])),
          difficulty: Type.Optional(Type.Union([Type.Literal("easy"), Type.Literal("medium"), Type.Literal("hard"), Type.Null()])),
          tags: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 100 })),
          number: Type.Optional(Type.Union([
            Type.Object({ mode: Type.Literal("auto") }, strict), Type.Object({ mode: Type.Literal("none") }, strict),
            Type.Object({ mode: Type.Literal("fixed"), label: Type.String({ minLength: 1, maxLength: 80 }) }, strict),
            Type.Object({ mode: Type.Literal("continue") }, strict)
          ])),
          styleRef: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()], { description: "题框样式名（questionStyles 中带 frame 的样式，如例题框）；null 恢复文档默认的无框样式" })),
          frameLabel: Type.Optional(Type.Union([Type.String({ maxLength: 120 }), Type.Null()], { description: "这道题题框上的标题，如“例1”“典例精讲”；null 用样式自带的标题，\"\" 隐藏标题" }))
        }, strict))
      }, strict) }, strict), { minItems: 1, maxItems: 30 })
    }, strict),
    execute: async ({ path: candidate, expectedRevision, edits }, host) => {
      const updated = await host.documents.updateQuestions(candidate, expectedRevision, edits as never, pictureSources(host));
      return output(written(host, updated), { documents: [documentRef(updated.path, edits[0]?.questionId)] });
    }
  }),
  defineTool({
    name: "content_insert", label: "插入内容", surfaces: BOTH, kind: "write",
    description: `在 ChalkLee 中插入新的标题、段落、表格、图片、题目或题组并保存；已打开的文档实时更新且可撤销。位置用 document_outline 返回的 id。小题要插入题组时用该题组某个小题的 id 作 after/before。blocks 格式：${AGENT_CONTENT_FORMAT}`,
    parameters: Type.Object({ path: PathParam, blocks: Blocks(1), ...Position, expectedRevision: RevisionParam }, strict),
    execute: async ({ path: candidate, blocks, expectedRevision, ...where }, host) => {
      const updated = await host.documents.insertContent(candidate, blocks, position(where), expectedRevision, pictureSources(host));
      return output(written(host, updated, { insertedIds: updated.insertedIds }), { documents: [documentRef(updated.path, updated.insertedIds[0])] });
    }
  }),
  defineTool({
    name: "content_update", label: "修改内容", surfaces: BOTH, kind: "write",
    description: `修改 ChalkLee 中题目以外的内容并保存，如试卷标题、注意事项、说明段落、表格；题目的题干、选项、答案、属性用 question_update，插入新内容用 content_insert。每项 edit 二选一：{id, block} 用一个新的标题/段落/表格整块替换该块（保留原有对齐与间距；含图片的块不能整块替换），block 格式同 content_insert；{id?, find, replace} 把文字 find 全部替换为 replace，不改动公式和原有格式，id 可以是任意块或题目，省略 id 时作用于全文（如统一改年份、学校名）；replace 可写 <b>粗体</b>、<i>斜体</i>、<u>下划线</u>，如 find:"not"、replace:"<b>not</b>" 把这个词加粗。盒子：{wrap:[ids], label?, style?} 把正文中相连的段落、公式、表格或图片原样放进一个盒子（讲义中的学习目标、定义、注意等），{id:盒子id, label?, style?} 改盒子标题或样式（null 恢复默认），{id:盒子id, unwrap:true} 取消盒子、内容留在原位。用途：{id:段落或标题id, role:"subtitle"} 标明副标题、作者日期（byline）、导语（lead）、重点句（key）等用途，供 CSS 按 [data-role] 设计样式，null 清除。id 来自 document_outline。已打开的文档实时更新且可撤销。`,
    parameters: Type.Object({
      path: PathParam, expectedRevision: RevisionParam,
      edits: Type.Array(Type.Union([
        Type.Object({ id: Type.String({ minLength: 1 }), block: Type.Record(Type.String(), Type.Unknown()) }, strict),
        Type.Object({ id: Type.Optional(Type.String({ minLength: 1 })), find: Type.String({ minLength: 1, maxLength: 2000 }), replace: Type.String({ maxLength: 2000 }) }, strict),
        Type.Object({ wrap: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 100, description: "正文中前后相连的段落、公式、表格、图片、图形或题目的 id，放进同一个盒子（如“随堂练习”框住几道题），原有内容和格式不变，题号照常连续" }),
          label: Type.Optional(Type.String({ maxLength: 120 })), style: Type.Optional(Type.String({ description: "盒子样式名" })) }, strict),
        Type.Object({ id: Type.String({ minLength: 1, description: "盒子的 id" }), label: Type.Optional(Type.Union([Type.String({ maxLength: 120 }), Type.Null()])),
          style: Type.Optional(Type.Union([Type.String(), Type.Null()])), unwrap: Type.Optional(Type.Boolean({ description: "取消盒子，内容留在原位" })),
          role: Type.Optional(Type.Union([Type.String({ pattern: "^[a-z][a-z0-9-]{0,31}$" }), Type.Null()], { description: "段落或标题的用途，如 subtitle、byline、lead、key；null 清除" })) }, strict)
      ]), { minItems: 1, maxItems: 100 })
    }, strict),
    execute: async ({ path: candidate, edits, expectedRevision }, host) => {
      const updated = await host.documents.updateContent(candidate, edits as never, expectedRevision, pictureSources(host));
      const first = edits.map(edit => "id" in edit ? edit.id : "wrap" in edit ? edit.wrap[0] : undefined).find(Boolean);
      return output(written(host, updated, { replaced: updated.replaced }), { documents: [documentRef(updated.path, first)] });
    }
  }),
  defineTool({
    name: "content_delete", label: "删除内容", surfaces: BOTH, kind: "destructive",
    description: "按 id 从 ChalkLee 删除题目、题组、小题、标题、段落或盒子并保存。只删除老师要求删除或明显多余的内容（重复的标题、转换残留的空段落等），拿不准的不删，改为保留或放进盒子；只想改文字时用 content_update。删除和其他修改一样可在已打开的文档中撤销，修改前的文档也会保存为版本。完成后告诉老师删了什么。",
    notes: { mcp: "删除前请先征得用户同意。" },
    parameters: Type.Object({ path: PathParam, ids: Type.Array(Type.String(), { minItems: 1, maxItems: 200 }), expectedRevision: RevisionParam }, strict),
    execute: async ({ path: candidate, ids, expectedRevision }, host) => {
      const updated = await host.documents.removeContent(candidate, ids, expectedRevision);
      const names = updated.removedItems.map(item => item.label);
      const summary = `删除了 ${names.slice(0, 3).join("、")}${names.length > 3 ? ` 等 ${names.length} 项` : ""}，可撤销`;
      return output(written(host, updated, { removed: updated.removedItems }), { documents: [documentRef(updated.path)], summary });
    }
  }),
  defineTool({
    name: "content_move", label: "调整顺序", surfaces: BOTH, kind: "write",
    description: "按 id 把题目、标题或段落移到新位置并保存，用于调整题序或把题目归到某个大题标题下。多个 id 保持原有先后顺序。",
    parameters: Type.Object({ path: PathParam, ids: Type.Array(Type.String(), { minItems: 1, maxItems: 200 }), ...Position, expectedRevision: RevisionParam }, strict),
    execute: async ({ path: candidate, ids, expectedRevision, ...where }, host) => {
      const updated = await host.documents.moveContent(candidate, ids, position(where), expectedRevision);
      return output(written(host, updated, { moved: ids.length }), { documents: [documentRef(updated.path, ids[0])] });
    }
  }),
  defineTool({
    name: "document_style_read", label: "读取排版样式", surfaces: BOTH, kind: "read",
    description: "调整 ChalkLee 的排版或文档属性前先读取：返回当前完整 CSS、纸张参数（pt）、盒子样式与默认盒子样式、页眉页脚、标题编号、可套用的版式名称、文档属性中的年份和年级（null 表示未设置，按试卷标题等自动识别）、ownStyleItems（这份文档自己改过的纸张、正文和题目样式项，其余跟随应用标准样式）、revision、稳定的卷面选择器和设计约定。已打开的文档读取编辑器中的内容（含未保存修改），否则读磁盘。",
    notes: { mcp: "无需转换会话。" },
    parameters: Type.Object({ path: PathParam }, strict),
    execute: async ({ path: candidate }, host) => {
      const style = await host.documents.readStyle(candidate);
      return output({ ...style, path: relative(host.root, style.path) }, { documents: [documentRef(style.path)] });
    }
  }),
  defineTool({
    name: "document_style_update", label: "调整排版", surfaces: BOTH, kind: "write",
    description: `修改 ChalkLee 的视觉样式、纸张设置、盒子与题框样式、页眉页脚、封面、目录、页面装饰（卷头、密封线、水印）、标题编号、题号样式或文档属性中的年份和年级，或整体套用版式，并保存。metadata:{year,grade} 设置年份（如 2025）和年级（1–12，7 为初一、9 为初三、12 为高三），题库按它筛选，null 恢复自动识别。先 document_style_read 并传入 expectedRevision。小改动（字号、行距、题间距、颜色等）用 cssEdits:[{find,replace}] 替换当前 CSS 中唯一出现的片段，或用 appendCss 在末尾追加规则（后写的覆盖前面的）；整体重新设计才用 design:{name?,css} 完整替换，design:null 恢复应用默认样式；page 只合并提供的纸张参数（pt），未提供的保留。选项排列不是样式，用 question_update 的 optionLayout。CSS 支持字体、色彩、边框、底色、渐变、间距和网格，自动限制在当前卷面；正文、题目、素材和编辑能力保持不变。已打开时实时同步且可撤销，失败不写入。随后用 document_preview 查看效果并迭代。约束：${AGENT_DESIGN_GUIDE.constraints}`,
    parameters: Type.Object({
      path: PathParam, expectedRevision: RevisionParam,
      design: Type.Optional(Type.Union([Type.Object({ name: Type.Optional(Type.String({ maxLength: 180 })), css: Type.String({ maxLength: 100_000 }) }, strict), Type.Null()])),
      cssEdits: Type.Optional(Type.Array(Type.Object({ find: Type.String({ minLength: 1, maxLength: 20_000 }), replace: Type.String({ maxLength: 20_000 }) }, strict), { minItems: 1, maxItems: 30 })),
      appendCss: Type.Optional(Type.String({ minLength: 1, maxLength: 20_000 })),
      page: Type.Optional(Type.Object({
        size: Type.Optional(Type.Union([Type.Literal("A4"), Type.Literal("A3"), Type.Literal("Letter"), Type.Literal("slide"), Type.Literal("custom")], { description: "slide 为 16:9 课件，配 orientation:\"landscape\"，960×540pt" })),
        orientation: Type.Optional(Type.Union([Type.Literal("portrait"), Type.Literal("landscape")])),
        widthPt: Type.Optional(Type.Number({ minimum: 144, maximum: 14400 })), heightPt: Type.Optional(Type.Number({ minimum: 144, maximum: 14400 })),
        columnCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })), columnGapPt: Type.Optional(Type.Number({ minimum: 0 })),
        printBackground: Type.Optional(Type.Boolean()),
        marginsPt: Type.Optional(Type.Object({
          top: Type.Optional(Type.Number({ minimum: 0, maximum: 360 })), right: Type.Optional(Type.Number({ minimum: 0, maximum: 360 })),
          bottom: Type.Optional(Type.Number({ minimum: 0, maximum: 360 })), left: Type.Optional(Type.Number({ minimum: 0, maximum: 360 }))
        }, strict)),
        // Models often write a margin straight on the page; it means the same as marginsPt.
        ...Object.fromEntries(["top", "right", "bottom", "left"].map(side => [side, Type.Optional(Type.Number({ minimum: 0, maximum: 360, description: `同 marginsPt.${side}` }))]))
      }, strict)),
      metadata: Type.Optional(Type.Object({
        year: Type.Optional(Type.Union([Type.Integer({ minimum: 1990, maximum: 2100 }), Type.Null()])),
        grade: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 12 }), Type.Null()]))
      }, strict)),
      boxStyles: Type.Optional(Type.Record(Type.String({ pattern: "^[A-Za-z0-9._-]{1,80}$" }), Type.Union([BoxStyle,
        Type.String({ minLength: 1, maxLength: 40, description: "也可以是预设盒子样式的名称（如“方格纸”“便签”，见 guide.boxStyle）" }),
        Type.Null()]), { description: "按名称新增或替换盒子样式，null 删除未使用的样式；再用 content_update 的 {id:盒子id, style} 给盒子换上" })),
      questionStyles: Type.Optional(Type.Record(Type.String({ pattern: "^[A-Za-z0-9._-]{1,80}$" }), Type.Union([Type.Object({ ...BoxStyle.properties,
        gapPt: Type.Optional(Type.Number({ minimum: 0 })), breakInside: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("avoid")])),
        breakBefore: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("page")], { description: "page：用这个样式的每道题另起一页（课件一页一题）" })) }, strict), Type.Null()]),
        { description: "按名称新增或替换题目样式，带 frame 的就是题框（如例题框），再用 question_update 的 styleRef 给需要的题使用；null 删除未使用的样式" })),
      boxStyleRef: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "没有指定样式的盒子使用的样式名" })),
      headerFooter: Type.Optional(Type.Union([Type.Object({
        header: Type.Optional(RunningLine), footer: Type.Optional(RunningLine),
        differentFirstPage: Type.Optional(Type.Boolean({ description: "首页（如封面）不显示页眉页脚" })),
        fontFamilies: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 6 })),
        fontSizePt: Type.Optional(Type.Number({ minimum: 6, maximum: 24 })), color: Type.Optional(Color), ruleColor: Type.Optional(Color)
      }, strict), Type.Null()], { description: "完整替换页眉页脚；文字中 {page}、{pages}、{title} 自动替换为页码、总页数、文档标题；null 恢复页脚居中“第 N 页／共 M 页”，{} 不显示" })),
      headingNumbering: Type.Optional(Type.Union([Type.Object({
        style: Type.Union([Type.Literal("decimal"), Type.Literal("chinese")], { description: "decimal：1、1.1、1.1.1；chinese：一、（一）、1." }),
        fromLevel: Type.Optional(Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3)], { description: "从几级标题开始编号，默认 2（一级标题通常是文档名）" }))
      }, strict), Type.Null()], { description: "标题自动编号，null 关闭；开启前去掉标题文字中手写的编号" })),
      questionNumbering: Type.Optional(Type.Union([Type.Object({
        style: Type.Optional(Type.Union(["dot", "comma", "paren", "circle", "plain"].map(value => Type.Literal(value)), { description: "大题号写法：dot 1.（默认）、comma 1、、paren (1)、circle ①、plain 只写数字（配 frame）" })),
        subStyle: Type.Optional(Type.Union(["paren", "dot", "circle"].map(value => Type.Literal(value)), { description: "题组中的小题号：paren (1)（默认）、dot 1.、circle ①" })),
        fontWeight: Type.Optional(Type.Union([Type.Literal("normal"), Type.Literal("bold")], { description: "默认 bold" })),
        color: Type.Optional(Color),
        frame: Type.Optional(Type.Boolean({ description: "数字放在细框里" }))
      }, strict), Type.String({ minLength: 1, maxLength: 20, description: "也可以是预设名称，如“常规”“圆圈”，见 guide.questionNumbering" }), Type.Null()], { description: "全卷题号的写法和样子，null 恢复标准（加粗的“1.”，小题“(1)”）" })),
      cover: Type.Optional(Type.Union([Type.Object({
        title: Type.Optional(Type.String({ maxLength: 60, description: "标题，省略时用文档标题，\"\" 不显示" })),
        subtitle: Type.Optional(Type.String({ maxLength: 60 })),
        subject: Type.Optional(Type.String({ maxLength: 40, description: "学科年级，如“高二数学”" })),
        author: Type.Optional(Type.String({ maxLength: 40, description: "学校或教师" })),
        date: Type.Optional(Type.String({ maxLength: 40 })),
        style: Type.Optional(Type.Union([Type.Object({
          align: Type.Optional(Type.Union([Type.Literal("center"), Type.Literal("left")])),
          titleTop: Type.Optional(Type.Number({ minimum: .08, maximum: .8, description: "标题在页面高度的位置，默认 0.34" })),
          titleSizePt: Type.Optional(Type.Number({ minimum: 12, maximum: 72 })),
          titleWeight: Type.Optional(Type.Union([Type.Literal("normal"), Type.Literal("bold")])),
          titleColor: Type.Optional(Color), color: Type.Optional(Color),
          fontFamilies: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 6 })),
          svg: Type.Optional(Type.String({ minLength: 4, maxLength: 60_000, description: "铺满整张纸、在文字下方的底图；规则同 pageDecorations 的 svg" }))
        }, strict), Type.String({ minLength: 1, maxLength: 20, description: "也可以是预设名称，如“细框”“深色”，见 guide.cover" })], { description: "封面的外观，不改文字" }))
      }, strict), Type.Null()], { description: "封面，完整替换；{} 为标准样子，null 去掉。封面单独占第一页，不显示页眉页脚，正文页码从 1 起算" })),
      tableOfContents: Type.Optional(Type.Union([Type.Object({
        levels: Type.Optional(Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3)], { description: "列出的标题级数，从列出的最高一级算起，默认 2" })),
        title: Type.Optional(Type.String({ maxLength: 20, description: "默认“目录”，\"\" 不显示" })),
        style: Type.Optional(Type.Union([Type.Object({
          leader: Type.Optional(Type.Union([Type.Literal("dots"), Type.Literal("line"), Type.Literal("none")], { description: "条目到页码之间：dots 点线（默认）、line 细线、none 无" })),
          titleAlign: Type.Optional(Type.Union([Type.Literal("center"), Type.Literal("left")])),
          firstLevelBold: Type.Optional(Type.Boolean()),
          color: Type.Optional(Color), accentColor: Type.Optional(Color),
          fontFamilies: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 6 }))
        }, strict), Type.String({ minLength: 1, maxLength: 20, description: "也可以是预设名称，如“细线”“蓝色”，见 guide.tableOfContents" })], { description: "目录的外观" }))
      }, strict), Type.Null()], { description: "目录，完整替换；{} 为标准样子，null 去掉。排在封面之后、正文之前，按标题自动生成并带页码" })),
      pageDecorations: Type.Optional(Type.Union([Type.Array(Type.Object({
        place: Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("content")], { description: "left/right 为左右页边（卷头、装订线、侧栏），content 为正文区域下方（水印、正文外框）" }),
        pages: Type.Optional(Type.Union(["all", "first", "rest", "odd", "even"].map(value => Type.Literal(value)), { description: "默认 all；rest 为首页以外；content 只能 all 或 first" })),
        svg: Type.String({ minLength: 4, maxLength: 60_000, description: "铺满该区域的完整 SVG（viewBox 用区域大小 pt，或用百分比布局）；{title} 替换为文档标题" })
      }, strict), { maxItems: 12 }), Type.Null()], { description: "页面装饰（画在纸张上的卷头、密封线、侧栏、水印等），完整替换现有装饰，null 删除全部" })),
      saveLayoutAs: Type.Optional(Type.String({ minLength: 1, maxLength: 40, description: "把修改后的这份文档的外观保存为老师的版式，所有工作区可用，以后用 layout:{name} 套用；同名覆盖，不能用内置版式的名字" })),
      layout: Type.Optional(Type.Union([
        Type.Object({ name: Type.String({ minLength: 1, description: "版式名称，见 document_style_read 的 layouts" }) }, strict),
        Type.Object({ from: Type.String({ minLength: 1, description: "另一份 ChalkLee 的工作区相对路径，套用它的版式" }) }, strict)
      ], { description: "整体套用版式（CSS、盒子样式、页眉页脚、标题编号、题号样式和纸张），盒子按标题对应同名样式；先于本次其他修改执行" }))
    }, strict),
    execute: async ({ path: candidate, expectedRevision, design, cssEdits, appendCss, page: pageInput, metadata, boxStyles, questionStyles, boxStyleRef, headerFooter, headingNumbering, questionNumbering, cover, tableOfContents, pageDecorations, layout, saveLayoutAs }, host) => {
      const page = pageInput && chalkLeeAgentPagePatch(pageInput as Record<string, unknown>);
      const patch = { ...(design !== undefined ? { design } : {}), ...(cssEdits ? { cssEdits } : {}), ...(appendCss ? { appendCss } : {}), ...(page ? { page } : {}), ...(metadata ? { metadata } : {}),
        ...(boxStyles ? { boxStyles: boxStyles as never } : {}), ...(questionStyles ? { questionStyles: questionStyles as never } : {}), ...(boxStyleRef !== undefined ? { boxStyleRef } : {}), ...(headerFooter !== undefined ? { headerFooter: headerFooter as never } : {}),
        ...(headingNumbering !== undefined ? { headingNumbering: headingNumbering as never } : {}), ...(questionNumbering !== undefined ? { questionNumbering: questionNumbering as never } : {}), ...(cover !== undefined ? { cover: cover as never } : {}), ...(tableOfContents !== undefined ? { tableOfContents: tableOfContents as never } : {}), ...(pageDecorations !== undefined ? { pageDecorations: pageDecorations as never } : {}) };
      const updated = layout || saveLayoutAs
        ? await host.documents.updateStyle(candidate, expectedRevision, patch, layout, saveLayoutAs)
        : await host.documents.updateStyle(candidate, expectedRevision, patch);
      const savedLayout = "savedLayout" in updated ? updated.savedLayout : undefined;
      // Only what this change wrote: earlier CSS was warned about when it was written.
      const internal = agentDesignInternalSelectors([design?.css, appendCss, ...(cssEdits ?? []).map(edit => edit.replace)].filter(Boolean).join("\n"));
      const selectorWarning = internal.length ? `已保存。${internal.join("、")} 是应用内部的类名，升级后可能失效；请改用 document_style_read 的 guide.selectors 中的选择器（如 [data-chalklee-question]、[data-chalklee-option-label]）。` : undefined;
      return output(written(host, updated, { ...(savedLayout ? { savedLayout } : {}), ...(selectorWarning ? { selectorWarning } : {}) }),
        { documents: [documentRef(updated.path)], ...(savedLayout ? { summary: `已保存为“${savedLayout}”，以后可以直接说用这个样式` } : {}) });
    }
  }),
  defineTool({
    name: "document_preview", label: "查看页面", surfaces: BOTH, kind: "read",
    description: "查看文档页面，每次最多 3 页，页码从 1 开始，省略 pages 查看前 3 页。ChalkLee：用真实编辑器和打印链路渲染，返回页面截图、真实总页数、核对 audit 和全部页面的分页报告 layout（used 为每页正文用了多少，0～1；split 为从一页延续到下一页的题目和盒子，fitsOnPage 表示一页放得下；strandedHeadings 为落在页底、与下文分开的标题；tooWide 为超出正文宽度的图片和表格）；unmatchedCss 列出文档 CSS 中在卷面上一个元素也没选中的选择器，改了样式页面却没变时先看它，按 html:true 返回的实际结构换写法。用于检查排版、分页和题目是否完整；包含已打开编辑器中未保存的修改，不写文件；html:true 另外返回实际卷面 HTML，便于选择 CSS 目标（不用于替换内容）；可传 expectedRevision 保证预览的版本；“技能”文件夹中的 ChalkLee 另返回全文 text。PDF 原稿：返回页面截图和页面文字（扫描件没有文字时看截图），用于判断是哪份试卷、核对转换结果。DOC、DOCX 原稿：返回正文文字（不分页，最多 8000 字）。Markdown：返回完整原文和 revision，含未保存内容，用 html_update 修改。HTML 网页：在 1280×800 的屏幕上运行后截图，pages 指第几屏（默认第 1 屏），返回总屏数 screenCount、页面报错 errors（脚本错误、加载失败的图片和脚本）和 revision（html_update 修改时传入）；html:true 另外返回完整源码，修改前用它读取；steps 在截图前依次点击（click 写选择器或按钮文字，clickAt 写坐标）、填写、按键、等待，用于检查点击后的效果，某步做不到时停在那里并写入 errors。",
    notes: { mcp: "无需本地命令、浏览器调试或转换会话。" },
    parameters: Type.Object({
      path: PathParam, expectedRevision: Type.Optional(Revision), pages: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1, maxItems: 3 })),
      html: Type.Optional(Type.Boolean({ default: false })),
      steps: Type.Optional(Type.Array(Type.Union([
        Type.Object({ click: Type.String({ minLength: 1, maxLength: 300, description: "CSS 选择器，或按钮、链接等控件上的文字" }) }, strict),
        Type.Object({ clickAt: Type.Object({ x: Type.Number({ minimum: 0, maximum: 1280 }), y: Type.Number({ minimum: 0, maximum: 800 }) }, strict) }, strict),
        Type.Object({ fill: Type.String({ minLength: 1, maxLength: 300, description: "输入框的 CSS 选择器、name、id、placeholder 或标签文字" }), value: Type.String({ maxLength: 2000 }) }, strict),
        Type.Object({ press: Type.String({ minLength: 1, maxLength: 20, description: "按键，如 Enter、Space、ArrowRight 或单个字符" }) }, strict),
        Type.Object({ wait: Type.Integer({ minimum: 0, maximum: 5000, description: "等待毫秒数" }) }, strict)
      ]), { minItems: 1, maxItems: HTML_PAGE_MAX_STEPS }))
    }, strict),
    execute: async ({ path: candidate, pages, expectedRevision, html, steps }, host, signal) => {
      const info = await host.documents.info(candidate);
      if (isHtmlKind(info.kind)) {
        const page = await host.documents.previewPage(info.path, pages, steps);
        signal?.throwIfAborted();
        const shots = page.shots, truncated = page.html.length > HTML_PREVIEW_CHARS;
        return output({
          path: relative(host.root, page.path), kind: info.kind, revision: page.revision,
          ...(shots ? { title: shots.title, viewport: shots.viewport, screenCount: shots.screenCount, screens: shots.images.map(image => image.screen), errors: shots.errors,
            ...(shots.loadProblem ? { loadProblem: shots.loadProblem } : {}) } : { note: "当前环境无法渲染网页，只返回源码。" }),
          ...(html || !shots ? { html: page.html.slice(0, HTML_PREVIEW_CHARS), ...(truncated ? { truncated, length: page.html.length } : {}) } : {})
        }, { documents: [documentRef(page.path)] }, (shots?.images ?? []).flatMap(image => dataImage(image.dataUrl)));
      }
      if (steps) throw new Error("steps 只用于 HTML 网页。");
      if (isConvertibleKind(info.kind)) {
        const source = await host.documents.previewSource(info.path, pages, signal);
        signal?.throwIfAborted();
        const shots = ("images" in source ? source.images : undefined) ?? [];
        return output({
          path: relative(host.root, source.path), kind: source.kind,
          ...("pageCount" in source ? { pageCount: source.pageCount, pages: shots.map(shot => ({ page: shot.page, text: shot.text || "（本页没有文字层，可能是扫描件，请看截图）" })) } : {}),
          ...("text" in source ? { paragraphs: source.paragraphs, text: source.text, truncated: source.truncated } : {}),
          ...("revision" in source ? { revision: source.revision } : {})
        }, { documents: [documentRef(source.path)] }, shots.flatMap(shot => dataImage(shot.dataUrl)));
      }
      const preview = await host.documents.previewDocument(candidate, pages, expectedRevision, signal) as unknown as {
        path: string; revision: string; pageCount: number; audit?: unknown; layout?: unknown; unmatchedCss?: string[]; renderedHtml?: string; htmlTruncated?: boolean; previewUrl?: string; images?: Array<{ page: number; dataUrl: string }>;
      };
      signal?.throwIfAborted();
      // A skill is read through, so its words come whole rather than only as pictures of its pages.
      const skill = await isWorkspaceSkill(host.root, preview.path) ? await host.documents.readText(preview.path) : null;
      const images = (preview.images ?? []).flatMap(image => dataImage(image.dataUrl));
      return output({
        path: relative(host.root, preview.path), revision: preview.revision, pageCount: preview.pageCount, pages: (preview.images ?? []).map(image => image.page), audit: preview.audit,
        ...(skill ? { text: skill.text, ...(skill.truncated ? { textTruncated: true } : {}) } : {}),
        ...(preview.layout ? { layout: preview.layout } : {}), ...(preview.unmatchedCss?.length ? { unmatchedCss: preview.unmatchedCss } : {}),
        ...(html ? { renderedHtml: preview.renderedHtml, htmlTruncated: preview.htmlTruncated } : {}), ...(host.surface === "mcp" && preview.previewUrl ? { previewUrl: preview.previewUrl } : {})
      }, { documents: [documentRef(preview.path)] }, images);
    }
  }),
  defineTool({
    name: "html_update", label: "修改网页或笔记", surfaces: BOTH, kind: "write",
    description: "修改工作区中的 HTML 网页或 Markdown 文档。先用 document_preview 读取全文和 revision（HTML 加 html:true）；Markdown 用 markdown 传完整原文或 edits 逐处替换，已打开的笔记保留未保存内容并可撤销。小改动用 edits 逐处替换（find 按源码原样复制且只出现一次），大改动用 html 传入完整新源码，二者选一。网页已被其他人修改时拒绝写入，需重新读取。已打开的网页会自动刷新。改完用 document_preview 看效果和 errors；返回的新 revision 可直接用于下一次修改。",
    notes: { assistant: "老师的一次请求中改过的网页和笔记可用回复下方的“撤销这次修改”恢复。" },
    parameters: Type.Object({
      path: PathParam, revision: Type.String({ pattern: "^[a-f0-9]{16}$", description: "document_preview 返回的 revision" }),
      html: Type.Optional(Type.String({ minLength: 1, maxLength: HTML_PAGE_MAX_CHARS })),
      markdown: Type.Optional(Type.String({ maxLength: 10_000_000, description: "完整的 Markdown 原文；小改动用 edits" })),
      edits: Type.Optional(Type.Array(Type.Object({ find: Type.String({ minLength: 1, maxLength: 100_000 }), replace: Type.String({ maxLength: HTML_PAGE_MAX_CHARS }) }, strict), { minItems: 1, maxItems: 30 }))
    }, strict),
    execute: async ({ path: candidate, revision, html, markdown, edits }, host) => {
      if (html !== undefined && markdown !== undefined) throw new Error("html 与 markdown 只能提供一种。");
      const saved = await host.documents.updatePage(candidate, revision, { html: markdown ?? html, edits });
      return output({ path: relative(host.root, saved.path), revision: saved.revision, size: saved.size }, { documents: [documentRef(saved.path)] });
    }
  }),
  defineTool({
    name: "document_export", label: "导出文档", surfaces: BOTH, kind: "write",
    description: "把 ChalkLee 导出为 PDF 或可编辑的 Word（format:docx），默认 PDF，与工具栏使用相同的导出方式。保存在该文档所在文件夹，不覆盖已有文件。answers、analysis 控制是否保留答案和解析：学生版两者都设为 false，教师版保留默认 true。solutionPlacement 选 after-question 放在题后，或选 end 在卷末另页汇总，保留题号；默认放在题后。未指定 name 时自动命名，如“期中（学生版）.docx”。包含已打开编辑器中未保存的修改。Word 保留内容和基础排版，自定义 CSS 不直接转为 Word 样式。",
    parameters: Type.Object({
      path: PathParam, answers: Type.Optional(Type.Boolean({ default: true })), analysis: Type.Optional(Type.Boolean({ default: true })),
      format: Type.Optional(Type.Union([Type.Literal("pdf"), Type.Literal("docx")], { default: "pdf" })),
      solutionPlacement: Type.Optional(Type.Union([Type.Literal("after-question"), Type.Literal("end")], { default: "after-question", description: "答案与解析放在每道题后，或在试卷末尾另页汇总" })),
      name: Type.Optional(Type.String({ minLength: 1, maxLength: 180, description: "导出文件名，不含扩展名" }))
    }, strict),
    execute: async ({ path: candidate, answers, analysis, name, format, solutionPlacement }, host) => {
      const exported = await host.documents.exportDocument(candidate, { answers: answers ?? true, analysis: analysis ?? true, name, format, solutionPlacement });
      return output({ exported: relative(host.root, exported.path), from: relative(host.root, exported.source), kb: Math.max(1, Math.round(exported.bytes / 1024)) },
        { documents: [documentRef(exported.path)], summary: `已导出 ${format === "docx" ? "Word" : "PDF"}` });
    }
  }),
  defineTool({
    name: "document_show", label: "打开文档", surfaces: WITH_PLUGINS, kind: "read",
    description: "在 ChalkLee 中间区域打开文档给用户看；传 questionId 时定位并选中该题，传 page 时跳到 PDF 页码。修改文档本身不需要先打开。",
    notes: { mcp: "需要打开 ChalkLee 窗口；要在浏览器中打开用 document_open。" },
    parameters: Type.Object({ path: PathParam, questionId: Type.Optional(Type.String()), page: Type.Optional(Type.Integer({ minimum: 1 })) }, strict),
    execute: async ({ path: candidate, questionId, page }, host) => {
      const file = (await host.documents.info(candidate)).path;
      await requireApp(host).ui({ action: "open", path: file, questionId, page });
      return output({ opened: relative(host.root, file), questionId }, { documents: [documentRef(file, questionId)] });
    }
  }),
  defineTool({
    name: "document_info", label: "查看文档信息", surfaces: MCP, kind: "read",
    description: "查看文档或目录的位置、类型、大小、修改时间及可编辑状态，不触发转换。",
    parameters: Type.Object({ path: PathParam }, strict),
    execute: async ({ path: candidate }, host) => {
      const info = await host.documents.info(candidate);
      return output({ ...info, path: relative(host.root, info.path) });
    }
  }),
  defineTool({
    name: "document_read", label: "读取文档内容", surfaces: MCP, kind: "read",
    description: "读取现有 ChalkLee 的磁盘内容、文档属性与素材清单，不创建转换会话。未保存编辑不包含在内；PDF/DOC/DOCX/LaTeX 原稿内容用 conversion_open、read_source；Markdown 用 document_preview 读取完整原文和 revision。",
    parameters: Type.Object({ path: PathParam }, strict),
    execute: async ({ path: candidate }, host) => {
      const read = await host.documents.readDocument(candidate);
      return output({ ...read, path: relative(host.root, read.path) });
    }
  }),
  defineTool({
    name: "document_import", label: "导入文档", surfaces: MCP, kind: "write", openWorld: true,
    description: "将本地 PDF、DOC、DOCX、LaTeX、Markdown、HTML 或 ChalkLee 复制导入当前工作区，保留源文件，重名创建导入副本。导入不会自动转换。",
    parameters: Type.Object({ sourcePath: Type.String({ minLength: 1 }), directory: Type.Optional(Type.String({ default: "." })), name: Type.Optional(Type.String()) }, strict),
    execute: async ({ sourcePath, directory, name }, host) => output(await host.documents.importDocument(sourcePath, directory ?? ".", name))
  }),
  defineTool({
    name: "document_open", label: "浏览器打开", surfaces: MCP, kind: "read",
    description: "返回独立文档视图的浏览器 URL：PDF/DOC/DOCX/LaTeX 只读预览、HTML 网页可交互预览、Markdown 和 ChalkLee 可编辑，不显示工作区侧栏；省略 path 打开完整工作区。普通打开不会创建转换会话。客户端须自行打开返回 URL。",
    parameters: Type.Object({ path: Type.Optional(Type.String()) }, strict),
    execute: async ({ path: candidate }, host) => output(await requireExternal(host).service.editorUrl(candidate))
  })
];
