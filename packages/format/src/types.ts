/** `chalklee/0.3` files store only the appearance items a document changed; `chalklee/0.2` files, still read, stored all. */
export const CHALKLEE_SCHEMA_VERSION = "chalklee/0.3" as const;
export const CHALKLEE_FORMAT_VERSION = "0.1" as const;
export const CHALKLEE_MEDIA_TYPE = "application/vnd.chalklee+zip" as const;

export type ChalkLeeSchemaVersion = typeof CHALKLEE_SCHEMA_VERSION;

export type ChalkLeeId = string;
export type ChalkLeeTextAlign = "left" | "center" | "right" | "justify";
export type ChalkLeeOptionLayout = "auto" | "inline" | "one-column" | "two-column" | "four-column";

export type ChalkLeeDocument = {
  schemaVersion: ChalkLeeSchemaVersion;
  id: ChalkLeeId;
  metadata: ChalkLeeMetadata;
  content: ChalkLeeRootNode;
  appearance: ChalkLeeAppearance;
  provenance?: ChalkLeeProvenance;
};

export type ChalkLeeMetadata = {
  title: string;
  subject?: string;
  language?: string;
  tags?: string[];
  /** Exam year set by the teacher; without it the year is read from the title, file name or folders. */
  year?: number;
  /** School grade 1–12 set by the teacher, read the same way when absent. */
  grade?: number;
  createdAt: string;
  updatedAt: string;
};

export type ChalkLeeRootNode = {
  type: "doc";
  content: ChalkLeeBlockNode[];
};

export type ChalkLeeBlockNode =
  | ChalkLeeParagraphNode
  | ChalkLeeHeadingNode
  | ChalkLeeImageNode
  | ChalkLeeGraphicNode
  | ChalkLeeBlockMathNode
  | ChalkLeeTableNode
  | ChalkLeePageBreakNode
  | ChalkLeeDividerNode
  | ChalkLeeAnswerLinesNode
  | ChalkLeeBoxNode
  | ChalkLeeQuestionNode
  | ChalkLeeQuestionGroupNode;

/**
 * A titled, framed block in a handout, such as 学习目标, 定义, 注意 or 随堂练习.
 * It holds ordinary content and questions, but no headings or other boxes, and is not numbered itself:
 * questions in it are numbered with the rest of the document. Its look comes from `appearance.boxStyles`.
 */
export type ChalkLeeBoxNode = {
  type: "box";
  attrs: {
    id: ChalkLeeId;
    styleRef?: string;
    /** This box's title; omit to use the style's label, "" hides it. */
    label?: string;
  };
  content: ChalkLeeBoxContentBlock[];
};

export type ChalkLeeBoxContentBlock = ChalkLeeQuestionContentBlock | ChalkLeeQuestionNode | ChalkLeeQuestionGroupNode;

export type ChalkLeeQuestionContentBlock =
  | ChalkLeeParagraphNode
  | ChalkLeeImageNode
  | ChalkLeeGraphicNode
  | ChalkLeeBlockMathNode
  | ChalkLeeTableNode
  | ChalkLeeAnswerLinesNode;

export type ChalkLeeCellContentBlock = ChalkLeeParagraphNode | ChalkLeeImageNode | ChalkLeeBlockMathNode;

export type ChalkLeeParagraphNode = {
  type: "paragraph";
  attrs: ChalkLeeParagraphAttrs;
  content?: ChalkLeeInlineNode[];
};

export type ChalkLeeParagraphAttrs = {
  id: ChalkLeeId;
  textAlign?: ChalkLeeTextAlign;
  indentLeftPt?: number;
  indentRightPt?: number;
  firstLineIndentPt?: number;
  listType?: "bullet" | "ordered";
  /** Restart an ordered list at this number; subsequent items omit it. */
  listStart?: number;
  /** What the paragraph is for (e.g. "subtitle", "byline", "key"), so document CSS can style it by use. */
  role?: string;
  lineHeight?: number;
  spaceBeforePt?: number;
  spaceAfterPt?: number;
};

