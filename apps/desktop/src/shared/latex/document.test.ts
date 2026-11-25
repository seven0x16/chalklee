import { describe, expect, it } from "vitest";
import type { WordBlock, WordDocument, WordParagraph } from "@chalklee/word";
import { importAppearance, importText } from "../conversion/importDocument";
import { prepareStructuredImport } from "../conversion/prepareWord";
import { latexListLabel, parseLatexDocument } from "./document";
import { findLatexFile, latexGraphicCandidates } from "./source";

const encode = (text: string) => new TextEncoder().encode(text);
const signal = () => new AbortController().signal;
const parse = (text: string, files: Record<string, Uint8Array> = {}) => parseLatexDocument({ main: encode(text), files }, signal());
const paragraphs = (model: WordDocument) => model.sections[0].blocks.filter((block): block is WordParagraph => block.kind === "paragraph");
const plain = (block: WordBlock): string => block.kind === "table" ? block.rows.map(row => row.map(cell => cell.blocks.map(plain).join("/")).join("|")).join("\n")
  : (block.marker ? block.marker + " " : "") + block.inlines.map(inline => inline.kind === "text" ? inline.text : inline.kind === "math" ? `$${inline.latex}$` : inline.kind === "image" ? `[img:${inline.alt}]` : "").join("");
const lines = (model: WordDocument) => model.sections[0].blocks.map(plain);
const png = (width: number, height: number) => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width); new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
};

