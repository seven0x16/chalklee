import type { ImportNotice, ImportRecord } from "./types";

export interface ConversionNotice extends ImportNotice {
  id: string;
  kind?: "notice" | "source-preserved";
}
export interface ConversionReview {
  notices: ConversionNotice[];
  checkedIds: string[];
}
export function conversionNoticeId(message: string, page?: number, nodeId?: string): string {
  let value = 2166136261;
  for (const char of `${nodeId ?? ""}|${page ?? ""}|${message}`) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return `notice_${(value >>> 0).toString(16)}`;
}
export function conversionReviewFromRecord(record: Pick<ImportRecord, "warnings" | "conversion">): ConversionReview {
  const preserved = record.conversion?.units?.filter(unit => unit.status === "source-preserved") ?? [];
  const notices: ConversionNotice[] = preserved.map(unit => {
    const message = unit.reason ?? "本页尚未完成转换，已保留原图。";
    return { id: conversionNoticeId(message, unit.page, unit.nodeId), message, ...(unit.page ? { page: unit.page } : {}), ...(unit.nodeId ? { nodeId: unit.nodeId } : {}), kind: "source-preserved" };
  });
  for (const notice of record.warnings) {
    if (preserved.some(unit => notice.page && unit.page === notice.page && (notice.nodeId === unit.nodeId || notice.message.includes("整页原图")))) continue;
    // Routine source-retention and crop advice belongs in the record, not a warning badge on every page.
    if (/^(本页有从页面裁取的题图|已保留原稿副本)/.test(notice.message)) continue;
    const id = conversionNoticeId(notice.message, notice.page, notice.nodeId);
    if (!notices.some(item => item.id === id)) notices.push({ ...notice, id, kind: "notice" });
  }
  return { notices, checkedIds: [] };
}
export function pendingConversionNotices(review?: ConversionReview): ConversionNotice[] {
  return review?.notices.filter(notice => notice.kind === "source-preserved" || !review.checkedIds.includes(notice.id)) ?? [];
}