export type ChalkLeeHeadingNode = {
  type: "heading";
  attrs: {
    id: ChalkLeeId;
    level: 1 | 2 | 3 | 4 | 5 | 6;
    /** What the heading is for, as for paragraphs. */
    role?: string;
    textAlign?: ChalkLeeTextAlign;
    indentLeftPt?: number;
    indentRightPt?: number;
    firstLineIndentPt?: number;
    lineHeight?: number;
    spaceBeforePt?: number;
    spaceAfterPt?: number;
  };
  content?: ChalkLeeInlineNode[];
};

export type ChalkLeeImageNode = {
  type: "image";
  attrs: ChalkLeeImageAttrs;
};

export type ChalkLeeInlineImageNode = {
  type: "imageInline";
  attrs: ChalkLeeImageAttrs;
  marks?: ChalkLeeMark[];
};

export type ChalkLeeImageAttrs = {
  id: ChalkLeeId;
  assetId: ChalkLeeId;
  alt?: string;
  caption?: string;
  widthPt?: number;
  heightPt?: number;
  textAlign?: Exclude<ChalkLeeTextAlign, "justify">;
  spaceBeforePt?: number;
  spaceAfterPt?: number;
  layout?: "block" | "wrap-left" | "wrap-right";
  /** Presentation only: images remain children of their own questions. */
  imagePairId?: ChalkLeeId;
};

/**
 * A drawing written as SVG, such as a cover, a banner, a concept map or a step-by-step animated explanation.
 * It shows as a picture: its own SMIL and CSS animations play on screen, nothing in it runs or loads.
 */
export type ChalkLeeGraphicNode = {
  type: "graphic";
  attrs: {
    id: ChalkLeeId;
    /** One complete SVG with a viewBox; it scales to its width and keeps its proportions. */
    svg: string;
    /** What print, PDF and Word show, such as an animation's last frame; without it, the drawing as it starts. */
    printSvg?: string;
    /** Share of the text width, 10–100; default 100. */
    widthPercent?: number;
    textAlign?: Exclude<ChalkLeeTextAlign, "justify">;
    alt?: string;
    caption?: string;
  };
};

export type ChalkLeeBlockMathNode = {
  type: "blockMath";
  attrs: {
    id: ChalkLeeId;
    latex: string;
    textAlign?: Exclude<ChalkLeeTextAlign, "justify">;
  };
};

export type ChalkLeeTableNode = {
  type: "table";
  attrs: {
    id: ChalkLeeId;
    widthPt?: number;
    columnWidthsPt?: number[];
  };
  content: ChalkLeeTableRowNode[];
};

export type ChalkLeeTableRowNode = {
  type: "tableRow";
  attrs: {
    id: ChalkLeeId;
    heightPt?: number;
    /** Repeat this leading row at the top of every continuation page. */
    repeatAsHeader?: boolean;
  };
  content: ChalkLeeTableCellNode[];
};

export type ChalkLeeTableCellNode = {
  type: "tableCell";
  attrs: {
    id: ChalkLeeId;
    colspan?: number;
    rowspan?: number;
  };
  content: ChalkLeeCellContentBlock[];
};

export type ChalkLeePageBreakNode = {
  type: "pageBreak";
  attrs: { id: ChalkLeeId };
};

/** A thin rule across the text width that separates parts of the body. */
export type ChalkLeeDividerNode = {
  type: "divider";
  attrs: { id: ChalkLeeId };
};

/**
 * Ruled lines a student writes on, such as for a composition or a worked answer. Each line may carry printed words,
 * such as a letter's greeting and closing, written on the line.
 */
export type ChalkLeeAnswerLinesNode = {
  type: "answerLines";
  /**
   * `spacingPt`: distance between lines; the paper's 24pt when absent. `count`: how files before 2026-10-24 gave the
   * lines, read as that many empty lines and no longer written.
   */
  attrs: { id: ChalkLeeId; spacingPt?: number; count?: number };
  content?: ChalkLeeAnswerLineNode[];
};

export type ChalkLeeAnswerLineNode = {
  type: "answerLine";
  attrs?: { id?: ChalkLeeId };
  content?: ChalkLeeInlineNode[];
};

export type ChalkLeeInlineNode =
  | ChalkLeeTextNode
  | ChalkLeeInlineImageNode
  | ChalkLeeHardBreakNode
  | ChalkLeeInlineMathNode
  | ChalkLeeBlankNode;

