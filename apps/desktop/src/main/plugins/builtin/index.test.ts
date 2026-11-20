import { randomUUID } from "node:crypto";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_PLUGINS } from ".";

// Not a timer, so tests that fake timers can still wait for the page.
const flush = () => new Promise(resolve => setImmediate(resolve));

async function openPlugin(id: string, saved: Record<string, unknown> = {}) {
  const plugin = BUILTIN_PLUGINS.find(item => item.manifest.id === id)!;
  const html = new TextDecoder().decode(plugin.files.get("index.html"));
  const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!source) throw new Error("插件页面缺少脚本");
  const { window, document } = parseHTML(html);
  const data = new Map<string, unknown>(Object.entries(saved));
  const chalklee = {
    storage: {
      get: vi.fn(async (key: string) => data.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown) => { data.set(key, structuredClone(value)); }),
      remove: vi.fn(async (key: string) => { data.delete(key); })
    }
  };
  new Function("window", "document", "chalklee", "crypto", source)(window, document, chalklee, { randomUUID });
  await flush();
  return { window, document: document as unknown as Document, data };
}

function dispatch(window: unknown, element: EventTarget, type: string, extra: Record<string, unknown> = {}) {
  const EventConstructor = (window as { Event: typeof Event }).Event;
  element.dispatchEvent(Object.assign(new EventConstructor(type, { bubbles: true, cancelable: true }), extra));
}

type TodoItem = { id: string; text: string; done: boolean; date: string | null; repeat: { every: string; from: string } | null };

