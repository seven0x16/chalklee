/** Fold from the right so the disclosure absorbs one control at a time. */
export const CHALKLEE_TOOLBAR_OVERFLOW_ORDER = [
  "alignment",
  "indent",
  "lineHeight",
  "orderedList",
  "bulletList",
  "highlight",
  "textColor",
  "fontSettings",
  "bold",
  "fontSize",
  "fontFamily",
  "blockStyle",
  "add"
] as const;

export type ChalkLeeToolbarOverflowItem = (typeof CHALKLEE_TOOLBAR_OVERFLOW_ORDER)[number];

/** Flat buttons shown while the toolbar is wide; they fold into menu triggers as it narrows. */
export const CHALKLEE_TOOLBAR_FLAT_STYLE_ITEMS = ["italic", "underline", "strike", "superscript", "subscript"] as const;
export const CHALKLEE_TOOLBAR_FLAT_INDENT_ITEMS = ["indentIncrease", "indentDecrease"] as const;
export const CHALKLEE_TOOLBAR_FLAT_ALIGN_ITEMS = ["alignLeft", "alignCenter", "alignRight", "alignJustify"] as const;
/** Intra-group dividers between the flat line-height/indent/alignment buttons. */
export const CHALKLEE_TOOLBAR_FLAT_DIVIDER_ITEMS = ["lineIndentDivider", "indentAlignDivider"] as const;

export type ChalkLeeToolbarFlatItem =
  | (typeof CHALKLEE_TOOLBAR_FLAT_STYLE_ITEMS)[number]
  | (typeof CHALKLEE_TOOLBAR_FLAT_INDENT_ITEMS)[number]
  | (typeof CHALKLEE_TOOLBAR_FLAT_ALIGN_ITEMS)[number]
  | (typeof CHALKLEE_TOOLBAR_FLAT_DIVIDER_ITEMS)[number];

export type ChalkLeeToolbarItemId = ChalkLeeToolbarOverflowItem | ChalkLeeToolbarFlatItem;

/**
 * Staged collapse ahead of the second-row overflow: 0 keeps every control flat;
 * 1 folds alignment into one trigger; 2 also folds indent; 3 also folds the
 * font styles into “更多字体设置”. The overflow row only engages at level 3.
 */
export type ChalkLeeToolbarCollapseLevel = 0 | 1 | 2 | 3;

/** Common document font sizes; the input also accepts arbitrary half-point values. */
export const CHALKLEE_FONT_SIZE_PRESETS = [
  5, 5.5, 6.5, 7.5, 8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72
] as const;

export interface ChalkLeeFontFamilyPreset {
  label: string;
  value: string;
}

/**
 * Document font presets use CSS fallback chains for platform-specific family names.
 */
export const CHALKLEE_FONT_FAMILY_PRESETS: readonly ChalkLeeFontFamilyPreset[] = [
  { label: "等线", value: "DengXian, sans-serif" },
  { label: "宋体", value: "Songti SC, SimSun, Noto Serif CJK SC, serif" },
  { label: "黑体", value: "Heiti SC, SimHei, Noto Sans CJK SC, sans-serif" },
  { label: "微软雅黑", value: "Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif" },
  { label: "楷体", value: "Kaiti SC, KaiTi, STKaiti, serif" },
  { label: "仿宋", value: "STFangsong, FangSong, serif" },
  { label: "仿宋_GB2312", value: "FangSong_GB2312, FangSong, STFangsong, serif" },
  { label: "楷体_GB2312", value: "KaiTi_GB2312, KaiTi, Kaiti SC, serif" },
  { label: "方正小标宋简体", value: "FZXiaoBiaoSong-B05S, 方正小标宋简体, Songti SC, serif" },
  { label: "Calibri", value: "Calibri, Carlito, sans-serif" },
  { label: "Arial", value: "Arial, Liberation Sans, sans-serif" },
  { label: "Times New Roman", value: "Times New Roman, Liberation Serif, serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Verdana", value: "Verdana, sans-serif" },
  { label: "Tahoma", value: "Tahoma, sans-serif" },
  { label: "Cambria", value: "Cambria, Caladea, serif" },
  { label: "Garamond", value: "Garamond, serif" },
  { label: "Trebuchet MS", value: "Trebuchet MS, sans-serif" },
  { label: "Segoe UI", value: "Segoe UI, sans-serif" },
  { label: "Courier New", value: "Courier New, Liberation Mono, monospace" },
  { label: "Impact", value: "Impact, sans-serif" },
  { label: "Yu Gothic", value: "Yu Gothic, sans-serif" },
  { label: "Yu Mincho", value: "Yu Mincho, serif" },
  { label: "Meiryo", value: "Meiryo, sans-serif" },
  { label: "MS Gothic", value: "MS Gothic, monospace" },
  { label: "MS Mincho", value: "MS Mincho, serif" },
  { label: "Malgun Gothic", value: "Malgun Gothic, sans-serif" },
  { label: "Batang", value: "Batang, serif" },
  { label: "Gulim", value: "Gulim, sans-serif" },
  { label: "Dotum", value: "Dotum, sans-serif" },
  { label: "Microsoft JhengHei", value: "Microsoft JhengHei, sans-serif" },
  { label: "PMingLiU", value: "PMingLiU, serif" }
];

