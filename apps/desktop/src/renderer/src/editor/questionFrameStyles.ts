import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import type { ChalkLeeDocument, ChalkLeeQuestionStyle } from "@chalklee/format";
import { findChalkLeeQuestionContext } from "./editorContext";
import { chalkLeeQuestionAppearance, resolveChalkLeeQuestionFrame } from "./questionAppearance";
import { chalkLeeFrameColors, chalkLeeFrameTint, customizeChalkLeeFrameStyle, recolorChalkLeeFrame, type ChalkLeeFramePatch } from "./frameCustomization";

export interface ChalkLeeQuestionFrameChoice {
  id: string;
  name: string;
  styleRef: string;
  style: ChalkLeeQuestionStyle;
  selected: boolean;
}

const handoutSpacing: ChalkLeeQuestionStyle = {
  paddingPt: { top: 16, right: 18, bottom: 16, left: 18 },
  gapPt: 9, breakInside: "avoid", spaceBeforePt: 18, spaceAfterPt: 22
};

const presetAccent = chalkLeeFrameColors[0].color;
const presetSurface = chalkLeeFrameTint(presetAccent);

/** Versioned definitions are copied into a document only when the teacher uses them. */
const presets: Array<{ id: string; name: string; style: ChalkLeeQuestionStyle }> = [
  { id: "none", name: "无边框", style: { gapPt: 0, breakInside: "auto" } },
  {
    id: "blue-line", name: "素线", style: {
      ...handoutSpacing,
      border: { style: "solid", widthPt: .75, color: presetAccent }, borderRadiusPt: 6,
      frame: { design: "line", label: "重点例题", labelPosition: "top-left", labelStyle: "plain", accentColor: presetAccent }
    }
  },
  {
    id: "green-fill", name: "书签", style: {
      ...handoutSpacing, backgroundColor: presetSurface,
      border: { style: "solid", widthPt: .75, color: presetAccent }, borderRadiusPt: 6,
      frame: { design: "ribbon", label: "随堂练习", labelPosition: "top-left", labelStyle: "filled", accentColor: presetAccent }
    }
  },
  {
    id: "orange-fill", name: "折角", style: {
      ...handoutSpacing, backgroundColor: presetSurface,
      paddingPt: { top: 24, right: 18, bottom: 16, left: 18 },
      border: { style: "solid", widthPt: .75, color: presetAccent }, borderRadiusPt: 6,
      frame: { design: "fold", label: "巩固加深", labelPosition: "top-left", labelStyle: "plain", accentColor: presetAccent }
    }
  },
  {
    id: "center-dashed", name: "信笺", style: {
      ...handoutSpacing, backgroundColor: presetSurface,
      border: { style: "dashed", widthPt: .75, color: presetAccent }, borderRadiusPt: 10,
      frame: { design: "dashed", label: "温故知新", labelPosition: "top-center", labelStyle: "filled", accentColor: presetAccent }
    }
  },
  {
    id: "header-band", name: "题头", style: {
      ...handoutSpacing, backgroundColor: presetSurface,
      paddingPt: { top: 24, right: 18, bottom: 16, left: 18 },
      border: { style: "solid", widthPt: .75, color: presetAccent }, borderRadiusPt: 6,
      frame: { design: "band", label: "举一反三", labelPosition: "top-left", labelStyle: "filled", accentColor: presetAccent }
    }
  },
  {
    id: "double-line", name: "双线", style: {
      ...handoutSpacing, paddingPt: { top: 19, right: 21, bottom: 19, left: 21 },
      border: { style: "solid", widthPt: .75, color: presetAccent }, borderRadiusPt: 6,
      frame: { design: "double", label: "典例精讲", labelPosition: "top-center", labelStyle: "plain", accentColor: presetAccent }
    }
  }
];

function hasDecoration(style: ChalkLeeQuestionStyle | undefined) {
  return Boolean(style?.frame || style?.border || style?.backgroundColor);
}

/** Labels are content: two frames that differ only in their wording share a picker card. */
function styleSignature(style: ChalkLeeQuestionStyle) {
  const { runtimeStyle, runtimeFrame } = chalkLeeQuestionAppearance(style);
  return JSON.stringify([runtimeStyle, runtimeFrame?.design, runtimeFrame?.labelPosition ?? "top-left", runtimeFrame?.labelStyle ?? "plain"]);
}

export function chalkLeeCurrentQuestionStyle(document: ChalkLeeDocument, node: ProseMirrorNode) {
  return document.appearance.questionStyles[String(node.attrs.styleRef ?? document.appearance.defaults.questionStyleRef)];
}

function frameDesign(style: ChalkLeeQuestionStyle | undefined) {
  if (!style?.frame) return null;
  return style.frame.design ?? (style.frame.labelPosition === "left" ? "rail"
    : style.frame.labelPosition === "top-center" && style.border?.style === "dashed" ? "dashed"
    : style.frame.labelStyle === "filled" ? "ribbon" : "line");
}