describe("LaTeX originals", () => {
  it("reads an exam-zh paper as printed: numbered questions, choices, answers, solutions and headings", () => {
    const model = parse(String.raw`\documentclass{exam-zh}
\usepackage{amsmath}
\title{2024 年高一数学期中考试}
\subject{数学}
\begin{document}
\maketitle
\section{单项选择题：本题共 2 小题}
\begin{question}
  已知集合 $A=\{1,2\}$，则 $A\cap B=$ \paren[B]
  \begin{choices}
    \item $\varnothing$
    \item $\{1\}$
    \item $\{2\}$
    \item $\{1,2\}$
  \end{choices}
\end{question}
\begin{question}
  函数 $f(x)=\dfrac{1}{x}$ 的定义域是\fillin[$x\neq 0$]。
  \begin{solution}
    分母不为零。
  \end{solution}
\end{question}
\section{解答题}
\begin{problem}[points=12]
  已知数列满足条件。
  \begin{enumerate}
    \item 求通项；
    \item 求和。
  \end{enumerate}
\end{problem}
\end{document}`);
    expect(lines(model)).toEqual([
      "2024 年高一数学期中考试", "数学",
      "一、单项选择题：本题共 2 小题",
      "1．已知集合 $A=\\{1,2\\}$，则 $A\\cap B=$ （\u3000\u3000）",
      "A．$\\varnothing$", "B．$\\{1\\}$", "C．$\\{2\\}$", "D．$\\{1,2\\}$",
      "【答案】B",
      "2．函数 $f(x)=\\dfrac{1}{x}$ 的定义域是        。",
      "【答案】$x\\neq 0$",
      "【解析】分母不为零。",
      "二、解答题",
      "3．（12 分）已知数列满足条件。",
      "(1) 求通项；", "(2) 求和。"
    ]);
    expect(paragraphs(model)[0]).toMatchObject({ heading: 1, style: { align: "center" } });
    expect(paragraphs(model)[2]).toMatchObject({ heading: 2 });
    expect(model.warnings).toEqual([]);
  });

  it("reads the exam class: questions, parts, \\CorrectChoice and solutions", () => {
    const model = parse(String.raw`\documentclass{exam}
\begin{document}
\begin{questions}
\question[5] Which is prime?
\begin{choices}
\choice 4
\CorrectChoice 5
\choice 6
\end{choices}
\question Answer both.
\begin{parts}
\part First part.
\part Second part.
\end{parts}
\begin{solution}
Because.
\end{solution}
\end{questions}
\end{document}`);
    expect(lines(model)).toEqual(["1．（5 分）Which is prime?", "A．4", "B．5", "C．6", "【答案】B", "2．Answer both.", "(a) First part.", "(b) Second part.", "【解析】Because."]);
  });

  it("expands the teacher's own commands and environments, including optional defaults", () => {
    const model = parse(String.raw`\documentclass{ctexart}
\newcommand{\R}{\mathbb{R}}
\newcommand\vect[1]{\overrightarrow{#1}}
\newcommand{\pt}[2][A]{#1(#2)}
\def\abs#1{\left|#1\right|}
\DeclareMathOperator{\lcm}{lcm}
\newenvironment{jie}{\textbf{解：}}{}
\begin{document}
设 $x\in\R$，$\vect{AB}$，$\pt{1,2}$ 与 $\pt[B]{3}$，$\abs{x}$，$\lcm(a,b)$。

\begin{jie}因为\end{jie}
\end{document}`);
    expect(lines(model)).toEqual([
      "设 $x\\in\\mathbb{R}$，$\\overrightarrow{AB}$，$A(1,2)$ 与 $B(3)$，$\\left|x\\right|$，$\\operatorname{lcm}(a,b)$。",
      "解：因为"
    ]);
    expect(paragraphs(model)[1].inlines[0]).toMatchObject({ text: "解：", style: { bold: true } });
  });

  it("keeps control words apart from the letters a replacement brings", () => {
    const model = parse(String.raw`\newcommand{\n}{n}\newcommand{\al}{\alpha}
$\cdot\n$ and $\al b$`);
    expect(lines(model)).toEqual(["$\\cdot n$ and $\\alpha b$"]);
  });

  it("drops comments with their line ends, and removes spaces only between Chinese characters", () => {
    const model = parse("已知函数%注释\n  在区间上单调，\n求 a 的取值范围。\\% 不是注释\n\n第二段 English words.");
    expect(lines(model)).toEqual(["已知函数在区间上单调，求 a 的取值范围。% 不是注释", "第二段 English words."]);
  });

  it("reads GB18030 files", () => {
    const gbk = new Uint8Array([0xd2, 0xd1, 0xd6, 0xaa, 0x24, 0x78, 0x24]); // 已知$x$
    const model = parseLatexDocument({ main: gbk }, signal());
    expect(lines(model)).toEqual(["已知$x$"]);
  });

  it("converts tables with merged cells and rules removed", () => {
    const model = parse(String.raw`\begin{tabular}{|c|c|c|}
\hline
\multicolumn{2}{|c|}{甲乙} & 丙 \\ \hline
\multirow{2}{*}{合并} & $x$ & 1 \\
 & $y$ & 2 \\ \hline
\end{tabular}`);
    const table = model.sections[0].blocks[0];
    expect(table.kind).toBe("table");
    if (table.kind !== "table") return;
    expect(table.rows.map(row => row.map(cell => ({ span: cell.span, merge: cell.merge, text: cell.blocks.map(plain).join("") })))).toEqual([
      [{ span: 2, merge: undefined, text: "甲乙" }, { span: 1, merge: undefined, text: "丙" }],
      [{ span: 1, merge: "start", text: "合并" }, { span: 1, merge: undefined, text: "$x$" }, { span: 1, merge: undefined, text: "1" }],
      [{ span: 1, merge: "continue", text: "" }, { span: 1, merge: undefined, text: "$y$" }, { span: 1, merge: undefined, text: "2" }]
    ]);
  });

  it("reads \\input files and pictures relative to the main file, with \\graphicspath and missing extensions", () => {
    const model = parse(String.raw`\documentclass{article}
\graphicspath{{figures/}}
\begin{document}
\input{parts/q1}
\begin{figure}[h]
\centering
\includegraphics[width=0.5\textwidth]{triangle}
\caption{三角形}
\end{figure}
\includegraphics{missing}
\includegraphics{old.eps}
\end{document}`, {
      "parts/q1.tex": encode("第一题 \\includegraphics[scale=0.5]{figures/a.png}"),
      "figures/triangle.png": png(400, 200),
      "figures/a.png": png(300, 150),
      "old.eps": encode("%!PS")
    });
    expect(lines(model)).toEqual(["第一题 [img:figures/a.png]", "[img:triangle]", "三角形", "[待补图：missing] [待补图：old.eps]"]);
    const images = paragraphs(model).flatMap(p => p.inlines).filter(inline => inline.kind === "image");
    expect(images[0]).toMatchObject({ width: 200 });
    expect(images[1]).toMatchObject({ width: (793.7 - 192) / 2, height: (793.7 - 192) / 4 });
    expect(paragraphs(model)[1].style.align).toBe("center");
    expect(model.assets.map(asset => asset.mime)).toEqual(["image/png", "image/png"]);
    expect(model.warnings.join("")).toContain("EPS");
    expect(model.warnings.join("")).toContain("没有找到");
  });

  it("leaves TikZ drawings as placeholders with their code, and keeps display math and environments", () => {
    const model = parse(String.raw`如图所示，
\begin{center}
\begin{tikzpicture}
\draw (0,0) -- (1,1);
\end{tikzpicture}
\end{center}
则
\begin{align*}
a &= b \\
c &= d \label{eq}
\end{align*}
\begin{equation}
E=mc^2 \tag{1}
\end{equation}
质量为 \SI{2.5}{\kilo\gram}，速度 \si{\metre\per\second}。`);
    expect(lines(model)).toEqual([
      "如图所示，", "[待补图：TikZ 绘图]", "\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}", "则",
      "$\\begin{aligned}a &= b \\\\ c &= d\\end{aligned}$", "$E=mc^2$",
      "质量为 $2.5\\,\\mathrm{kg}$，速度 $\\mathrm{m}/\\mathrm{s}$。"
    ]);
    expect(model.warnings.join("")).toContain("TikZ");
  });

  it("numbers enumerate items with enumitem, enumerate-package and \\labelenumi labels, and resumes", () => {
    expect(latexListLabel("(\\arabic*)", 3)).toBe("(3)");
    expect(latexListLabel("\\Alph*.", 2)).toBe("B.");
    expect(latexListLabel("(i)", 4)).toBe("(iv)");
    expect(latexListLabel("{Q}1", 2)).toBe("Q2");
    const model = parse(String.raw`\renewcommand{\labelenumi}{(\arabic{enumi})}
\begin{document}
\begin{enumerate}\item 一\item 二\end{enumerate}
\begin{enumerate}[resume]\item 三\end{enumerate}
\begin{enumerate}[label=\Alph*.]\item 甲\end{enumerate}
\begin{itemize}\item[★] 特别\item 普通\end{itemize}
\end{document}`);
    expect(lines(model)).toEqual(["(1) 一", "(2) 二", "(3) 三", "A. 甲", "★ 特别", "• 普通"]);
  });

  it("prepares content references the conversion uses: answers, analyses, blanks and question numbers", async () => {
    const model = parse(String.raw`\documentclass{exam-zh}
\begin{document}
\begin{question}
函数的零点个数为\fillin[2]。
\begin{solution}画图可知。\end{solution}
\end{question}
\end{document}`);
    const result = await prepareStructuredImport({ sourcePath: "/w/paper.tex", sourceHash: "h", page: importAppearance().page, units: [], warnings: [] }, model, signal(), async () => null);
    const blocks = result.units.flatMap(unit => unit.blocks);
    const roles = Object.assign({}, ...result.units.map(unit => unit.sourceRoles));
    expect(blocks.map(block => importText(block))).toEqual(["1．函数的零点个数为  。", "【答案】2", "【解析】画图可知。"]);
    expect(JSON.stringify(blocks[0])).toContain('"type":"blank"');
    expect(blocks.map(block => roles[block.attrs.id])).toEqual(["body", "answer", "analysis"]);
  });
});

it("finds a picture whose name has a dot in it, and takes another type of the same name before EPS", () => {
  const png = new Uint8Array([1]);
  expect(findLatexFile({ "figs/图1.1.png": png }, latexGraphicCandidates("图1.1", ["figs/"]))).toBe("figs/图1.1.png");
  expect(findLatexFile({ "graph.eps": png, "graph.svg": png }, latexGraphicCandidates("graph", []))).toBe("graph.svg");
  expect(findLatexFile({ "plot.png": png }, latexGraphicCandidates("plot.png", []))).toBe("plot.png");
  // A name that happens to be an object property is not a file.
  expect(findLatexFile({}, ["constructor", "toString"])).toBeUndefined();
});
