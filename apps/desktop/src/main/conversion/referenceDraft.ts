import type { ChalkLeeDocument } from "@chalklee/format";
import type { PreparedImport } from "../../shared/conversion/types";
import { wordSourceEntries } from "../../shared/conversion/wordSource";
import { assertImportDocument } from "../../shared/conversion/importDocument";
import { compileAutonomousDraft, type AutonomousDraft } from "./autonomous/state";
import { preserveImportFragment } from "./draft";

export function referenceSourceEntries(input: PreparedImport) {
  return input.units.flatMap(unit => wordSourceEntries(unit.blocks, unit.sourceRoles, unit.sourceQuestionNumbers)
    .filter(entry => entry.text.trim()).map(entry => ({ ...entry, unitId: unit.id })));
}

export const collectSourceRefs = (value: any, refs: string[] = []): string[] => {
  if (!value || typeof value !== "object") return refs;
  if (typeof value.ref === "string") refs.push(value.ref);
  Object.values(value).forEach(child => collectSourceRefs(child, refs));
  return refs;
};

const ALIGN_LABELS: Record<string, string> = { center: "居中", right: "右对齐" };

/** Layout hints shown beside a source paragraph, which the shared assembly rules refer to. */
export function sourceLayoutLabels(block: any, text: string): string[] {
  const paragraph = block?.type === "paragraph" || block?.type === "heading" ? block : undefined;
  const runs = paragraph?.content?.filter((node: any) => node.type === "text" && node.text.trim());
  const boldShortLine = text.trim().replace(/\s*\n\s*/g, "↵").length <= 60 && runs?.length && runs.every((node: any) => node.marks?.some((mark: any) => mark.type === "bold"));
  return [block?.type === "table" ? "表格" : "", ALIGN_LABELS[paragraph?.attrs?.textAlign ?? ""], (paragraph?.attrs?.firstLineIndentPt ?? 0) > 0 ? "首行缩进" : "", boldShortLine ? "加粗短行" : ""].filter(Boolean);
}

// While a paper is still being organized, one line per unplaced paragraph or
// page repeats the whole source after every write. Report what is left as a
// count; paragraphs used twice and every other check stay listed.
const UNPLACED = /必须恰好引用一次，当前 0 次|尚无对应的文档片段|尚未查看原稿/;
const REPORT_LIMIT = 30;

/** What a converting agent needs after each write, the same for ChalkLee AI and external AI applications. */
export function assemblyProgress(input: PreparedImport, draft: AutonomousDraft, issues: string[]) {
  const used = new Set(draft.fragments.flatMap(fragment => collectSourceRefs(fragment.blocks)));
  const units = input.units.filter(unit => unit.nativeReferences);
  const missing = referenceSourceEntries({ ...input, units }).filter(entry => !used.has(entry.ref));
  const unreadUnits = units.filter(unit => !draft.seenUnits.includes(unit.id)).map(unit => unit.id);
  const other = issues.filter(issue => !UNPLACED.test(issue));
  return {
    remaining: { count: missing.length, refs: missing.slice(0, REPORT_LIMIT).map(entry => entry.ref), ...(unreadUnits.length ? { unreadUnits } : {}) },
    issues: other.slice(0, REPORT_LIMIT), ...(other.length > REPORT_LIMIT ? { moreIssues: other.length - REPORT_LIMIT } : {})
  };
}

/** Paragraphs the agent has not placed yet stay where they were printed, so an unfinished run still delivers the whole paper. */
export function withOriginalParagraphs(input: PreparedImport, draft: AutonomousDraft): AutonomousDraft {
  const used = new Set(draft.fragments.flatMap(fragment => collectSourceRefs(fragment.blocks)));
  const rest = referenceSourceEntries(input).flatMap((entry, index) => used.has(entry.ref) ? [] : [{ key: `original_${index + 1}`, order: index, unitIds: [entry.unitId], blocks: [{ ref: entry.ref }], continuesPrevious: false, warnings: [] }]);
  return { ...draft, fragments: [...draft.fragments, ...rest] };
}

/** The unfinished paper: the agent's structure where it compiles, the original paragraphs everywhere else. */
export function compileUnfinishedReferenceDraft(input: PreparedImport, template: ChalkLeeDocument, draft: AutonomousDraft) {
  let compiled: ReturnType<typeof compileAutonomousDraft>;
  try { compiled = compileAutonomousDraft(input, template, withOriginalParagraphs(input, draft), true); }
  catch { compiled = compileAutonomousDraft(input, template, withOriginalParagraphs(input, { ...draft, fragments: [] }), true); }
  try { assertImportDocument(compiled.document); }
  catch { compiled.document.content.content = compiled.document.content.content.flatMap(preserveImportFragment); }
  return compiled;
}
