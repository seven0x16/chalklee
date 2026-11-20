import type { ChalkLeeBlockNode } from "@chalklee/format";

/**
 * What a distributor overlays on the papers it shares to advertise itself: "来源：高三答案公众号",
 * "微信搜《高三答案公众号》获取全科", "关注公众号××获取答案". Only these fixed forms, so a passage that merely
 * mentions an official account keeps it.
 */
const PROMO = /[^\S\n]*(?:来源[:：][^\S\n]*[^\s，。；,;]{2,20}?公众号|微信搜(?:索)?[^\S\n]*[《“"]?[^》”"\s]{2,20}?[》”"]?[^\S\n]*获取[^\s，。；,;]{0,8}|关注(?:微信)?公众号[^\S\n]*[《“"]?[^\s，。；,;》”"]{2,20}?[》”"]?[^\S\n]*获取[^\s，。；,;]{0,8})[^\S\n]*/g;

export const stripDistributorPromo = (text: string): string => text.replace(PROMO, "");

/** The same, on extracted blocks: text runs lose the advert, and a paragraph left with nothing is dropped. */
export function stripDistributorPromoBlocks(blocks: ChalkLeeBlockNode[]): ChalkLeeBlockNode[] {
  const text = (nodes: any[]) => nodes.map(node => node.type === "text" ? node.text : "￼").join("");
  return blocks.flatMap(block => {
    if ((block.type !== "paragraph" && block.type !== "heading") || !block.content?.length) return [block];
    const before = text(block.content);
    if (stripDistributorPromo(before) === before) return [block];
    const content = (block.content as any[]).map(node => node.type === "text" ? { ...node, text: stripDistributorPromo(node.text) } : node).filter(node => node.type !== "text" || node.text);
    return content.length ? [{ ...block, content } as ChalkLeeBlockNode] : [];
  });
}