export function chalkLeeQuestionFrameChoices(document: ChalkLeeDocument, node: ProseMirrorNode): ChalkLeeQuestionFrameChoice[] {
  const { questionStyles: styles, defaults } = document.appearance;
  const currentRef = String(node.attrs.styleRef ?? defaults.questionStyleRef);
  const currentStyle = styles[currentRef];
  const entries = Object.entries(styles);
  // Prefer the current reference when several document styles share the same appearance.
  const orderedEntries = [...entries].sort(([left], [right]) => Number(right === currentRef) - Number(left === currentRef));
  const choices = presets.map(preset => {
    const style = preset.id === "none" ? preset.style : recolorChalkLeeFrame(preset.style, currentStyle?.frame?.accentColor ?? chalkLeeFrameColors[0].color);
    const signature = styleSignature(style);
    const existing = preset.id === "none"
      ? orderedEntries.find(([ref, style]) => !hasDecoration(style) && (ref === currentRef || ref === defaults.questionStyleRef))
      : orderedEntries.find(([, style]) => styleSignature(style) === signature);
    const baseRef = `question.frame.${preset.id}.v2`;
    let ref = baseRef;
    let suffix = 2;
    while (styles[ref]) ref = `${baseRef}.${suffix++}`;
    return {
      id: preset.id, name: preset.name,
      styleRef: existing?.[0] ?? ref, style: existing?.[1] ?? style,
      selected: preset.id === "none" ? !hasDecoration(currentStyle)
        : Boolean(currentStyle && frameDesign(currentStyle) === style.frame?.design)
    };
  });
  const seen = new Set(choices.map(choice => styleSignature(choice.style)));
  for (const [ref, style] of orderedEntries) {
    const signature = styleSignature(style);
    if (!hasDecoration(style) || seen.has(signature)) continue;
    seen.add(signature);
    choices.push({
      id: `document:${ref}`, name: style.frame?.label.trim() || "文档样式",
      styleRef: ref, style, selected: ref === currentRef && !choices.some(choice => choice.selected)
    });
  }
  return choices;
}

export function chalkLeeQuestionFrameStyleChange(state: EditorState, document: ChalkLeeDocument, questionId: string, choiceId: string) {
  const context = findChalkLeeQuestionContext(state.doc, questionId);
  if (!context) return null;
  const choice = chalkLeeQuestionFrameChoices(document, context.node).find(item => item.id === choiceId);
  if (!choice) return null;
  const currentStyle = chalkLeeCurrentQuestionStyle(document, context.node);
  if (currentStyle && (styleSignature(currentStyle) === styleSignature(choice.style) || choice.id === "none" && !hasDecoration(currentStyle))) return null;
  return changeQuestionStyle(state, document, questionId, choice.styleRef, choice.style);
}

/** Copy-on-write definitions keep sibling questions and every undo step intact. */
export function chalkLeeQuestionFrameCustomizationChange(state: EditorState, document: ChalkLeeDocument, questionId: string, patch: ChalkLeeFramePatch) {
  const context = findChalkLeeQuestionContext(state.doc, questionId);
  if (!context) return null;
  const current = chalkLeeCurrentQuestionStyle(document, context.node);
  if (!current) return null;
  const style = customizeChalkLeeFrameStyle(current, patch);
  if (!style || styleSignature(style) === styleSignature(current)) return null;
  const existing = Object.entries(document.appearance.questionStyles).find(([, value]) => styleSignature(value) === styleSignature(style));
  let ref = existing?.[0] ?? "question.frame.custom.1";
  if (!existing) {
    let index = 1;
    while (document.appearance.questionStyles[ref]) ref = `question.frame.custom.${++index}`;
  }
  return changeQuestionStyle(state, document, questionId, ref, existing?.[1] ?? style);
}

function changeQuestionStyle(state: EditorState, document: ChalkLeeDocument, questionId: string, styleRef: string, style: ChalkLeeQuestionStyle) {
  const context = findChalkLeeQuestionContext(state.doc, questionId);
  if (!context) return null;
  const { node, position } = context;
  const currentStyle = document.appearance.questionStyles[String(node.attrs.styleRef ?? document.appearance.defaults.questionStyleRef)];
  const currentFrame = resolveChalkLeeQuestionFrame(currentStyle?.frame, node.attrs.frameLabel);
  // Preserve even an inherited title when switching shapes, including a trip through "无边框".
  const frameLabel = typeof node.attrs.frameLabel === "string" ? node.attrs.frameLabel
    : currentFrame && currentFrame.label !== style.frame?.label ? currentFrame.label : null;
  const transaction = state.tr.setNodeMarkup(position, undefined, {
    ...node.attrs, styleRef, frameLabel, ...chalkLeeQuestionAppearance(style)
  });
  return {
    transaction,
    document: {
      ...document,
      appearance: {
        ...document.appearance,
        questionStyles: {
          ...document.appearance.questionStyles,
          [styleRef]: structuredClone(style)
        }
      }
    }
  };
}
