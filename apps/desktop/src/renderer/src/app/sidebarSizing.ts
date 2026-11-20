export type SidebarSide = "left" | "right";

export interface SidebarWidths {
  left: number;
  right: number;
}

export interface SidebarVisibility {
  left: boolean;
  right: boolean;
}

export interface SidebarLimit { default: number; min: number; max: number }
export type SidebarLimits = Record<SidebarSide, SidebarLimit>;

// On Windows the window buttons share the right pane's title bar segment, which then needs a wider pane to hold them.
const windowButtonsInTitleBar = typeof window !== "undefined" && Boolean(window.chalkLee?.windowControls);

export const SIDEBAR_LIMITS = {
  left: { default: 248, min: 200, max: 420 },
  right: { default: 380, min: windowButtonsInTitleBar ? 256 : 200, max: 620 }
} as const;

export const COLLAPSE_DRAG_DISTANCE = 28;

export const SIDEBAR_COLLAPSE_THRESHOLDS = {
  left: SIDEBAR_LIMITS.left.min - COLLAPSE_DRAG_DISTANCE,
  right: SIDEBAR_LIMITS.right.min - COLLAPSE_DRAG_DISTANCE
} as const;

export const DEFAULT_SIDEBAR_WIDTHS: SidebarWidths = {
  left: SIDEBAR_LIMITS.left.default,
  right: SIDEBAR_LIMITS.right.default
};

// Space reserved for the shell's 8px outer padding and the two 8px gutters between the cards.
const FIXED_LAYOUT_WIDTH = 32;
const MIN_DOCUMENT_WIDTH = 480;
/** Below this the paper gets hard to read, so the inspector makes way unless the teacher opened it. */
export const COMFORTABLE_DOCUMENT_WIDTH = 640;

/** Whether even the narrowest right pane, at its current content's minimum, would squeeze the paper below a comfortable width. */
export function inspectorCrowdsDocument(containerWidth: number, leftWidth: number, rightMinimum: number = SIDEBAR_LIMITS.right.min): boolean {
  return containerWidth - FIXED_LAYOUT_WIDTH - leftWidth - rightMinimum < COMFORTABLE_DOCUMENT_WIDTH;
}

export function normalizeSidebarWidths(widths: Partial<SidebarWidths>, limits: SidebarLimits = SIDEBAR_LIMITS): SidebarWidths {
  return {
    left: clampAbsolute(limits.left, widths.left ?? limits.left.default),
    right: clampAbsolute(limits.right, widths.right ?? limits.right.default)
  };
}

export function clampSidebarWidth(
  side: SidebarSide,
  requestedWidth: number,
  widths: SidebarWidths,
  containerWidth: number,
  visibility: SidebarVisibility,
  allLimits: SidebarLimits = SIDEBAR_LIMITS
): number {
  const limits = allLimits[side];
  const otherSide = side === "left" ? "right" : "left";
  const otherWidth = visibility[otherSide] ? widths[otherSide] : 0;
  const layoutMaximum = containerWidth - FIXED_LAYOUT_WIDTH - MIN_DOCUMENT_WIDTH - otherWidth;
  const maximum = Math.max(limits.min, Math.min(limits.max, layoutMaximum));
  return Math.round(Math.min(maximum, Math.max(limits.min, finiteOr(requestedWidth, limits.default))));
}

export function fitSidebarWidths(
  widths: SidebarWidths,
  containerWidth: number,
  visibility: SidebarVisibility,
  allLimits: SidebarLimits = SIDEBAR_LIMITS
): SidebarWidths {
  const normalized = normalizeSidebarWidths(widths, allLimits);
  const visibleSides = (["left", "right"] as const).filter((side) => visibility[side]);
  if (!visibleSides.length) return normalized;

  const available = Math.max(
    visibleSides.reduce((total, side) => total + allLimits[side].min, 0),
    containerWidth - FIXED_LAYOUT_WIDTH - MIN_DOCUMENT_WIDTH
  );
  const occupied = visibleSides.reduce((total, side) => total + normalized[side], 0);
  if (occupied <= available) return normalized;

  const minimumTotal = visibleSides.reduce((total, side) => total + allLimits[side].min, 0);
  const extraTotal = occupied - minimumTotal;
  const extraAvailable = Math.max(0, available - minimumTotal);
  const ratio = extraTotal > 0 ? Math.min(1, extraAvailable / extraTotal) : 0;
  const next = { ...normalized };

  for (const side of visibleSides) {
    const limits = allLimits[side];
    next[side] = Math.round(limits.min + (normalized[side] - limits.min) * ratio);
  }
  return next;
}

function clampAbsolute(limits: SidebarLimit, width: number): number {
  return Math.round(Math.min(limits.max, Math.max(limits.min, finiteOr(width, limits.default))));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
