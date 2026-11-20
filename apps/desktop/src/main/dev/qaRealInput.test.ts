import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QA_CAPTURE_DEFAULT_DELAY_MS,
  QA_CAPTURE_MAX_DELAY_MS,
  QA_REAL_INPUT_CAPTURE_SETTLE_MS,
  QA_REAL_INPUT_MAX_CAPTURES,
  QA_REAL_INPUT_MAX_STEPS,
  QA_REAL_INPUT_MAX_TEXT_LENGTH,
  QA_REAL_INPUT_MAX_TOTAL_TEXT_LENGTH,
  QA_REAL_INPUT_MAX_TOTAL_WAIT_MS,
  QA_REAL_INPUT_MAX_WAIT_MS,
  parseQaCaptureDelayMs,
  parseQaRealInputConfiguration,
  parseQaRealInputSteps,
  runQaRealInputFlow,
  type QaRealInputRuntime
} from "./qaRealInput";

afterEach(() => vi.useRealTimers());

describe("ordered native QA input parser", () => {
  it("keeps the declared order and accepts every supported step", () => {
    expect(parseQaRealInputSteps(undefined)).toEqual([]);
    expect(parseQaRealInputSteps(JSON.stringify([
      { type: "text", text: "1." },
      { type: "paste", text: "21. 收到\nA. 甲 B. 乙" },
      { type: "key", keyCode: "Space", modifiers: ["shift", "shift", "meta"] },
      { type: "wait", ms: 120 },
      { type: "capture", path: "output/qa/after-space.png" },
      { type: "key", keyCode: "Enter", modifiers: [] }
    ]))).toEqual([
      { type: "text", text: "1." },
      { type: "paste", text: "21. 收到\nA. 甲 B. 乙" },
      { type: "key", keyCode: "Space", modifiers: ["shift", "meta"] },
      { type: "wait", ms: 120 },
      { type: "capture", path: "output/qa/after-space.png" },
      { type: "key", keyCode: "Enter" }
    ]);
  });

  it("rejects malformed envelopes and unknown fields with an indexed message", () => {
    expect(() => parseQaRealInputSteps("{"))
      .toThrow("必须是合法 JSON 数组");
    expect(() => parseQaRealInputSteps("{}"))
      .toThrow("必须是 JSON 数组");
    expect(() => parseQaRealInputSteps(JSON.stringify(Array.from(
      { length: QA_REAL_INPUT_MAX_STEPS + 1 },
      () => ({ type: "text", text: "x" })
    )))).toThrow(`最多允许 ${QA_REAL_INPUT_MAX_STEPS} 项`);
    expect(() => parseQaRealInputSteps(JSON.stringify([
      { type: "text", text: "ok" },
      { type: "wait", ms: 1, typo: true }
    ]))).toThrow("第 2 项包含未知字段“typo”");
  });

  it("bounds individual and cumulative waits without coercion", () => {
    const exactTotalWait = Array.from(
      { length: QA_REAL_INPUT_MAX_TOTAL_WAIT_MS / QA_REAL_INPUT_MAX_WAIT_MS },
      () => ({ type: "wait", ms: QA_REAL_INPUT_MAX_WAIT_MS })
    );
    expect(parseQaRealInputSteps(JSON.stringify(exactTotalWait))).toHaveLength(exactTotalWait.length);
    for (const ms of [-1, 1.5, String(1), QA_REAL_INPUT_MAX_WAIT_MS + 1]) {
      expect(() => parseQaRealInputSteps(JSON.stringify([{ type: "wait", ms }])))
        .toThrow(`0–${QA_REAL_INPUT_MAX_WAIT_MS} 的整数`);
    }
    expect(() => parseQaRealInputSteps(JSON.stringify(Array.from(
      { length: QA_REAL_INPUT_MAX_TOTAL_WAIT_MS / QA_REAL_INPUT_MAX_WAIT_MS + 1 },
      () => ({ type: "wait", ms: QA_REAL_INPUT_MAX_WAIT_MS })
    )))).toThrow(`累计等待超过 ${QA_REAL_INPUT_MAX_TOTAL_WAIT_MS} ms`);
  });

  it("fails closed for malformed key, text, paste, capture, and type steps", () => {
    const invalidSteps = [
      { type: "key", keyCode: "" },
      { type: "key", keyCode: "Enter", modifiers: ["super"] },
      { type: "text", text: "" },
      { type: "paste", text: "" },
      { type: "capture", path: "   " },
      { type: "click", selector: "button" },
      null
    ];
    for (const step of invalidSteps) {
      expect(() => parseQaRealInputSteps(JSON.stringify([step]))).toThrow("第 1 项");
    }
  });

  it("bounds aggregate text and capture work", () => {
    const text = "x".repeat(QA_REAL_INPUT_MAX_TEXT_LENGTH);
    const exactTextSteps = Array.from(
      { length: QA_REAL_INPUT_MAX_TOTAL_TEXT_LENGTH / QA_REAL_INPUT_MAX_TEXT_LENGTH },
      () => ({ type: "text", text })
    );
    expect(parseQaRealInputSteps(JSON.stringify(exactTextSteps))).toHaveLength(exactTextSteps.length);
    expect(() => parseQaRealInputSteps(JSON.stringify([...exactTextSteps, { type: "text", text: "x" }])))
      .toThrow(`累计文本超过 ${QA_REAL_INPUT_MAX_TOTAL_TEXT_LENGTH} 字符`);

    const captures = Array.from(
      { length: QA_REAL_INPUT_MAX_CAPTURES },
      (_, index) => ({ type: "capture", path: `capture-${index}.png` })
    );
    expect(parseQaRealInputSteps(JSON.stringify(captures))).toHaveLength(QA_REAL_INPUT_MAX_CAPTURES);
    expect(() => parseQaRealInputSteps(JSON.stringify([...captures, { type: "capture", path: "overflow.png" }])))
      .toThrow(`截图步骤超过 ${QA_REAL_INPUT_MAX_CAPTURES} 项`);
  });
});

