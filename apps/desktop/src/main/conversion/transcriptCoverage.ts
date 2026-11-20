import { importOptionAnchors, importQuestionAnchors } from "../../shared/conversion/questionAnchors";
import { importContentText as contentText, normalizeImportContent, plainImportText } from "../../shared/conversion/contentText";
import { importNumberedBlankMatches, wordAnswerLabel, wordAnalysisLabel } from "../../shared/conversion/wordSource";
import { importMarkdownBlocks, importSubquestionAnchors, stripImportPageFurniture } from "./structuredContent";
import { normalizeImportNumber } from "../../shared/conversion/answerSource";
const normalize = (text: string) => {
  let plain = plainImportText(text).replace(/\[\[(?:math|figure)_\d+\]\]/g, "");
  for (const match of importNumberedBlankMatches(plain).reverse()) plain = plain.slice(0, match.index!) + `[[blank_${match[1] ?? match[2]}]]` + plain.slice(match.index! + match[0].length);
  return normalizeImportContent(plain);
};
const sourceText = (text: string) => text.replace(/^\s*(?:[（(]\d{1,2}[）)]|[⑴-⒇])\s*[.．、]?\s*/, "").replace(/^\s*>\s?/, "").replace(wordAnswerLabel, "").replace(wordAnalysisLabel, "");

