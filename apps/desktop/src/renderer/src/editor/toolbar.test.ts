import { describe, expect, it } from "vitest";
import {
  CHALKLEE_FONT_FAMILY_PRESETS,
  CHALKLEE_FONT_SIZE_PRESETS,
  CHALKLEE_HIGHLIGHT_COLORS,
  CHALKLEE_STANDARD_COLORS,
  CHALKLEE_THEME_COLORS,
  CHALKLEE_THEME_COLOR_SHADES,
  CHALKLEE_TOOLBAR_OVERFLOW_ORDER,
  CHALKLEE_TOOLBAR_VISUAL_ORDER,
  chalkLeeFontFamilyLabel,
  chalkLeeToolbarCollapseLevel,
  chalkLeeToolbarHiddenItems,
  chalkLeeToolbarOccupiedWidth,
  normalizeChalkLeeFontSize,
  type ChalkLeeToolbarOverflowMetrics
} from "./toolbar";

const metrics: ChalkLeeToolbarOverflowMetrics = {
  availableWidth: 1100,
  pinnedWidth: 180,
  overflowButtonWidth: 32,
  paddingWidth: 20,
  itemWidths: {
    blockStyle: 76,
    fontFamily: 128,
    fontSize: 54,
    bold: 30,
    fontSettings: 30,
    textColor: 30,
    highlight: 30,
    bulletList: 30,
    orderedList: 30,
    lineHeight: 30,
    indent: 44,
    alignment: 44,
    add: 51
  },
  separatorWidths: {
    blockStyle: 15,
    fontFamily: 15,
    text: 15,
    color: 15,
    list: 15,
    paragraph: 15,
    add: 15
  }
};

describe("ChalkLee toolbar overflow", () => {
  it("keeps every control visible when the complete toolbar fits", () => {
    expect(chalkLeeToolbarHiddenItems(metrics)).toEqual([]);
    expect(chalkLeeToolbarHiddenItems({ ...metrics, availableWidth: chalkLeeToolbarOccupiedWidth([], metrics) })).toEqual([]);
  });

  it("folds the rightmost control first instead of a whole group", () => {
    const full = chalkLeeToolbarOccupiedWidth([], metrics);
    expect(chalkLeeToolbarHiddenItems({ ...metrics, availableWidth: full - 8 })).toEqual(["alignment"]);
    const afterAlignment = chalkLeeToolbarOccupiedWidth(["alignment"], metrics);
    expect(chalkLeeToolbarHiddenItems({ ...metrics, availableWidth: afterAlignment })).toEqual(["alignment"]);
  });

  it("keeps absorbing one control at a time as the surface gets narrower", () => {
    const afterAlignment = chalkLeeToolbarOccupiedWidth(["alignment"], metrics);
    expect(chalkLeeToolbarHiddenItems({ ...metrics, availableWidth: afterAlignment - 8 })).toEqual(["alignment", "indent"]);

    const afterIndent = chalkLeeToolbarOccupiedWidth(["alignment", "indent"], metrics);
    expect(chalkLeeToolbarHiddenItems({ ...metrics, availableWidth: afterIndent - 8 })).toEqual([
      "alignment",
      "indent",
      "lineHeight"
    ]);
  });

  it("can fold all overflowable controls on a very narrow surface", () => {
    expect(chalkLeeToolbarHiddenItems({ ...metrics, availableWidth: 220 })).toEqual([...CHALKLEE_TOOLBAR_OVERFLOW_ORDER]);
    expect(chalkLeeToolbarHiddenItems({ ...metrics, availableWidth: Number.NaN })).toEqual([...CHALKLEE_TOOLBAR_OVERFLOW_ORDER]);
    expect(chalkLeeToolbarHiddenItems({ ...metrics, availableWidth: 0 })).toEqual([...CHALKLEE_TOOLBAR_OVERFLOW_ORDER]);
  });

  it("never clips a fractional-width control at a folding boundary", () => {
    const full = chalkLeeToolbarOccupiedWidth([], metrics);
    expect(chalkLeeToolbarHiddenItems({ ...metrics, availableWidth: full - 0.25 })).toEqual(["alignment"]);
  });

  it("uses measured group spacing and chooses the smallest fitting prefix throughout resizing", () => {
    const current = { ...metrics, groupGaps: { text: 8, color: 6, list: 3, paragraph: 5 } };
    const minimum = chalkLeeToolbarOccupiedWidth(CHALKLEE_TOOLBAR_OVERFLOW_ORDER, current);
    const maximum = chalkLeeToolbarOccupiedWidth([], current);
    expect(maximum).toBeGreaterThan(chalkLeeToolbarOccupiedWidth([], metrics));
    let previous = 0;
    for (let width = maximum; width >= minimum; width -= 0.5) {
      const hidden = chalkLeeToolbarHiddenItems({ ...current, availableWidth: width });
      expect(hidden).toEqual(CHALKLEE_TOOLBAR_OVERFLOW_ORDER.slice(0, hidden.length));
      expect(hidden.length).toBeGreaterThanOrEqual(previous);
      expect(chalkLeeToolbarOccupiedWidth(hidden, current)).toBeLessThanOrEqual(width);
      if (hidden.length) expect(chalkLeeToolbarOccupiedWidth(hidden.slice(0, -1), current)).toBeGreaterThan(width);
      previous = hidden.length;
    }
  });
});

