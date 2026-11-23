import path from "node:path";
import { Type } from "typebox";
import type { DocumentVersions } from "../../../shared/document/versions";
import { QUESTION_BANK_TYPES, QUESTION_BANK_TYPE_LABELS, QUESTION_DIFFICULTY_LABELS } from "../../../shared/questionBank/search";
import { MAX_MEMORY_LENGTH } from "../assistant/memory";
import { ASSISTANT, BOTH, PathParam, WITH_PLUGINS, defineTool, documentRef, output, relative, requireApp, strict, type BankInsertResult, type ChalkLeeTool, type ToolHost } from "./toolKit";
import { organizeConfirmation, organizePreview, planOrganize, runOrganize, undoOrganize } from "./workspaceOrganize";
import { planTagEdit, runTagEdit, tagEditConfirmation, tagTreeListing, undoTagEdit } from "./questionTags";
import { conversionActionConfirmation, conversionConfirmation, markOriginals, MAX_CONVERSIONS, planConversionAction, planConversions, runConversionAction, startConversions } from "./conversionPlan";
import { conversionFollowUp, conversionFollowUpText, conversionUnfinished, type ConversionTask } from "../../../shared/conversion/tasks";

const conversionDetail = (task: ConversionTask) => {
  const followUp = conversionFollowUp(task);
  return followUp ? conversionFollowUpText(followUp) : task.status === "draft" ? conversionUnfinished(task).detail : task.error;
};

const QuestionRef = Type.Object({ path: PathParam, questionId: Type.String({ minLength: 1 }) }, strict);
const trashName = () => process.platform === "darwin" ? "废纸篓" : "回收站";
const absolute = async (host: ToolHost, candidate: string) => (await host.documents.info(candidate)).path;
const versionTime = (time: number) => new Date(time).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const resolveQuestions = (host: ToolHost, questions: Array<{ path: string; questionId: string }>) =>
  Promise.all(questions.map(async question => ({ path: await absolute(host, question.path), questionId: question.questionId })));