export type ChalkLeeTextNode = {
  type: "text";
  text: string;
  marks?: ChalkLeeMark[];
};

export type ChalkLeeHardBreakNode = { type: "hardBreak" };

export type ChalkLeeInlineMathNode = {
  type: "mathInline";
  attrs: { latex: string };
};

export type ChalkLeeBlankNode = {
  type: "blank";
  attrs: {
    id: ChalkLeeId;
    label?: string;
    widthPt?: number;
    answer?: string;
  };
};

export type ChalkLeeMark =
  | { type: "bold" | "italic" | "underline" | "strike" | "superscript" | "subscript" }
  | {
      type: "textStyle";
      attrs: {
        fontFamily?: string;
        fontSizePt?: number;
        color?: string;
        backgroundColor?: string;
        /** Not bold where the text would be by default, as in a heading. */
        fontWeight?: "normal";
      };
    }
  | {
      type: "link";
      attrs: {
        href: string;
        title?: string;
      };
    };

export type ChalkLeeQuestionNode = {
  type: "question";
  attrs: ChalkLeeQuestionAttrs;
  content: [ChalkLeeQuestionStemNode, ...Array<ChalkLeeOptionGroupNode | ChalkLeeQuestionAnswerNode | ChalkLeeQuestionAnalysisNode>];
};

export type ChalkLeeQuestionGroupNode = {
  type: "questionGroup";
  attrs: ChalkLeeQuestionAttrs;
  content: [ChalkLeeQuestionMaterialNode, ...Array<ChalkLeeOptionGroupNode | ChalkLeeSubQuestionListNode | ChalkLeeQuestionAnswerNode | ChalkLeeQuestionAnalysisNode>];
};

export type ChalkLeeQuestionAttrs = {
  id: ChalkLeeId;
  kind: string;
  number: ChalkLeeQuestionNumber;
  sourceBlankId?: ChalkLeeId;
  score?: number;
  difficulty?: "easy" | "medium" | "hard";
  tags?: string[];
  styleRef?: string;
  /** Per-question frame title; omit to inherit the style label, use "" to hide it. */
  frameLabel?: string;
};

/**
 * `continue`, for a question group only: the group shows no number and takes none; its subquestions take the
 * paper's numbers, written as the paper's questions are, as a reading passage's questions run on from the
 * questions before it. A question reads it as `auto`.
 */
export type ChalkLeeQuestionNumber =
  | { mode: "auto" }
  | { mode: "fixed"; label: string }
  | { mode: "none" }
  | { mode: "continue" };

export type ChalkLeeQuestionStemNode = {
  type: "questionStem";
  attrs: { id: ChalkLeeId };
  content: ChalkLeeQuestionContentBlock[];
};

export type ChalkLeeQuestionMaterialNode = {
  type: "questionMaterial";
  attrs: { id: ChalkLeeId };
  content: ChalkLeeQuestionContentBlock[];
};

export type ChalkLeeOptionGroupNode = {
  type: "optionGroup";
  attrs: {
    id: ChalkLeeId;
    layout?: ChalkLeeOptionLayout;
    styleRef?: string;
  };
  content: ChalkLeeOptionNode[];
};

export type ChalkLeeOptionNode = {
  type: "option";
  attrs: {
    id: ChalkLeeId;
    label: string;
    styleRef?: string;
  };
  content: ChalkLeeQuestionContentBlock[];
};

export type ChalkLeeQuestionAnswerNode = {
  type: "questionAnswer";
  attrs: {
    id: ChalkLeeId;
    styleRef?: string;
  };
  content: ChalkLeeQuestionContentBlock[];
};

export type ChalkLeeQuestionAnalysisNode = {
  type: "questionAnalysis";
  attrs: {
    id: ChalkLeeId;
    styleRef?: string;
  };
  content: ChalkLeeQuestionContentBlock[];
};

export type ChalkLeeSubQuestionListNode = {
  type: "subQuestionList";
  attrs: { id: ChalkLeeId };
  content: ChalkLeeQuestionNode[];
};

