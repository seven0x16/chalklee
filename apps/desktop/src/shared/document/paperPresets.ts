import {
  chalkLeeCoverLook, chalkLeeQuestionNumberLook, chalkLeeRunningLook, chalkLeeTocLook,
  type ChalkLeeQuestionNumbering, type ChalkLeeCover, type ChalkLeeCoverStyle, type ChalkLeeTableOfContents, type ChalkLeeTableOfContentsStyle, type ChalkLeeHeaderFooter, type ChalkLeeRunningLine, type ChalkLeeRunningLineStyle
} from "@chalklee/format";

/** 黑白清楚: keeps its look in black-and-white print. 需彩印: its colour is part of the look. 省墨: light lines. */
type PresetTag = "黑白清楚" | "需彩印" | "省墨";

/** A header or footer look shipped with the app; header and footer share them, each rule facing the body. */
export interface ChalkLeeRunningPreset {
  id: string;
  name: string;
  tags: readonly PresetTag[];
  /** Every choice written out, so a preset looks the same whatever the document's shared settings say. */
  style: Required<Pick<ChalkLeeRunningLineStyle, "fontSizePt" | "color" | "fontWeight" | "letterSpacingEm">> & Pick<ChalkLeeRunningLineStyle, "rule">;
}

const running = (id: string, name: string, tags: readonly PresetTag[], style: Partial<ChalkLeeRunningPreset["style"]>): ChalkLeeRunningPreset =>
  ({ id, name, tags, style: { fontSizePt: 9, color: "#1f2937", fontWeight: "normal", letterSpacingEm: 0, ...style } });

// Only what page-margin boxes print without backgrounds: text and borders.
export const CHALKLEE_RUNNING_PRESETS: readonly ChalkLeeRunningPreset[] = [
  running("standard", "标准", ["黑白清楚"], {}),
  running("hairline", "细线", ["黑白清楚"], { rule: { style: "solid", widthPt: .5, color: "#374151" } }),
  running("bold", "粗线", ["黑白清楚"], { color: "#111111", fontWeight: "bold", rule: { style: "solid", widthPt: 1.25, color: "#111111" } }),
  running("double", "双线", ["黑白清楚"], { color: "#111111", rule: { style: "double", widthPt: .5, color: "#111111" } }),
  running("between", "上下线", ["黑白清楚"], { color: "#111111", rule: { style: "solid", widthPt: .75, color: "#111111", bothSides: true } }),
  running("dashed", "虚线", ["黑白清楚"], { rule: { style: "dashed", widthPt: .6, color: "#60646c" } }),
  running("airy", "疏朗", [], { fontSizePt: 8.5, color: "#60646c", letterSpacingEm: .22, rule: { style: "dotted", widthPt: .9, color: "#8b8d98" } }),
  running("teal", "蓝绿", ["需彩印"], { color: "#0d9b8a", fontWeight: "bold", rule: { style: "solid", widthPt: 1, color: "#12a594" } }),
  running("red", "红线", ["需彩印"], { color: "#111111", rule: { style: "solid", widthPt: 1, color: "#dc3e42" } })
];

export function chalkLeeRunningPresetByName(name: string) {
  return CHALKLEE_RUNNING_PRESETS.find(preset => preset.name === name.trim());
}

/** The preset a header or footer looks like, judged by how it draws rather than how it is written. */
export function chalkLeeCurrentRunningPreset(headerFooter: ChalkLeeHeaderFooter, line: ChalkLeeRunningLine | undefined) {
  const look = JSON.stringify(chalkLeeRunningLook(headerFooter, line));
  return CHALKLEE_RUNNING_PRESETS.find(preset => JSON.stringify(chalkLeeRunningLook({}, { style: preset.style })) === look) ?? null;
}

/** A cover look shipped with the app; the cover's words stay the document's own. */
export interface ChalkLeeCoverPreset {
  id: string;
  name: string;
  tags: readonly PresetTag[];
  style: ChalkLeeCoverStyle;
}

// Drawings are laid out in percentages so they fit every paper size.
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