/** Check attribution before replacing source tokens with formulas and image coordinates. */
export function assertTranscriptCoverage(markdown: string, blocks: unknown[], continuationNumber?: string, continuationParents: string[] = []): void {
  const source = stripImportPageFurniture(plainImportText(markdown));
  const prose = normalize(blocks.map((node: any) => node.type === "question" ? "" : node.type === "questionGroup" ? contentText(node.material) : contentText(node)).join("\n"));
  const starts = importQuestionAnchors(source).filter(match => {
    const line = source.slice(match.index!, source.indexOf("\n", match.index!) < 0 ? source.length : source.indexOf("\n", match.index!));
    // A numbered instruction/step that is retained verbatim as prose is not a
    // missing question. Explicit question cues and options still require a
    // question node, even if a model tries to flatten them to a paragraph.
    if (/[?？]|求|计算|已知|如图|[（(]\s*\d+(?:\.\d+)?\s*分\s*[）)]|(?:^|\s)[A-H][.．、)]\s|\[\[(?:math|figure)_/.test(line)) return true;
    const text = normalize(line);
    return text.length < 6 || !prose.includes(text);
  });
  const expected = new Map<string, number>();
  starts.forEach(match => expected.set(match[1], (expected.get(match[1]) ?? 0) + 1));
  const actual = new Map<string, any[]>();
  const numbered: { number: string; node: any; parents: string[] }[] = [];
  const visit = (value: any, parents: string[] = []) => {
    if (Array.isArray(value)) value.forEach(child => visit(child, parents));
    else if (value && typeof value === "object") {
      if (["question", "questionGroup", "answerEntry"].includes(value.type)) {
        const number = normalizeImportNumber(String(value.number ?? value.attrs?.number?.label ?? ""));
        numbered.push({ number, node: value, parents });
        // Main question 1 and child (1) are different scopes. Mixing them made
        // correctly split answer pages fail as duplicate main question numbers.
        if (!parents.length && !value.parentNumbers?.length) actual.set(number, [...(actual.get(number) ?? []), value]);
        if (value.type === "answerEntry" && Array.isArray(value.parentNumbers)) for (const parent of value.parentNumbers) {
          const label = normalizeImportNumber(parent);
          if (!actual.has(label)) actual.set(label, [{ type: "questionGroup", number: label }]);
        }
        if (number) parents = [...parents, number];
      }
      Object.values(value).forEach(item => { if (item && typeof item === "object") visit(item, parents); });
    }
  };
  visit(blocks);
  const tables: any[] = [];
  const collectTables = (value: any) => {
    if (Array.isArray(value)) value.forEach(collectTables);
    else if (value && typeof value === "object") {
      if (value.type === "table") tables.push(value);
      Object.values(value).forEach(child => { if (child && typeof child === "object") collectTables(child); });
    }
  };
  collectTables(blocks);
  const signature = (rows: any[][]) => JSON.stringify(rows.map(row => row.map(cell => normalizeImportContent(contentText(cell)))));
  const available = tables.map(table => ({ signature: signature(table.rows ?? []), text: normalize(contentText(table.rows)) }));
  for (const table of importMarkdownBlocks(markdown).filter(value => value.type === "table")) {
    const boxedText = table.rows.length === 1 && table.rows[0].length === 1;
    const at = available.findIndex(value => value.signature === signature(table.rows) || (boxedText && value.text === normalize(contentText(table.rows))));
    if (at < 0) throw new Error("原文表格或演算框必须保留为可编辑表格，逐行逐列保留全部单元格，不能变为带竖线的正文。");
    available.splice(at, 1);
  }
  for (const [number, count] of expected) {
    const found = actual.get(number)?.length ?? 0;
    if (!found) throw new Error(`拆题结果遗漏了原文第 ${number} 题。`);
    if (found > count) throw new Error(`拆题结果重复了第 ${number} 题：原稿 ${count} 次，结果 ${found} 次。`);
  }
  // A continuation or an inline numbered blank may have no line-start number.
  // Keep those explicit sources, but never accept a new standalone question ID.
  const supportedNumbers = new Set([
    ...importQuestionAnchors(source).map(match => match[1]),
    ...importNumberedBlankMatches(source).map(match => match[1] ?? match[2]),
    ...[...source.matchAll(/[（(](\d{1,3})[）)]/g)].map(match => match[1]),
    ...importSubquestionAnchors(source).map(match => match.number),
    ...[...source.matchAll(/[⑴-⒇]/g)].map(match => normalizeImportNumber(match[0])),
    ...(continuationNumber ? [normalizeImportNumber(continuationNumber)] : []),
  ]);
  for (const { number, node } of numbered) {
    if (/^\d{1,3}$/.test(number) && !supportedNumbers.has(number) && node.type !== "questionGroup") throw new Error(`第 ${number} 题没有对应的原文题号、编号填空或续题来源，不能新增题目。`);
  }
  const blankCounts = (text: string) => {
    const counts = new Map<string, number>();
    for (const match of importNumberedBlankMatches(plainImportText(text))) {
      const label = match[1] ?? match[2];
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return counts;
  };
  const withoutQuestionNumbers = source.split("\n").map(line => {
    const anchor = importQuestionAnchors(line)[0];
    return anchor?.index === 0 ? line.slice(anchor[0].length) : line;
  }).join("\n");
  if (continuationNumber) {
    const leading = source.slice(0, importQuestionAnchors(source)[0]?.index ?? source.length);
    const required = importSubquestionAnchors(leading).map(anchor => anchor.number);
    const scoped = numbered.filter(({ node, parents }) => node.type === "answerEntry"
      ? continuationParents.length && JSON.stringify((node.parentNumbers ?? []).map(normalizeImportNumber)) === JSON.stringify(continuationParents.map(normalizeImportNumber))
      : parents.map(normalizeImportNumber).includes(normalizeImportNumber(continuationNumber)));
    const retained = new Set([...scoped.map(({ number }) => number), ...importSubquestionAnchors(contentText(blocks)).map(anchor => anchor.number)]);
    for (const number of required) if (!retained.has(number)) throw new Error(`续页的（${number}）小问编号被遗漏；保留印刷编号或整理为对应父题的独立小问答案。`);
  }
  const sourceBlanks = blankCounts(withoutQuestionNumbers), outputBlanks = blankCounts(contentText(blocks));
  for (const label of new Set([...sourceBlanks.keys(), ...outputBlanks.keys()])) {
    if (sourceBlanks.get(label) !== outputBlanks.get(label)) throw new Error(`编号填空 ${label} 被遗漏、新增或重复，请保留原文填空及编号。`);
  }
  starts.forEach((match, index) => {
    const number = match[1];
    // Repeated numbering and parent/subquestion notation require their own scope;
    // don't guess ownership when the source anchor is ambiguous.
    if (expected.get(number) !== 1 || actual.get(number)?.length !== 1) return;
    const question = actual.get(number)![0];
    let body = source.slice(match.index! + match[0].length, starts[index + 1]?.index ?? source.length);
    const subnumbers = importSubquestionAnchors(body).map(anchor => anchor.number);
    if (subnumbers.length) {
      const retained = new Set(importSubquestionAnchors(contentText(question)).map(anchor => anchor.number));
      const children = (question.questions ?? []).map((child: any) => normalizeImportNumber(String(child.number ?? "")));
      for (const { node } of numbered) if (node.type === "answerEntry" && node.parentNumbers?.some((parent: string) => normalizeImportNumber(parent) === normalizeImportNumber(number))) children.push(normalizeImportNumber(node.number));
      for (const child of subnumbers) if (!retained.has(child) && !children.includes(child)) throw new Error(`第 ${number} 题的（${child}）小问编号被遗漏；必须保留原文编号或整理为有明确父题的小问，不能直接删除编号。`);
    }
    if (!["question", "answerEntry"].includes(question.type)) return;
    const nextSection = body.search(/\n\s*(?:#{1,6}\s|第[一二三四五六七八九十\d]+[节部章]|[一二三四五六七八九十]+[、．]|[IVX]{1,6}[.．、]|[A-H][.．、]?\s*$)/m);
    if (nextSection >= 0) body = body.slice(0, nextSection);
    const serialized = JSON.stringify(question);
    for (const token of body.match(/\[\[(?:math|figure)_\d+\]\]/g) ?? []) {
      const key = token.slice(2, -2);
      const belongs = key.startsWith("math_") ? serialized.includes(token) : new RegExp(`"figureId"\\s*:\\s*"${key}"`).test(serialized);
      if (!belongs) throw new Error(`原文引用 ${key} 属于第 ${number} 题，不能移动到其他题。`);
    }
    if (question.type === "answerEntry") {
      const pieces = body.split(/[\n|]/).map(line => normalize(sourceText(line))).filter(text => /[\p{L}\p{N}]/u.test(text));
      const answer = normalize(contentText([question.answer, question.analysis]));
      if (pieces.some(text => !answer.includes(text)) || (pieces.length === 1 && question.analysis === undefined && answer !== pieces[0])) throw new Error(`第 ${number} 题答案未完整保留，请逐字保留该题的原稿答案。`);
      return;
    }
    const options = importOptionAnchors(body);
    const stem = body.slice(0, options[0]?.index ?? body.length).split(/\n\s*(?:【(?:参考答案|答案|解析|分析|详解)】|(?:答案|解析|Answers?)\s*[:：])/i)[0];
    const stemResult = normalize(contentText(question.stem ?? question.content?.find((region: any) => region.type === "questionStem")?.content));
    const missingStem = stem.split(/[\n|]/).map(sourceText).find(line => {
      const text = normalize(line);
      return /[\p{L}\p{N}]/u.test(text) && !stemResult.includes(text);
    });
    if (missingStem) throw new Error(`第 ${number} 题题干未完整保留：${missingStem.trim().slice(0, 120)}。短题干、否定词和数字也必须逐字保留。`);
    if (options.length < 2 || !options.every((entry, i) => !i || entry[1].charCodeAt(0) === options[i - 1][1].charCodeAt(0) + 1)) return;
    const resultOptions: any[] = question.options ?? question.content?.find((region: any) => region.type === "optionGroup")?.content ?? [];
    for (let i = 0; i < options.length; i++) {
      const label = options[i][1];
      const matches = resultOptions.filter(option => String(option.label ?? option.attrs?.label) === label);
      if (matches.length !== 1) throw new Error(`第 ${number} 题选项 ${label} 应保留一次，实际为 ${matches.length} 次。`);
      // A separately placed whole-question figure after D is not an option image.
      const optionSource = body.slice(options[i].index! + options[i][0].length, options[i + 1]?.index ?? body.length).split(/\n\s*\[\[figure_/)[0].split(/\n\s*(?:【(?:答案|解析)】|(?:答案|解析|Answers?)\s*[:：])/i)[0];
      const optionResult = JSON.stringify(matches[0]);
      for (const token of optionSource.match(/\[\[(?:math|figure)_\d+\]\]/g) ?? []) {
        const key = token.slice(2, -2);
        const belongs = key.startsWith("math_") ? optionResult.includes(token) : new RegExp(`"figureId"\\s*:\\s*"${key}"`).test(optionResult);
        if (!belongs) throw new Error(`原文引用 ${token} 属于第 ${number} 题的 ${label} 选项，不能改变选项归属。`);
      }
      const originalText = normalize(optionSource);
      if (originalText && originalText.length < 25 && normalize(contentText(matches[0].content)) !== originalText) throw new Error(`第 ${number} 题的 ${label} 选项内容未完整保留，请逐字保留原文。`);
    }
    if (resultOptions.length !== options.length) throw new Error(`第 ${number} 题选项数量与原稿不一致。`);
  });
  // Scanned pages have no text layer. The locked transcription is their source
  // too: checking question numbers alone would miss a dropped reading passage.
  const preserved = normalize(contentText(blocks));
  const missing = source.split(/[\n|]/).flatMap(line => {
    const anchor = importQuestionAnchors(line)[0];
    const text = anchor?.index === 0 ? line.slice(anchor[0].length) : line;
    const choices = importOptionAnchors(text);
    return (choices.length ? [text.slice(0, choices[0].index), ...choices.map((choice, index) => text.slice(choice.index! + choice[0].length, choices[index + 1]?.index ?? text.length))] : [text]).map(sourceText);
  }).filter(text => {
    const expected = normalize(text);
    return /[\p{L}\p{N}]/u.test(expected) && !preserved.includes(expected);
  });
  if (missing.length) throw new Error(`原文正文未完整保留：${missing.slice(0, 5).map(text => text.trim().slice(0, 120)).join("；")}。共享材料、说明和表格也必须完整输出。`);
}
