import type { ChalkLeeDocument } from "@chalklee/format";

/** Deliberately small layout surface: the agent changes data, never runs code. */
export const autonomousLayoutRanges = {
  fontSizePt: [10, 16], lineHeight: [1.2, 2], paragraphSpaceAfterPt: [0, 12], questionGapPt: [0, 18]
} as const;
export type AutonomousLayout = Partial<Record<keyof typeof autonomousLayoutRanges, number>>;
export const autonomousLayoutDefaults: Required<AutonomousLayout> = {
  fontSizePt: 11, lineHeight: 1.35, paragraphSpaceAfterPt: 2, questionGapPt: 3
};

export function validateAutonomousLayout(value: unknown): asserts value is AutonomousLayout {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("layout 必须是排版参数对象。");
  for (const [key, number] of Object.entries(value)) {
    const range = autonomousLayoutRanges[key as keyof AutonomousLayout];
    if (!range || typeof number !== "number" || !Number.isFinite(number) || number < range[0] || number > range[1]) {
      throw new Error(`排版参数 ${key} 无效${range ? `，允许范围 ${range[0]}—${range[1]}` : ""}。`);
    }
  }
}

export function applyAutonomousLayout(document: ChalkLeeDocument, layout: AutonomousLayout = {}) {
  validateAutonomousLayout(layout);
  const values = { ...autonomousLayoutDefaults, ...layout };
  document.appearance.body.fontSizePt = values.fontSizePt;
  document.appearance.body.lineHeight = values.lineHeight;
  document.appearance.body.paragraphSpaceAfterPt = values.paragraphSpaceAfterPt;
  const style = document.appearance.questionStyles[document.appearance.defaults.questionStyleRef];
  style.gapPt = values.questionGapPt;
  // Leave room for a single heading, instead of inserting a large gap before
  // every original answer. The editor owns group solution numbering/layout.
  for (const styles of [document.appearance.answerStyles, document.appearance.analysisStyles]) {
    for (const value of Object.values(styles)) value.paddingPt = { top: 0, right: 0, bottom: 2, left: 32 };
  }
  const walk = (node: any) => {
    if (node.type === "question" || node.type === "questionGroup") {
      // Existing short-question rules are applied afterwards by the importer.
      // Long groups remain free to continue across pages.
      node.attrs.styleRef ??= document.appearance.defaults.questionStyleRef;
    }
    // The editor starts wrapping at the image position. Place an explicitly
    // requested float before its immediately preceding paragraph, as in the
    // reviewed Codex builder. Keep it within the same semantic region.
    if (["questionStem", "questionMaterial", "questionAnswer", "questionAnalysis", "option"].includes(node.type)) {
      for (let i = 1; i < (node.content?.length ?? 0); i++) {
        const image = node.content[i];
        if (image.type === "image" && ["wrap-left", "wrap-right"].includes(image.attrs?.layout) && node.content[i - 1].type === "paragraph") {
          node.content.splice(i, 1); node.content.splice(i - 1, 0, image);
        }
      }
    }
    node.content?.forEach(walk);
  };
  walk(document.content);
}
