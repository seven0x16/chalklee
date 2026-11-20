/** Restore only independently read, printed subquestion markers beside a unique
 * existing line. Never rewrite its words/formulas or infer a missing number. */
export function restoreAuditedImportMarkers(markdown: string, raw: string): { markdown: string; restored: string[] } {
  const value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  if (!Array.isArray(value.markers) || value.markers.length > 80) throw new Error("原稿小问编号核对格式无效。");
  const normalized = (text: string) => text.normalize("NFKC").replace(/[\s:：,，.。．、;；]/g, "");
  const prefix = /^(\s*(?:\d{1,3}\s*[.．、]\s*)?)([（(]\d{1,2}[）)]|[⑴-⒇])?\s*/;
  const lines = markdown.split("\n"), restored: string[] = [];
  for (const item of value.markers) {
    // An observation starting with a formula may have no usable text anchor.
    // Ignore unusable observations; they never authorize adding a number.
    if (!item || typeof item.marker !== "string" || !/^(?:[（(]\d{1,2}[）)]|[⑴-⒇])$/.test(item.marker) || typeof item.followingText !== "string" || item.followingText.length > 120) continue;
    const anchor = normalized(item.followingText);
    if (anchor.length < 4 || /\[\[|\$|\n/.test(item.followingText)) continue;
    const matches = lines.flatMap((line, index) => {
      const match = line.match(prefix)!;
      return normalized(line.slice(match[0].length)).startsWith(anchor) ? [{ index, match }] : [];
    });
    if (matches.length !== 1) continue;
    const { index, match } = matches[0];
    if (match[2]) {
      if (normalized(match[2]) !== normalized(item.marker)) throw new Error(`原稿小问编号与转录冲突：${match[2]} / ${item.marker}，请重新识别原稿。`);
      continue;
    }
    lines[index] = match[1] + item.marker + " " + lines[index].slice(match[0].length);
    restored.push(item.marker + " " + item.followingText);
  }
  return { markdown: lines.join("\n"), restored };
}
