/** ChalkLee's read-only Word model. It has no dependency on a vendor document model. */
export interface TextStyle {
  font?: string;
  latinFont?: string;
  size?: number; // CSS px at 96 dpi
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  background?: string;
  highlight?: string; // Word's named text highlight; "none" cancels an inherited highlight.
  vertical?: "sub" | "super";
  offset?: number;
  spacing?: number;
  hidden?: boolean;
}

export type WordInline =
  | { kind: "text"; text: string; style: TextStyle }
  | { kind: "image"; asset: number; width?: number; height?: number; alt: string; mathType?: boolean }
  | { kind: "image-placeholder"; width?: number; height?: number; alt: string; mathType?: boolean }
  | { kind: "math"; mathml: string; latex?: string; source?: "omml" | "mathtype" }
  | { kind: "page-number" | "page-count" | "section-page-count"; style?: TextStyle; format?: WordNumberFormat };

export type WordNumberFormat = "decimal" | "decimalZero" | "upperRoman" | "lowerRoman" | "upperLetter" | "lowerLetter";

export interface WordAnchorAxis { relative: string; offset: number; align?: string }
export interface WordDrawing {
  x: WordAnchorAxis;
  y: WordAnchorAxis;
  width: number;
  height: number;
  behind: boolean;
  order: number;
  group?: { width: number; height: number; left: number; top: number };
  content: Extract<WordInline, { kind: "image" | "image-placeholder" }> | {
    kind: "textbox"; blocks: WordBlock[];
    decoration?: number; // A locally generated SVG asset behind the ordinary text.
    fitToText?: boolean; // spAutoFit with wrap=none: intrinsic width/height, no font scaling.
    inset: { top: number; right: number; bottom: number; left: number };
    vertical: "top" | "center" | "bottom";
  };
}

export interface WordTabStop {
  position: number;
  align: "left" | "right" | "center";
  leader?: "dot" | "hyphen" | "underscore" | "heavy" | "middleDot";
}
export interface WordBorder {
  style: "none" | "solid" | "double" | "dotted" | "dashed";
  width: number;
  color: string;
  space: number;
}
export type WordBorders = Partial<Record<"top" | "right" | "bottom" | "left" | "insideH" | "insideV" | "between", WordBorder>>;
export interface ParagraphStyle {
  borders?: WordBorders;
  align?: "left" | "center" | "right" | "justify";
  before?: number;
  after?: number;
  beforeLines?: number;
  afterLines?: number;
  contextualSpacing?: boolean;
  snapToGrid?: boolean;
  left?: number;
  right?: number;
  indent?: number;
  lineHeight?: number;
  linePixels?: number;
  lineRule?: "auto" | "exact" | "atLeast";
  lineValue?: number; // Word units, retained while resolving paragraph-style inheritance
  keepNext?: boolean;
  keepLines?: boolean;
  widowControl?: boolean;
  tabs?: number[];
  tabStops?: WordTabStop[];
  defaultTab?: number;
}

export interface WordParagraph {
  kind: "paragraph";
  id: string;
  styleId?: string;
  inlines: WordInline[];
  drawings?: WordDrawing[];
  style: ParagraphStyle;
  textStyle: TextStyle;
  markStyle?: TextStyle;
  heading?: number;
  marker?: string;
  markerStyle?: TextStyle;
  markerFollow?: "tab" | "space" | "nothing";
  pageBreakBefore?: boolean;
  pageBreakAfter?: boolean;
  sectionBreakAfter?: boolean;
}

export interface WordCell {
  blocks: WordBlock[];
  span: number;
  merge?: "start" | "continue";
  width?: number;
  background?: string;
  borders?: WordBorders;
  vertical?: "top" | "center" | "bottom";
  padding?: Partial<Record<"top" | "right" | "bottom" | "left", number>>;
}

export interface WordRowProperties {
  height?: number;
  heightRule?: "auto" | "exact" | "atLeast";
  cantSplit?: boolean;
}

export interface WordTable {
  kind: "table";
  id: string;
  rows: WordCell[][];
  widths: number[];
  headerRows: number;
  rowProperties?: WordRowProperties[];
  borders?: WordBorders;
  // Provisional grid for DOC tables whose row geometry/merges are unsupported.
  legacyGrid?: boolean;
  width?: number;
  align?: "left" | "center" | "right";
  padding?: { top: number; right: number; bottom: number; left: number };
}

export type WordBlock = WordParagraph | WordTable;
export interface WordPageSettings {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
  header?: number;
  footer?: number;
  fixedTop?: boolean;
  fixedBottom?: boolean;
  grid?: { type: "lines" | "linesAndChars" | "snapToChars"; linePitch: number };
}
export interface WordSection {
  blocks: WordBlock[];
  page: WordPageSettings;
  header: WordBlock[];
  footer: WordBlock[];
  firstHeader?: WordBlock[];
  evenHeader?: WordBlock[];
  firstFooter?: WordBlock[];
  evenFooter?: WordBlock[];
  titlePage?: boolean;
  evenAndOddHeaders?: boolean;
  pageNumberStart?: number;
  pageNumberFormat?: WordNumberFormat;
  breakType?: "nextPage" | "continuous" | "evenPage" | "oddPage";
}
export interface WordAsset { bytes: Uint8Array; mime: string }
export interface WordDocument {
  format: "doc" | "docx" | "markdown" | "latex";
  sections: WordSection[];
  assets: WordAsset[];
  warnings: string[];
}
export const defaultPage = (): WordPageSettings => ({ width: 793.7, height: 1122.5, top: 96, right: 96, bottom: 96, left: 96 });
export const paragraph = (id: string): WordParagraph => ({ kind: "paragraph", id, inlines: [], style: {}, textStyle: {} });
export const paragraphText = (p: WordParagraph): string => p.inlines.map(i => i.kind === "text" ? i.text : i.kind === "image" || i.kind === "image-placeholder" ? i.alt : "").join("");
