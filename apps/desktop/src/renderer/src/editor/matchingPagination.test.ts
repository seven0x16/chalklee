import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { alignChalkLeePageGaps, keepChalkLeeFrameOpeningsTogether, paginateChalkLeeFlow, syncChalkLeeMatchingPaginationLayout } from "./pagination";

function matchingLayout(scale = 1) {
  const { document } = parseHTML(`<main><section class="chalklee-question-object group" data-question-kind="matching">
    <p>Match each question to an option.</p><span class="chalklee-page-gap"></span>
  </section></main>`);
  const content = document.querySelector("main")! as unknown as HTMLElement;
  const group = content.querySelector<HTMLElement>("section")!;
  const geometry = { grid: 1055, linear: 960, gap: 180 };
  group.getBoundingClientRect = () => {
    const measuring = group.classList.contains("chalklee-matching-measuring");
    const height = measuring ? geometry.grid
      : (group.dataset.paginationOverflow === "true" ? geometry.linear : geometry.grid) + geometry.gap;
    return { height: height * scale } as DOMRect;
  };
  return { content, group, geometry };
}

describe("matching pagination layout", () => {
  it("moves a frame and its instructions with the first question without moving reordered shared options", () => {
    const flow = [{ pos: 1, top: 0, bottom: 80 }, { pos: 21, top: 80, bottom: 90 },
      { pos: 201, top: 95, bottom: 115 }, { pos: 231, top: 115, bottom: 135 }, { pos: 51, top: 140, bottom: 160 }];
    const result = keepChalkLeeFrameOpeningsTogether(flow, [{ pos: 20, top: 80, bottom: 115 }], 100).sort((a, b) => a.top - b.top);
    expect(paginateChalkLeeFlow(result, 100)).toMatchObject([{ pos: 20, startPx: 80 }]);
    expect(result).toContainEqual(flow[3]);
    expect(result).toContainEqual(flow[4]);
    expect(flow).toHaveLength(5);
    expect(keepChalkLeeFrameOpeningsTogether(flow, [{ pos: 20, top: 80, bottom: 160 }], 100)).toEqual(flow);
  });
  it("aligns reordered matching content and the following pages in one pass", () => {
    const { document } = parseHTML(`<main>
      <span class="chalklee-page-gap" data-page="3"></span>
      <span class="chalklee-page-gap" data-page="2"></span>
      <span class="chalklee-page-gap" data-page="4"></span>
    </main>`);
    const content = document.querySelector("main")! as unknown as HTMLElement;
    const gaps = Array.from(content.querySelectorAll<HTMLElement>(".chalklee-page-gap"))
      .sort((a, b) => Number(a.dataset.page) - Number(b.dataset.page));
    const contentStarts = [850, 1700, 2550];
    gaps.forEach((gap, index) => {
      gap.style.height = "160px";
      gap.style.setProperty("--chalklee-gap-fill", "8px");
      gap.style.setProperty("--chalklee-gap-mb", "60px");
      gap.style.setProperty("--chalklee-gap-mt", "60px");
      gap.style.setProperty("--chalklee-gap-band", "32px");
      gap.getBoundingClientRect = () => ({
        top: 60 + contentStarts[index] + gaps.slice(0, index).reduce((sum, previous) => sum + parseFloat(previous.style.height), 0),
        height: parseFloat(gap.style.height)
      }) as DOMRect;
    });
    const paper = { getBoundingClientRect: () => ({ top: 0 }) } as HTMLElement;

    alignChalkLeePageGaps(paper, content, 1120, 1);

    gaps.forEach((gap, index) => {
      const rect = gap.getBoundingClientRect();
      expect(rect.top + rect.height).toBe((index + 1) * 1152 + 60);
    });
    const heights = gaps.map(gap => gap.style.height);
    alignChalkLeePageGaps(paper, content, 1120, 1);
    expect(gaps.map(gap => gap.style.height)).toEqual(heights);
  });

  it("counts a block's top margin in its page spacer instead of on the next sheet", () => {
    const { document } = parseHTML('<main><span class="chalklee-page-gap" data-page="2"></span><section>解析</section></main>');
    const content = document.querySelector("main")! as unknown as HTMLElement;
    const gap = content.querySelector<HTMLElement>(".chalklee-page-gap")!;
    gap.style.height = "262px";
    for (const [name, value] of Object.entries({ fill: 110, mb: 60, mt: 60, band: 32 })) {
      gap.style.setProperty(`--chalklee-gap-${name}`, `${value}px`);
    }
    gap.getBoundingClientRect = () => ({ top: 950, bottom: 950 + parseFloat(gap.style.height) }) as DOMRect;
    const solution = content.querySelector("section")!;
    solution.getBoundingClientRect = () => ({ top: gap.getBoundingClientRect().bottom + 10, height: 90 }) as DOMRect;
    const paper = { getBoundingClientRect: () => ({ top: 0 }) } as HTMLElement;

    alignChalkLeePageGaps(paper, content, 1120, 1);
    expect(solution.getBoundingClientRect().top).toBe(1120 + 32 + 60);
    alignChalkLeePageGaps(paper, content, 1120, 1);
    expect(solution.getBoundingClientRect().top).toBe(1120 + 32 + 60);
  });

  it.each([.66, 1, 1.5])("lets a long grid continue from the current page at scale %s", scale => {
    const { content, group, geometry } = matchingLayout(scale);
    geometry.grid = 660;
    geometry.linear = 560;
    for (let pass = 0; pass < 8; pass++) {
      syncChalkLeeMatchingPaginationLayout(content, scale, 1000);
      expect(group.dataset.paginationOverflow).toBe("true");
    }
    expect(group.classList.contains("chalklee-matching-measuring")).toBe(false);
  });

  it("returns to a grid after content shrinks, without counting old page spacers", () => {
    const { content, group, geometry } = matchingLayout();
    syncChalkLeeMatchingPaginationLayout(content, 1, 1000);
    expect(group.dataset.paginationOverflow).toBe("true");

    geometry.grid = 450;
    for (let pass = 0; pass < 3; pass++) {
      syncChalkLeeMatchingPaginationLayout(content, 1, 1000);
      expect(group.dataset.paginationOverflow).toBeUndefined();
    }
    expect(group.querySelector("p")?.textContent).toBe("Match each question to an option.");
    expect(group.querySelectorAll(".chalklee-page-gap")).toHaveLength(1);
  });

  it("keeps a short matching grid in two columns", () => {
    const { content, group, geometry } = matchingLayout();
    geometry.grid = 500;
    syncChalkLeeMatchingPaginationLayout(content, 1, 1000);
    expect(group.dataset.paginationOverflow).toBeUndefined();
  });

  it("removes the temporary measuring state even if geometry cannot be read", () => {
    const { content, group } = matchingLayout();
    group.dataset.paginationOverflow = "true";
    group.getBoundingClientRect = () => { throw new Error("layout unavailable"); };
    expect(() => syncChalkLeeMatchingPaginationLayout(content, 1, 1000)).toThrow("layout unavailable");
    expect(group.classList.contains("chalklee-matching-measuring")).toBe(false);
    expect(group.dataset.paginationOverflow).toBe("true");
  });
});
