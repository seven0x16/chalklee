import type { AutonomousFragment } from "./state";
import { isDeepStrictEqual } from "node:util";

export interface AutonomousEdit { key: string; path: (string | number)[]; expected: unknown; value: unknown }
const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);
const describeValue = (value: unknown) => {
  const text = JSON.stringify(value) ?? "undefined";
  return text.length > 800 ? `${text.slice(0, 800)}…（已截断，请读取完整片段）` : text;
};

/** Compare before replacing an existing value. An outdated path must fail
 * rather than silently edit a different question after earlier restructuring. */
export function applyAutonomousEdits(fragments: AutonomousFragment[], edits: AutonomousEdit[], viewedSources: Set<string>): AutonomousFragment[] {
  if (edits.length > 30 || JSON.stringify(edits).length > 200000) throw new Error("局部修改过多，请按题目分批提交。");
  const result = structuredClone(fragments);
  for (const edit of edits) {
    const fragment = result.find(fragment => fragment.key === edit.key);
    if (!fragment) throw new Error(`片段 ${edit.key} 不存在，请 read_draft 读取后再修改。`);
    if (fragment.unitIds.some(id => !viewedSources.has(id))) throw new Error("修改前请先 read_source 查看该片段的当前原稿。");
    if (!Array.isArray(edit.path) || edit.path.length < 2 || edit.path.length > 24 || edit.path[0] !== "blocks") throw new Error("局部修改 path 必须指向 blocks 内的现有内容。");
    let parent: any = fragment;
    for (const [index, key] of edit.path.entries()) {
      const validKey = Array.isArray(parent) ? Number.isInteger(key) && Number(key) >= 0 && Number(key) < parent.length : typeof key === "string" && !unsafeKeys.has(key);
      const location = `${edit.key} ${JSON.stringify(edit.path.slice(0, index + 1))}`;
      // A field a question does not have yet, such as answerFor, is added when expected is null.
      const adding = index === edit.path.length - 1 && edit.expected === null && edit.value !== undefined && edit.value !== null
        && parent && typeof parent === "object" && !Array.isArray(parent) && validKey && !Object.hasOwn(parent, key);
      if (adding) { parent[key] = structuredClone(edit.value); continue; }
      if (!parent || typeof parent !== "object" || !validKey || !Object.hasOwn(parent, key)) throw new Error(`局部修改路径不存在或无效：${location}；请 read_draft({keys:[${JSON.stringify(edit.key)}]}) 读取最新片段。`);
      if (index === edit.path.length - 1) {
        if (edit.expected === undefined || edit.value === undefined || !isDeepStrictEqual(parent[key], edit.expected)) throw new Error(`局部修改的 expected 与当前内容不符：${location}；当前值=${describeValue(parent[key])}；expected=${describeValue(edit.expected)}。本批次全部回滚，请读取最新片段并修正此项，勿重复原参数。`);
        parent[key] = structuredClone(edit.value);
      } else parent = parent[key];
    }
  }
  return result;
}