describe("built-in todo page", () => {
  it("adds, edits, completes and removes an item", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
    const { window, document, data } = await openPlugin("chalklee.todo");
    const input = document.querySelector<HTMLInputElement>("#input")!;
    expect(input.disabled).toBe(false);
    input.value = "整理本周错题";
    dispatch(window, document.querySelector("#form")!, "submit");
    await flush();
    expect(data.get("items")).toMatchObject([{ text: "整理本周错题", done: false, date: null }]);
    expect(document.querySelector("#summary")!.textContent).toBe("1 项待完成");

    const text = document.querySelector<HTMLInputElement>("#open .text")!;
    text.value = "整理并讲评本周错题";
    dispatch(window, text, "change");
    await flush();
    expect(data.get("items")).toMatchObject([{ text: "整理并讲评本周错题" }]);

    // A checked item stays in place for a moment, and a second click takes it back.
    document.querySelector<HTMLButtonElement>("#open .check")!.click();
    await flush();
    expect(data.get("items")).toMatchObject([{ done: true }]);
    expect(document.querySelector("#open li.done")).not.toBeNull();
    document.querySelector<HTMLButtonElement>("#open .check")!.click();
    await flush();
    expect(data.get("items")).toMatchObject([{ done: false }]);

    document.querySelector<HTMLButtonElement>("#open .check")!.click();
    vi.advanceTimersByTime(1500);
    expect(document.querySelector("#open li")).toBeNull();
    expect(document.querySelector<HTMLUListElement>("#done")!.hidden).toBe(true);
    document.querySelector<HTMLButtonElement>("#finished")!.click();
    expect(document.querySelector<HTMLUListElement>("#done")!.hidden).toBe(false);

    document.querySelector<HTMLButtonElement>("#done .remove")!.click();
    await flush();
    expect(data.get("items")).toEqual([]);
    expect(document.querySelector("#empty")!.textContent).toBe("还没有待办");
    expect(document.querySelector("#toast-text")!.textContent).toBe("已删除“整理并讲评本周错题”");
    document.querySelector<HTMLButtonElement>("#undo")!.click();
    await flush();
    expect(data.get("items")).toMatchObject([{ text: "整理并讲评本周错题", done: true }]);
    expect(document.querySelector<HTMLElement>("#toast")!.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads the date from what was typed, without changing the words", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 10, 4, 12) });
    try {
      const { window, document, data } = await openPlugin("chalklee.todo");
      const input = document.querySelector<HTMLInputElement>("#input")!;
      const add = (text: string) => {
        input.value = text;
        dispatch(window, input, "input");
        const label = document.querySelector("#date-label")!.textContent;
        dispatch(window, document.querySelector("#form")!, "submit");
        return label;
      };
      expect(add("周五交教案")).toBe("后天");
      expect(add("周日前改完作文")).toBe("周日");
      expect(add("下周三教研")).toBe("11月11日");
      expect(add("每周一升旗")).toBe("每周一");
      expect(add("每周一次班会")).toBe("日期");
      expect(add("上周五的作业明天讲")).toBe("明天");
      expect(add("1月5日期末考试")).toBe("2027年1月5日");
      await flush();
      expect((data.get("items") as TodoItem[]).reverse().map(item => [item.text, item.date, item.repeat?.every ?? null])).toEqual([
        ["周五交教案", "2026-11-06", null],
        ["周日前改完作文", "2026-11-08", null],
        ["下周三教研", "2026-11-11", null],
        ["每周一升旗", "2026-11-09", "weekly"],
        ["每周一次班会", null, null],
        ["上周五的作业明天讲", "2026-11-05", null],
        ["1月5日期末考试", "2027-01-05", null]
      ]);

      // A date picked by hand wins over the words.
      input.value = "明天交成绩";
      dispatch(window, input, "input");
      document.querySelector<HTMLButtonElement>("#date")!.click();
      document.querySelector<HTMLButtonElement>("#popover .picker-clear")!.click();
      dispatch(window, document.querySelector("#form")!, "submit");
      await flush();
      expect((data.get("items") as TodoItem[])[0]).toMatchObject({ text: "明天交成绩", date: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it("adds each pasted line as its own item, and undoes them together", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 10, 4, 12) });
    try {
      const { window, document, data } = await openPlugin("chalklee.todo", { items: [{ id: "a", text: "备课", done: false }] });
      const input = document.querySelector<HTMLInputElement>("#input")!;
      dispatch(window, input, "paste", { clipboardData: { getData: () => "1. 周四前交教案\n2、收齐春游回执\n\n- [ ] 明天出月考卷\n" } });
      await flush();
      expect((data.get("items") as TodoItem[]).map(item => [item.text, item.date])).toEqual([
        ["周四前交教案", "2026-11-05"], ["收齐春游回执", null], ["明天出月考卷", "2026-11-05"], ["备课", null]
      ]);
      expect(document.querySelector("#toast-text")!.textContent).toBe("已添加 3 项");
      dispatch(window, document, "keydown", { key: "z", metaKey: true });
      await flush();
      expect((data.get("items") as TodoItem[]).map(item => item.text)).toEqual(["备课"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves a repeating item to its next date when it is done", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], now: new Date(2026, 10, 4, 12) });
    try {
      const { document, data } = await openPlugin("chalklee.todo", {
        items: [{ id: "a", text: "交周报", done: false, date: "2026-10-23", repeat: { every: "weekly", from: "2026-10-23" } }]
      });
      expect(document.querySelector('li[data-id="a"] .due')!.textContent).toBe("10月23日");
      // Moved to today, it stays a Friday series.
      document.querySelector<HTMLButtonElement>("#move-overdue")!.click();
      await flush();
      expect((data.get("items") as TodoItem[])[0].date).toBe("2026-11-04");

      document.querySelector<HTMLButtonElement>('li[data-id="a"] .check')!.click();
      await flush();
      const saved = data.get("items") as TodoItem[];
      expect(saved.find(item => item.id === "a")).toMatchObject({ done: false, date: "2026-11-06", repeat: { every: "weekly", from: "2026-10-23" } });
      expect(saved.find(item => item.id !== "a")).toMatchObject({ text: "交周报", done: true, date: "2026-11-04", repeat: null });
      vi.advanceTimersByTime(1500);
      expect(document.querySelector('li[data-id="a"] .due')!.textContent).toBe("后天");
      expect(document.querySelector("#finished-count")!.textContent).toBe("已完成 1 项");

      document.querySelector<HTMLButtonElement>('li[data-id="a"] .due')!.click();
      document.querySelector<HTMLButtonElement>('#popover [data-repeat="monthly"]')!.click();
      await flush();
      expect((data.get("items") as TodoItem[]).find(item => item.id === "a")).toMatchObject({ date: "2026-11-06", repeat: { every: "monthly", from: "2026-11-06" } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears finished items, and brings them back on undo", async () => {
    const { document, data } = await openPlugin("chalklee.todo", {
      items: [{ id: "a", text: "备课", done: false }, { id: "b", text: "交教案", done: true, doneAt: "2026-11-03T02:00:00.000Z" }, { id: "c", text: "改作业", done: true }]
    });
    document.querySelector<HTMLButtonElement>("#finished")!.click();
    document.querySelector<HTMLButtonElement>("#clear-done")!.click();
    await flush();
    expect((data.get("items") as TodoItem[]).map(item => item.id)).toEqual(["a"]);
    expect(document.querySelector<HTMLElement>("#finished-bar")!.hidden).toBe(true);
    document.querySelector<HTMLButtonElement>("#undo")!.click();
    await flush();
    expect((data.get("items") as TodoItem[]).map(item => item.id)).toEqual(["a", "b", "c"]);
  });

  it("groups open items by date and moves them when the date changes", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 10, 4, 12) });
    try {
      const { window, document, data } = await openPlugin("chalklee.todo", {
        items: [
          { id: "a", text: "交教案", done: false, date: "2026-11-02" },
          { id: "b", text: "批改作业", done: false, date: "2026-11-04" },
          { id: "c", text: "出期中卷", done: false, date: "2026-11-20" },
          { id: "d", text: "整理错题", done: false }
        ]
      });
      const groups = () => [...document.querySelectorAll<HTMLElement>("#open section")].map(section => [
        section.querySelector("h2")!.textContent,
        [...section.querySelectorAll<HTMLInputElement>(".text")].map(text => text.value)
      ]);
      expect(groups()).toEqual([["已过期", ["交教案"]], ["今天", ["批改作业"]], ["以后", ["出期中卷"]], ["未定日期", ["整理错题"]]]);

      document.querySelector<HTMLButtonElement>('li[data-id="d"] .due')!.click();
      document.querySelector<HTMLButtonElement>('#popover [data-quick="明天"]')!.click();
      await flush();
      expect(groups()[2]).toEqual(["以后", ["整理错题", "出期中卷"]]);
      expect((data.get("items") as { id: string; date: string }[]).find(item => item.id === "d")!.date).toBe("2026-11-05");

      document.querySelector<HTMLButtonElement>('li[data-id="a"] .due')!.click();
      document.querySelector<HTMLButtonElement>("#popover .picker-clear")!.click();
      await flush();
      expect(groups()[0]).toEqual(["今天", ["批改作业"]]);

      const input = document.querySelector<HTMLInputElement>("#input")!;
      input.value = "周五交成绩";
      document.querySelector<HTMLButtonElement>("#date")!.click();
      document.querySelector<HTMLButtonElement>('#popover [data-date="2026-11-06"]')!.click();
      dispatch(window, document.querySelector("#form")!, "submit");
      await flush();
      expect((data.get("items") as unknown[])[0]).toMatchObject({ text: "周五交成绩", date: "2026-11-06" });
      expect(document.querySelector("#date-label")!.textContent).toBe("日期");
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops document links saved by earlier versions", async () => {
    const { document } = await openPlugin("chalklee.todo", { items: [{ id: "a", text: "备课", done: false, document: { name: "三年级数学.chalklee", path: "数学/三年级数学.chalklee" } }] });
    expect(document.querySelector<HTMLInputElement>("#open .text")!.value).toBe("备课");
    expect(document.querySelector("#open .doc")).toBeNull();
  });
});

describe("built-in calendar page", () => {
  it("adds and edits an arrangement, and numbers the teaching week", async () => {
    const { window, document, data } = await openPlugin("chalklee.calendar");
    const today = document.querySelector<HTMLElement>(".day.current")!;
    const key = today.dataset.date!;
    const text = document.querySelector<HTMLInputElement>("#text")!;
    expect(text.disabled).toBe(false);
    text.value = "年级教研";
    document.querySelector<HTMLInputElement>("#time")!.value = "09:30";
    dispatch(window, document.querySelector("#form")!, "submit");
    await flush();
    expect(data.get("events")).toMatchObject({ [key]: [{ text: "年级教研", time: "09:30" }] });
    expect(document.querySelector(`.day[data-date="${key}"] .chip-text`)!.textContent).toBe("年级教研");

    const itemText = document.querySelector<HTMLInputElement>("#events .event-text")!;
    itemText.value = "数学组教研";
    dispatch(window, itemText, "change");
    await flush();
    const itemTime = document.querySelector<HTMLInputElement>("#events .event-time")!;
    itemTime.value = "10:00";
    dispatch(window, itemTime, "change");
    await flush();
    expect(data.get("events")).toMatchObject({ [key]: [{ text: "数学组教研", time: "10:00" }] });

    document.querySelector<HTMLButtonElement>("#term")!.click();
    document.querySelector<HTMLButtonElement>(`#popover [data-date="${key}"]`)!.click();
    await flush();
    expect(document.querySelector<HTMLElement>("#popover")!.hidden).toBe(true);
    expect(data.get("termStart")).toBe(key);
    expect(document.querySelector("#day-week")!.textContent).toBe("第 1 教学周");

    const title = document.querySelector("#title")!.textContent;
    document.querySelector<HTMLButtonElement>("#next")!.click();
    expect(document.querySelector("#title")!.textContent).not.toBe(title);
    expect(document.querySelector('.day[aria-pressed="true"]')).not.toBeNull();
    document.querySelector<HTMLButtonElement>("#today")!.click();
    document.querySelector<HTMLButtonElement>("#events .remove")!.click();
    await flush();
    expect(data.get("events")).toEqual({});
    expect(document.querySelector<HTMLElement>("#empty")!.hidden).toBe(false);
  });

  it("takes a typed or picked time, and keeps the last valid one", async () => {
    const { window, document, data } = await openPlugin("chalklee.calendar");
    const key = document.querySelector<HTMLElement>(".day.current")!.dataset.date!;
    const time = document.querySelector<HTMLInputElement>("#time")!;
    time.value = "805";
    dispatch(window, time, "change");
    expect(time.value).toBe("08:05");
    time.value = "25:00";
    dispatch(window, time, "change");
    expect(time.value).toBe("08:05");

    document.querySelector<HTMLInputElement>("#text")!.value = "第一节课";
    dispatch(window, document.querySelector("#form")!, "submit");
    await flush();
    expect(data.get("events")).toMatchObject({ [key]: [{ text: "第一节课", time: "08:05" }] });
    expect(time.value).toBe("");

    const itemTime = () => document.querySelector<HTMLInputElement>("#events .event-time")!;
    itemTime().click();
    document.querySelector<HTMLElement>('#popover [data-hour="14"]')!.click();
    expect(data.get("events")).toMatchObject({ [key]: [{ time: "08:05" }] });
    document.querySelector<HTMLElement>('#popover [data-minute="30"]')!.click();
    await flush();
    expect(data.get("events")).toMatchObject({ [key]: [{ time: "14:30" }] });
    itemTime().click();
    document.querySelector<HTMLElement>("#popover .no-time .option")!.click();
    await flush();
    expect(data.get("events")).toMatchObject({ [key]: [{ time: "" }] });
  });

  it("starts the week on the chosen day, and counts teaching weeks from it", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 10, 4, 12) });
    try {
      const { document, data } = await openPlugin("chalklee.calendar", { termStart: "2026-11-01" });
      const firstCell = () => document.querySelector<HTMLElement>("#grid .day")!.dataset.date;
      const weekday = () => document.querySelector("#weekdays span:nth-child(2)")!.textContent;
      const firstWeek = () => document.querySelector("#grid .week")!.textContent;
      expect([weekday(), firstCell()]).toEqual(["周一", "2026-10-26"]);
      expect(document.querySelector("#day-week")!.textContent).toBe("第 2 教学周");
      expect(firstWeek()).toBe("第1周");

      document.querySelector<HTMLButtonElement>("#start-sunday")!.click();
      await flush();
      expect(data.get("firstDay")).toBe(0);
      expect([weekday(), firstCell()]).toEqual(["周日", "2026-11-01"]);
      expect(document.querySelector("#day-week")!.textContent).toBe("第 1 教学周");
      expect(firstWeek()).toBe("第1周");
      expect(document.querySelector("#start-sunday")!.getAttribute("aria-pressed")).toBe("true");

      const reopened = await openPlugin("chalklee.calendar", { firstDay: 0 });
      expect(reopened.document.querySelector("#weekdays span")!.textContent).toBe("周日");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows lunar dates, naming the month on its first day", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 10, 4, 12) });
    try {
      const { document } = await openPlugin("chalklee.calendar");
      const lunar = (date: string) => document.querySelector(`.day[data-date="${date}"] .lunar`)!.textContent;
      expect(["2026-11-04", "2026-11-09", "2026-11-18", "2026-11-28", "2026-11-30"].map(lunar)).toEqual(["廿六", "十月", "初十", "二十", "廿二"]);
      document.querySelector<HTMLButtonElement>("#next")!.click();
      expect(lunar("2026-12-09")).toBe("冬月");
    } finally {
      vi.useRealTimers();
    }
  });
});