export const CHALKLEE_COVER_PRESETS: readonly ChalkLeeCoverPreset[] = [
  { id: "standard", name: "标准", tags: ["黑白清楚"], style: {} },
  { id: "frame", name: "细框", tags: ["黑白清楚"], style: {
    svg: svg('<rect x="7%" y="5%" width="86%" height="90%" fill="none" stroke="#1c2024" stroke-width="1"/><rect x="8%" y="5.7%" width="84%" height="88.6%" fill="none" stroke="#1c2024" stroke-width=".4"/>')
  } },
  { id: "bar", name: "题线", tags: ["黑白清楚"], style: {
    titleTop: .36, svg: svg('<rect x="45%" y="31.5%" width="10%" height="3" fill="#1c2024"/>')
  } },
  { id: "rules", name: "上下线", tags: ["黑白清楚"], style: {
    svg: svg('<line x1="10%" y1="6%" x2="90%" y2="6%" stroke="#1c2024" stroke-width="1.5"/><line x1="10%" y1="6.6%" x2="90%" y2="6.6%" stroke="#1c2024" stroke-width=".5"/><line x1="10%" y1="93.4%" x2="90%" y2="93.4%" stroke="#1c2024" stroke-width=".5"/><line x1="10%" y1="94%" x2="90%" y2="94%" stroke="#1c2024" stroke-width="1.5"/>')
  } },
  { id: "left", name: "左对齐", tags: ["黑白清楚"], style: {
    align: "left", titleTop: .3, svg: svg('<line x1="0" y1="27%" x2="100%" y2="27%" stroke="#1c2024" stroke-width=".75"/>')
  } },
  { id: "grid", name: "方格", tags: ["省墨"], style: {
    svg: svg('<defs><pattern id="cover-grid" width="14" height="14" patternUnits="userSpaceOnUse"><path d="M14 0H0V14" fill="none" stroke="#d9d9e0" stroke-width=".5"/></pattern></defs><rect width="100%" height="100%" fill="url(#cover-grid)"/>')
  } },
  { id: "blue", name: "浅蓝", tags: ["需彩印"], style: {
    titleColor: "#113264", color: "#0d74ce",
    svg: svg('<rect width="100%" height="100%" fill="#e6f4fe"/><rect y="58%" width="100%" height="42%" fill="#cee7fe"/>')
  } },
  { id: "dark", name: "深色", tags: ["需彩印"], style: {
    titleColor: "#ffffff", color: "#c2e5ff",
    svg: svg('<rect width="100%" height="100%" fill="#113264"/><line x1="10%" y1="81%" x2="90%" y2="81%" stroke="#5eb1ef" stroke-width=".75"/>')
  } }
];

export function chalkLeeCoverPresetByName(name: string) {
  return CHALKLEE_COVER_PRESETS.find(preset => preset.name === name.trim());
}

const coverLook = (style: ChalkLeeCoverStyle | undefined) => JSON.stringify({ ...chalkLeeCoverLook(style), svg: style?.svg ?? null });

export function chalkLeeCurrentCoverPreset(cover: ChalkLeeCover | null | undefined) {
  if (!cover) return null;
  const look = coverLook(cover.style);
  return CHALKLEE_COVER_PRESETS.find(preset => coverLook(preset.style) === look) ?? null;
}

export interface ChalkLeeTocPreset {
  id: string;
  name: string;
  tags: readonly PresetTag[];
  style: ChalkLeeTableOfContentsStyle;
}

export const CHALKLEE_TOC_PRESETS: readonly ChalkLeeTocPreset[] = [
  { id: "standard", name: "标准", tags: ["黑白清楚"], style: {} },
  { id: "line", name: "细线", tags: ["黑白清楚"], style: { leader: "line" } },
  { id: "plain", name: "无引线", tags: ["省墨"], style: { leader: "none" } },
  { id: "left", name: "左对齐", tags: ["黑白清楚"], style: { titleAlign: "left", leader: "line" } },
  { id: "light", name: "清淡", tags: ["省墨"], style: { firstLevelBold: false, color: "#60646c", accentColor: "#1c2024" } },
  { id: "blue", name: "蓝色", tags: ["需彩印"], style: { accentColor: "#0d74ce" } }
];

export function chalkLeeTocPresetByName(name: string) {
  return CHALKLEE_TOC_PRESETS.find(preset => preset.name === name.trim());
}

const tocLook = (style: ChalkLeeTableOfContentsStyle | undefined) => JSON.stringify(chalkLeeTocLook(style));

export function chalkLeeCurrentTocPreset(toc: ChalkLeeTableOfContents | null | undefined) {
  if (!toc) return null;
  const look = tocLook(toc.style);
  return CHALKLEE_TOC_PRESETS.find(preset => tocLook(preset.style) === look) ?? null;
}

/** Question numbers shipped with the app, for the whole document; each pairs a question number with a subquestion one. */
export interface ChalkLeeQuestionNumberingPreset {
  id: string;
  name: string;
  tags: readonly PresetTag[];
  numbering: ChalkLeeQuestionNumbering;
}

export const CHALKLEE_QUESTION_NUMBERING_PRESETS: readonly ChalkLeeQuestionNumberingPreset[] = [
  { id: "standard", name: "标准", tags: ["黑白清楚"], numbering: {} },
  { id: "regular", name: "常规", tags: ["黑白清楚"], numbering: { fontWeight: "normal" } },
  { id: "paren", name: "括号", tags: ["黑白清楚"], numbering: { style: "paren", subStyle: "circle" } },
  { id: "circle", name: "圆圈", tags: ["黑白清楚"], numbering: { style: "circle", fontWeight: "normal" } },
  { id: "frame", name: "方框", tags: ["黑白清楚"], numbering: { style: "plain", frame: true } },
  { id: "blue", name: "蓝色", tags: ["需彩印"], numbering: { color: "#0d74ce" } }
];

export function chalkLeeQuestionNumberingPresetByName(name: string) {
  return CHALKLEE_QUESTION_NUMBERING_PRESETS.find(preset => preset.name === name.trim());
}

const numberingLook = (numbering: ChalkLeeQuestionNumbering | undefined) => JSON.stringify(chalkLeeQuestionNumberLook(numbering));

/** The preset the numbers look like, judged by how they are drawn rather than how the setting is written. */
export function chalkLeeCurrentQuestionNumberingPreset(numbering: ChalkLeeQuestionNumbering | null | undefined) {
  const look = numberingLook(numbering ?? undefined);
  return CHALKLEE_QUESTION_NUMBERING_PRESETS.find(preset => numberingLook(preset.numbering) === look) ?? null;
}