export const APP_TOOLS: ChalkLeeTool[] = [
  defineTool({
    name: "file_move", label: "移动或改名", surfaces: BOTH, kind: "write",
    description: "移动一个文件或文件夹，或改名，或两者同时进行；目标文件夹不存在会自动新建，不覆盖同名项目，不能放入自身。已打开的文档、未保存内容和撤销记录都会保留。整理多个项目（3 个以上）用 file_organize。",
    parameters: Type.Object({
      path: PathParam, directory: Type.Optional(Type.String({ description: "目标文件夹，\".\" 为工作区根目录；省略表示留在原处" })),
      name: Type.Optional(Type.String({ minLength: 1, maxLength: 180, description: "新名称，扩展名自动保留；省略表示不改名" }))
    }, strict),
    execute: async ({ path: candidate, directory, name }, host) => {
      if (directory === undefined && name === undefined) throw new Error("请提供目标文件夹 directory 或新名称 name。");
      const plan = await planOrganize(host, { moves: [{ path: candidate, to: directory ?? path.dirname(relative(host.root, await absolute(host, candidate))), name }] });
      if (!plan.moves.length) return output({ unchanged: relative(host.root, await absolute(host, candidate)) });
      const result = await runOrganize(host, plan, { single: true });
      return output({ moved: relative(host.root, path.join(plan.moves[0].directory, plan.moves[0].name)), ...(result.createdFolders.length ? { createdFolders: result.createdFolders } : {}) });
    }
  }),
  defineTool({
    name: "file_copy", label: "复制", surfaces: BOTH, kind: "write",
    description: "复制文件或文件夹到目标文件夹（省略为原位置），重名时自动生成“副本”。",
    parameters: Type.Object({ path: PathParam, directory: Type.Optional(Type.String()) }, strict),
    execute: async ({ path: candidate, directory }, host) => {
      const source = await absolute(host, candidate);
      const copied = await requireApp(host).ui<{ targetPath?: string }>({ action: "file", operation: "copy", path: source, directory: directory ? await absolute(host, directory) : path.dirname(source) });
      return output({ copy: copied.targetPath ? relative(host.root, copied.targetPath) : undefined });
    }
  }),
  defineTool({
    name: "file_trash", label: "移到废纸篓", surfaces: BOTH, kind: "destructive",
    description: "把文件或文件夹移到系统废纸篓/回收站（可在系统中恢复），与目录中删除相同：先保存未保存的修改，关联的原稿不删除。",
    notes: { assistant: "会先请用户确认。", mcp: "执行前先在对话中说明要移走什么，用户同意后再调用；删除工作区文件请用本工具，不要用命令直接删除。" },
    parameters: Type.Object({ path: PathParam }, strict),
    confirm: async ({ path: candidate }, host) => {
      const info = await host.documents.info(candidate);
      return { title: `将“${path.basename(info.path)}”移到${trashName()}`, detail: info.kind === "directory" ? "文件夹中的全部内容都会一起移走。" : undefined, action: `移到${trashName()}` };
    },
    execute: async ({ path: candidate }, host) => {
      const file = await absolute(host, candidate);
      await requireApp(host).ui({ action: "file", operation: "trash", path: file });
      return output({ trashed: relative(host.root, file) });
    }
  }),
  defineTool({
    // Moves change the tree, so external clients ask before running it, as the assistant's card does.
    name: "file_organize", label: "整理目录", surfaces: BOTH, kind: "destructive",
    description: "按一份完整方案整理工作区目录：把文件或文件夹移到目标文件夹（可同时改名，目标文件夹不存在会自动新建）、另建空文件夹、删除整理后变空的文件夹。与 ChalkLee 在同一文件夹的原稿（PDF/DOC/DOCX/LaTeX/Markdown）自动随它移动并保持原名，方案中只需列出 ChalkLee。先整体检查（来源存在、不覆盖同名、不把文件夹放入自身），确认后依次执行，与手动操作一样同步已打开的标签和路径；只移动和改名，不删除文件、不改内容，因此每次整理都能完整撤销。preview:true 只检查方案并返回去向，不移动任何文件。结果中的 organizeId 用于撤销：undo 传 organizeId 或 \"last\"，把那次整理移回原位并删除新建的空文件夹。",
    notes: {
      assistant: "内置助手会在一张卡片上请用户确认整个方案，不需要先 preview；撤销不需要确认。",
      mcp: "执行前先用 preview:true 取得方案，在对话中给用户看，用户同意后再用相同参数执行；整理和撤销后 ChalkLee 目录顶部会提示用户可以撤销。整理工作区文件请用本工具，不要用命令直接移动或改名：直接移动会让 ChalkLee 中已打开的文档不可用，也无法撤销。"
    },
    parameters: Type.Object({
      moves: Type.Optional(Type.Array(Type.Object({
        path: PathParam, to: Type.String({ minLength: 1, description: "目标文件夹（工作区相对路径，\".\" 为根目录）" }),
        name: Type.Optional(Type.String({ minLength: 1, maxLength: 180, description: "新名称，扩展名自动保留；省略保持原名" }))
      }, strict), { maxItems: 500 })),
      folders: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 200, description: "另外要新建的空文件夹" })),
      removeEmpty: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 200, description: "整理后为空就删除的文件夹；仍有内容的会保留" })),
      preview: Type.Optional(Type.Boolean({ description: "只检查方案并返回去向，不做任何改动" })),
      undo: Type.Optional(Type.String({ minLength: 1, description: "撤销一次整理：organizeId 或 \"last\"；不与其他参数同用" }))
    }, strict),
    confirm: async ({ undo, preview, ...request }, host) => undo || preview ? null : organizeConfirmation(host, await planOrganize(host, request)),
    execute: async ({ undo, preview, ...request }, host) => {
      if (undo) {
        if (request.moves?.length || request.folders?.length || request.removeEmpty?.length || preview) throw new Error("undo 不与 moves、folders、removeEmpty、preview 同用。");
        const result = await undoOrganize(host, undo);
        return output(result, { summary: `已撤销整理，移回 ${result.restored} 项` });
      }
      const plan = await planOrganize(host, request);
      if (preview) return output(organizePreview(host, plan), { summary: "已检查整理方案" });
      const { lines, ...result } = await runOrganize(host, plan);
      return output(result, { summary: `已整理 ${result.moved} 项`, organize: { id: result.organizeId, moved: result.moved, folders: result.createdFolders.length, lines } });
    }
  }),
  defineTool({
    name: "question_search", label: "搜索题库", surfaces: WITH_PLUGINS, kind: "read",
    description: `搜索当前工作区全部已保存 ChalkLee 中的题目（关键词与公式片段），可按年份、年级（1–12）、题型、难度、标签筛选；tags 传多个时题目须同时带有这些标签。年份和年级取自题目上的“初三”“2024”这类标签，其次是文档属性中的设置，再次从试卷标题、文件名、文件夹识别。题型可选：${QUESTION_BANK_TYPES.map(type => `${type.value}=${type.label}`).join("、")}。返回题目位置（path、questionId）、题干摘要与属性，以及各筛选维度的题数。`,
    parameters: Type.Object({
      query: Type.Optional(Type.String()), year: Type.Optional(Type.Integer()), grade: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })),
      type: Type.Optional(Type.String()), difficulty: Type.Optional(Type.Union([Type.Literal("easy"), Type.Literal("medium"), Type.Literal("hard")])),
      tags: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 10 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 }))
    }, strict),
    execute: async ({ limit, ...filters }, host) => {
      if (!host.app) throw new Error("搜索题库需要打开 ChalkLee 窗口。");
      const response = await host.app.searchQuestions({ query: filters.query ?? "", ...filters, type: filters.type as never, limit: limit ?? 20 });
      const clip = (text: string, size: number) => text.length > size ? `${text.slice(0, size)}…` : text;
      return output({
        total: response.total, index: response.status.state === "ready" ? undefined : `题库索引中（${response.status.indexedDocuments}/${response.status.totalDocuments}）`,
        questions: response.items.map(item => ({
          path: item.relativePath, questionId: item.questionId, document: item.documentTitle, number: item.number, type: QUESTION_BANK_TYPE_LABELS[item.type],
          stem: clip(item.stem, 200), options: item.options.length ? item.options.map(option => `${option.label}. ${clip(option.text, 40)}`).join(" ") : undefined,
          subQuestions: item.subQuestionCount || undefined, answer: item.answer ? clip(item.answer, 60) : undefined, images: item.imageCount || undefined,
          score: item.score ?? undefined, difficulty: item.difficulty ? QUESTION_DIFFICULTY_LABELS[item.difficulty] : undefined, tags: item.tags.length ? item.tags : undefined,
          years: item.years.length ? item.years : undefined, grades: item.grades.length ? item.grades : undefined, copies: item.duplicates.length || undefined
        })),
        facets: { types: response.facets.types.map(entry => `${QUESTION_BANK_TYPE_LABELS[entry.value]} ${entry.count}`), years: response.facets.years.slice(0, 12).map(entry => `${entry.value} ${entry.count}`), tags: response.facets.tags.slice(0, 20).map(entry => `${entry.value} ${entry.count}`) }
      }, { summary: `找到 ${response.total} 道题`, questionSearch: { ...filters, type: filters.type as never, total: response.total } });
    }
  }),
  defineTool({
    name: "question_basket", label: "选题篮", surfaces: WITH_PLUGINS, kind: "write",
    description: "管理选题篮（组卷用的暂存题目，随工作区保存，与界面右侧的选题篮相同）：list 查看，add/remove 按题目位置加入或移出（来自 question_search 或 document_questions），order 调整顺序（questions 中的题按给出的顺序排到最前，其余保持原顺序），clear 清空。组成新试卷用 document_create 新建后再用 question_insert 插入篮中的题。",
    parameters: Type.Object({ action: Type.Union([Type.Literal("list"), Type.Literal("add"), Type.Literal("remove"), Type.Literal("order"), Type.Literal("clear")]), questions: Type.Optional(Type.Array(QuestionRef, { maxItems: 100 })) }, strict),
    execute: async ({ action, questions }, host) => output(await requireApp(host).ui({ action: "basket", operation: action, questions: await resolveQuestions(host, questions ?? []) }))
  }),
  defineTool({
    name: "question_tags", label: "整理标签", surfaces: BOTH, kind: "destructive",
    description: "整理题库的标签树（与题库左侧标签树相同：分组像文件夹，可多层嵌套，一个标签只在一个位置；题目上只存标签名）。list 查看全部分组（path 如 \"知识点/函数\"，后附每个标签的题数）和未归组的标签。edit 一次提交完整方案，按顺序执行：rename 给标签改名或合并，tags 中的标签在所有文档的题目上改为 to，to 已存在即合并，改名后的标签沿用原来在树中的位置；groups 新建分组（parent 省略为最外层，已有同名分组则沿用）；renameGroups 给分组改名；place 把标签（tags）或分组（groups）归入 into 分组，into 为 null 移到最外层，标签不存在时新建；removeGroups 删除分组，其中题目用到的标签移到最外层，没用到的随分组删除，不改动题目。分组可用 list 返回的 id、路径或唯一的名称指定。改名、合并会跨多份文档写入，先请用户在卡片上确认；写入前保存未保存的修改并保留版本，已打开的文档可撤销。只改分组不需要确认。结果中的 tagEditId 用于撤销：undo 传 tagEditId 或 \"last\"，把那次整理改过的题目标签和标签分组恢复原样（之后又改过的保持不动）。只给个别题目加减标签用 question_update。",
    notes: { mcp: "改名或合并前先用 edit 加 preview:true 取得方案，在对话中给用户看，用户同意后再用相同参数执行。" },
    parameters: Type.Object({
      action: Type.Optional(Type.Union([Type.Literal("list"), Type.Literal("edit"), Type.Literal("undo")], { default: "list" })),
      rename: Type.Optional(Type.Array(Type.Object({
        tags: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { minItems: 1, maxItems: 50, description: "要改名或并入的标签" }),
        to: Type.String({ minLength: 1, maxLength: 200, description: "新名称，或要并入的已有标签" })
      }, strict), { maxItems: 50 })),
      groups: Type.Optional(Type.Array(Type.Object({ name: Type.String({ minLength: 1, maxLength: 50 }), parent: Type.Optional(Type.String({ minLength: 1, description: "上级分组" })) }, strict), { maxItems: 50 })),
      renameGroups: Type.Optional(Type.Array(Type.Object({ group: Type.String({ minLength: 1 }), name: Type.String({ minLength: 1, maxLength: 50 }) }, strict), { maxItems: 50 })),
      place: Type.Optional(Type.Array(Type.Object({
        tags: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 200 })),
        groups: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 50 })),
        into: Type.Union([Type.String({ minLength: 1 }), Type.Null()], { description: "目标分组；null 为最外层" })
      }, strict), { maxItems: 100 })),
      removeGroups: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 50 })),
      preview: Type.Optional(Type.Boolean({ description: "edit 时只检查方案并返回要改的内容，不做任何改动" })),
      undo: Type.Optional(Type.String({ minLength: 1, description: "action 为 undo 时：tagEditId 或 \"last\"" }))
    }, strict),
    confirm: async ({ action, undo: _undo, preview, ...request }, host) => action === "edit" && !preview ? tagEditConfirmation(await planTagEdit(host, request)) : null,
    execute: async ({ action, undo, preview, ...request }, host) => {
      if (action === "undo") {
        const result = await undoTagEdit(host, undo ?? "last");
        return output(result, { summary: `已撤销标签整理，恢复 ${result.restored} 道题` });
      }
      if (action !== "edit") {
        const listing = await tagTreeListing(host);
        return output(listing, { summary: `${listing.groups.length} 个分组` });
      }
      const plan = await planTagEdit(host, request);
      if (!plan.lines.length) return output({ done: [], note: "方案没有需要改动的内容" }, { summary: "标签无需改动" });
      if (preview) {
        const card = tagEditConfirmation(plan);
        return output({ preview: true, lines: plan.lines, ...(card ? { title: card.title, detail: card.detail } : {}) }, { summary: "已检查标签整理方案" });
      }
      const result = await runTagEdit(host, plan);
      return output(result, { summary: result.questions !== undefined ? `已整理标签，修改 ${result.questions} 道题` : `已整理标签分组 ${plan.lines.length} 项` });
    }
  }),
  defineTool({
    name: "question_insert", label: "插入题库题目", surfaces: BOTH, kind: "write",
    description: "把题库中已保存的题目（含图片、公式、表格）复制插入到目标 ChalkLee：生成新 id、自动题号、套用目标卷样式，并记录来源。会在界面打开目标文档，插入后可撤销。组卷时先用 document_create 或 content_insert 建好“一、选择题”等大题标题，再把各类题插到对应标题或题目之后；after 省略时插到文末。",
    parameters: Type.Object({
      path: Type.String({ minLength: 1, description: "目标 ChalkLee" }), questions: Type.Array(QuestionRef, { minItems: 1, maxItems: 60 }),
      after: Type.Optional(Type.String({ minLength: 1, description: "插在这个标题、段落或题目之后（id 来自 document_outline，题组内的小题除外）" }))
    }, strict),
    execute: async ({ path: candidate, questions, after: afterQuestionId }, host) => {
      const target = await absolute(host, candidate);
      if (!target.toLowerCase().endsWith(".chalklee")) throw new Error("只能插入到 ChalkLee 文档。");
      // Through the window, as from the basket, so an open paper takes the questions with its unsaved work and undo.
      if (!host.app) throw new Error("插入题库题目需要打开 ChalkLee 窗口。");
      const value = await host.app.ui<BankInsertResult>({ action: "insert-bank-questions", path: target, questions: await resolveQuestions(host, questions), afterQuestionId });
      return output({ path: relative(host.root, target), ...value }, { documents: [documentRef(target, value.questionIds?.[0])] });
    }
  }),
  defineTool({
    name: "document_versions", label: "版本历史", surfaces: BOTH, kind: "destructive",
    description: "ChalkLee 和网页的版本历史（自动保存，与文档属性中的“版本历史”相同；网页在 AI 修改前和恢复前保存）：list 列出版本（最新在前，含时间、来由和题数）；copy 把某个版本另存为原文档旁的副本，原文档不变；restore 把文档恢复到某个版本，恢复前当前内容会先保存为一个版本，可再恢复回来，会先请用户确认。老师说“改坏了”“回到上午那版”时先 list 再按时间选版本。",
    notes: { mcp: "restore 前先在对话中说明要恢复到哪个时间的版本，用户同意后再调用。" },
    parameters: Type.Object({
      action: Type.Union([Type.Literal("list"), Type.Literal("copy"), Type.Literal("restore")]), path: PathParam,
      versionId: Type.Optional(Type.String({ minLength: 1, description: "list 返回的版本 id，copy 和 restore 必填" }))
    }, strict),
    confirm: async ({ action, path: candidate, versionId }, host) => {
      if (action !== "restore") return null;
      const file = await absolute(host, candidate);
      const version = (await requireApp(host).ui<DocumentVersions>({ action: "version", operation: "list", path: file })).versions.find(item => item.id === versionId);
      if (!version) throw new Error("找不到这个版本，请先用 list 查看。");
      return { title: `将《${path.basename(file).replace(/\.(chalklee|html?)$/i, "")}》恢复到 ${versionTime(version.createdAt)} 的版本`, detail: "当前内容会先保存为一个版本，之后可以再恢复回来。", action: "恢复", tone: "primary" };
    },
    execute: async ({ action, path: candidate, versionId }, host) => {
      const file = await absolute(host, candidate);
      if (!/\.(chalklee|html?)$/i.test(file)) throw new Error("只有 ChalkLee 和网页有版本历史。");
      const app = requireApp(host);
      if (action === "list") {
        const history = await app.ui<DocumentVersions>({ action: "version", operation: "list", path: file });
        return output({
          versions: history.versions.slice(0, 40).map(version => ({ id: version.id, time: versionTime(version.createdAt), label: version.label, questions: version.questionCount,
            ...(version.file !== relative(host.root, file) ? { file: version.file } : {}) })),
          total: history.versions.length, ...(history.initial ? { firstConversion: versionTime(history.initial.createdAt) } : {})
        }, { summary: `${history.versions.length} 个版本` });
      }
      if (!versionId) throw new Error("请提供 versionId。");
      if (action === "copy") {
        const copy = await app.ui<{ path: string }>({ action: "version", operation: "copy", path: file, versionId });
        return output({ copy: relative(host.root, copy.path) }, { documents: [documentRef(copy.path)] });
      }
      await app.ui({ action: "version", operation: "restore", path: file, versionId });
      return output({ restored: relative(host.root, file), versionId }, { documents: [documentRef(file)], summary: "已恢复版本" });
    }
  }),
  defineTool({
    name: "conversion_start", label: "转换为 ChalkLee", surfaces: ASSISTANT, kind: "write",
    description: `用 ChalkLee 内置转换在后台把 PDF/DOC/DOCX/LaTeX/Markdown 原稿转换为可编辑的 ChalkLee（保留原稿）。path 是一份原稿或一个文件夹（含子文件夹中的全部原稿），paths 一次传多份；一次最多 ${MAX_CONVERSIONS} 份。已有转换结果或正在转换的原稿自动跳过并在结果中列出，用户明确要求重新转换时才传 reconvert:true（更新已有的 ChalkLee，用户改过的内容保留，更新前的内容存入版本历史）。多份会先请用户在卡片上确认。耗时较长，启动后告诉用户可在右上角转换任务查看，不要等待完成；之后停止、继续或校对用 conversion_tasks。`,
    parameters: Type.Object({
      path: Type.Optional(PathParam),
      paths: Type.Optional(Type.Array(PathParam, { minItems: 1, maxItems: 200 })),
      reconvert: Type.Optional(Type.Boolean({ description: "重新转换已有结果的原稿" }))
    }, strict),
    confirm: async (args, host) => conversionConfirmation(host, await planConversions(host, args)),
    execute: async (args, host) => {
      const plan = await planConversions(host, args);
      const result = await startConversions(host, plan);
      const skipped = (result.alreadyConverted?.length ?? 0) + (result.alreadyConverting?.length ?? 0);
      const summary = result.started.length ? `已开始转换 ${result.started.length} 份${skipped ? `，跳过 ${skipped} 份` : ""}` : "没有需要转换的原稿";
      return output(result, { summary, ...(result.started.length === 1 ? { documents: [documentRef(plan.start[0].path)] } : {}) });
    }
  }),
  defineTool({
    name: "conversion_tasks", label: "转换任务", surfaces: BOTH, kind: "destructive",
    description: "查看和操作 PDF/DOC/DOCX/LaTeX/Markdown 转换任务，与右上角转换任务中的按钮相同。新转换直接交付，不主动询问或安排独立校对。list 查看状态与结果文档：draft 表示转换未完成（对老师只说“转换未完成”，不说草稿），error 说明还差什么，可以 resume；completed 且 error 写着“请检查”或“保留为原图”时文档已可用，老师要继续整理时用 paths 点名这份再 resume；旧版 drafted 表示整卷初稿已完成，等待选择 ChalkLee AI 校对或不校对；phase 为 proofread 时是在校对初稿。stop 停止转换或校对（已整理的部分保留，之后可以继续）；resume 让停止、中断或未完成的任务从停下处接着转换或校对；proofread 用 ChalkLee AI 逐页对照原稿校对初稿，直接修正同一份 ChalkLee（老师改过的题保留并标为待核对，修改前的内容存为版本）；skip-proofread 不校对，保留初稿作为结果。paths 传原稿、转换结果或文件夹，省略时作用于工作区中所有适用的任务（不包括外部 AI 应用的会话）。not-needed 把原稿标为不需要转换（课本等只用来阅读的资料：不计入待转换份数，转换文件夹时跳过，单独点名时仍可转换），needed 取消这个标记；两者都要传 paths，文件夹作用于其中全部原稿，已有转换结果或正在转换的不标。",
    notes: {
      assistant: "继续或校对多份会先请用户在卡片上确认。",
      mcp: "resume、proofread 会用 ChalkLee 设置中的模型额度，这里不能用：请老师在 ChalkLee 右上角转换任务中操作，或用 conversion_open 自己转换。"
    },
    parameters: Type.Object({
      action: Type.Optional(Type.Union([Type.Literal("list"), Type.Literal("stop"), Type.Literal("resume"), Type.Literal("proofread"), Type.Literal("skip-proofread"), Type.Literal("not-needed"), Type.Literal("needed")], { default: "list" })),
      paths: Type.Optional(Type.Array(PathParam, { minItems: 1, maxItems: 200 }))
    }, strict),
    confirm: async ({ action, paths }, host) => !action || action === "list" || action === "not-needed" || action === "needed" ? null
      : conversionActionConfirmation(host, await planConversionAction(host, { action, paths })),
    execute: async ({ action, paths }, host) => {
      if (!action || action === "list") return output(requireApp(host).conversions().filter(task => task.workspaceRoot === host.root && !task.dismissed).map(task => ({
        source: relative(host.root, task.source.path), status: task.status, result: task.result?.file ? relative(host.root, task.result.file.path) : undefined,
        error: conversionDetail(task), pendingReview: task.pendingReviewCount || undefined, agent: task.agent, phase: task.phase
      })));
      if (action === "not-needed" || action === "needed") {
        const result = await markOriginals(host, paths, action === "needed");
        return output(result, { summary: result.marked.length ? `已标记 ${result.marked.length} 份${action === "needed" ? "需要" : "不需要"}转换` : "没有需要标记的原稿" });
      }
      // External agents bring their own model; the app's quota is the teacher's to spend from the task list.
      if (host.surface === "mcp" && (action === "resume" || action === "proofread")) throw new Error("继续转换和校对会用 ChalkLee 设置中的模型额度，请老师在 ChalkLee 右上角转换任务中操作，或用 conversion_open 自己转换。");
      const plan = await planConversionAction(host, { action, paths });
      const result = await runConversionAction(host, plan);
      const verb = ({ stop: "已停止", resume: "已继续", proofread: "已开始校对", "skip-proofread": "已保留初稿" })[action];
      const results = plan.tasks.flatMap(task => action !== "stop" && task.result ? [documentRef(task.result.file.path)] : []);
      return output(result, { summary: result.done.length ? `${verb} ${result.done.length} 份` : "没有适用的转换任务", ...(results.length === 1 ? { documents: results } : {}) });
    }
  }),
  defineTool({
    name: "memory", label: "记忆", surfaces: ASSISTANT, kind: "write",
    description: `长期记住用户的偏好与习惯，对以后的所有对话和工作区生效（已记住的内容每次都会提供给你）。只在用户明确要求“记住/以后都…”，或说出稳定的个人偏好（任教学科与年级、常用题型格式、排版习惯等）时 add；不记录一次性的任务内容、文档内容或敏感信息。每条一句话、不超过 ${MAX_MEMORY_LENGTH} 字。用户要求忘掉时先 list 再按编号 remove。`,
    parameters: Type.Object({
      action: Type.Union([Type.Literal("list"), Type.Literal("add"), Type.Literal("remove")]),
      text: Type.Optional(Type.String({ description: "add 时要记住的一句话" })),
      index: Type.Optional(Type.Integer({ minimum: 1, description: "remove 时的编号（从 1 开始）" }))
    }, strict),
    execute: async ({ action, text, index }, host) => {
      const memory = requireApp(host).memory;
      if (!memory) throw new Error("记忆只供 ChalkLee AI 使用。");
      const items = action === "add" ? await memory.add(text ?? "") : action === "remove" ? await memory.remove(index ?? 0) : await memory.list();
      return output(items.length ? items.map((item, position) => `${position + 1}. ${item}`).join("\n") : "（没有记忆）", { summary: action === "add" ? "已记住" : action === "remove" ? "已删除" : `${items.length} 条记忆` });
    }
  })
];
