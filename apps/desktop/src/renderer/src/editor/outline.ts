import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { chalkLeeGroupContinuesNumbers, chalkLeeQuestionCounter } from "@chalklee/format";
import type { OutlineItem } from "../viewers/types";

/** Imported Word/PDF section labels may still be ordinary paragraphs. Read
 * their outline role without changing the document's formatting or contents. */
export function paragraphSectionLevel(text: string): number | null {
  const label = text.trim();
  if (!label || label.length > 160 || /[\r\n]/.test(label)) return null;
  if (/^第[一二三四五六七八九十百\d]+(?:部分|卷|章)\s*\S/.test(label)) return 1;
  if (/^第[一二三四五六七八九十百\d]+节\s*\S/.test(label)) return 3;
  const numbered = label.match(/^(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]+|[IVX]+|[一二三四五六七八九十百]+)\s*[、.．:：]\s*(.+)$/);
  if (numbered && /^(?:(?:单项|多项|不定项|单|多|非)?选择|完形填空|阅读|语法填空|短文填空|语篇填空|选词填空|信息匹配|书面表达|听力|口语|词汇|单词拼写|翻译|写作|作文|填空|判断|解答|计算|证明|综合|应用|作图|实验|探究)/.test(numbered[1])) return 2;
  return null;
}

export function buildChalkLeeOutline(doc: ProseMirrorNode): OutlineItem[] {
  const items: OutlineItem[] = [];
  const headings: OutlineItem[] = [];
  // Numbers as the paper prints them (chalkLeeQuestionCounter).
  const counter = chalkLeeQuestionCounter();
  const visit = (node: ProseMirrorNode, parent: ProseMirrorNode) => {
    const id = String(node.attrs.id);
    const level = node.type.name === "heading" ? Number(node.attrs.level) || 1
      : node.type.name === "paragraph" && parent.type.name === "doc" ? paragraphSectionLevel(node.textContent) : null;
    if (level !== null) {
      while (headings.length && headings.at(-1)!.level >= level) headings.pop();
      const item: OutlineItem = { id, label: node.textContent || "未命名标题", level, kind: "heading", target: id, parentId: headings.at(-1)?.id };
      items.push(item);
      headings.push(item);
    }
    const isQuestion = node.type.name === "question" || node.type.name === "questionGroup";
    if (isQuestion) {
      const isGroup = node.type.name === "questionGroup";
      const counted = { type: node.type.name, attrs: node.attrs };
      const index = counter.next(counted) ?? 0;
      const childQuestionIds: string[] = [];
      if (isGroup) node.descendants(child => {
        if (child.type.name === "question") childQuestionIds.push(String(child.attrs.id));
      });
      const level = (headings.at(-1)?.level ?? 1) + 1;
      // A passage without its own number (a cloze, reading A, B …) is known by its questions' printed
      // numbers, so each of them is listed; a numbered group stays one entry for its main question.
      // A group that continues the paper's numbers is known by its questions' numbers, each listed.
      if (isGroup && chalkLeeGroupContinuesNumbers(counted)) {
        const sub = counter.group(counted);
        node.descendants(child => {
          if (child.type.name !== "question") return true;
          const blankId = typeof child.attrs.sourceBlankId === "string" && child.attrs.sourceBlankId ? child.attrs.sourceBlankId : null;
          items.push({ id: String(child.attrs.id), label: questionOutlineLabel(child, sub(), node), level, kind: "question", target: String(child.attrs.id), parentId: headings.at(-1)?.id, groupId: id,
            ...(blankId ? { blankId } : {}) });
          return false;
        });
        return;
      }
      const numbered: ProseMirrorNode[] = [];
      if (isGroup && !fixedNumber(node)) node.descendants(child => { if (child.type.name === "question" && /^\d+$/.test(fixedNumber(child) ?? "")) numbered.push(child); return child.type.name !== "question"; });
      if (numbered.length) {
        for (const child of numbered) {
          const blankId = typeof child.attrs.sourceBlankId === "string" && child.attrs.sourceBlankId ? child.attrs.sourceBlankId : null;
          items.push({ id: String(child.attrs.id), label: questionOutlineLabel(child, index, node), level, kind: "question", target: String(child.attrs.id), parentId: headings.at(-1)?.id, groupId: id,
            ...(blankId ? { blankId } : {}) });
        }
        return;
      }
      items.push({ id, label: questionOutlineLabel(node, index), questionGroup: isGroup, level,
        kind: "question", target: id, parentId: headings.at(-1)?.id, childQuestionIds });
      // A question group is one navigation target. Its internal headings and
      // subquestions belong to the paper, not the document's section outline.
      return;
    }
    node.forEach(child => visit(child, node));
  };
  doc.forEach(node => visit(node, doc));
  return items;
}

const outlineExcerpts = new WeakMap<ProseMirrorNode, string>();

function outlineExcerpt(region: ProseMirrorNode | undefined): string {
  if (!region) return "";
  const cached = outlineExcerpts.get(region);
  if (cached !== undefined) return cached;
  const text = region.textContent.replace(/\s+/g, " ").trim();
  const excerpt = text.length > 64 ? `${text.slice(0, 64)}…` : text;
  outlineExcerpts.set(region, excerpt);
  return excerpt;
}

function fixedNumber(node: ProseMirrorNode): string | null {
  const number = node.attrs.number && typeof node.attrs.number === "object" ? node.attrs.number as { mode?: unknown; label?: unknown } : null;
  return number?.mode === "fixed" && typeof number.label === "string" && number.label.trim() ? number.label.trim() : null;
}

/** A question in a passage without its own words is previewed by the passage. */
function questionOutlineLabel(node: ProseMirrorNode, questionIndex: number, passage?: ProseMirrorNode) {
  const isGroup = node.type.name === "questionGroup";
  // An unnumbered question (a writing task under its section) has no number on the paper, so none is made up for it.
  const unnumbered = (node.attrs.number as { mode?: unknown } | null)?.mode === "none";
  const fixedLabel = fixedNumber(node) ?? String(questionIndex);
  const prefix = unnumbered ? isGroup ? "题组" : "题目" : isGroup ? `题组 ${fixedLabel}` : `第 ${fixedLabel} 题`;
  const regionName = isGroup ? "questionMaterial" : "questionStem";
  const own = node.content.content.find(child => child.type.name === regionName);
  const preview = outlineExcerpt(own) || outlineExcerpt(passage?.content.content.find(child => child.type.name === "questionMaterial"));
  return preview ? `${prefix} · ${preview}` : prefix;
}
