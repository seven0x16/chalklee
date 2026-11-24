/** Printed choice answer brackets and Markdown emphasis are not part of a question number. */
export function importQuestionAnchors(text: string): RegExpMatchArray[] {
  // "11.2010—2020年江苏省…", "1.5月20日为中国学生营养日": a number before a year or a date is the question's
  // number, not a decimal.
  return [...text.matchAll(/^[^\S\r\n]*(?:\*{1,2})?(?:[（(][^\S\r\n]*[）)][^\S\r\n]*)?(\d{1,3})(?:(?:\.(?!\d)|\.(?=(?:19|20)\d\d(?:年|[^\S\r\n]*[—–~～-])|1?\d月\d{1,2}日)|[．、])[^\S\r\n]*|[^\S\r\n]+)(?:\*{1,2})?/gm)];
}

/**
 * Where a blank's number is printed in running text: "falls 46 May", "(13)", "room.26. Let's", "37.________(smart)".
 * A number glued to the end of the previous sentence is still printed once, and its own period goes with it;
 * a decimal ("3.26", "26.5") never is the number.
 */
export function printedBlankNumbers(text: string, label: string): RegExpMatchArray[] {
  return [...text.matchAll(new RegExp(`(?<![\\d\\w])(?<!\\d[.．])[（(]?[ \\t]*${label}[ \\t]*(?:[）)]|[.．](?=[\\s_]|$))?(?![\\dA-Za-z])(?![.．]\\d)`, "g"))];
}

/** The number of a question printed with its separator ("2．", "2."), not a count opening a sentence ("2 次"). */
export function importPunctuatedQuestionStart(text: string): string | undefined {
  const match = importQuestionAnchors(text).find(anchor => anchor.index === 0);
  return match && /[.．、]/.test(match[0]) ? match[1] : undefined;
}

/** "41. A. ": the number of a question printed on its first option, as cloze questions are. */
export const importNumberedFirstOption = (text: string) => text.match(/^\s*\d{1,3}\s*[.．、]\s*A\s*[.．、]\s*/)?.[0];

export function importOptionAnchors(text: string): RegExpMatchArray[] {
  const marked = [...text.matchAll(/(?:^|\s)(?:\*{1,2})?([A-H])[ \t]*[.．、:：)）](?:\*{1,2})?[ \t]*/g)].filter(match => {
    if (!/[)）]/.test(match[0])) return true;
    // A wrapped parenthetical name, such as "(region\nA)", is still prose.
    const before = text.slice(0, match.index);
    return Math.max(before.lastIndexOf("("), before.lastIndexOf("（")) <= Math.max(before.lastIndexOf(")"), before.lastIndexOf("）"));
  });
  const unmarked = [...text.matchAll(/(?:^|\n)[ \t]*([A-H])[ \t]+(?=\S)/g)];
  const anchors = [...marked, ...unmarked].sort((a, b) => a.index! - b.index!);
  return anchors.filter((anchor, index) => {
    const letter = anchor[1].charCodeAt(0);
    if (anchors[index - 1]?.[1].charCodeAt(0) === letter - 1 || anchors[index + 1]?.[1].charCodeAt(0) === letter + 1) return true;
    // A page may contain just one continued option. An isolated letter in a
    // sentence ("points H、F") is not an option boundary for moving a figure.
    return anchors.length === 1 && (anchor[0].includes("\n") || !text.slice(text.lastIndexOf("\n", anchor.index!) + 1, anchor.index!).trim());
  });
}
