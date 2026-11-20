import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { latexSubfiles } from "../workspace/latexSubfiles";
import { scanWorkspace } from "../workspace/files";
import { readLatexCompanions } from "./latexCompanions";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const temporary = async () => { const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "chalklee-latex-"))); roots.push(root); return root; };

describe("files a LaTeX original uses", () => {
  it("reads \\input files and pictures inside the workspace, following nested inputs and \\graphicspath", async () => {
    const outside = await temporary(), root = await temporary();
    await mkdir(path.join(root, "卷", "parts"), { recursive: true });
    await mkdir(path.join(root, "卷", "figures"));
    await mkdir(path.join(root, ".chalklee"));
    const main = "\\documentclass{article}\\graphicspath{{figures/}}\\begin{document}\\input{parts/q1}\\includegraphics{../../" + path.basename(outside) + "/secret}\\includegraphics{../.chalklee/x}\\end{document}";
    await writeFile(path.join(root, "卷", "main.tex"), main);
    await writeFile(path.join(root, "卷", "parts", "q1.tex"), "\\input{parts/q2}\\includegraphics[width=3cm]{tri}");
    await writeFile(path.join(root, "卷", "parts", "q2.tex"), "第二题");
    await writeFile(path.join(root, "卷", "figures", "tri.png"), "png");
    await writeFile(path.join(outside, "secret.png"), "outside");
    await writeFile(path.join(root, ".chalklee", "x.png"), "internal");
    const files = await readLatexCompanions(root, path.join(root, "卷", "main.tex"), new TextEncoder().encode(main));
    expect(Object.keys(files).sort()).toEqual(["figures/tri.png", "parts/q1.tex", "parts/q2.tex"]);
  });
});

describe("LaTeX sub-files in the tree", () => {
  it("lists a main file and hides the files it includes, while standalone fragments stay listed", async () => {
    const root = await temporary();
    await mkdir(path.join(root, "期中", "chapters"), { recursive: true });
    await writeFile(path.join(root, "期中", "main.tex"), "\\documentclass{ctexart}\\begin{document}\\include{chapters/ch1}\\input chapters/ch2.tex\\end{document}");
    await writeFile(path.join(root, "期中", "chapters", "ch1.tex"), "第一章");
    await writeFile(path.join(root, "期中", "chapters", "ch2.tex"), "第二章");
    await writeFile(path.join(root, "期中", "chapters", "extra.tex"), "单独一题");
    const snapshot = await scanWorkspace(root);
    const names: string[] = [];
    const visit = (nodes: typeof snapshot.root.children) => nodes.forEach(node => node.kind === "file" ? names.push(node.name) : visit(node.children));
    visit(snapshot.root.children);
    expect(names.sort()).toEqual(["extra.tex", "main.tex"]);
    expect(snapshot.fileCount).toBe(2);
    expect(await latexSubfiles([])).toEqual(new Set());
  });
});