describe("ChalkLee toolbar collapse levels", () => {
  const flatMetrics: ChalkLeeToolbarOverflowMetrics = {
    ...metrics,
    itemWidths: {
      ...metrics.itemWidths,
      italic: 30,
      underline: 30,
      strike: 30,
      superscript: 30,
      subscript: 30,
      indentIncrease: 30,
      indentDecrease: 30,
      lineIndentDivider: 7,
      indentAlignDivider: 7,
      alignLeft: 30,
      alignCenter: 30,
      alignRight: 30,
      alignJustify: 30
    }
  };

  it("keeps every control flat when the toolbar is very wide", () => {
    expect(chalkLeeToolbarCollapseLevel({ ...flatMetrics, availableWidth: 2000 })).toBe(0);
  });

  it("folds alignment first, then indent, then font styles as the surface narrows", () => {
    const level0 = chalkLeeToolbarOccupiedWidth([], flatMetrics, 0);
    const level1 = chalkLeeToolbarOccupiedWidth([], flatMetrics, 1);
    const level2 = chalkLeeToolbarOccupiedWidth([], flatMetrics, 2);
    const level3 = chalkLeeToolbarOccupiedWidth([], flatMetrics, 3);
    expect(level0).toBeGreaterThan(level1);
    expect(level1).toBeGreaterThan(level2);
    expect(level2).toBeGreaterThan(level3);
    expect(chalkLeeToolbarCollapseLevel({ ...flatMetrics, availableWidth: level0 })).toBe(0);
    expect(chalkLeeToolbarCollapseLevel({ ...flatMetrics, availableWidth: level0 - 1 })).toBe(1);
    expect(chalkLeeToolbarCollapseLevel({ ...flatMetrics, availableWidth: level1 - 1 })).toBe(2);
    expect(chalkLeeToolbarCollapseLevel({ ...flatMetrics, availableWidth: level2 - 1 })).toBe(3);
    expect(chalkLeeToolbarCollapseLevel({ ...flatMetrics, availableWidth: level3 })).toBe(3);
  });

  it("hands over to the overflow row only at level 3", () => {
    const level3 = chalkLeeToolbarOccupiedWidth([], flatMetrics, 3);
    expect(chalkLeeToolbarCollapseLevel({ ...flatMetrics, availableWidth: level3 - 1 })).toBe(3);
    expect(chalkLeeToolbarHiddenItems({ ...flatMetrics, availableWidth: level3 - 1 })).toEqual(["alignment"]);
  });

  it("collapses fully when measurements are unavailable", () => {
    expect(chalkLeeToolbarCollapseLevel({ ...flatMetrics, availableWidth: Number.NaN })).toBe(3);
    expect(chalkLeeToolbarCollapseLevel({ ...flatMetrics, availableWidth: 0 })).toBe(3);
  });

  it("places flat variants at their collapsed trigger's position in the overflow panel", () => {
    const order = CHALKLEE_TOOLBAR_VISUAL_ORDER;
    expect(order.filter((id) => (CHALKLEE_TOOLBAR_OVERFLOW_ORDER as readonly string[]).includes(id)))
      .toEqual([...CHALKLEE_TOOLBAR_OVERFLOW_ORDER].reverse());
    expect(order.indexOf("italic")).toBeGreaterThan(order.indexOf("bold"));
    expect(order.indexOf("subscript")).toBeLessThan(order.indexOf("fontSettings"));
    expect(order.indexOf("indentDecrease")).toBeLessThan(order.indexOf("indent"));
    expect(order.indexOf("alignLeft")).toBeGreaterThan(order.indexOf("indent"));
    expect(order.indexOf("alignJustify")).toBeLessThan(order.indexOf("alignment"));
  });
});

describe("ChalkLee toolbar formatting presets", () => {
  it("offers document font sizes including half-point presets", () => {
    expect(CHALKLEE_FONT_SIZE_PRESETS).toEqual([
      5, 5.5, 6.5, 7.5, 8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72
    ]);
    expect(normalizeChalkLeeFontSize(13.26)).toBe(13.5);
    expect(normalizeChalkLeeFontSize(0)).toBeNull();
    expect(normalizeChalkLeeFontSize(2000)).toBe(1638);
  });

  it("includes Chinese, Latin and CJK font families", () => {
    const labels = CHALKLEE_FONT_FAMILY_PRESETS.map((item) => item.label);
    expect(labels).toEqual(expect.arrayContaining(["宋体", "微软雅黑", "Times New Roman", "Arial", "Yu Gothic", "Malgun Gothic"]));
  });

  it("shows the Chinese font for the default mixed-script body style", () => {
    expect(chalkLeeFontFamilyLabel("Times New Roman, Songti SC, SimSun, Noto Serif SC, serif"))
      .toBe("宋体");
    expect(chalkLeeFontFamilyLabel("Songti SC, SimSun, serif")).toBe("宋体");
    expect(chalkLeeFontFamilyLabel("Times New Roman, Liberation Serif, serif")).toBe("Times New Roman");
  });

  it("keeps the document text and highlight palettes", () => {
    expect(CHALKLEE_THEME_COLORS).toHaveLength(10);
    expect(CHALKLEE_THEME_COLOR_SHADES).toHaveLength(5);
    expect(CHALKLEE_THEME_COLOR_SHADES.every((row) => row.length === 10)).toBe(true);
    expect(CHALKLEE_STANDARD_COLORS).toHaveLength(10);
    expect(CHALKLEE_HIGHLIGHT_COLORS).toHaveLength(15);
  });
});