export type ChalkLeeAppearance = {
  /** Document-owned CSS. Structured content remains the source for editing. */
  design?: ChalkLeeDesign;
  page: ChalkLeePageAppearance;
  body: ChalkLeeTextAppearance;
  defaults: {
    questionStyleRef: string;
    optionStyleRef: string;
    answerStyleRef: string;
    analysisStyleRef: string;
    /** Used by boxes without their own style; the application's plain frame when absent. */
    boxStyleRef?: string;
  };
  questionStyles: Record<string, ChalkLeeQuestionStyle>;
  optionStyles: Record<string, ChalkLeeOptionStyle>;
  answerStyles: Record<string, ChalkLeeRegionStyle>;
  analysisStyles: Record<string, ChalkLeeRegionStyle>;
  /** Frames for boxes, in the same shape as question frames. */
  boxStyles?: Record<string, ChalkLeeBoxStyle>;
  /** Running header and footer; absent means a centred "第 {page} 页／共 {pages} 页" footer. */
  headerFooter?: ChalkLeeHeaderFooter;
  /** Automatic heading numbers, generated at display and not stored in the heading text. */
  headingNumbering?: ChalkLeeHeadingNumbering;
  /** How question numbers are written and look, for the whole document; absent means the standard bold "1.". */
  questionNumbering?: ChalkLeeQuestionNumbering;
  /** A cover as the first page, before the body; present means shown. */
  cover?: ChalkLeeCover;
  /** A table of contents after the cover and before the body; present means shown. */
  tableOfContents?: ChalkLeeTableOfContents;
  /** Drawings on the page itself, such as a header block in a margin or a watermark over the body. */
  pageDecorations?: ChalkLeePageDecoration[];
};

/**
 * A cover: a page of its own before the body, with no header or footer, and the page numbers
 * counting from the body. It may fill the whole sheet, margins included. Fields left out are not shown.
 */
export type ChalkLeeCover = {
  /** Default the document title; `""` shows none. */
  title?: string;
  subtitle?: string;
  /** Subject and grade, such as 高二数学. */
  subject?: string;
  /** School or teacher. */
  author?: string;
  date?: string;
  /** How it is drawn; absent is the standard look: the title centred a third of the way down. */
  style?: ChalkLeeCoverStyle;
};

export type ChalkLeeCoverStyle = {
  /** Default `center`. */
  align?: "center" | "left";
  /** Where the title sits, as a share of the page height from the top; default 0.34. */
  titleTop?: number;
  /** Default 30. */
  titleSizePt?: number;
  /** Default `bold`. */
  titleWeight?: "normal" | "bold";
  /** Default #1c2024. */
  titleColor?: string;
  /** The other fields; default #60646c. */
  color?: string;
  /** The title's fonts; default the body's. */
  fontFamilies?: string[];
  /** A drawing over the whole sheet, under the text; same rules as a page decoration's svg. */
  svg?: string;
};

/**
 * A table of contents: pages of their own after the cover and before the body, like the cover without a header
 * or footer. The application lists the body's headings with the pages they are on and keeps them up
 * to date; only the title is written by hand.
 */
export type ChalkLeeTableOfContents = {
  /** Heading levels listed, counted down from the highest heading listed; default 2. */
  levels?: 1 | 2 | 3;
  /** Default 目录; `""` shows none. */
  title?: string;
  /** How it is drawn; absent is the standard look: a centred title and dotted leaders. */
  style?: ChalkLeeTableOfContentsStyle;
};

export type ChalkLeeTableOfContentsStyle = {
  /** What leads from an entry to its page number; default `dots`. */
  leader?: "dots" | "line" | "none";
  /** Default `center`. */
  titleAlign?: "center" | "left";
  /** Top-level entries in bold; default true. */
  firstLevelBold?: boolean;
  /** Entries and page numbers; default #1c2024. */
  color?: string;
  /** The title and top-level entries; default the color. */
  accentColor?: string;
  /** Default the body's. */
  fontFamilies?: string[];
};

/**
 * An SVG drawn into one area of every chosen page. `left` and `right` are the side margins; `content` is the
 * body area, drawn faintly under the text (watermarks, a frame round the text). The drawing is sized to its
 * area in points: give the root a viewBox of that size, or lay it out in percentages. `{title}` is replaced.
 */
