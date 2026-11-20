import type { ChalkLeeBoxStyle, ChalkLeeQuestionFrame } from "@chalklee/format";

export type ChalkLeeBoxPresetGroup = "简洁" | "讲义" | "趣味" | "特别用途";

/** A box style shipped with the app, offered in 盒子属性 and to ChalkLee AI as a starting point. */
export interface ChalkLeeBoxPreset {
  /** Stable id; the style is copied into a document as `box.preset-<id>`. */
  id: string;
  name: string;
  group: ChalkLeeBoxPresetGroup;
  /** 黑白清楚: keeps its look in black-and-white print. 费墨: large dark or patterned areas, for screens. */
  tags: readonly ("黑白清楚" | "费墨")[];
  style: ChalkLeeBoxStyle;
}

export const CHALKLEE_BOX_PRESET_GROUPS: readonly ChalkLeeBoxPresetGroup[] = ["简洁", "讲义", "趣味", "特别用途"];

// Box style CSS selectors: the box itself, its title and the decoration layer over it.
const BOX = "[data-chalklee-box]";
const LABEL = `${BOX} > [data-chalklee-frame-label]`;
const DECO = `${BOX} > [data-chalklee-frame-decoration]`;
const svg = (body: string, width = 24, height = width) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} ${height}' width='${width}' height='${height}'>${body}</svg>`)}")`;
const pad = (top: number, right: number, bottom: number, left: number) => ({ top, right, bottom, left });
const frame = (accentColor: string, extra: Partial<ChalkLeeQuestionFrame> = {}): ChalkLeeQuestionFrame =>
  ({ label: "", design: "line", labelPosition: "top-left", labelStyle: "plain", accentColor, ...extra });
const solid = (color: string, widthPt = .75, style: "solid" | "dashed" | "dotted" = "solid") => ({ style, widthPt, color });
/** A title inside the box's top-left corner rather than on its top edge. */
const insideLabel = (top: string, left: string, extra = "") =>
  `${LABEL} { top: ${top}; left: ${left}; transform: none; padding: 0; background: transparent; ${extra} }`;
const icon = (picture: string) =>
  `${LABEL}::before { content: ""; display: inline-block; width: 11pt; height: 11pt; margin-right: 4pt; vertical-align: -1.5pt; background: ${picture} center / contain no-repeat; }`;

/** A filled pill title on the top edge, white text, optionally tilted, with a glyph before it. */
const pillLabel = (color: string, { tilt = 0, glyph = "", glyphColor = "#ffffff", outline = true } = {}) =>
  `${LABEL} { top: -.64em; left: 14pt; transform: ${tilt ? `rotate(${tilt}deg)` : "none"}; padding: 1.5pt 10pt 2pt; background: ${color}; border: ${outline ? "1.25pt solid #ffffff" : "0"}; border-radius: 999pt; box-shadow: 1pt 1pt 0 rgb(0 0 0 / .12); } ${LABEL} * { color: #ffffff !important; font-size: 9pt !important; font-weight: 700 !important; letter-spacing: .8pt !important; line-height: 1.5 !important; }`
  + (glyph ? ` ${LABEL}::before { content: "${glyph}"; display: inline-block; margin-right: 4pt; font-size: 7.5pt; vertical-align: .5pt; color: ${glyphColor}; }` : "");
/** A white hairline just inside the border, then a faint tinted one: a printed card's double edge. */
const innerEdge = (rgb: string) => `box-shadow: inset 0 0 0 2.5pt #ffffff, inset 0 0 0 3.25pt rgb(${rgb} / .18);`;

const preset = (id: string, name: string, group: ChalkLeeBoxPresetGroup, tags: ChalkLeeBoxPreset["tags"], style: ChalkLeeBoxStyle): ChalkLeeBoxPreset =>
  ({ id, name, group, tags, style: { name, spaceBeforePt: 14, spaceAfterPt: 12, ...style } });

const corner = (path: string) => svg(`<path d='${path}' fill='none' stroke='#111' stroke-width='1.5'/>`, 14);
const meander = (path: string) => svg(`<path d='${path}' fill='none' stroke='#7a1f1f' stroke-width='1.2'/>`, 18);

