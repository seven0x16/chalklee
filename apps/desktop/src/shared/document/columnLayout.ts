import { chalkLeePageSize, type ChalkLeePageAppearance } from "@chalklee/format";

export const CHALKLEE_DEFAULT_COLUMN_GAP_PT = 24;
export const CHALKLEE_MIN_COLUMN_WIDTH_PT = 72;
export const CHALKLEE_MAX_COLUMNS = 12;

/** Shared geometry for the inspector, editable paper, print surface and question cards. */
export function chalkLeeColumnLayout(page: ChalkLeePageAppearance) {
  const contentWidthPt = chalkLeePageSize(page).width - page.marginsPt.left - page.marginsPt.right;
  const gapPt = Number.isFinite(page.columnGapPt) && page.columnGapPt! >= 0 ? page.columnGapPt! : CHALKLEE_DEFAULT_COLUMN_GAP_PT;
  const maxCount = Math.max(1, Math.min(CHALKLEE_MAX_COLUMNS,
    Math.floor((contentWidthPt + gapPt) / (CHALKLEE_MIN_COLUMN_WIDTH_PT + gapPt))));
  const count = Number.isInteger(page.columnCount) ? Math.max(1, Math.min(maxCount, page.columnCount!)) : 1;
  return { count, gapPt, maxCount, widthPt: (contentWidthPt - (count - 1) * gapPt) / count,
    maxGapPt: count > 1 ? Math.max(0, (contentWidthPt - count * CHALKLEE_MIN_COLUMN_WIDTH_PT) / (count - 1)) : contentWidthPt };
}
