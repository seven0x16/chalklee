/** Only explicit answer-section titles, never instructions such as “写出答案”. */
export function isImportAnswerHeading(text: string): boolean {
  const title = text.trim().replace(/^[#*【\[\s]+|[*】\]:：\s]+$/g, "")
    .replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "")
    // “答案解析部分” names the same section as “答案解析”.
    .replace(/(?<=答案|解析|详解)部分$/, "");
  return /^(?:(?:参考|标准)?答案(?:[与及和]?解析|详解)?|(?:(?:语文|数学|英语|物理|化学|生物学?|历史|地理|政治|思想政治|道德与法治)(?:试卷)?|试卷)(?:参考|标准)?答案(?:[与及和]?解析)?|试题解析|答案及评分(?:标准|参考)|answer\s*key|answers?(?:\s+and\s+solutions?)?|solutions?)$/i.test(title)
    || (!/请|不要|不得|写出|填写|抄写|对照|参照|查看|查阅|[。！？!?]/.test(title)
      && /^[\p{L}\p{N}\s()（）—–-]{1,80}(?:试卷|试题|考试|检测|调研)\s*(?:参考|标准)?答案(?:[与及和]?解析|详解)?$/u.test(title));
}

/** A section's printed label is independent of its score/count description. */
export function importSectionLabel(text: string): string | undefined {
  return text.normalize("NFKC").trim().replace(/^#+\s*/, "")
    .match(/^(第[一二三四五六七八九十百\d]+(?:章|节|部分|卷)|[一二三四五六七八九十百]+\s*[、.]|[IVX](?:\s*[IVX])*\s*[、.])\s*/)?.[1].replace(/\s*[、.]$/, "").replace(/\s/g, "");
}

export const normalizeImportNumber = (number: string): string => number.normalize("NFKC").trim().replace(/[（(]\s*(\d+)\s*[）)]/g, "$1").replace(/[.．、]$/, "");

/** Printed subsection titles are not the preceding question's answer. */
export const isImportSubsectionHeading = (text: string): boolean => /^\s*[（(][一二三四五六七八九十]+[）)]\s*(?:必考题|选考题|选择题|非选择题|填空题|解答题)(?:\s*[:：。]|\s*$)/.test(text)
  || /^\s*【选修\s*\d+\s*[:：][^】\n]{1,40}】\s*$/.test(text)
  // The paper's halves: "选择题部分（共40分）", "第Ⅱ卷（非选择题 共90分）".
  || /^\s*(?:(?:非)?选择题部分|第\s*(?:[ⅠⅡ]|I{1,2}|[一二12])\s*卷)\s*(?:(?:非)?选择题)?\s*(?:[（(][^（）()\n]{1,20}[）)])?\s*$/.test(text)
  // A Chinese paper's subsections: "（四）阅读IV（本题共2小题，9分）", "（一）现代文阅读Ⅰ".
  || /^\s*[（(][一二三四五六七八九十]+[）)]\s*[^。！？!?；;，,（()\n]{1,24}[（(][^（）()\n]{0,24}(?:分|小题)[^（）()\n]{0,12}[）)]\s*$/.test(text)
  || /^\s*[（(][一二三四五六七八九十]+[）)]\s*(?:现代文|古代诗文|古诗文|文言文|古代诗歌|诗歌|名篇名句|论述类文本|实用类文本|文学类文本|语言文字|语言运用|写作|作文)[^。！？!?；;，,\n]{0,16}$/.test(text);

/** "阅读下面的文字，完成18～22题。", "据此完成6～8题。": the lead-in of the questions that follow, never an answer. */
export const isImportQuestionLeadIn = (text: string): boolean => text.length <= 200 && !/^\s*【/.test(text)
  && /(?:完成|回答)\s*(?:第\s*)?\d{1,3}\s*(?:[～~—–-]\s*\d{1,3}\s*)?(?:小)?题\s*[。.]?\s*$/.test(text.trim());

export const isImportSampleHeading = (text: string): boolean => /^(?:(?:参考)?范文|范文参考|参考作文|one possible version|sample (?:answer|essay))\s*[:：]?$/i.test(text.trim());

/** Rubric lists have their own numbering, independent of the paper's answers.
 * A short inline scoring note does not start a new section. */
export const isImportScoringSection = (text: string): boolean => /^(?:参考)?(?:评分细则|评分原则|阅卷说明|评分档次(?:[和及]要求)?)(?:\s*[:：]|$)/.test(text.trim())
  || /^(?:参考)?评分标准\s*[:：]?$/.test(text.trim());