describe("QA final capture delay parser", () => {
  it("preserves the legacy default and accepts bounded millisecond values", () => {
    expect(parseQaCaptureDelayMs(undefined)).toBe(QA_CAPTURE_DEFAULT_DELAY_MS);
    expect(parseQaCaptureDelayMs("")).toBe(QA_CAPTURE_DEFAULT_DELAY_MS);
    expect(parseQaCaptureDelayMs("0")).toBe(0);
    expect(parseQaCaptureDelayMs(String(QA_CAPTURE_MAX_DELAY_MS))).toBe(QA_CAPTURE_MAX_DELAY_MS);
  });

  it("rejects negative, fractional, padded, and oversized values", () => {
    for (const value of ["-1", "1.5", " 100", "NaN", String(QA_CAPTURE_MAX_DELAY_MS + 1)]) {
      expect(() => parseQaCaptureDelayMs(value)).toThrow("CHALKLEE_QA_CAPTURE_DELAY_MS");
    }
  });
});

describe("ordered native QA input flow", () => {
  it("awaits Electron insertText completion before the renderer acknowledgement", () => {
    const mainSource = readFileSync(new URL("./qaHarness.ts", import.meta.url), "utf8");
    expect(mainSource).toMatch(
      /await qaWindow\.webContents\.insertText\(text\);\s*await waitForQaRendererInput\(qaWindow\);/
    );
  });

  it("waits for each renderer input to land before sending the next physical event", async () => {
    const events: string[] = [];
    let releaseFirstText!: () => void;
    const firstTextLanded = new Promise<void>((resolve) => { releaseFirstText = resolve; });
    const flow = runQaRealInputFlow({
      steps: [
        { type: "text", text: "A." },
        { type: "key", keyCode: "Space" },
        { type: "text", text: " " }
      ],
      loadedAtMs: Date.now(),
      captureDelayMs: 0,
      settleMs: 0,
      runtime: {
        sendKey: (keyCode) => { events.push(`key:${keyCode}`); },
        insertText: async (text) => {
          events.push(`text:${text}:queued`);
          if (text === "A.") await firstTextLanded;
          events.push(`text:${text}:landed`);
        },
        pasteText: (text) => { events.push(`paste:${text}`); },
        captureStep: vi.fn(),
        captureFinal: async () => { events.push("final"); }
      }
    });

    await Promise.resolve();
    expect(events).toEqual(["text:A.:queued"]);
    releaseFirstText();
    await flow;
    expect(events).toEqual([
      "text:A.:queued",
      "text:A.:landed",
      "key:Space",
      "text: :queued",
      "text: :landed",
      "final"
    ]);
  });

  it("never captures the final screenshot before a long sequence and after-script finish", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const events: string[] = [];
    const runtime: QaRealInputRuntime = {
      sendKey: (keyCode) => { events.push(`key:${keyCode}`); },
      insertText: (text) => { events.push(`text:${text}`); },
      pasteText: (text) => { events.push(`paste:${text}`); },
      captureStep: async (destination) => { events.push(`capture:${destination}`); },
      runAfterScript: async () => { events.push("after"); },
      captureFinal: async () => { events.push("final"); },
      now: Date.now
    };
    const flow = runQaRealInputFlow({
      steps: [
        { type: "text", text: "1." },
        { type: "wait", ms: 30_000 },
        { type: "key", keyCode: "Space" },
        { type: "capture", path: "mid.png" }
      ],
      loadedAtMs: 0,
      captureDelayMs: 12_000,
      runtime
    });

    await vi.advanceTimersByTimeAsync(12_000);
    expect(events).toEqual(["text:1."]);
    await vi.advanceTimersByTimeAsync(18_000);
    expect(events).toEqual(["text:1.", "key:Space", "capture:mid.png", "after"]);
    await vi.advanceTimersByTimeAsync(QA_REAL_INPUT_CAPTURE_SETTLE_MS - 1);
    expect(events).not.toContain("final");
    await vi.advanceTimersByTimeAsync(1);
    await flow;
    expect(events.at(-1)).toBe("final");
  });

  it("fails invalid configuration before any final capture can be scheduled", () => {
    const captureFinal = vi.fn();
    expect(() => {
      const configuration = parseQaRealInputConfiguration("{", undefined);
      void runQaRealInputFlow({
        ...configuration,
        loadedAtMs: 0,
        runtime: {
          sendKey: vi.fn(),
          insertText: vi.fn(),
          pasteText: vi.fn(),
          captureStep: vi.fn(),
          captureFinal
        }
      });
    }).toThrow("必须是合法 JSON 数组");
    expect(captureFinal).not.toHaveBeenCalled();
  });

  it("stops a hung capture at the total flow deadline without producing a final artifact", async () => {
    vi.useFakeTimers();
    const captureFinal = vi.fn();
    const flow = runQaRealInputFlow({
      steps: [{ type: "capture", path: "hung.png" }],
      loadedAtMs: Date.now(),
      captureDelayMs: 0,
      settleMs: 0,
      timeoutMs: 1_000,
      runtime: {
        sendKey: vi.fn(),
        insertText: vi.fn(),
        pasteText: vi.fn(),
        captureStep: () => new Promise<void>(() => undefined),
        captureFinal
      }
    }).then(() => null, (error: unknown) => error);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(await flow).toMatchObject({ message: "QA ordered input 超过 1000 ms 总时限。" });
    expect(captureFinal).not.toHaveBeenCalled();
  });
});
