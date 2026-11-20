import { XMLParser, XMLValidator } from "fast-xml-parser";

export interface XmlNode { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string }
const local = (name: string) => name.slice(name.indexOf(":") + 1);
/** Preserve element order: separate arrays for runs and drawings lose the reading order. */
export function readXml(xml: string): XmlNode {
  if (xml.length > 32 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("文档 XML 无效或过大。");
  if (XMLValidator.validate(xml) !== true) throw new Error("文档 XML 已损坏。");
  const raw = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "", trimValues: false, parseTagValue: false, processEntities: true }).parse(xml);
  function convert(items: Record<string, unknown>[], depth: number): XmlNode[] {
    if (depth > 128) throw new Error("文档结构过于复杂。");
    return items.flatMap(item => {
      const tag = Object.keys(item).find(key => key !== ":@" && key !== "#text" && !key.startsWith("?"));
      if (!tag) return [];
      const body = item[tag] as Record<string, unknown>[];
      return [{ name: local(tag), attrs: Object.fromEntries(Object.entries((item[":@"] ?? {}) as Record<string, unknown>).map(([k, v]) => [local(k), String(v)])),
        children: convert(body, depth + 1), text: body.filter(n => n["#text"] !== undefined).map(n => String(n["#text"])).join("") }];
    });
  }
  return { name: "root", attrs: {}, text: "", children: convert(raw, 0) };
}
export const children = (node: XmlNode | undefined, name: string): XmlNode[] => node?.children.filter(n => n.name === name) ?? [];
export const child = (node: XmlNode | undefined, name: string): XmlNode | undefined => children(node, name)[0];
export const value = (node: XmlNode | undefined, name: string): string | undefined => child(node, name)?.attrs.val;
export function descendants(node: XmlNode | undefined, name: string): XmlNode[] {
  if (!node) return [];
  return node.children.flatMap(n => [...(n.name === name ? [n] : []), ...descendants(n, name)]);
}
export function text(node: XmlNode | undefined): string { return node ? node.text + node.children.map(text).join("") : ""; }
export const enabled = (node: XmlNode | undefined): boolean | undefined => node ? !["0", "false", "off", "none"].includes(node.attrs.val ?? "1") : undefined;
