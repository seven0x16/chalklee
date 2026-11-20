import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { alignTabs, drawingPosition, layoutWord, renderWordBlocks, resolvePageFields, safePageCut, tabSpacing } from "./layout";
import { defaultPage, paragraph, type WordBlock, type WordSection } from "./model";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("independent Word layout", () => {
  it("paints highlights behind runs without filling the whole paragraph, and keeps shading when highlighting is cleared", () => {
    const { document } = parseHTML("<html><body></body></html>"); vi.stubGlobal("document", document);
    const p = paragraph("highlights"); p.textStyle = { highlight: "#ffff00" }; p.markStyle = { highlight: "#00ffff" };
    p.inlines = [{ kind: "text", text: "重点", style: {} }, { kind: "text", text: "底纹", style: { background: "#123456", highlight: "none" } }, { kind: "text", text: "普通", style: { highlight: "none" } }];
    const before = JSON.stringify(p), host = document.createElement("div"); host.append(renderWordBlocks([p], [], 900));
    const rendered = host.querySelector<HTMLElement>("p")!, runs = [...rendered.querySelectorAll<HTMLElement>("span")];
    expect(rendered.style.backgroundColor).toBeUndefined();
    expect(runs.map(r => r.style.backgroundColor)).toEqual(["#ffff00", "#123456", undefined]);
    expect(rendered.textContent).toBe("重点底纹普通"); expect(JSON.stringify(p)).toBe(before);
  });

  it("positions grouped children against the parent frame and keeps textbox decoration behind its text", async () => {
    const { document } = parseHTML("<html><body></body></html>"); vi.stubGlobal("document", document);
    vi.stubGlobal("NodeFilter", { SHOW_TEXT: 4 }); Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() } });
    const create = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = create(tag);
      el.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 20, right: 180, height: 20, width: 180 } as DOMRect);
      return el;
    }) as typeof document.createElement);
    vi.spyOn(document, "createTreeWalker").mockReturnValue({ nextNode: () => null } as unknown as TreeWalker);
    const body = paragraph("body"), label = paragraph("label"); label.inlines = [{ kind: "text", text: "姓名：", style: {} }];
    body.inlines = [{ kind: "text", text: "原正文", style: {} }];
    body.drawings = [{ x: { relative: "page", offset: 0, align: "center" }, y: { relative: "page", offset: 0, align: "bottom" },
      width: 40, height: 20, group: { width: 100, height: 60, left: 30, top: 10 }, order: 7, behind: false,
      content: { kind: "textbox", blocks: [label], decoration: 0, inset: { top: 0, right: 0, bottom: 0, left: 0 }, vertical: "center" } },
      { x: { relative: "margin", offset: 0, align: "center" }, y: { relative: "page", offset: 170 }, width: 192, height: 192, order: 8, behind: false,
        content: { kind: "textbox", blocks: [label], fitToText: true, inset: { top: 0, right: 0, bottom: 0, left: 0 }, vertical: "top" } }];
    const model = { format: "docx" as const, assets: [], warnings: [], sections: [{ page: { width: 200, height: 200, top: 20, bottom: 20, left: 10, right: 10 }, header: [], footer: [], blocks: [body] }] };
    const before = JSON.stringify(model), result = await layoutWord(model, create("div"), ["blob:decoration"], new AbortController().signal);
    const page = create("div"); page.innerHTML = result.pages[0]!.drawings!;
    const drawing = page.querySelector<HTMLElement>(".chalk-word-drawing")!, box = drawing.querySelector<HTMLElement>(".chalk-word-textbox")!;
    expect(parseFloat(drawing.style.left)).toBe(80); expect(parseFloat(drawing.style.top)).toBe(150);
    expect(box.textContent).toBe("姓名："); expect(box.style.backgroundImage).toContain("blob:decoration");
    const intrinsic = page.querySelectorAll<HTMLElement>(".chalk-word-drawing")[1]!;
    // The auto-sized footer uses the margin area's midpoint as its reference;
    // its text remains ordinary paragraph content, with no inserted padding tabs.
    expect(parseFloat(intrinsic.style.left)).toBe(100); expect(parseFloat(intrinsic.style.top)).toBe(170);
    expect(intrinsic.textContent).toBe("姓名：");
    expect(result.pages[0]!.html).toContain("原正文"); expect(JSON.stringify(model)).toBe(before);
  });

  it("renders DOC list markers with independent formatting and their recorded tab, space or no separator", () => {
    const { document } = parseHTML("<html><body></body></html>"); vi.stubGlobal("document", document);
    const blocks = (["tab", "space", "nothing"] as const).map((follow, i) => {
      const p = paragraph(`list-${i}`); p.marker = `${i + 1}.`; p.markerFollow = follow; p.markerStyle = { bold: true };
      p.style.tabStops = [{ position: 20.8, align: "left" }]; p.inlines = [{ kind: "text", text: "列表正文", style: {} }]; return p;
    });
    const host = document.createElement("div"); host.append(renderWordBlocks(blocks, [], 900));
    const ps = Array.from(host.querySelectorAll<HTMLElement>("p"));
    expect(ps.map(p => p.textContent)).toEqual(["1.列表正文", "2.\u00a0列表正文", "3.列表正文"]);
    expect(ps.map(p => p.querySelectorAll("[data-word-tab]").length)).toEqual([1, 0, 0]);
    expect(ps[0]!.querySelector<HTMLElement>(".chalk-word-marker")!.style.fontWeight).toBe("bold");
    expect((ps[0]!.lastElementChild as HTMLElement).style.fontWeight).not.toBe("bold");
    ps[0]!.getBoundingClientRect = () => ({ left: 100 } as DOMRect);
    ps[0]!.querySelector<HTMLElement>("[data-word-tab]")!.getBoundingClientRect = () => ({ left: 112 } as DOMRect);
    alignTabs(host);
    expect(12 + parseFloat(ps[0]!.querySelector<HTMLElement>("[data-word-tab]")!.style.width)).toBeCloseTo(20.8);
  });
  it("renders missing pictures as sized, inert image boxes without changing surrounding text or drawing anchors", () => {
    const { document } = parseHTML("<html><body></body></html>"); vi.stubGlobal("document", document);
    const p = paragraph("pictures");
    p.inlines = [{ kind: "text", text: "前", style: {} }, { kind: "image-placeholder", width: 96, height: 48, alt: '<img onerror="alert(1)">' }, { kind: "text", text: "后", style: {} }];
    p.drawings = [{ x: { relative: "margin", offset: 10 }, y: { relative: "paragraph", offset: 20 }, width: 50, height: 30, behind: false, order: 0, content: { kind: "image-placeholder", alt: "锚定图片" } }];
    const before = JSON.stringify(p), host = document.createElement("div"); host.append(renderWordBlocks([p], [], 900));
    const inline = host.querySelector<HTMLElement>("p > .chalk-word-image-placeholder")!;
    expect(inline.style.width).toBe("96px"); expect(inline.style.height).toBe("48px");
    expect(inline.getAttribute("role")).toBe("img"); expect(inline.getAttribute("aria-label")).toBe('<img onerror="alert(1)">未显示');
    expect(host.querySelector("img")).toBeNull();
    expect(inline.previousSibling?.textContent).toBe("前"); expect(inline.nextSibling?.textContent).toBe("后");
    expect(host.querySelector(".chalk-word-drawing > .chalk-word-image-placeholder")).not.toBeNull();
    expect(JSON.stringify(p)).toBe(before);
  });
  it("chooses first/even/default headers per page and applies section numbering after final pagination", async () => {
    const { document } = parseHTML("<html><body></body></html>"); vi.stubGlobal("document", document);
    vi.stubGlobal("NodeFilter", { SHOW_TEXT: 4 }); Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() } });
    const create = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = create(tag);
      el.getBoundingClientRect = () => {
        const heights: Record<string, number> = { first: 60, even: 20, odd: 10, footer: 30, body: 500, second: 20 };
        const height = heights[el.dataset.wordBlock!] ?? Array.from(el.children).reduce((sum, c) => sum + c.getBoundingClientRect().height, 0);
        return { top: 0, bottom: height, height, left: 0, width: 180, right: 180 } as DOMRect;
      }; return el;
    }) as typeof document.createElement);
    vi.spyOn(document, "createTreeWalker").mockReturnValue({ nextNode: () => null } as unknown as TreeWalker);
    const part = (id: string, label: string): WordBlock[] => {
      const p = paragraph(id); p.inlines = [{ kind: "text", text: label, style: {} }, { kind: "page-number" }, { kind: "text", text: "/", style: {} }, { kind: "section-page-count" }]; return [p];
    };
    const page = { width: 200, height: 200, left: 10, right: 10, top: 40, bottom: 20, header: 10, footer: 10 };
    const footer = part("footer", "静态123 ");
    const first: WordSection = { page, header: part("odd", "奇数"), firstHeader: part("first", "首页"), evenHeader: part("even", "偶数"), footer, firstFooter: footer, evenFooter: footer,
      blocks: part("body", "完整内容"), titlePage: true, evenAndOddHeaders: true, pageNumberStart: 3, pageNumberFormat: "lowerRoman" };
    const second: WordSection = { page, header: part("odd", "新节"), footer: [], blocks: part("second", "末尾"), pageNumberStart: 1, pageNumberFormat: "upperLetter" };
    const result = await layoutWord({ format: "docx", sections: [first, second], assets: [], warnings: [] }, create("div"), [], new AbortController().signal);
    const text = (html: string) => { const el = create("div"); el.innerHTML = html; return el.textContent; };
    // First page reserves 60px header + 30px footer; later pages reserve less.
    expect(result.pages.map(p => p.number)).toEqual([3, 4, 5, 6, 7, 1]);
    expect(result.pages.map(p => text(p.header))).toEqual(["首页iii/5", "偶数iv/5", "奇数v/5", "偶数vi/5", "奇数vii/5", "新节A/1"]);
    expect(result.pages[0]!.bodyTop).toBe(70);
    expect(result.pages[1]!.bodyTop).toBe(40);
    expect(text(result.pages[0]!.footer)).toBe("静态123 iii/5");
    expect(text(result.pages.at(-1)!.html)).toContain("末尾A/1");
  });

  it.each([
    { logoHeight: 30, footerHeight: 0, bodyTop: 86, pageCount: 3, fixed: false },
    { logoHeight: 2, footerHeight: 0, bodyTop: 60, pageCount: 2, fixed: false },
    { logoHeight: 2, footerHeight: 30, bodyTop: 60, pageCount: 3, fixed: false },
    { logoHeight: 30, footerHeight: 30, bodyTop: 60, pageCount: 2, fixed: true }
  ])("reserves measured header/footer content for pagination ($logoHeight px logo, $footerHeight px footer, fixed $fixed)", async ({ logoHeight, footerHeight, bodyTop, pageCount, fixed }) => {
    const { document } = parseHTML("<html><body></body></html>"); vi.stubGlobal("document", document);
    vi.stubGlobal("NodeFilter", { SHOW_TEXT: 4 });
    Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() } });
    // Supply measured geometry; LinkeDOM itself has no font/image layout engine.
    const create = document.createElement.bind(document);
    const withGeometry = ((tag: string) => {
      const el = create(tag);
      if (tag === "img") Object.defineProperty(el, "decode", { value: async () => {} });
      el.getBoundingClientRect = () => {
        const height = el.dataset.wordBlock === "body" ? 210 : el.dataset.wordBlock === "footer" ? footerHeight : el.dataset.wordBlock === "section-mark" ? 308 : tag === "img" ? parseFloat(el.style.height) : Array.from(el.children).reduce((sum, c) => sum + c.getBoundingClientRect().height, 0);
        return { top: 0, bottom: height, height, left: 0, right: 180, width: 180, x: 0, y: 0, toJSON() {} };
      };
      return el;
    }) as typeof document.createElement;
    vi.spyOn(document, "createElement").mockImplementation(withGeometry);
    vi.spyOn(document, "createTreeWalker").mockReturnValue({ nextNode: () => null } as unknown as TreeWalker);
    const header = paragraph("header"); header.inlines.push({ kind: "image", asset: 0, alt: "页眉标志", width: 76, height: logoHeight });
    const footer = paragraph("footer"); footer.inlines.push({ kind: "text", text: "第 ", style: {} }, { kind: "page-number" }, { kind: "text", text: " 页", style: {} });
    const body = paragraph("body"); body.inlines.push({ kind: "text", text: "完整正文", style: {} });
    const ending = paragraph("section-mark"); ending.sectionBreakAfter = true; ending.style.linePixels = 308;
    const page = Object.freeze({ width: 200, height: 200, left: 10, right: 10, top: 60, bottom: 10, header: 56, footer: 8, fixedTop: fixed, fixedBottom: fixed });
    const result = await layoutWord({ format: "docx", sections: [{ page, header: [header], footer: footerHeight ? [footer] : [], blocks: [body, ending] }], assets: [], warnings: [] }, create("div"), ["blob:logo"], new AbortController().signal);
    expect(result.pages).toHaveLength(pageCount);
    expect(result.pages.every(p => p.bodyTop === bodyTop && p.contentHeight <= page.height - bodyTop - (fixed ? page.bottom : Math.max(page.bottom, footerHeight ? page.footer + footerHeight : 0)))).toBe(true);
    if (footerHeight) {
      result.pages.forEach((p, i) => {
        const content = create("div"); content.innerHTML = p.footer;
        expect(content.textContent).toBe(`第 ${i + 1} 页`);
      });
    }
    expect(result.pages[0]!.header).toContain("页眉标志");
    expect(result.pages[0]!.html).toContain("完整正文");
    expect(page.top).toBe(60);
  });

  it("aligns TOC page numbers of different lengths at the same right edge across formatting runs", () => {
    const { document } = parseHTML("<html><body></body></html>"); vi.stubGlobal("document", document);
    const host = document.createElement("div");
    host.append(renderWordBlocks(["3", "14", "257"].map((number, i) => {
      const p = paragraph(`toc-${i}`); p.style.tabStops = [{ position: 590, align: "right", leader: "dot" }];
      p.inlines = [{ kind: "text", text: "专题标题\t", style: {} }, ...[...number].map(text => ({ kind: "text" as const, text, style: {} }))];
      return p;
    }), [], 900));
    for (const p of host.querySelectorAll<HTMLElement>("p")) {
      p.getBoundingClientRect = () => ({ left: 100 } as DOMRect);
      const tab = p.querySelector<HTMLElement>("[data-word-tab]")!;
      tab.getBoundingClientRect = () => ({ left: 300 } as DOMRect);
    }
    let tab: HTMLElement;
    Object.defineProperty(document, "createRange", { value: () => ({
      setStartAfter(node: HTMLElement) { tab = node; }, setEnd() {},
      getClientRects() { return Array.from(tab.closest("p")!.children).slice(1).map((_, i) => ({ left: 300 + i * 7, right: 307 + i * 7, top: 0, height: 14 })); }
    }) });
    alignTabs(host);
    const tabs = Array.from(host.querySelectorAll<HTMLElement>("[data-word-tab]"));
    expect(tabs.map((tab, i) => 200 + parseFloat(tab.style.width) + (i + 1) * 7)).toEqual([590, 590, 590]);
    expect(tabs.every(tab => tab.dataset.wordLeader === "dot")).toBe(true);
    expect(tabSpacing(200, { position: 590, align: "center" }, 28)).toBe(376);
    expect(tabSpacing(200, { position: 590, align: "left" }, 28)).toBe(390);
  });

  it("places cover artwork at the paper edge and centers footer textboxes within margins", () => {
    const page = { ...defaultPage(), width: 794, height: 1122, left: 120, right: 120 };
    expect(drawingPosition({ relative: "column", offset: -120 }, 794, page, false, 120)).toBe(0);
    expect(drawingPosition({ relative: "paragraph", offset: -96 }, 1122, page, true, 96)).toBe(0);
    expect(drawingPosition({ relative: "page", offset: 2 }, 40, page, true, 500)).toBe(2);
    expect(drawingPosition({ relative: "margin", offset: 0, align: "center" }, 192, page, false, 120)).toBe(301);
  });
  it("updates current and total page fields in the body and footer after pagination", () => {
    const { document } = parseHTML("<html><body></body></html>"); vi.stubGlobal("document", document);
    const footer = '<span data-word-page-number>8</span> / <span data-word-page-count>999</span>';
    const pages = [1, 2, 3].map(() => ({ page: defaultPage(), html: footer, header: "", footer, drawings: footer, contentHeight: 700 }));
    resolvePageFields(pages);
    pages.forEach((page, i) => {
      const body = document.createElement("div"); body.innerHTML = page.html;
      expect(body.textContent).toBe(`${i + 1} / 3`);
      body.innerHTML = page.footer;
      expect(body.textContent).toBe(`${i + 1} / 3`);
      body.innerHTML = page.drawings;
      expect(body.textContent).toBe(`${i + 1} / 3`);
    });
  });
  it("keeps text inert and preserves merged table cells in rendered output", () => {
    const { document } = parseHTML("<html><body></body></html>"); vi.stubGlobal("document", document);
    const p = paragraph("one"); p.inlines.push({ kind: "text", text: '<img src="https://example.com/" onerror="alert(1)">', style: {} });
    const host = document.createElement("div");
    host.append(renderWordBlocks([{ kind: "table", id: "table", widths: [], headerRows: 0, rows: [
      [{ blocks: [p], span: 2, merge: "start" }], [{ blocks: [], span: 2, merge: "continue" }]
    ] }], [], 900));
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toBe(p.inlines[0]!.kind === "text" ? p.inlines[0]!.text : "");
    expect(host.querySelector("td")?.colSpan).toBe(2);
    expect(host.querySelector("td")?.rowSpan).toBe(2);
    expect(host.querySelectorAll("td")).toHaveLength(1);
  });
  it("keeps a normal line intact at a page boundary and makes progress for oversized content", () => {
    expect(safePageCut(0, 900, [{ top: 890, bottom: 910 }])).toBe(890);
    expect(safePageCut(0, 900, [{ top: 0, bottom: 1200 }])).toBe(900);
    expect(safePageCut(900, 1800, [{ top: 1780, bottom: 1810 }, { top: 1760, bottom: 1790 }])).toBe(1760);
  });
});
