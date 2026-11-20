import { child, children, type XmlNode } from "./xml";

export const rgbColor = (value: string | undefined) => value && /^[0-9a-f]{6}$/i.test(value) ? `#${value}` : undefined;
const colorNames: Record<string, string> = {
  dark1: "dk1", dark2: "dk2", light1: "lt1", light2: "lt2", hyperlink: "hlink", followedHyperlink: "folHlink",
  background1: "lt1", background2: "lt2", text1: "dk1", text2: "dk2",
};
const mappingNames: Record<string, string> = { background1: "bg1", background2: "bg2", text1: "t1", text2: "t2" };

/** Word applies theme tint/shade to HSL luminance, rather than each RGB channel. */
function luminance(color: string, shade: string | undefined, tint: string | undefined): string {
  const factor = (s: string | undefined) => s && /^[0-9a-f]{2}$/i.test(s) ? parseInt(s, 16) / 255 : undefined;
  const s = factor(shade), t = factor(tint);
  if (s === undefined && t === undefined) return color;
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
  const max = Math.max(...rgb), min = Math.min(...rgb), old = (max + min) / 2;
  const next = t !== undefined ? 1 - (1 - old) * t : old * s!;
  const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * old - 1));
  const scale = max === min ? 0 : (1 - Math.abs(2 * next - 1)) * saturation / (max - min);
  return `#${rgb.map(c => Math.round(Math.max(0, Math.min(1, next + (c - old) * scale)) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function createThemeResolver(root: XmlNode | undefined, settings: XmlNode | undefined) {
  const elements = child(child(root, "theme"), "themeElements");
  const fonts = child(elements, "fontScheme"), colors = child(elements, "clrScheme");
  const language = child(settings, "themeFontLang"), mapping = child(settings, "clrSchemeMapping");
  return {
    lineWidth(index: number): number | undefined {
      if (!Number.isInteger(index) || index < 1) return;
      const width = Number(children(child(child(elements, "fmtScheme"), "lnStyleLst"), "ln")[index - 1]?.attrs.w);
      return Number.isFinite(width) && width >= 0 && width <= 1219200 ? width / 9525 : undefined;
    },
    font(reference: string | undefined, eastAsia: boolean, lang?: string): string | undefined {
      if (!reference || !/^(major|minor)(Ascii|HAnsi|EastAsia|Bidi)$/.test(reference)) return;
      const group = child(fonts, reference.startsWith("major") ? "majorFont" : "minorFont");
      // The rFonts slot determines the script; some Word documents use minorHAnsi
      // in the eastAsiaTheme slot and still require the East Asian theme face.
      if (!eastAsia) return child(group, "latin")?.attrs.typeface || undefined;
      const direct = child(group, "ea")?.attrs.typeface;
      if (direct) return direct;
      const code = (lang ?? language?.attrs.eastAsia ?? "").toLowerCase();
      const script = /^(zh-(tw|hk|mo)|zh-hant)/.test(code) ? "Hant" : /^zh/.test(code) ? "Hans" : /^ja/.test(code) ? "Jpan" : /^ko/.test(code) ? "Hang" : undefined;
      return children(group, "font").find(n => n.attrs.script === script)?.attrs.typeface || undefined;
    },
    color(node: XmlNode | undefined, fill = false): string | undefined {
      if (!node) return;
      const attrs = node.attrs, ref = attrs[fill ? "themeFill" : "themeColor"];
      const mapped = ref && (mapping?.attrs[mappingNames[ref] ?? ref] ?? ref);
      const source = mapped ? child(colors, colorNames[mapped] ?? mapped)?.children[0] : undefined;
      const theme = source?.name === "srgbClr" ? rgbColor(source.attrs.val) : source?.name === "sysClr" ? rgbColor(source.attrs.lastClr) : undefined;
      if (theme) return luminance(theme, attrs[fill ? "themeFillShade" : "themeShade"], attrs[fill ? "themeFillTint" : "themeTint"]);
      const fallback = attrs[fill ? "fill" : "val"];
      return rgbColor(fallback) ?? (fallback === "auto" ? fill ? "transparent" : "var(--cm-document-paper-ink)" : undefined);
    },
  };
}
export type WordTheme = ReturnType<typeof createThemeResolver>;
