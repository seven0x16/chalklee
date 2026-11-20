import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { chooseChalkLeeOptionColumns } from "./extensions/optionNodeViews";

describe("automatic option columns on a long paper", () => {
  it("tries every group at once, so the paper lays out a few times in all instead of several times per group", () => {
    const { document } = parseHTML("<html><body></body></html>");
    // Short options fit four to a row, medium ones two, long ones only one.
    const group = (length: string) => {
      const element = document.createElement("section");
      element.innerHTML = `<div data-chalklee-option data-length="${length}"></div>`.repeat(4);
      document.body.append(element);
      return element as unknown as HTMLElement;
    };
    const groups = ["short", "medium", "long", "short", "long"].map(group);
    const events: string[] = [];
    for (const element of groups) {
      let columns = "";
      Object.defineProperty(element.dataset, "autoColumns", { configurable: true, get: () => columns, set: value => { columns = value; events.push("write"); } });
    }
    const wraps = (option: HTMLElement) => {
      events.push("read");
      const columns = (option.parentElement as HTMLElement).dataset.autoColumns, length = option.dataset.length;
      return columns === "4" ? length !== "short" : columns === "2" ? length === "long" : false;
    };
    chooseChalkLeeOptionColumns(groups, wraps);
    expect(groups.map(element => element.dataset.autoColumns)).toEqual(["4", "2", "1", "4", "1"]);
    // Writes and reads come in runs: a layout is needed only where a read follows a write.
    const layouts = events.filter((event, index) => event === "read" && events[index - 1] === "write").length;
    expect(layouts).toBe(2);
  });
});
