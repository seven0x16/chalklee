import type { ChalkLeeDocument } from "@chalklee/format";
import type { ImportNotice } from "./types";
import { normalizeImportNumber } from "./answerSource";

/**
 * What conversion leaves in the paper where it could not be sure: a short bracketed note naming 待核对, such as
 * “[待核对]”, “[配图待核对]”, “〔公式待核对〕” or “（待核对续页）”. Plain prose mentioning 待核对 is not one.
 * The editor highlights the same notes.
 */
export const REVIEW_MARKER_PATTERN = /[[【〔（(][^[\]【】〔〕（）()\n]{0,8}待核对[^[\]【】〔〕（）()\n]{0,8}[\]】〕）)]/;

interface ReviewNode {
  type: string;
  text?: string;
  attrs?: { [key: string]: unknown; id?: string; number?: { mode: string; label?: string } };
  content?: ReviewNode[];
}

/** Upgrade old records conservatively: their nodeId often points at the first
 * block of an entire page, so it must never be treated as a question owner. */
export function associateQuestionNotices(notices: ImportNotice[], document: ChalkLeeDocument): ImportNotice[] {
  const questions: { id: string; path: string[]; nodes: Set<string> }[] = [];
  const markers: ImportNotice[] = [];
  const visit = (node: ReviewNode, parents: string[], owners: typeof questions) => {
    const id = node.attrs?.id;
    if (id && (node.type === "question" || node.type === "questionGroup")) {
      const label = node.attrs?.number?.mode === "fixed" ? normalizeImportNumber(node.attrs.number.label ?? "") : "";
      const question = { id, path: [...parents, label], nodes: new Set<string>() };
      questions.push(question);
      owners = [...owners, question];
      parents = question.path;
    }
    if (id) owners.forEach(owner => owner.nodes.add(id));
    if (node.text && REVIEW_MARKER_PATTERN.test(node.text) && owners.length) {
      const owner = owners.at(-1)!;
      if (!markers.some(notice => notice.questionIds?.includes(owner.id))) markers.push({
        message: "题目中有待核对标记，请对照原稿检查。", questionIds: [owner.id], nodeId: owner.id
      });
    }
    node.content?.forEach(child => visit(child, parents, owners));
  };
  visit(document.content, [], []);
  const anchors = document.provenance?.anchors ?? [];
  const questionIds = new Set(questions.map(question => question.id));
  const resolved = notices.map(notice => {
    if (notice.questionIds) return { ...notice, questionIds: [...new Set(notice.questionIds.filter(id => questionIds.has(id)))] };
    if (/^(本页有从页面裁取的题图|已保留原稿副本|局部校对修订公式|局部图像核对已按原稿保留文字)/.test(notice.message)) return { ...notice, questionIds: [] };
    const ids = new Set<string>();
    // Only explicit printed question references; a page-wide notice stays in
    // the conversion record even when its navigation node happens to be a question.
    for (const match of notice.message.matchAll(/第\s*([\dA-Za-z一二三四五六七八九十百（()）]+(?:\s*[·/、]\s*[\dA-Za-z一二三四五六七八九十百（()）]+)*)\s*题/g)) {
      const paths = match[1].split(/\s*[·/]\s*/).map(normalizeImportNumber);
      // “第1、2题” lists peers; “第20 · 1题” identifies a nested question.
      const references = paths.length === 1 ? paths[0].split("、").map(label => [label]) : [paths];
      for (const reference of references) {
        let candidates = questions.filter(question => reference.length > 1
          ? JSON.stringify(question.path) === JSON.stringify(reference)
          : question.path.at(-1) === reference[0]);
        if (candidates.length > 1) {
          const origin = anchors.find(anchor => anchor.nodeId === notice.nodeId)?.locator;
          const scoped = candidates.filter(question => anchors.some(anchor => question.nodes.has(anchor.nodeId)
            && (notice.page ? anchor.locator.kind === "pdf" && anchor.locator.page === notice.page
              : (origin?.kind === "doc" || origin?.kind === "docx" || origin?.kind === "markdown") && anchor.locator.kind === origin.kind && anchor.locator.note === origin.note)));
          if (scoped.length) candidates = scoped;
        }
        if (candidates.length === 1) ids.add(candidates[0].id);
      }
    }
    return { ...notice, questionIds: [...ids] };
  });
  // A visible source marker is precise even when the model's warning was vague.
  for (const marker of markers) if (!resolved.some(notice => notice.questionIds.includes(marker.questionIds![0]))) resolved.push({ ...marker, questionIds: marker.questionIds! });
  return resolved;
}

export function questionReviewNotices(notices: ImportNotice[], visibleQuestionIds?: Iterable<string>): Map<string, ImportNotice[]> {
  const visible = visibleQuestionIds ? new Set(visibleQuestionIds) : null;
  const result = new Map<string, ImportNotice[]>();
  for (const notice of notices) for (const id of new Set(notice.questionIds ?? [])) {
    if (visible && !visible.has(id)) continue;
    result.set(id, [...(result.get(id) ?? []), notice]);
  }
  return result;
}