/** Shows one concrete font name, preferring the Chinese face in a mixed-script fallback chain. */
export function chalkLeeFontFamilyLabel(value: string) {
  const families = value.split(",").map((family) => family.trim().replace(/^(['"])(.*)\1$/, "$2"));
  const labels = CHALKLEE_FONT_FAMILY_PRESETS
    .filter((preset) => families.includes(preset.value.split(",")[0].trim()))
    .map((preset) => preset.label);
  return labels[0] || families[0] || value;
}

export const CHALKLEE_THEME_COLORS = [
  "#FFFFFF", "#000000", "#E7E6E6", "#0E2841", "#156082",
  "#E97132", "#196B24", "#0F9ED5", "#A02B93", "#4EA72E"
] as const;

export const CHALKLEE_THEME_COLOR_SHADES = [
  ["#F2F2F2", "#7F7F7F", "#D0CECE", "#DDEBF7", "#DDEBF7", "#FCE4D6", "#E2F0D9", "#DDEBF7", "#E4DFEC", "#E2F0D9"],
  ["#D9D9D9", "#595959", "#AEAAAA", "#BDD7EE", "#9DC3E6", "#F8CBAD", "#C6E0B4", "#9DC3E6", "#D9E1F2", "#C6E0B4"],
  ["#BFBFBF", "#3F3F3F", "#757171", "#8EA9DB", "#5B9BD5", "#F4B084", "#A9D18E", "#5B9BD5", "#B4C6E7", "#A9D18E"],
  ["#A6A6A6", "#262626", "#3A3838", "#4472C4", "#2E75B6", "#C65911", "#70AD47", "#00B0F0", "#8064A2", "#70AD47"],
  ["#808080", "#0D0D0D", "#171616", "#203864", "#1F4E78", "#843C0C", "#375623", "#0070C0", "#5B315E", "#385723"]
] as const;

export const CHALKLEE_STANDARD_COLORS = [
  "#C00000", "#FF0000", "#FFC000", "#FFFF00", "#92D050",
  "#00B050", "#00B0F0", "#0070C0", "#002060", "#7030A0"
] as const;

export const CHALKLEE_HIGHLIGHT_COLORS = [
  "#FFFF00", "#00FF00", "#00FFFF", "#FF00FF", "#0000FF",
  "#FF0000", "#00008B", "#008B8B", "#006400", "#8B008B",
  "#8B0000", "#808000", "#808080", "#C0C0C0", "#000000"
] as const;

export function normalizeChalkLeeFontSize(value: unknown): number | null {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return null;
  return Math.round(Math.min(1638, Math.max(1, size)) * 2) / 2;
}

/** Flat variants occupy their collapsed counterpart's slot in the overflow panel. */
export const CHALKLEE_TOOLBAR_VISUAL_ORDER: ChalkLeeToolbarItemId[] = [
  "add", "blockStyle", "fontFamily", "fontSize", "bold",
  "italic", "underline", "strike", "superscript", "subscript", "fontSettings",
  "textColor", "highlight", "bulletList", "orderedList",
  "lineHeight", "indentIncrease", "indentDecrease", "indent",
  "alignLeft", "alignCenter", "alignRight", "alignJustify", "alignment"
];

export interface ChalkLeeToolbarGroupSpec {
  id: string;
  items: ChalkLeeToolbarItemId[];
  gap: number;
}

export function chalkLeeToolbarGroupsForLevel(level: ChalkLeeToolbarCollapseLevel): ChalkLeeToolbarGroupSpec[] {
  return [
    { id: "add", items: ["add"], gap: 2 },
    { id: "blockStyle", items: ["blockStyle"], gap: 4 },
    { id: "fontFamily", items: ["fontFamily"], gap: 4 },
    {
      id: "text",
      items: level >= 3 ? ["fontSize", "bold", "fontSettings"] : ["fontSize", "bold", ...CHALKLEE_TOOLBAR_FLAT_STYLE_ITEMS],
      gap: 4
    },
    { id: "color", items: ["textColor", "highlight"], gap: 2 },
    { id: "list", items: ["bulletList", "orderedList"], gap: 2 },
    {
      id: "paragraph",
      items: level === 0
        ? ["lineHeight", "lineIndentDivider", ...CHALKLEE_TOOLBAR_FLAT_INDENT_ITEMS, "indentAlignDivider", ...CHALKLEE_TOOLBAR_FLAT_ALIGN_ITEMS]
        : level === 1
          ? ["lineHeight", "lineIndentDivider", ...CHALKLEE_TOOLBAR_FLAT_INDENT_ITEMS, "indentAlignDivider", "alignment"]
          : ["lineHeight", "indent", "alignment"],
      gap: 2
    }
  ];
}

export interface ChalkLeeToolbarOverflowMetrics {
  availableWidth: number;
  pinnedWidth: number;
  overflowButtonWidth: number;
  paddingWidth: number;
  itemWidths: Partial<Record<ChalkLeeToolbarItemId, number>>;
  /** Separator box, its margins, and the gap before the group's first item. */
  separatorWidths: Partial<Record<string, number>>;
  /** Actual CSS gaps; presets are used by non-DOM callers. */
  groupGaps?: Partial<Record<string, number>>;
}

const FIT_SLACK = 0;

function isHidden(hidden: ReadonlySet<ChalkLeeToolbarItemId>, id: ChalkLeeToolbarItemId) {
  return hidden.has(id);
}

export function chalkLeeToolbarOccupiedWidth(
  hiddenItems: readonly ChalkLeeToolbarItemId[],
  metrics: ChalkLeeToolbarOverflowMetrics,
  level: ChalkLeeToolbarCollapseLevel = 3
): number {
  const hidden = new Set(hiddenItems);
  let width = metrics.pinnedWidth + metrics.paddingWidth;
  if (hidden.size > 0) width += metrics.overflowButtonWidth;
  for (const group of chalkLeeToolbarGroupsForLevel(level)) {
    const visible = group.items.filter((id) => !isHidden(hidden, id));
    if (visible.length === 0) continue;
    width += metrics.separatorWidths[group.id] ?? 0;
    visible.forEach((id, index) => {
      width += metrics.itemWidths[id] ?? 0;
      if (index > 0) width += metrics.groupGaps?.[group.id] ?? group.gap;
    });
  }
  return width;
}

function chalkLeeToolbarMetricsValid(metrics: ChalkLeeToolbarOverflowMetrics): boolean {
  const values = [
    metrics.availableWidth,
    metrics.pinnedWidth,
    metrics.overflowButtonWidth,
    metrics.paddingWidth,
    ...Object.values(metrics.itemWidths),
    ...Object.values(metrics.separatorWidths),
    ...Object.values(metrics.groupGaps ?? {})
  ];
  return values.every((value) => Number.isFinite(value)) && metrics.availableWidth > 0;
}

/** Picks the flattest level that still fits; level 3 hands over to the overflow row. */
export function chalkLeeToolbarCollapseLevel(metrics: ChalkLeeToolbarOverflowMetrics): ChalkLeeToolbarCollapseLevel {
  if (!chalkLeeToolbarMetricsValid(metrics)) return 3;
  for (const level of [0, 1, 2] as const) {
    if (chalkLeeToolbarOccupiedWidth([], metrics, level) <= metrics.availableWidth + FIT_SLACK) return level;
  }
  return 3;
}

export function sameChalkLeeToolbarOverflow(
  left: readonly ChalkLeeToolbarOverflowItem[],
  right: readonly ChalkLeeToolbarOverflowItem[]
): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function chalkLeeToolbarHiddenItems(metrics: ChalkLeeToolbarOverflowMetrics): ChalkLeeToolbarOverflowItem[] {
  if (!chalkLeeToolbarMetricsValid(metrics)) {
    return [...CHALKLEE_TOOLBAR_OVERFLOW_ORDER];
  }
  if (chalkLeeToolbarOccupiedWidth([], metrics) <= metrics.availableWidth + FIT_SLACK) return [];
  const hidden: ChalkLeeToolbarOverflowItem[] = [];
  for (const id of CHALKLEE_TOOLBAR_OVERFLOW_ORDER) {
    hidden.push(id);
    if (chalkLeeToolbarOccupiedWidth(hidden, metrics) <= metrics.availableWidth + FIT_SLACK) return hidden;
  }
  return hidden;
}
