export const DOCUMENT_KINDS = ["doc", "docx", "pdf", "tex", "md", "markdown", "html", "htm", "chalklee"] as const;
export type DocumentKind = typeof DOCUMENT_KINDS[number];
export const isMarkdownKind = (kind: string) => kind === "md" || kind === "markdown";
/** Web pages open as a live, sandboxed preview; they are neither converted nor edited. */
export const isHtmlKind = (kind: string) => kind === "html" || kind === "htm";
/**
 * What a workspace page may do: run its scripts, forms and dialogs, open links in the
 * system browser and go full screen. Without allow-same-origin it gets an opaque origin,
 * so it cannot reach the app, its preload API or other workspace files.
 */
export const HTML_PAGE_SANDBOX_FLAGS = "allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-pointer-lock";
/** Plugins get less than a workspace page: no popups, so nothing they hold can leave through a window. */
export const PLUGIN_SANDBOX_FLAGS = "allow-scripts allow-forms allow-modals allow-pointer-lock";
/** LaTeX sources are originals too: converted, never edited or compiled in the app. */
export const isLatexKind = (kind: string) => kind === "tex";
export const isOriginalKind = (kind: string) => kind === "pdf" || kind === "doc" || kind === "docx" || kind === "tex";
/** "不需要转换" is for originals kept only for reading, like a textbook; a LaTeX source is the teacher's own and has no such use. */
export const canSkipConversion = (kind: string) => isOriginalKind(kind) && !isLatexKind(kind);
export const isConvertibleKind = (kind: string) => isOriginalKind(kind) || isMarkdownKind(kind);
export const sourceFormat = (file: string): "pdf" | "doc" | "docx" | "markdown" | "latex" => /\.pdf$/i.test(file) ? "pdf" : /\.(md|markdown)$/i.test(file) ? "markdown" : /\.tex$/i.test(file) ? "latex" : /\.doc$/i.test(file) ? "doc" : "docx";
/** .md/.markdown and .html/.htm are one type each when sorting and filtering. */
export const documentKindFamily = (kind: string) => isMarkdownKind(kind) ? "markdown" : isHtmlKind(kind) ? "html" : kind;
export const documentKindLabel = (kind: string) => isMarkdownKind(kind) ? "Markdown" : isHtmlKind(kind) ? "HTML" : isLatexKind(kind) ? "LaTeX" : kind.toUpperCase();