export type ChalkLeePageDecoration = {
  place: "left" | "right" | "content";
  /** Default `all`. `rest` is every page but the first; a `content` decoration can be on all pages or the first. */
  pages?: "all" | "first" | "rest" | "odd" | "even";
  svg: string;
};

/** Text at the left, centre and right of a header or footer. `{page}`, `{pages}` and `{title}` are replaced. */
export type ChalkLeeRunningLine = {
  left?: string;
  center?: string;
  right?: string;
  /** A thin line between this header or footer and the body. */
  rule?: boolean;
  /** This line's own look; what it leaves out comes from the header and footer settings. */
  style?: ChalkLeeRunningLineStyle;
};

/** The look of one header or footer: its text and the line between it and the body. */
export type ChalkLeeRunningLineStyle = {
  fontSizePt?: number;
  color?: string;
  fontWeight?: "normal" | "bold";
  /** Space between characters, in em. */
  letterSpacingEm?: number;
  /** Replaces the line's `rule`; absent, `rule: true` draws a thin solid line. */
  rule?: ChalkLeeRunningRule;
};

export type ChalkLeeRunningRule = {
  /** Default `solid`. */
  style?: "solid" | "dashed" | "dotted" | "double";
  /** Default 0.5; for `double`, each of the two lines. */
  widthPt?: number;
  /** Default the header and footer `ruleColor`. */
  color?: string;
  /** A second line on the far side, so the text sits between two lines. */
  bothSides?: boolean;
};

export type ChalkLeeHeaderFooter = {
  header?: ChalkLeeRunningLine;
  footer?: ChalkLeeRunningLine;
  /** The first page (e.g. a cover) shows neither. */
  differentFirstPage?: boolean;
  fontFamilies?: string[];
  fontSizePt?: number;
  color?: string;
  ruleColor?: string;
};

/** `decimal`: 1, 1.1, 1.1.1; `chinese`: 一、（一）1. Numbering starts at `fromLevel` (default 2). */
export type ChalkLeeHeadingNumbering = {
  style: "decimal" | "chinese";
  fromLevel?: 1 | 2 | 3;
};

/**
 * Question numbers, generated at display and never stored in the question text. `style` writes a question's
 * number as `dot` 1.  `comma` 1、  `paren` (1)  `circle` ①  `plain` 1; `subStyle` does the same for subquestions
 * in a group. Defaults: `dot`, `paren`, bold, the body colour, no frame.
 */
export type ChalkLeeQuestionNumbering = {
  style?: "dot" | "comma" | "paren" | "circle" | "plain";
  subStyle?: "dot" | "paren" | "circle";
  fontWeight?: "normal" | "bold";
  color?: string;
  /** A thin box around the number. */
  frame?: boolean;
};

export type ChalkLeeDesign = { name?: string; css: string };

export type ChalkLeePageAppearance = {
  /** `slide`: 16:9 for teaching on a screen, 960 × 540 pt in landscape. */
  size: "A4" | "A3" | "Letter" | "slide" | "custom";
  orientation: "portrait" | "landscape";
  widthPt?: number;
  heightPt?: number;
  /** Equal-width newspaper flow; omitted in older documents means one column. */
  columnCount?: number;
  /** Space between columns, in points; defaults to 24 pt. */
  columnGapPt?: number;
  marginsPt: ChalkLeeSpacing;
  background: ChalkLeePaint;
  printBackground: boolean;
};

export type ChalkLeeTextAppearance = {
  fontFamilies: string[];
  fontSizePt: number;
  lineHeight: number;
  color: string;
  /** Space after every paragraph unless a paragraph sets its own. */
  paragraphSpaceAfterPt?: number;
};

export type ChalkLeeQuestionStyle = {
  backgroundColor?: string;
  border?: ChalkLeeBorder;
  borderRadiusPt?: number;
  paddingPt?: ChalkLeeSpacing;
  gapPt?: number;
  spaceBeforePt?: number;
  spaceAfterPt?: number;
  frame?: ChalkLeeQuestionFrame;
  breakInside?: "auto" | "avoid";
  /** `page`: each question of this style starts a new page, as on slides. Subquestions follow their group. */
  breakBefore?: "auto" | "page";
};

