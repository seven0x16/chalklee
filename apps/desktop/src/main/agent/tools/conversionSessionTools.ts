import { createHash } from "node:crypto";
import { Type } from "typebox";
import guide from "../externalAgentGuide.md?raw";
import { SourceFragmentEditSchema } from "../../conversion/referenceSources";
import { ExternalPdfSourcePageSchema } from "../../conversion/externalPdfSources";
import type { PixelBox } from "../../conversion/crop";
import { TRANSCRIBE_PROMPT } from "../../conversion/transcript";
import { ASSEMBLY_LAYOUT_RULES, ASSEMBLY_STRUCTURE_RULES } from "../../conversion/assemblyRules";
import { MCP, defineTool, output, requireExternal, strict, type ChalkLeeTool } from "./toolKit";

// The same recognition and assembly rules ChalkLee AI follows.
export const EXTERNAL_AGENT_GUIDE = guide.replace("<!-- PDF_TRANSCRIBE_GUIDE -->", TRANSCRIBE_PROMPT)
  .replace("<!-- ASSEMBLY_LAYOUT_RULES -->", ASSEMBLY_LAYOUT_RULES).replace("<!-- ASSEMBLY_STRUCTURE_RULES -->", ASSEMBLY_STRUCTURE_RULES);
// Content-derived version changes whenever the bundled instructions change.
export const EXTERNAL_AGENT_GUIDE_VERSION = `sha256:${createHash("sha256").update(EXTERNAL_AGENT_GUIDE).digest("hex")}`;

