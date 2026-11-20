import { XMLParser, XMLValidator } from "fast-xml-parser";

export const escapeXml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const elements = new Set("svg g defs path rect circle ellipse line polyline polygon text tspan textPath clipPath mask linearGradient radialGradient stop pattern use image title desc".split(" "));
const attributes = new Set("id x y x1 y1 x2 y2 dx dy width height viewBox preserveAspectRatio transform d points cx cy r rx ry fill fill-rule fill-opacity stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity color clip-path clip-rule mask font-family font-size font-weight font-style text-anchor dominant-baseline alignment-baseline textLength lengthAdjust letter-spacing word-spacing gradientUnits gradientTransform offset stop-color stop-opacity spreadMethod fx fy fr patternUnits patternContentUnits patternTransform clipPathUnits maskUnits maskContentUnits startOffset".split(" "));
const css = new Set("fill fill-rule fill-opacity stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity color clip-path clip-rule mask font-family font-size font-weight font-style text-anchor dominant-baseline alignment-baseline letter-spacing word-spacing stop-color stop-opacity".split(" "));
const local = (s: string) => s.slice(s.indexOf(":") + 1);
const safeValue = (s: string) => !/[<>\\]|@|\/\*|expression\s*\(/i.test(s)
  && !s.replace(/url\(\s*#[\w.-]+\s*\)/g, "").match(/url\s*\(/i);
type Item = Record<string, unknown>;

/** Rebuild an inert SVG image with local references only, preserving mixed text order. */
export function sanitizeSvg(bytes: Uint8Array, stretch = false): { bytes: Uint8Array; partial: boolean } | undefined {
  if (bytes.length > 4 * 1024 * 1024) return;
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(source) || XMLValidator.validate(source) !== true) return;
    const raw = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "", trimValues: false, parseTagValue: false }).parse(source) as Item[];
    let partial = false, count = 0;
    function render(items: Item[], depth: number): string {
      if (depth > 64) throw Error("SVG depth");
      return items.map(item => {
        if (++count > 20000) throw Error("SVG size");
        if (item["#text"] !== undefined) return escapeXml(String(item["#text"]));
        const tag = Object.keys(item).find(k => k !== ":@" && !k.startsWith("?") && !k.startsWith("#"));
        if (!tag) return "";
        const name = local(tag);
        if (!elements.has(name)) { partial = true; return ""; }
        const attrs: string[] = [];
        if (depth === 0) {
          attrs.push('xmlns="http://www.w3.org/2000/svg"');
          if (stretch) attrs.push('preserveAspectRatio="none"');
        }
        for (const [key, value] of Object.entries((item[":@"] ?? {}) as Item)) {
          if (key === "xmlns" || key.startsWith("xmlns:") || ["version", "baseProfile"].includes(key)) continue;
          const attr = local(key), s = String(value);
          if (depth === 0 && stretch && attr === "preserveAspectRatio") continue;
          if (attr === "href") {
            const allowed = /^#[\w.-]+$/.test(s) || name === "image" && /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(s);
            if (allowed) attrs.push(`href="${escapeXml(s)}"`); else partial = true;
          } else if (attr === "style") {
            const rules: string[] = [];
            for (const rule of s.split(";")) {
              if (!rule.trim()) continue;
              const colon = rule.indexOf(":"), prop = rule.slice(0, colon).trim().toLowerCase(), val = rule.slice(colon + 1).trim();
              if (colon > 0 && css.has(prop) && safeValue(val)) rules.push(`${prop}:${val}`); else partial = true;
            }
            if (rules.length) attrs.push(`style="${escapeXml(rules.join(";"))}"`);
          } else if (attributes.has(attr) && safeValue(s)) attrs.push(`${attr}="${escapeXml(s)}"`);
          else partial = true;
        }
        return `<${name}${attrs.length ? ` ${attrs.join(" ")}` : ""}>${render(item[tag] as Item[], depth + 1)}</${name}>`;
      }).join("");
    }
    const roots = raw.filter(item => Object.keys(item).some(k => local(k) === "svg"));
    if (roots.length !== 1) return;
    return { bytes: new TextEncoder().encode(render(roots, 0)), partial };
  } catch { return; }
}
