import type {
  ChalkLeeBlockNode,
  ChalkLeeDocument,
  ChalkLeeInlineNode,
  ChalkLeeManifest,
  ChalkLeeQuestionContentBlock,
  ChalkLeeQuestionGroupNode,
  ChalkLeeQuestionNode
} from "./types";
import { CHALKLEE_GROUP_KINDS, CHALKLEE_QUESTION_KINDS } from "./kinds";
import { chalkLeePageDecorationIssues } from "./decorations";
import { chalkLeeCoverIssues } from "./cover";
import { chalkLeeGraphicIssues } from "./graphic";

export type ChalkLeeValidationIssue = {
  code: string;
  path: string;
  message: string;
};

export function validateChalkLeeSemantics(document: ChalkLeeDocument, manifest?: ChalkLeeManifest): ChalkLeeValidationIssue[] {
  const issues: ChalkLeeValidationIssue[] = [];
  const ids = new Map<string, string>();
  const assetIds = new Set(manifest?.assets.map((asset) => asset.id) ?? []);
  const sourceIds = new Set(document.provenance?.sources.map((source) => source.id) ?? []);
  const blankIds = new Set<string>();
  const blankLinks: Array<{ blankId: string; path: string }> = [];
  const page = document.appearance.page;
  if (page.columnCount != null && (!Number.isInteger(page.columnCount) || page.columnCount < 1 || page.columnCount > 12)) {
    issues.push({ code: "page-column-count", path: "appearance.page.columnCount", message: "栏数必须是 1 至 12 的整数" });
  }
  if (page.columnGapPt != null && (!Number.isFinite(page.columnGapPt) || page.columnGapPt < 0)) {
    issues.push({ code: "page-column-gap", path: "appearance.page.columnGapPt", message: "栏间距必须是非负数" });
  }

  function recordId(id: string, path: string) {
    const previousPath = ids.get(id);
    if (previousPath) {
      issues.push({ code: "duplicate-id", path, message: `id ${id} 已在 ${previousPath} 使用` });
      return;
    }
    ids.set(id, path);
  }

  function checkAsset(assetId: string, path: string) {
    if (manifest && !assetIds.has(assetId)) {
      issues.push({ code: "missing-asset", path, message: `未在 manifest 中找到素材 ${assetId}` });
    }
  }

  function visitQuestionContent(block: ChalkLeeQuestionContentBlock, path: string) {
    visitBlock(block, path);
  }

  function visitQuestion(question: ChalkLeeQuestionNode, path: string) {
    recordId(question.attrs.id, `${path}.attrs.id`);
    if (!(CHALKLEE_QUESTION_KINDS as readonly string[]).includes(question.attrs.kind)) {
      issues.push({ code: "question-kind", path: `${path}.attrs.kind`, message: `题目的题型只能是 ${CHALKLEE_QUESTION_KINDS.join("、")}` });
    }
    checkQuestionStyle(question.attrs.styleRef, `${path}.attrs.styleRef`);
    if (question.attrs.sourceBlankId) {
      blankLinks.push({ blankId: question.attrs.sourceBlankId, path: `${path}.attrs.sourceBlankId` });
    }

    const expectedOrder = ["questionStem", "optionGroup", "questionAnswer", "questionAnalysis"];
    validateRegionSequence(question.content, expectedOrder, `${path}.content`, "question-region-order");
    const stem = question.content.find((region) => region.type === "questionStem");
    if (!stem) {
      issues.push({ code: "missing-question-stem", path: `${path}.content`, message: "题目必须包含题干区域" });
      return;
    }
    const stemIndex = question.content.indexOf(stem);
    recordId(stem.attrs.id, `${path}.content[${stemIndex}].attrs.id`);
    stem.content.forEach((block, index) => visitQuestionContent(block, `${path}.content[${stemIndex}].content[${index}]`));

    question.content.forEach((region, regionIndex) => {
      if (region === stem) return;
      recordId(region.attrs.id, `${path}.content[${regionIndex}].attrs.id`);
      if (region.type === "optionGroup") {
        visitOptionGroup(region, `${path}.content[${regionIndex}]`);
      } else if (region.type === "questionAnswer") {
        checkRegionStyle(region.attrs.styleRef, document.appearance.answerStyles, `${path}.content[${regionIndex}].attrs.styleRef`);
        region.content.forEach((block, index) => visitQuestionContent(block, `${path}.content[${regionIndex}].content[${index}]`));
      } else if (region.type === "questionAnalysis") {
        checkRegionStyle(region.attrs.styleRef, document.appearance.analysisStyles, `${path}.content[${regionIndex}].attrs.styleRef`);
        region.content.forEach((block, index) => visitQuestionContent(block, `${path}.content[${regionIndex}].content[${index}]`));
      }
    });
  }

  function visitQuestionGroup(group: ChalkLeeQuestionGroupNode, path: string) {
    recordId(group.attrs.id, `${path}.attrs.id`);
    if (!(CHALKLEE_GROUP_KINDS as readonly string[]).includes(group.attrs.kind)) {
      issues.push({ code: "group-kind", path: `${path}.attrs.kind`, message: `题组的题型只能是 ${CHALKLEE_GROUP_KINDS.join("、")}` });
    }
    checkQuestionStyle(group.attrs.styleRef, `${path}.attrs.styleRef`);

    const expectedOrder = ["questionMaterial", "optionGroup", "subQuestionList", "questionAnswer", "questionAnalysis"];
    validateRegionSequence(group.content, expectedOrder, `${path}.content`, "question-group-region-order");
    const material = group.content.find((region) => region.type === "questionMaterial");
    const subQuestions = group.content.find((region) => region.type === "subQuestionList");
    if (!material) issues.push({ code: "missing-question-material", path: `${path}.content`, message: "题组必须包含材料区域" });
    if (!subQuestions) issues.push({ code: "missing-subquestion-list", path: `${path}.content`, message: "题组必须包含小题列表" });

    group.content.forEach((region, regionIndex) => {
      recordId(region.attrs.id, `${path}.content[${regionIndex}].attrs.id`);
      if (region.type === "questionMaterial") {
        region.content.forEach((block, index) => visitQuestionContent(block, `${path}.content[${regionIndex}].content[${index}]`));
      } else if (region.type === "optionGroup") {
        visitOptionGroup(region, `${path}.content[${regionIndex}]`);
      } else if (region.type === "subQuestionList") {
        region.content.forEach((question, index) => visitQuestion(question, `${path}.content[${regionIndex}].content[${index}]`));
      } else if (region.type === "questionAnswer") {
        checkRegionStyle(region.attrs.styleRef, document.appearance.answerStyles, `${path}.content[${regionIndex}].attrs.styleRef`);
        region.content.forEach((block, index) => visitQuestionContent(block, `${path}.content[${regionIndex}].content[${index}]`));
      } else {
        checkRegionStyle(region.attrs.styleRef, document.appearance.analysisStyles, `${path}.content[${regionIndex}].attrs.styleRef`);
        region.content.forEach((block, index) => visitQuestionContent(block, `${path}.content[${regionIndex}].content[${index}]`));
      }
    });
  }

  function visitOptionGroup(options: Extract<ChalkLeeQuestionNode["content"][number], { type: "optionGroup" }>, path: string) {
    const labels = new Set<string>();
    options.content.forEach((option, optionIndex) => {
      const optionPath = `${path}.content[${optionIndex}]`;
      recordId(option.attrs.id, `${optionPath}.attrs.id`);
      if (labels.has(option.attrs.label)) {
        issues.push({ code: "duplicate-option-label", path: `${optionPath}.attrs.label`, message: `重复选项标签 ${option.attrs.label}` });
      }
      labels.add(option.attrs.label);
      checkOptionStyle(option.attrs.styleRef ?? options.attrs.styleRef, `${optionPath}.attrs.styleRef`);
      option.content.forEach((block, index) => visitQuestionContent(block, `${optionPath}.content[${index}]`));
    });
    checkOptionStyle(options.attrs.styleRef, `${path}.attrs.styleRef`);
  }

  function validateRegionSequence(
    content: Array<{ type: string }>,
    expectedOrder: string[],
    path: string,
    code: string
  ) {
    let previousRank = -1;
    const seen = new Set<string>();
    content.forEach((region, index) => {
      const rank = expectedOrder.indexOf(region.type);
      if (rank < 0 || rank <= previousRank || seen.has(region.type)) {
        issues.push({ code, path: `${path}[${index}]`, message: `区域必须按 ${expectedOrder.join(" → ")} 排列，且每种至多一个` });
      }
      previousRank = Math.max(previousRank, rank);
      seen.add(region.type);
    });
  }

  function visitBlock(node: ChalkLeeBlockNode | ChalkLeeQuestionContentBlock, path: string) {
    if (node.type === "question") {
      visitQuestion(node, path);
      return;
    }
    if (node.type === "questionGroup") {
      visitQuestionGroup(node, path);
      return;
    }
    if (node.type === "box") {
      // A box may name a style that is defined later, e.g. by a layout; until then it shows the default style.
      recordId(node.attrs.id, `${path}.attrs.id`);
      node.content.forEach((block, index) => visitBlock(block, `${path}.content[${index}]`));
      return;
    }

    recordId(node.attrs.id, `${path}.attrs.id`);
    if (node.type === "image") checkAsset(node.attrs.assetId, `${path}.attrs.assetId`);
    if (node.type === "graphic") for (const message of chalkLeeGraphicIssues(node.attrs)) issues.push({ code: "graphic", path: `${path}.attrs`, message });
    const visitInlines = (content: ChalkLeeInlineNode[] | undefined, contentPath: string) => content?.forEach((inline, inlineIndex) => {
      if (inline.type === "imageInline") {
        recordId(inline.attrs.id, `${contentPath}.content[${inlineIndex}].attrs.id`);
        checkAsset(inline.attrs.assetId, `${contentPath}.content[${inlineIndex}].attrs.assetId`);
      }
      if (inline.type === "blank") {
        recordId(inline.attrs.id, `${contentPath}.content[${inlineIndex}].attrs.id`);
        blankIds.add(inline.attrs.id);
      }
    });
    if (node.type === "paragraph" || node.type === "heading") visitInlines(node.content, path);
    if (node.type === "answerLines") node.content?.forEach((line, lineIndex) => {
      if (line.attrs?.id) recordId(line.attrs.id, `${path}.content[${lineIndex}].attrs.id`);
      visitInlines(line.content, `${path}.content[${lineIndex}]`);
    });
    if (node.type === "table") {
      const logicalColumnCount = node.content[0]?.content.reduce((count, cell) => count + (cell.attrs.colspan ?? 1), 0) ?? 0;
      if (node.attrs.columnWidthsPt && node.attrs.columnWidthsPt.length !== logicalColumnCount) {
        issues.push({
          code: "table-column-width-count",
          path: `${path}.attrs.columnWidthsPt`,
          message: `列宽数量 ${node.attrs.columnWidthsPt.length} 与表格逻辑列数 ${logicalColumnCount} 不一致`
        });
      }
      let foundNonHeaderRow = false;
      let repeatHeaderRowCount = 0;
      node.content.forEach((row, rowIndex) => {
        const rowPath = `${path}.content[${rowIndex}]`;
        recordId(row.attrs.id, `${rowPath}.attrs.id`);
        if (row.attrs.heightPt != null && (!Number.isFinite(row.attrs.heightPt) || row.attrs.heightPt <= 0)) {
          issues.push({
            code: "table-row-height",
            path: `${rowPath}.attrs.heightPt`,
            message: "表格行高必须是正数"
          });
        }
        if (row.attrs.repeatAsHeader === true) {
          if (foundNonHeaderRow) {
            issues.push({
              code: "table-header-row-order",
              path: `${rowPath}.attrs.repeatAsHeader`,
              message: "重复标题行必须是表格顶部连续的行"
            });
          } else {
            repeatHeaderRowCount += 1;
          }
        } else {
          foundNonHeaderRow = true;
        }
        row.content.forEach((cell, cellIndex) => {
          const cellPath = `${rowPath}.content[${cellIndex}]`;
          recordId(cell.attrs.id, `${cellPath}.attrs.id`);
          cell.content.forEach((block, blockIndex) => visitBlock(block, `${cellPath}.content[${blockIndex}]`));
        });
      });
      node.content.slice(0, repeatHeaderRowCount).forEach((row, rowIndex) => {
        row.content.forEach((cell, cellIndex) => {
          const rowspan = cell.attrs.rowspan ?? 1;
          if (rowspan === 0 || rowIndex + rowspan > repeatHeaderRowCount) {
            issues.push({
              code: "table-header-rowspan",
              path: `${path}.content[${rowIndex}].content[${cellIndex}].attrs.rowspan`,
              message: "重复标题行中的纵向合并不能延伸到正文行"
            });
          }
        });
      });
    }
  }

  function checkQuestionStyle(styleRef: string | undefined, path: string) {
    checkRegionStyle(styleRef, document.appearance.questionStyles, path);
  }

  function checkOptionStyle(styleRef: string | undefined, path: string) {
    checkRegionStyle(styleRef, document.appearance.optionStyles, path);
  }

  function checkRegionStyle(styleRef: string | undefined, styles: Record<string, unknown>, path: string) {
    if (styleRef && !styles[styleRef]) {
      issues.push({ code: "missing-style", path, message: `未找到样式 ${styleRef}` });
    }
  }

  document.content.content.forEach((node, index) => visitBlock(node, `content.content[${index}]`));

  blankLinks.forEach(({ blankId, path }) => {
    if (!blankIds.has(blankId)) {
      issues.push({ code: "missing-source-blank", path, message: `未找到关联填空 ${blankId}` });
    }
  });

  checkQuestionStyle(document.appearance.defaults.questionStyleRef, "appearance.defaults.questionStyleRef");
  checkOptionStyle(document.appearance.defaults.optionStyleRef, "appearance.defaults.optionStyleRef");
  checkRegionStyle(document.appearance.defaults.answerStyleRef, document.appearance.answerStyles, "appearance.defaults.answerStyleRef");
  checkRegionStyle(document.appearance.defaults.analysisStyleRef, document.appearance.analysisStyles, "appearance.defaults.analysisStyleRef");
  checkRegionStyle(document.appearance.defaults.boxStyleRef, document.appearance.boxStyles ?? {}, "appearance.defaults.boxStyleRef");

  for (const message of chalkLeeCoverIssues(document.appearance.cover)) {
    issues.push({ code: "cover", path: "appearance.cover", message });
  }
  for (const message of chalkLeePageDecorationIssues(document.appearance.pageDecorations)) {
    issues.push({ code: "page-decoration", path: "appearance.pageDecorations", message });
  }

  if (document.appearance.page.background.type === "image") {
    checkAsset(document.appearance.page.background.assetId, "appearance.page.background.assetId");
  }

  document.provenance?.anchors?.forEach((anchor, index) => {
    if (!ids.has(anchor.nodeId)) {
      issues.push({ code: "missing-anchor-node", path: `provenance.anchors[${index}].nodeId`, message: `未找到节点 ${anchor.nodeId}` });
    }
    if (!sourceIds.has(anchor.sourceId)) {
      issues.push({ code: "missing-anchor-source", path: `provenance.anchors[${index}].sourceId`, message: `未找到来源 ${anchor.sourceId}` });
    }
  });

  return issues;
}
