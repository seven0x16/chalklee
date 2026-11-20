import type { JSONContent } from "@tiptap/core";

export const isSolutionRegion = (type?: string) => type === "questionAnswer" || type === "questionAnalysis";

/** The editing order follows the paper. Archives retain each subquestion's
 * original answer/analysis, IDs, marks, assets and appearance attributes. */
export function restoreChalkLeeGroupSolutions(node: JSONContent): JSONContent {
  if (!node.content) return node;
  const children = node.content.map(restoreChalkLeeGroupSolutions);
  if (node.type !== "questionGroup") return { ...node, content: children };
  const solutions = new Map<string, JSONContent[]>();
  const summaries = children.filter(child => child.type === "questionSolution");
  // A marker typed in an answer may temporarily create analysis in that same
  // wrapper. Merge it after the existing analysis, without losing either text.
  for (const child of summaries) {
    const id = String(child.attrs?.questionId);
    const type = child.attrs?.regionType || child.content?.[0]?.type;
    solutions.set(id, [...(solutions.get(id) ?? []), ...(child.content?.filter(region => region.type === type) ?? [])]);
  }
  for (const child of summaries) {
    const id = String(child.attrs?.questionId), regions = solutions.get(id)!;
    const type = child.attrs?.regionType || child.content?.[0]?.type;
    for (const region of child.content?.filter(region => region.type !== type) ?? []) {
      const index = regions.findIndex(existing => existing.type === region.type);
      if (index < 0) regions.push(region);
      else regions[index] = {...regions[index], content:[...(regions[index].content ?? []), ...(region.content ?? [])]};
    }
  }
  const restoreRegions = (question: JSONContent): JSONContent => {
    const regions = solutions.get(String(question.attrs?.id));
    if (!regions) return question;
    const existing = question.content ?? [];
    return { ...question, content: [
      ...existing.filter(part => !isSolutionRegion(part.type)),
      ...["questionAnswer", "questionAnalysis"].flatMap(type => {
        const authored = existing.find(part => part.type === type), saved = regions.find(part => part.type === type);
        // Authoring a region marker can create a fresh region in the stem
        // before the layout transaction. Append it without discarding an
        // existing answer. A matching ID is an intentional edit of that region.
        const region = authored && saved && authored.attrs?.id !== saved.attrs?.id
          ? {...saved, content:[...(saved.content ?? []), ...(authored.content ?? [])]} : authored ?? saved;
        return region ? [region] : [];
      })
    ] };
  };
  return restoreRegions({ ...node, content: children.filter(child => child.type !== "questionSolution").map(child => child.type !== "subQuestionList" ? child : {
    ...child, content: child.content?.map(restoreRegions)
  }) });
}

function authoredIds(node: JSONContent, ids = new Set<string>()): Set<string> {
  if (node.type !== "questionSolution" && typeof node.attrs?.id === "string") ids.add(node.attrs.id);
  node.content?.forEach(child => authoredIds(child, ids));
  return ids;
}

export function projectChalkLeeGroupSolutions(node: JSONContent, usedIds = authoredIds(node)): JSONContent {
  if (!node.content) return node;
  const previousIds = new Map(node.content.filter(child => child.type === "questionSolution")
    .map(child => [`${child.attrs?.questionId}:${child.attrs?.regionType || child.content?.[0]?.type}`, child.attrs?.id as string | undefined]));
  const canonical = node.type === "questionGroup" ? restoreChalkLeeGroupSolutions(node) : node;
  const children = canonical.content!.map(child => projectChalkLeeGroupSolutions(child, usedIds));
  if (node.type !== "questionGroup") return { ...node, content: children };
  const solutions: JSONContent[] = [];
  const projectRegions = (question: JSONContent, label: string): JSONContent => {
    const regions = question.content?.filter(part => isSolutionRegion(part.type)) ?? [];
    if (!regions.length) return question;
    for (const region of regions) {
      const baseId = previousIds.get(`${question.attrs?.id}:${region.type}`)
        ?? `solution_${question.attrs?.id}${region.type === "questionAnalysis" ? "_analysis" : ""}`;
      let id = baseId, suffix = 2;
      while (usedIds.has(id)) id = `${baseId}_${suffix++}`;
      usedIds.add(id);
      solutions.push({ type: "questionSolution", attrs: {id, questionId: question.attrs?.id, label, heading: "", regionType: region.type}, content: [region] });
    }
    return { ...question, content: question.content?.filter(part => !isSolutionRegion(part.type)) };
  };
  // Common explanations and each child's detail share a single heading per
  // region. Ownership remains separate when editing or restoring the archive.
  const group = projectRegions({ ...node, content: children }, "");
  const content = group.content!.map(child => child.type !== "subQuestionList" ? child : {
    ...child, content: child.content?.map((question, index) => {
      const number = question.attrs?.number;
      const numberText = number?.mode === "fixed" && typeof number.label === "string" && number.label.trim() ? number.label.trim() : String(index + 1);
      const label = `${numberText.replace(/^[（(]/, "").replace(/[）).．、]+$/, "")})`;
      return projectRegions(question, label);
    })
  });
  const sections = ["questionAnswer", "questionAnalysis"].flatMap(type => solutions.filter(solution => solution.content?.[0]?.type === type)
    .map((solution, index) => ({...solution, attrs: {...solution.attrs, heading: index === 0
      ? (solution.content?.[0]?.attrs?.runtimeLabel ?? (type === "questionAnswer" ? "答案" : "解析")) : ""}})));
  return { ...node, content: [...content, ...sections] };
}
