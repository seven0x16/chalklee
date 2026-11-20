const QUESTION = /^[ \t>]*(?:#{1,6}[ \t]*)?(?:\d{1,3}[.．、)）]|[（(]\d{1,3}[)）])[ \t　]*\S/gm;
const SECTION = /^[ \t>#*]*[一二三四五六七八九十]{1,3}[、.．][^\n]{0,12}(?:选择|填空|判断|解答|计算|阅读|完形|写作|作文|听力|词汇|语法|改错|翻译|应用|实验|简答)/m;
const OPTION = /(?:^|[ \t　])[A-D][.．、)）][ \t　]*\S/gm;
// Blanks as typed, or escaped the way a paste writes them; empty brackets for a choice.
const BLANK = /(?:\\?_){3,}|＿{2,}|（[ \t　]*）|\([ \t　]{2,}\)/g;

/**
 * Whether a note reads like a paper or worksheet for students rather than the teacher's own text: numbered questions
 * with answer options or blanks, or sections named by question type. Only the opening of a long note is read.
 */
export function looksLikePaper(text: string): boolean {
  const sample = text.slice(0, 40_000);
  if ((sample.match(QUESTION)?.length ?? 0) < 3) return false;
  return SECTION.test(sample) || (sample.match(OPTION)?.length ?? 0) >= 6 || (sample.match(BLANK)?.length ?? 0) >= 3;
}
