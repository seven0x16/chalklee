import type { CSSProperties } from "react";
import type { ChalkLeeQuestionFrame, ChalkLeeQuestionStyle } from "@chalklee/format";
import { chalkLeeFrameLabelText, chalkLeeFrameTint } from "./frameCustomization";

/** Keep the shared style intact: an empty override hides only this question's label. */
export function resolveChalkLeeQuestionFrame(frame: ChalkLeeQuestionFrame | null | undefined, label: unknown) {
  return frame ? { ...frame, label: typeof label === "string" ? label : frame.label } : null;
}

/** Derived presentation only. Persist the style definition and its styleRef in ChalkLee. */
export function chalkLeeQuestionAppearance(style: ChalkLeeQuestionStyle | undefined) {
  if (!style) return { runtimeStyle: null, runtimeFrame: null };
  const css: CSSProperties & Record<string, string | number> = {};
  if (style.backgroundColor) css.backgroundColor = style.backgroundColor;
  if (style.border) css.border = `${style.border.widthPt}pt ${style.border.style} ${style.border.color}`;
  if (style.borderRadiusPt != null) css.borderRadius = `${style.borderRadiusPt}pt`;
  if (style.paddingPt) {
    const { top, right, bottom, left } = style.paddingPt;
    css.padding = `${top}pt ${right}pt ${bottom}pt ${left}pt`;
    css["--chalklee-question-padding-top"] = `${top}pt`;
    css["--chalklee-question-padding-left"] = `${left}pt`;
    css["--chalklee-question-padding-right"] = `${right}pt`;
    css["--chalklee-question-padding-bottom"] = `${bottom}pt`;
  }
  if (style.gapPt != null) css["--chalklee-question-gap"] = `${style.gapPt}pt`;
  if (style.spaceBeforePt != null) css.marginTop = `${style.spaceBeforePt}pt`;
  if (style.spaceAfterPt != null) css.marginBottom = `${style.spaceAfterPt}pt`;
  if (style.breakInside) css.breakInside = style.breakInside;
  // Read by pagination and print; subquestions inherit it but never break for it.
  if (style.breakBefore === "page") css["--chalklee-break-before"] = "page";
  // Keep an empty style label available for the inline "添加标题" affordance.
  const frame = style.frame ?? null;
  if (frame) {
    const accent = frame.accentColor ?? style.border?.color ?? "#486879";
    css["--chalklee-frame-accent"] = accent;
    css["--chalklee-frame-label-text"] = chalkLeeFrameLabelText(accent, style.backgroundColor);
    css["--chalklee-frame-tint"] = chalkLeeFrameTint(accent, .6);
    css["--chalklee-frame-border"] = style.border?.color ?? accent;
    css["--chalklee-frame-width"] = `${style.border?.widthPt ?? .75}pt`;
    css["--chalklee-frame-line"] = style.border?.style ?? "solid";
    css["--chalklee-frame-radius"] = `${style.borderRadiusPt ?? 0}pt`;
    css["--chalklee-frame-surface"] = style.backgroundColor ?? "var(--chalklee-page-background, #fff)";
  }
  return { runtimeStyle: css, runtimeFrame: frame ? { ...frame } : null };
}

/**
 * A title straddling a frame's top edge needs room above the frame that a page break cannot take away:
 * the node view's wrapper keeps it as padding, and the frame's own space above shrinks by the same amount.
 * Every key is always written, as the wrapper only ever sets attributes.
 */
export function chalkLeeFrameWrapperAttrs(attrs: { runtimeFrame?: unknown; runtimeStyle?: unknown }, defaultSpaceBefore = "0pt"): Record<string, string> {
  const frame = attrs.runtimeFrame as ChalkLeeQuestionFrame | null | undefined;
  const room = Boolean(frame) && frame!.labelPosition !== "left" && !["fold", "band", "rail"].includes(frame!.design ?? "");
  const spaceBefore = (attrs.runtimeStyle as Record<string, unknown> | null | undefined)?.marginTop;
  return {
    "data-frame-room": room ? "true" : "false",
    style: room ? `--chalklee-frame-space-before: ${typeof spaceBefore === "string" ? spaceBefore : defaultSpaceBefore}` : ""
  };
}