/**
 * A box style: the question-style fields plus optional decoration CSS for boxes of this style. Every selector
 * starts with `[data-chalklee-box]`; see `compileChalkLeeBoxStyleCss`.
 */
export type ChalkLeeBoxStyle = ChalkLeeQuestionStyle & {
  /** What teachers call it, such as 方格纸; the map key stays the style's reference. */
  name?: string;
  css?: string;
};

/** Optional printed label on a question border; the question content stays editable. */
export type ChalkLeeQuestionFrame = {
  label: string;
  design?: "line" | "ribbon" | "fold" | "dashed" | "rail" | "double" | "band";
  labelPosition?: "top-left" | "top-center" | "left";
  labelStyle?: "plain" | "filled";
  accentColor?: string;
};

export type ChalkLeeOptionStyle = {
  marker: "label" | "circle" | "square" | "none";
  layout: ChalkLeeOptionLayout;
  columnGapPt?: number;
  rowGapPt?: number;
  labelGapPt?: number;
  backgroundColor?: string;
  border?: ChalkLeeBorder;
  borderRadiusPt?: number;
  paddingPt?: ChalkLeeSpacing;
};

export type ChalkLeeRegionStyle = {
  label: string;
  backgroundColor?: string;
  border?: ChalkLeeBorder;
  borderRadiusPt?: number;
  paddingPt?: ChalkLeeSpacing;
  text?: Partial<ChalkLeeTextAppearance>;
};

export type ChalkLeeSpacing = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type ChalkLeeBorder = {
  style: "none" | "solid" | "dashed" | "dotted";
  widthPt: number;
  color: string;
};

export type ChalkLeePaint =
  | { type: "solid"; color: string }
  | {
      type: "image";
      assetId: ChalkLeeId;
      fit: "cover" | "contain" | "stretch" | "tile";
      opacity: number;
      fallbackColor: string;
    };

export type ChalkLeeProvenance = {
  method: "manual" | "import" | "ai";
  sources: ChalkLeeSource[];
  anchors?: ChalkLeeSourceAnchor[];
};

export type ChalkLeeSource = {
  id: ChalkLeeId;
  /** `chalklee`: a workspace ChalkLee whose questions were copied into this document. */
  type: "doc" | "docx" | "pdf" | "markdown" | "latex" | "chalklee" | "other";
  fileName: string;
  relativePath?: string;
  sha256?: string;
  /**
   * For a PDF/DOC/DOCX/Markdown: `whole` when this document replaces the file (a conversion, also of several files into one),
   * `partial` when it only quotes part of it or its conversion has not finished. Missing means `whole`. Only a whole
   * conversion hides the original in the workspace.
   */
  coverage?: "whole" | "partial";
  /** What the file is to this document, e.g. "试卷" or "答案". */
  label?: string;
};

export type ChalkLeeSourceAnchor = {
  nodeId: ChalkLeeId;
  sourceId: ChalkLeeId;
  confidence?: number;
  locator: {
    kind: "doc" | "docx" | "pdf" | "markdown" | "latex" | "chalklee" | "manual";
    paragraphStart?: number;
    paragraphEnd?: number;
    page?: number;
    /** For `chalklee` sources: the copied question's ID in the source document. */
    nodeId?: ChalkLeeId;
    note?: string;
  };
};

export type ChalkLeeManifest = {
  format: "chalklee";
  formatVersion: typeof CHALKLEE_FORMAT_VERSION;
  mediaType: typeof CHALKLEE_MEDIA_TYPE;
  documentPath: "document.json";
  documentId: ChalkLeeId;
  createdAt: string;
  updatedAt: string;
  assets: ChalkLeeManifestAsset[];
};

export type ChalkLeeManifestAsset = {
  id: ChalkLeeId;
  path: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
};

export type ChalkLeeArchiveAssetInput = {
  id: ChalkLeeId;
  path: string;
  mediaType: string;
  data: Uint8Array;
};

export type ChalkLeeArchive = {
  manifest: ChalkLeeManifest;
  document: ChalkLeeDocument;
  assets: Record<ChalkLeeId, Uint8Array>;
};