const SessionId = Type.String({ pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" });
const Identifier = Type.String({ pattern: "^[a-zA-Z0-9_-]{1,80}$" });
// MCP clients may discard tools whose array items use tuple schemas. Image bounds and ordering are checked by pixelCropBox.
const Box = Type.Unsafe<PixelBox>(Type.Array(Type.Integer({ minimum: 0 }), {
  minItems: 4, maxItems: 4, description: "原像素坐标 [left, top, right, bottom]，right > left，bottom > top。"
}));
const withGuide = (value: object) => ({ ...value, guideTool: "conversion_guide", authoringGuideVersion: EXTERNAL_AGENT_GUIDE_VERSION });

/** External page recognition and shared reference assembly in a resumable session. */
export const CONVERSION_SESSION_TOOLS: ChalkLeeTool[] = [
  defineTool({
    name: "conversion_guide", label: "转换指南", surfaces: MCP, kind: "read",
    description: "用户要求将 PDF、DOC、DOCX、LaTeX 或 Markdown 转为 ChalkLee 时，先调用此工具读取当前应用的完整转换流程、内容格式与核对要求。无需参数，仅用于复杂转换流程；日常文档管理直接使用对应工具。",
    parameters: Type.Object({}, strict),
    execute: async () => output({ guideVersion: EXTERNAL_AGENT_GUIDE_VERSION, instructions: EXTERNAL_AGENT_GUIDE })
  }),
  defineTool({
    name: "conversion_open", label: "建立转换会话", surfaces: MCP, kind: "write",
    description: "建立按原稿引用转换的可恢复会话，先读 conversion_guide。DOC/DOCX/LaTeX/Markdown 直接提供 ref；PDF 先通过 write_fragments.sourcePages 保存各页原生确认或视觉转录，全部固定后按 ref 组题。返回精简页目录、建议识别方式、准备进度及指南版本；完整指南只需读取一次。普通打开用 document_open。",
    parameters: Type.Object({ path: Type.String({ minLength: 1 }) }, strict),
    execute: async ({ path }, host) => { const { service, agent } = requireExternal(host); return output(withGuide(await service.openDocument(path, agent))); }
  }),
  defineTool({
    name: "list_import_sessions", label: "转换会话列表", surfaces: MCP, kind: "read",
    description: "列出当前工作区的持久外部转换会话，便于中断后恢复；stopped 表示用户已在 ChalkLee 中停止，不能继续。",
    parameters: Type.Object({}, strict),
    execute: async (_args, host) => output(await requireExternal(host).service.listSessions())
  }),
  defineTool({
    name: "read_source", label: "读取原稿", surfaces: MCP, kind: "read",
    description: "读取原稿：PDF 准备期间返回整页、候选文字和图片信息，sourcePages 全部固定后与 DOC/DOCX/LaTeX/Markdown 一样返回 ref、文字、版式标签和图片元数据；局部修订需要节点路径时加 includeContent:true 取得工作片段。按需指定 sourceImageId 查看实际原图（PDF 整页 ID 为 unitId）。box 只供局部放大，不能代替完整原页。坐标为原像素 [left,top,right,bottom]，实际图像每次最多三张，固定引用每次最多十二个部分。",
    parameters: Type.Object({ sessionId: SessionId, sources: Type.Array(Type.Object({ unitId: Identifier, sourceImageId: Type.Optional(Identifier), box: Type.Optional(Box) }, strict), { minItems: 1, maxItems: 12 }),
      includeContent: Type.Optional(Type.Boolean({ default: false })) }, strict),
    execute: async ({ sessionId, sources, includeContent }, host) => output(await requireExternal(host).service.readSource(sessionId, sources, includeContent ?? false))
  }),
  defineTool({
    name: "crop_figures", label: "裁取配图", surfaces: MCP, kind: "write",
    description: "创建或替换配图，box 使用原像素 [left,top,right,bottom]。每个裁图结果包含裁片、红框对照、sourcePixelSize、cutEdges 和更新后的 revision，可直接用于下一次 write_fragments。文字、公式和表格不要截图。",
    parameters: Type.Object({ sessionId: SessionId, figures: Type.Array(Type.Object({
      id: Identifier, unitId: Identifier, sourceImageId: Type.Optional(Identifier), box: Box, alt: Type.String({ maxLength: 500 }), widthPt: Type.Optional(Type.Number({ minimum: 12, maximum: 1000 }))
    }, strict), { minItems: 1, maxItems: 6 }) }, strict),
    execute: async ({ sessionId, figures }, host) => output(await requireExternal(host).service.cropFigures(sessionId, figures))
  }),
  defineTool({
    name: "write_fragments", label: "写入转换片段", surfaces: MCP, kind: "write",
    description: '保存转换进度，失败整批回滚。PDF 先单独提交 sourcePages：native 确认原生文字/图片，或 transcript 提交完整页转录。全部固定后 read_source 读取 ref；各格式 fragments.blocks 都按 ref 组题，不重抄内容。sourceEdits 可在交付前修订工作片段，原图依据须先显式查看。expectedRevision 使用最新 revision；完整说明在 conversion_guide。',
    parameters: Type.Object({
      sessionId: SessionId, expectedRevision: Type.Integer({ minimum: 0 }),
      sourcePages: Type.Optional(Type.Array(ExternalPdfSourcePageSchema, { minItems: 1, maxItems: 3 })),
      fragments: Type.Optional(Type.Array(Type.Object({
        key: Identifier, order: Type.Number(), unitIds: Type.Array(Identifier, { minItems: 1 }), blocks: Type.Array(Type.Record(Type.String(), Type.Unknown()), { minItems: 1 }),
        continuesPrevious: Type.Optional(Type.Boolean({ default: false })), warnings: Type.Optional(Type.Array(Type.String({ maxLength: 1000 }), { default: [] }))
      }, strict), { minItems: 1, maxItems: 6 })),
      edits: Type.Optional(Type.Array(Type.Object({ key: Identifier, path: Type.Array(Type.Union([Type.String(), Type.Integer({ minimum: 0 })]), { minItems: 2, maxItems: 24 }), expected: Type.Unknown(), value: Type.Unknown() }, strict), { minItems: 1, maxItems: 30 })),
      sourceEdits: Type.Optional(Type.Array(SourceFragmentEditSchema, { minItems: 1, maxItems: 30 })),
      removeKeys: Type.Optional(Type.Array(Identifier, { minItems: 1 })),
      layout: Type.Optional(Type.Object({
        fontSizePt: Type.Optional(Type.Number({ minimum: 10, maximum: 16 })), lineHeight: Type.Optional(Type.Number({ minimum: 1.2, maximum: 2 })),
        paragraphSpaceAfterPt: Type.Optional(Type.Number({ minimum: 0, maximum: 12 })), questionGapPt: Type.Optional(Type.Number({ minimum: 0, maximum: 18 }))
      }, strict))
    }, strict),
    execute: async ({ sessionId, ...update }, host) => output(await requireExternal(host).service.writeFragments(sessionId, update as never))
  }),
  defineTool({
    name: "read_draft", label: "读取转换草稿", surfaces: MCP, kind: "read",
    description: "读取已保存的转换内容、revision、原稿目录、内容准备进度及剩余问题，供当前或另一个外部 AI 接手续转；先读 conversion_guide，沿用同一 sessionId，不另建会话。齐备时返回 tagging，使用同一知识点目录给题目分类，随 finish 提交。keys 可指定片段。",
    parameters: Type.Object({ sessionId: SessionId, keys: Type.Optional(Type.Array(Identifier)) }, strict),
    execute: async ({ sessionId, keys }, host) => output(await requireExternal(host).service.readDraft(sessionId, keys))
  }),
  defineTool({
    name: "preview_document", label: "预览转换结果", surfaces: MCP, kind: "read",
    description: "用真实 ChalkLee 编辑器生成成品 PDF，返回截图与渲染检查。audit 比对当前 ChalkLee 与打印结果，不验证原稿内容齐备。修改后重新渲染，每次最多三页。",
    parameters: Type.Object({ sessionId: SessionId, pages: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1, maxItems: 3 })) }, strict),
    execute: async ({ sessionId, pages }, host) => output(await requireExternal(host).service.preview(sessionId, pages))
  }),
  defineTool({
    name: "finish", label: "完成转换", surfaces: MCP, kind: "write",
    description: "来源引用齐备后，自动渲染当前版本并检查排版，保存 ChalkLee 和转换记录，返回编辑 URL；无需逐页调用 preview_document。返回带 id 的问题时逐条处理，核对原稿后确属原稿如此的，在 keep 中写这一条的 id 和 reason。直接交付，不追加独立校对。用户另行明确要求校对时可再次完成旧会话，保留用户改过的题。draft:true 保留已有内容和未转换原页，保存未完成草稿。",
    parameters: Type.Object({ sessionId: SessionId, agentName: Type.String({ minLength: 1, maxLength: 100 }), draft: Type.Optional(Type.Boolean({ default: false })),
      keep: Type.Optional(Type.Array(Type.Object({ id: Type.String({ pattern: "^chk_[0-9a-f]{8}$" }), reason: Type.String({ minLength: 6, maxLength: 300 }) }, strict), { maxItems: 200 })),
      tags: Type.Optional(Type.Object({ revision: Type.Integer({ minimum: 0 }), tags: Type.Record(Type.String(), Type.Array(Type.String({ maxLength: 100 }), { maxItems: 3 })),
        groups: Type.Optional(Type.Record(Type.String(), Type.Array(Type.String({ maxLength: 100 }), { maxItems: 12 }))) }, strict)) }, strict),
    execute: async ({ sessionId, agentName, draft, tags, keep }, host) => output(await requireExternal(host).service.finish(sessionId, agentName, draft ?? false, tags, keep))
  })
];
