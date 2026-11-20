import "mathlive/static.css";

const COMMON_MATH_FONTS = ["16px KaTeX_Main", "italic 16px KaTeX_Math", "16px KaTeX_Size1", "16px KaTeX_Size2"];
let commonMathFontsRequested = false;

/** Start loading MathLive's common local faces while a ChalkLee document opens. */
export function prewarmChalkLeeMathFonts(fonts: FontFaceSet | undefined) {
  if (!fonts || commonMathFontsRequested) return;
  commonMathFontsRequested = true;
  void Promise.allSettled(COMMON_MATH_FONTS.map(font => fonts.load(font)));
}