export const CHALKLEE_BOX_PRESETS: readonly ChalkLeeBoxPreset[] = [
  // 简洁：线条为主，黑白打印清楚。
  preset("line", "素线", "简洁", ["黑白清楚"], {
    border: solid("#111111"), paddingPt: pad(14, 14, 10, 14), frame: frame("#111111")
  }),
  preset("rounded", "细框圆角", "简洁", ["黑白清楚"], {
    border: solid("#9aa0a6"), borderRadiusPt: 6, paddingPt: pad(27, 14, 10, 14), frame: frame("#111111"),
    css: insideLabel("8pt", "14pt", "font-size: 10.5pt;")
  }),
  preset("double", "双线", "简洁", ["黑白清楚"], {
    border: solid("#111111"), paddingPt: pad(18, 18, 14, 18), frame: frame("#111111", { design: "double", labelPosition: "top-center" }),
    css: `${DECO} { opacity: 1; border-width: .5pt; } ${LABEL} { letter-spacing: .2em; padding-inline: 10pt; }`
  }),
  preset("corners", "角标", "简洁", ["黑白清楚"], {
    paddingPt: pad(18, 16, 14, 16), frame: frame("#111111"),
    css: `${DECO} { background: ${corner("M1 13V1h12")} left top no-repeat, ${corner("M1 1h12v12")} right top no-repeat, ${corner("M1 1v12h12")} left bottom no-repeat, ${corner("M13 1v12H1")} right bottom no-repeat; } ${LABEL} { left: 18pt; }`
  }),
  preset("dashed", "虚线提示", "简洁", ["黑白清楚"], {
    border: solid("#444444", .75, "dashed"), borderRadiusPt: 8, paddingPt: pad(16, 16, 11, 16), frame: frame("#111111"),
    css: `${LABEL} { border: .75pt solid #111111; border-radius: 20pt; padding-inline: 9pt; }`
  }),
  preset("rules", "上下线", "简洁", ["黑白清楚"], {
    paddingPt: pad(23, 2, 10, 2), frame: frame("#111111"),
    css: `${BOX} { border-top: 1.5pt solid #111111; border-bottom: .75pt solid #111111; } ${insideLabel("5pt", "2pt", "letter-spacing: .12em; font-size: 9.5pt;")}`
  }),

  // 讲义：主色加浅底，用颜色区分用途。
  preset("card", "知识卡", "讲义", [], {
    border: solid("#2f5fb3"), borderRadiusPt: 5, backgroundColor: "#eef4fb", paddingPt: pad(16, 16, 11, 16),
    frame: frame("#2f5fb3", { labelStyle: "filled" })
  }),
  preset("band", "题头色带", "讲义", [], {
    border: solid("#2e7d4f"), borderRadiusPt: 5, paddingPt: pad(30, 16, 11, 16), frame: frame("#2e7d4f", { design: "band" })
  }),
  preset("ribbon", "书签", "讲义", [], {
    border: solid("#b4233c"), backgroundColor: "#fff7f8", paddingPt: pad(18, 16, 11, 16), frame: frame("#b4233c", { design: "ribbon", labelStyle: "filled" })
  }),
  preset("fold", "折角", "讲义", [], {
    border: solid("#c98a2b"), backgroundColor: "#fdf6e8", paddingPt: pad(22, 16, 11, 16), frame: frame("#c98a2b", { design: "fold" })
  }),
  preset("folder", "档案夹", "讲义", [], {
    border: solid("#5b4bb7"), borderRadiusPt: 6, paddingPt: pad(12, 16, 11, 16), spaceBeforePt: 26, frame: frame("#5b4bb7", { labelStyle: "filled" }),
    css: `${BOX} { border-top-left-radius: 0 !important; } ${LABEL} { top: -.75pt; left: -.75pt; transform: translateY(-100%); border-radius: 6pt 6pt 0 0; padding: 3pt 14pt 2pt; }`
  }),
  preset("side", "侧标", "讲义", [], {
    border: solid("#0f766e"), paddingPt: pad(10, 14, 10, 44), frame: frame("#0f766e", { labelPosition: "left" }),
    css: `${BOX} { min-height: 64pt; } ${DECO} { right: auto; width: 30pt; background: #e6f4f1; border-right: .75pt solid #0f766e; } ${LABEL} { top: 50%; width: 30pt; max-height: none; transform: translateY(-50%); padding: 0; background: transparent; text-align: center; letter-spacing: 4pt; }`
  }),

  preset("tabblue", "青蓝标签", "讲义", [], {
    border: solid("#a9c6d8"), borderRadiusPt: 4, backgroundColor: "#f6fafc", paddingPt: pad(20, 16, 13, 16), spaceBeforePt: 16, frame: frame("#2b6a8f"),
    css: `${BOX} { background-image: linear-gradient(180deg, rgb(43 106 143 / .06) 0%, rgb(43 106 143 / 0) 50%); ${innerEdge("43 106 143")} } ${LABEL} { top: -.62em; left: 13pt; transform: none; padding: 1pt 8pt 1.5pt; background: #2b6a8f; border: 0; border-radius: 2pt; box-shadow: 0 1pt 0 rgb(43 106 143 / .28); } ${LABEL} * { color: #ffffff !important; font-size: 9pt !important; font-weight: 700 !important; letter-spacing: .8pt !important; line-height: 1.5 !important; } ${LABEL}::before { content: "◆"; display: inline-block; margin-right: 4.5pt; font-size: 6.5pt; vertical-align: 1pt; opacity: .85; } ${DECO}::after { content: ""; position: absolute; top: 0; right: 0; width: 30pt; height: 30pt; background: linear-gradient(225deg, rgb(43 106 143 / .10) 0%, rgb(43 106 143 / .10) 48%, rgb(43 106 143 / 0) 48%); } ${BOX} p { color: #1b2b36; }`
  }),
  preset("mint", "薄荷卡片", "讲义", [], {
    border: solid("#9fd5b7"), borderRadiusPt: 8, backgroundColor: "#f2fbf6", paddingPt: pad(20, 16, 13, 16), spaceBeforePt: 16, frame: frame("#2f9e6b"),
    css: `${BOX} { background-image: radial-gradient(circle at 0 0, rgb(47 158 107 / .10), rgb(47 158 107 / 0) 45%); ${innerEdge("47 158 107")} } ${pillLabel("#2f9e6b", { glyph: "❀", glyphColor: "#c9f2dc" })} ${DECO}::after { content: ""; position: absolute; right: 10pt; bottom: 7pt; width: 22pt; height: 22pt; opacity: .55; background: ${svg("<path d='M20 4C10 4 4 10 4 20c10 0 16-6 16-16z' fill='#bfe7d0' stroke='#2f9e6b' stroke-width='1'/><path d='M5 19L17 7' stroke='#2f9e6b' stroke-width='1' fill='none'/>")} center / contain no-repeat; } ${BOX} p { color: #1d3328; }`
  }),
  preset("topbar", "学术蓝条", "讲义", ["黑白清楚"], {
    border: solid("#d5dbe5"), borderRadiusPt: 4, paddingPt: pad(25, 16, 12, 16), frame: frame("#1f4e8c"),
    css: `${BOX} { border-top: 3pt solid #1f4e8c !important; } ${insideLabel("8pt", "16pt")} ${LABEL} * { color: #1f4e8c !important; font-size: 9.5pt !important; font-weight: 700 !important; letter-spacing: 1.5pt !important; } ${LABEL}::after { content: ""; display: inline-block; width: 28pt; height: .75pt; margin-left: 7pt; vertical-align: middle; background: #1f4e8c; opacity: .35; }`
  }),

  // 趣味：手账风格。
  preset("sticky", "便签", "趣味", [], {
    backgroundColor: "#fff4b8", paddingPt: pad(23, 16, 12, 16), spaceBeforePt: 18, frame: frame("#7a5b00"),
    css: `${BOX} { box-shadow: 0 2pt 4pt rgb(0 0 0 / .12); } ${DECO}::before { content: ""; position: absolute; top: -8pt; left: 50%; width: 64pt; height: 16pt; margin-left: -32pt; background: rgb(214 226 240 / .85); transform: rotate(-2deg); } ${insideLabel("6pt", "16pt", "font-size: 10.5pt;")}`
  }),
  preset("notebook", "笔记本", "趣味", ["黑白清楚"], {
    border: solid("#c7d2e3"), borderRadiusPt: 4, paddingPt: pad(22, 14, 4, 40), frame: frame("#1d4f91"),
    css: `${BOX} { line-height: 18pt; background-image: repeating-linear-gradient(to bottom, transparent 0 17.5pt, #c9daf2 17.5pt 18pt); background-position: 0 22pt; background-size: 100% calc(100% - 26pt); background-repeat: no-repeat; } ${BOX} p { margin-top: 0 !important; margin-bottom: 0 !important; line-height: 18pt !important; } ${DECO}::before { content: ""; position: absolute; top: 0; bottom: 0; left: 30pt; border-left: .75pt solid #e57373; } ${DECO}::after { content: ""; position: absolute; top: 12pt; bottom: 8pt; left: 10pt; width: 9pt; background: ${svg("<circle cx='6' cy='12' r='4' fill='none' stroke='#b0b8c4' stroke-width='1.2'/>", 12, 24)} center top / 9pt 18pt repeat-y; } ${insideLabel("3pt", "40pt", "line-height: 18pt;")}`
  }),
  preset("grid", "方格纸", "趣味", [], {
    border: solid("#7aa7c7"), backgroundColor: "#fbfdff", paddingPt: pad(18, 16, 11, 16), frame: frame("#245b84"),
    css: `${BOX} { background-image: linear-gradient(#dbe9f4 .5pt, transparent .5pt), linear-gradient(90deg, #dbe9f4 .5pt, transparent .5pt); background-size: 9pt 9pt; } ${LABEL} { border: .75pt solid #245b84; border-radius: 2pt; padding: 1pt 7pt; background: #ffffff; }`
  }),
  preset("bubble", "对话气泡", "趣味", ["黑白清楚"], {
    border: solid("#374151"), borderRadiusPt: 12, paddingPt: pad(16, 16, 11, 16), spaceAfterPt: 20, frame: frame("#374151"),
    css: `${DECO}::after { content: ""; position: absolute; bottom: -6.5pt; left: 28pt; width: 11pt; height: 11pt; background: var(--chalklee-page-background, #ffffff); border-right: .75pt solid #374151; border-bottom: .75pt solid #374151; transform: rotate(45deg); } ${icon(svg("<g fill='none' stroke='#374151' stroke-width='2' stroke-linecap='round'><circle cx='12' cy='8' r='4'/><path d='M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6'/></g>"))}`
  }),
  preset("warning", "警示条", "趣味", [], {
    border: solid("#c2410c"), paddingPt: pad(27, 16, 11, 16), frame: frame("#c2410c"),
    css: `${DECO} { background: repeating-linear-gradient(-45deg, #c2410c 0 6pt, #ffffff 6pt 12pt) top / 100% 7pt no-repeat; } ${insideLabel("12pt", "16pt")} ${LABEL}::before { content: "!"; display: inline-block; width: 13pt; height: 13pt; margin-right: 5pt; border-radius: 50%; background: #c2410c; color: #ffffff; font-size: 9pt; line-height: 13pt; text-align: center; vertical-align: 0; }`
  }),
  preset("idea", "灯泡提示", "趣味", [], {
    border: solid("#e0b43c"), borderRadiusPt: 6, backgroundColor: "#fffaeb", paddingPt: pad(18, 16, 11, 16), frame: frame("#8a6100"),
    css: `${LABEL} { border: .75pt solid #e0b43c; border-radius: 20pt; padding: 1pt 10pt 1pt 7pt; } ${icon(svg("<g fill='none' stroke='#8a6100' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M9 18h6M10 22h4'/><path d='M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z'/></g>"))}`
  }),

  preset("lively", "活力便签", "趣味", [], {
    border: solid("#f0a32a", 1.25, "dashed"), borderRadiusPt: 10, backgroundColor: "#fffbea", paddingPt: pad(21, 16, 15, 16), spaceBeforePt: 15, spaceAfterPt: 13,
    frame: frame("#f2762e", { labelStyle: "filled" }),
    css: `${BOX} { background-image: linear-gradient(135deg, rgb(242 118 46 / .055) 0%, rgb(242 118 46 / 0) 42%), radial-gradient(circle at 100% 100%, rgb(242 178 46 / .18) 0%, rgb(242 178 46 / 0) 40%); box-shadow: 1.5pt 1.5pt 0 rgb(240 163 42 / .22), inset 0 0 0 2.5pt #ffffff, inset 0 0 0 3.25pt rgb(240 163 42 / .18); } ${LABEL} { top: -.68em; left: 14pt; transform: rotate(-2.5deg); padding: 1.6pt 10pt 2pt; background: #f2762e; border: 1.25pt solid #ffffff; border-radius: 999pt; box-shadow: 1pt 1pt 0 rgb(214 98 20 / .26); } ${LABEL} * { color: #ffffff !important; font-size: 9pt !important; font-weight: 800 !important; letter-spacing: 1pt !important; line-height: 1.45 !important; } ${LABEL}::before { content: "✦"; display: inline-block; margin-right: 4.5pt; font-size: 8pt; vertical-align: .5pt; color: #ffe7a6; } ${LABEL}::after { content: "✦"; display: inline-block; margin-left: 4pt; font-size: 6pt; vertical-align: 3pt; color: #ffe7a6; } ${DECO}::before { content: ""; position: absolute; top: 0; right: 18pt; width: 34pt; height: 10pt; background: rgb(242 178 46 / .42); border-left: .5pt dashed rgb(240 163 42 / .45); border-right: .5pt dashed rgb(240 163 42 / .45); transform: rotate(5deg) translateY(-2pt); } ${DECO}::after { content: ""; position: absolute; right: 12pt; bottom: 6pt; width: 10pt; height: 10pt; border-radius: 50%; background: radial-gradient(circle, rgb(242 118 46 / .30) 0%, rgb(242 118 46 / .30) 34%, rgb(242 118 46 / 0) 66%); box-shadow: -9pt -3pt 0 -2.5pt rgb(242 178 46 / .30), 5pt -8pt 0 -3pt rgb(242 118 46 / .22); } ${BOX} p { color: #33261a; }`
  }),
  preset("sakura", "樱花", "趣味", [], {
    border: solid("#f3c4d0"), borderRadiusPt: 12, backgroundColor: "#fff6f8", paddingPt: pad(20, 16, 13, 16), spaceBeforePt: 16, frame: frame("#e0607e"),
    css: `${BOX} { background-image: radial-gradient(circle at 100% 0, rgb(224 96 126 / .10), rgb(224 96 126 / 0) 40%); ${innerEdge("224 96 126")} } ${pillLabel("#e0607e", { glyph: "❀", glyphColor: "#ffd6e0" })} ${DECO}::after { content: ""; position: absolute; right: 10pt; bottom: 6pt; width: 26pt; height: 26pt; opacity: .5; background: ${svg("<g fill='#f7c1cf' stroke='#e0607e' stroke-width='.8'><ellipse cx='12' cy='6' rx='3.2' ry='4.6'/><ellipse cx='12' cy='6' rx='3.2' ry='4.6' transform='rotate(72 12 12)'/><ellipse cx='12' cy='6' rx='3.2' ry='4.6' transform='rotate(144 12 12)'/><ellipse cx='12' cy='6' rx='3.2' ry='4.6' transform='rotate(216 12 12)'/><ellipse cx='12' cy='6' rx='3.2' ry='4.6' transform='rotate(288 12 12)'/></g><circle cx='12' cy='12' r='1.8' fill='#e0607e'/>")} center / contain no-repeat; } ${BOX} p { color: #3a2228; }`
  }),
  preset("dots", "糖果波点", "趣味", [], {
    border: solid("#8ec5ff"), borderRadiusPt: 10, backgroundColor: "#f7fbff", paddingPt: pad(21, 16, 13, 16), spaceBeforePt: 16, frame: frame("#3d8bfd"),
    css: `${BOX} { background-image: radial-gradient(circle, rgb(61 139 253 / .14) 1.3pt, rgb(61 139 253 / 0) 1.5pt); background-size: 10pt 10pt; ${innerEdge("61 139 253")} } ${pillLabel("#3d8bfd", { tilt: -2, glyph: "●", glyphColor: "#ffd166" })} ${BOX} p { color: #1b2a40; }`
  }),

  // 特别用途：投屏、传统文化单元或强调重点。
  preset("chalkboard", "黑板", "特别用途", ["费墨"], {
    border: solid("#8b5e34", 6), borderRadiusPt: 3, backgroundColor: "#24493a", paddingPt: pad(27, 16, 14, 16), frame: frame("#f6e27a"),
    css: `${BOX} { color: #f3f1e7; } ${insideLabel("8pt", "16pt", "font-size: 11pt; letter-spacing: .1em; color: #f6e27a;")} ${DECO}::after { content: ""; position: absolute; right: 18pt; bottom: -6pt; width: 34pt; height: 5pt; border-radius: 2pt; background: #f4f1e6; }`
  }),
  preset("classic", "古典", "特别用途", ["黑白清楚"], {
    border: solid("#7a1f1f"), paddingPt: pad(22, 22, 16, 22), frame: frame("#7a1f1f", { design: "double", labelPosition: "top-center" }),
    css: `${DECO} { opacity: 1; border-width: .5pt; background: ${meander("M1 17V1h16M5 13V5h8v4H9")} 2pt 2pt no-repeat, ${meander("M17 17V1H1M13 13V5H5v4h4")} calc(100% - 2pt) 2pt no-repeat, ${meander("M1 1v16h16M5 5v8h8V9H9")} 2pt calc(100% - 2pt) no-repeat, ${meander("M17 1v16H1M13 5v8H5V9h4")} calc(100% - 2pt) calc(100% - 2pt) no-repeat; } ${LABEL} { font-family: "Songti SC", "STSong", "SimSun", serif; font-size: 11pt; letter-spacing: .3em; padding-inline: 12pt; } ${LABEL}::before, ${LABEL}::after { content: "◆"; font-size: 6pt; vertical-align: 2pt; margin: 0 6pt; letter-spacing: 0; }`
  }),
  preset("seal", "印章", "特别用途", [], {
    border: solid("#111111"), paddingPt: pad(14, 52, 10, 14), frame: frame("#c81e1e"),
    css: `${BOX} { min-height: 72pt; } ${LABEL} { left: auto; right: 12pt; top: 10pt; transform: rotate(-6deg); width: 30pt; max-width: none; padding: 4pt 0; text-align: center; writing-mode: vertical-rl; letter-spacing: 3pt; color: #c81e1e; border: 1.5pt solid #c81e1e; border-radius: 3pt; background: var(--chalklee-page-background, #ffffff); font-family: "Songti SC", "STSong", "SimSun", serif; font-size: 11pt; }`
  }),
  preset("kraft", "牛皮纸", "特别用途", [], {
    borderRadiusPt: 3, backgroundColor: "#f4e6cc", paddingPt: pad(22, 18, 14, 18), spaceBeforePt: 18, frame: frame("#7a5230"),
    css: `${BOX} { box-shadow: 0 1pt 2pt rgb(90 60 20 / .18); background-image: repeating-linear-gradient(45deg, rgb(122 82 48 / .04) 0 2pt, rgb(122 82 48 / 0) 2pt 4pt); } ${DECO}::before { content: ""; position: absolute; top: 4pt; right: 4pt; bottom: 4pt; left: 4pt; border: .75pt dashed rgb(122 82 48 / .45); border-radius: 2pt; } ${LABEL} { top: -.6em; left: 16pt; transform: rotate(-3deg); padding: 1pt 10pt 1pt 7pt; background: #fffaf0; border: .75pt solid #7a5230; border-radius: 2pt 9pt 9pt 2pt; } ${LABEL} * { color: #5b3b1f !important; font-weight: 700 !important; } ${LABEL}::before { content: ""; display: inline-block; width: 3.5pt; height: 3.5pt; margin-right: 5pt; vertical-align: 1pt; border: .75pt solid #7a5230; border-radius: 50%; } ${BOX} p { color: #3b2a17; }`
  }),
  preset("airmail", "航空信", "特别用途", [], {
    paddingPt: pad(26, 18, 14, 18), frame: frame("#2f5fb3"),
    css: `${BOX} { border: 5pt solid transparent !important; border-radius: 3pt; background: linear-gradient(#ffffff, #ffffff) padding-box, repeating-linear-gradient(-45deg, #d43c3c 0 6pt, #ffffff 6pt 9pt, #2f5fb3 9pt 15pt, #ffffff 15pt 18pt) border-box !important; } ${insideLabel("8pt", "14pt")} ${LABEL} * { color: #2f5fb3 !important; font-weight: 700 !important; letter-spacing: 1pt !important; } ${LABEL}::before { content: "✉"; display: inline-block; margin-right: 4pt; color: #d43c3c; }`
  }),
  preset("ink", "墨韵", "特别用途", ["黑白清楚"], {
    paddingPt: pad(24, 18, 14, 18), frame: frame("#1a1a1a"),
    css: `${BOX} { border-top: .75pt solid #222222; border-bottom: .75pt solid #222222; background-image: radial-gradient(ellipse at 0% 0%, rgb(30 30 30 / .10), rgb(30 30 30 / 0) 55%), radial-gradient(ellipse at 100% 100%, rgb(30 30 30 / .06), rgb(30 30 30 / 0) 50%); } ${insideLabel("7pt", "18pt")} ${LABEL} * { color: #1a1a1a !important; font-family: "Kaiti SC", "STKaiti", "KaiTi", serif !important; font-size: 11pt !important; font-weight: 400 !important; letter-spacing: .3em !important; } ${LABEL}::after { content: ""; display: inline-block; width: 8pt; height: 8pt; margin-left: 5pt; vertical-align: -.5pt; border-radius: 1pt; background: #b8322a; }`
  })
];

export const chalkLeeBoxPresetStyleName = (id: string) => `box.preset-${id}`;
