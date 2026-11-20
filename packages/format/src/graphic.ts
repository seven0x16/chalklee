import type { ChalkLeeGraphicNode } from "./types";

/** Characters of SVG a graphic may hold, its print version included. */
export const CHALKLEE_GRAPHIC_MAX_LENGTH = 200_000;

/**
 * Problems with an SVG that is only ever shown as a picture: it must be one complete drawing that runs no script
 * and loads nothing from elsewhere. Pictures written into it as `data:image/…` and references to its own parts
 * (`#id`) are allowed, and so are its own animations (SMIL and CSS inside the SVG).
 */
export function chalkLeeSvgIssues(svg: string): string[] {
  const issues: string[] = [];
  if (!/^\s*<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) issues.push("需要是完整的 <svg>…</svg>。");
  if (/<\s*(script|foreignObject|iframe|object|embed)\b|\son[a-z]+\s*=/i.test(svg)) issues.push("不能包含脚本、事件或嵌入的网页内容。");
  if (/(href|src)\s*=\s*["']\s*(?!#|data:image\/)/i.test(svg) || /url\(\s*["']?\s*(?!#|data:image\/)/i.test(svg) || /@import\b/i.test(svg)) {
    issues.push("只能引用自身的图形或写在其中的图片，不能引用网址或文件。");
  }
  return issues;
}

/** Problems with a graphic block, each naming what to fix. */
export function chalkLeeGraphicIssues(attrs: ChalkLeeGraphicNode["attrs"]): string[] {
  const issues: string[] = [];
  for (const [name, svg] of [["图形", attrs.svg], ["图形的打印版本", attrs.printSvg]] as const) {
    if (svg === undefined) continue;
    issues.push(...chalkLeeSvgIssues(svg).map(issue => `${name}${issue}`));
    if (!/^\s*<svg\b[^>]*\sviewBox\s*=/i.test(svg)) issues.push(`${name}的根元素需要 viewBox，才能按宽度缩放。`);
  }
  if (attrs.svg.length + (attrs.printSvg?.length ?? 0) > CHALKLEE_GRAPHIC_MAX_LENGTH) issues.push(`图形连同打印版本最多 ${CHALKLEE_GRAPHIC_MAX_LENGTH / 1000}K 字符。`);
  if (attrs.widthPercent !== undefined && !(attrs.widthPercent >= 10 && attrs.widthPercent <= 100)) issues.push("图形宽度为正文宽度的 10% 至 100%。");
  return issues;
}

const ANIMATION_ELEMENTS = "animate|animateTransform|animateMotion|animateColor|set";

/**
 * What a graphic looks like on paper: its print version, otherwise the drawing as it starts, with its SMIL
 * animations removed and CSS animations stopped.
 */
export function chalkLeeStaticGraphicSvg(attrs: Pick<ChalkLeeGraphicNode["attrs"], "svg" | "printSvg">): string {
  if (attrs.printSvg?.trim()) return attrs.printSvg;
  const stripped = attrs.svg
    .replace(new RegExp(`<(${ANIMATION_ELEMENTS})\\b[^>]*\\/>`, "g"), "")
    .replace(new RegExp(`<(${ANIMATION_ELEMENTS})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, "g"), "");
  return /animation|transition/i.test(stripped)
    ? stripped.replace(/^(\s*<svg\b[^>]*>)/i, "$1<style>*{animation:none!important;transition:none!important}</style>")
    : stripped;
}

/** The SVG as a file of its own: with its namespace, which a picture needs. */
export function chalkLeeGraphicSvgFile(svg: string): string {
  return (/^\s*<svg\b[^>]*\sxmlns\s*=/i.test(svg) ? svg : svg.replace(/^\s*<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"')).trim();
}

/** The SVG as a picture URL, for `<img>`, where it can animate but never run anything. */
export function chalkLeeGraphicPicture(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(chalkLeeGraphicSvgFile(svg))}`;
}
