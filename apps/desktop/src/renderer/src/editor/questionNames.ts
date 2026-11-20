import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { chalkLeeGroupContinuesNumbers, chalkLeeQuestionCounter } from "@chalklee/format";

/**
 * How a teacher names each question and group, by id, from the numbers the paper prints (chalkLeeQuestionCounter):
 * 第 3 题; a group's subquestion 第 4 题第 2 小题; or, in a group that continues the paper's numbers, 第 34 题, the
 * group itself being 第 33–36 题. A question shown without a number is 题目, such a group 题组.
 */
export function chalkLeeQuestionNames(doc: ProseMirrorNode): Map<string, string> {
  const names = new Map<string, string>(), counter = chalkLeeQuestionCounter();
  const counted = (node: ProseMirrorNode) => ({ type: node.type.name, attrs: node.attrs });
  // The number a question shows: its own label, its place, or none.
  const shown = (node: ProseMirrorNode, place: number | null) => {
    const number = node.attrs.number as { mode?: string; label?: string } | null;
    if (number?.mode === "fixed" && number.label?.trim()) return number.label.trim();
    return number?.mode === "none" || place === null ? null : String(place);
  };
  const visit = (parent: ProseMirrorNode) => parent.forEach(child => {
    if (child.type.name === "box") visit(child);
    else if (child.type.name === "question") {
      const label = shown(child, counter.next(counted(child)));
      names.set(String(child.attrs.id), label ? `第 ${label} 题` : "题目");
    } else if (child.type.name === "questionGroup") {
      const continues = chalkLeeGroupContinuesNumbers(counted(child));
      const groupLabel = shown(child, counter.next(counted(child)));
      const groupName = groupLabel ? `第 ${groupLabel} 题` : "题组";
      const sub = counter.group(counted(child)), labels: string[] = [];
      child.forEach(part => {
        if (part.type.name === "subQuestionList") part.forEach(question => {
          const label = shown(question, sub());
          if (continues && label) labels.push(label);
          names.set(String(question.attrs.id), continues ? label ? `第 ${label} 题` : "题目" : label ? `${groupName}第 ${label} 小题` : `${groupName}的小题`);
        });
      });
      names.set(String(child.attrs.id), !continues ? groupName : labels.length ? `第 ${labels[0]}${labels.length > 1 ? `–${labels[labels.length - 1]}` : ""} 题` : "题组");
    }
  });
  visit(doc);
  return names;
}
