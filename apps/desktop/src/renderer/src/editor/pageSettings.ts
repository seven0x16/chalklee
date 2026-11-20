import type { EditorState } from "@tiptap/pm/state";
import type { ChalkLeePageAppearance } from "@chalklee/format";
import { chalkLeeColumnLayout, chalkLeePageSizePt, CHALKLEE_MAX_COLUMNS } from "./pagination";

export type ChalkLeePagePatch = Omit<Partial<ChalkLeePageAppearance>, "marginsPt"> & {
  marginsPt?: Partial<ChalkLeePageAppearance["marginsPt"]>;
};

export const chalkLeeMarginPresets = [
  { id: "narrow", label: "窄", pt: 36 },
  { id: "standard", label: "标准", pt: 72 },
  { id: "wide", label: "宽", pt: 90 }
] as const;

export function chalkLeeMarginPreset(page: ChalkLeePageAppearance) {
  return chalkLeeMarginPresets.find(preset => Object.values(page.marginsPt).every(value => Math.abs(value - preset.pt) < .05))?.id ?? "custom";
}

/** Slides lie wide with narrow margins; leaving them, paper stands upright again. */
export function chalkLeePaperSizePatch(page: ChalkLeePageAppearance, size: ChalkLeePageAppearance["size"]): ChalkLeePagePatch {
  if (size === "slide") return { size, orientation: "landscape", marginsPt: { top: 36, right: 36, bottom: 36, left: 36 } };
  return page.size === "slide" ? { size, orientation: "portrait" } : { size };
}

/** Page edits use document steps so they share undo, autosave and content revision tracking. */
export function chalkLeePageSettingsTransaction(state: EditorState, patch: ChalkLeePagePatch) {
  const current = state.doc.attrs.runtimePage as ChalkLeePageAppearance | null;
  if (!current) return null;
  const page = { ...current, ...patch, marginsPt: { ...current.marginsPt, ...patch.marginsPt } };
  const { width, height } = chalkLeePageSizePt(page);
  const margins = page.marginsPt;
  if (![width, height].every(value => Number.isFinite(value) && value > 0)
    || !Object.values(margins).every(value => Number.isFinite(value) && value >= 0)
    || margins.left + margins.right > width - 36
    || margins.top + margins.bottom > height - 36
    || (page.columnCount != null && (!Number.isInteger(page.columnCount) || page.columnCount < 1 || page.columnCount > CHALKLEE_MAX_COLUMNS))
    || (page.columnGapPt != null && (!Number.isFinite(page.columnGapPt) || page.columnGapPt < 0))
    || (page.columnCount ?? 1) > chalkLeeColumnLayout(page).maxCount
    || JSON.stringify(current) === JSON.stringify(page)) return null;
  return state.tr.setDocAttribute("runtimePage", page);
}
