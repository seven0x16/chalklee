export const QA_REAL_INPUT_MAX_STEPS = 256;
export const QA_REAL_INPUT_MAX_WAIT_MS = 30_000;
export const QA_REAL_INPUT_MAX_TOTAL_WAIT_MS = 120_000;
export const QA_REAL_INPUT_MAX_TEXT_LENGTH = 100_000;
export const QA_REAL_INPUT_MAX_TOTAL_TEXT_LENGTH = 500_000;
export const QA_REAL_INPUT_MAX_CAPTURES = 32;
export const QA_REAL_INPUT_MAX_CAPTURE_PATH_LENGTH = 4_096;
export const QA_CAPTURE_DEFAULT_DELAY_MS = 12_000;
export const QA_CAPTURE_MAX_DELAY_MS = 120_000;
export const QA_REAL_INPUT_FLOW_TIMEOUT_MS = 150_000;
export const QA_REAL_INPUT_CAPTURE_SETTLE_MS = 120;

export const QA_REAL_INPUT_MODIFIERS = [
  "shift",
  "control",
  "ctrl",
  "alt",
  "meta",
  "command",
  "cmd",
  "iskeypad",
  "isautorepeat",
  "leftbuttondown",
  "middlebuttondown",
  "rightbuttondown",
  "capslock",
  "numlock",
  "left",
  "right"
] as const;

export type QaRealInputModifier = typeof QA_REAL_INPUT_MODIFIERS[number];

export type QaRealInputStep =
  | { type: "wait"; ms: number }
  | { type: "key"; keyCode: string; modifiers?: QaRealInputModifier[] }
  | { type: "text"; text: string }
  | { type: "paste"; text: string }
  | { type: "capture"; path: string };

export type QaRealInputRuntime = {
  sendKey(keyCode: string, modifiers: readonly QaRealInputModifier[] | undefined): void | Promise<void>;
  insertText(text: string): void | Promise<void>;
  pasteText(text: string): void | Promise<void>;
  captureStep(path: string, signal: AbortSignal): Promise<void>;
  runAfterScript?(signal: AbortSignal): Promise<void>;
  captureFinal(signal: AbortSignal): Promise<void>;
  now?(): number;
};

const modifierSet = new Set<string>(QA_REAL_INPUT_MODIFIERS);

function stepError(index: number, message: string): never {
  throw new Error(`CHALKLEE_QA_REAL_INPUT_STEPS 第 ${index + 1} 项${message}`);
}

function recordStep(value: unknown, index: number): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return stepError(index, "必须是对象。");
  }
  return value as Record<string, unknown>;
}

function requireOnlyKeys(step: Record<string, unknown>, allowed: readonly string[], index: number) {
  const unknown = Object.keys(step).find((key) => !allowed.includes(key));
  if (unknown) stepError(index, `包含未知字段“${unknown}”。`);
}

/** Parse a deliberately small, bounded language for ordered native QA input. */
export function parseQaRealInputSteps(value: string | undefined): QaRealInputStep[] {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("CHALKLEE_QA_REAL_INPUT_STEPS 必须是合法 JSON 数组。");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("CHALKLEE_QA_REAL_INPUT_STEPS 必须是 JSON 数组。");
  }
  if (parsed.length > QA_REAL_INPUT_MAX_STEPS) {
    throw new Error(`CHALKLEE_QA_REAL_INPUT_STEPS 最多允许 ${QA_REAL_INPUT_MAX_STEPS} 项。`);
  }

  let totalWaitMs = 0;
  let totalTextLength = 0;
  let captureCount = 0;
  return parsed.map((rawStep, index): QaRealInputStep => {
    const step = recordStep(rawStep, index);
    if (typeof step.type !== "string") stepError(index, "缺少字符串 type。" );

    if (step.type === "wait") {
      requireOnlyKeys(step, ["type", "ms"], index);
      if (typeof step.ms !== "number"
        || !Number.isInteger(step.ms)
        || step.ms < 0
        || step.ms > QA_REAL_INPUT_MAX_WAIT_MS) {
        stepError(index, `的 wait.ms 必须是 0–${QA_REAL_INPUT_MAX_WAIT_MS} 的整数。`);
      }
      const ms = step.ms;
      totalWaitMs += ms;
      if (totalWaitMs > QA_REAL_INPUT_MAX_TOTAL_WAIT_MS) {
        stepError(index, `使累计等待超过 ${QA_REAL_INPUT_MAX_TOTAL_WAIT_MS} ms。`);
      }
      return { type: "wait", ms };
    }

    if (step.type === "key") {
      requireOnlyKeys(step, ["type", "keyCode", "modifiers"], index);
      if (typeof step.keyCode !== "string" || !step.keyCode.trim() || step.keyCode.length > 64) {
        stepError(index, "的 key.keyCode 必须是 1–64 字符的非空字符串。");
      }
      let modifiers: QaRealInputModifier[] | undefined;
      if (step.modifiers !== undefined) {
        if (!Array.isArray(step.modifiers)
          || !step.modifiers.every((modifier) => typeof modifier === "string" && modifierSet.has(modifier))) {
          stepError(index, "的 key.modifiers 含有 Electron 不支持的修饰键。");
        }
        modifiers = [...new Set(step.modifiers as QaRealInputModifier[])];
      }
      return modifiers?.length
        ? { type: "key", keyCode: step.keyCode, modifiers }
        : { type: "key", keyCode: step.keyCode };
    }

    if (step.type === "text" || step.type === "paste") {
      requireOnlyKeys(step, ["type", "text"], index);
      if (typeof step.text !== "string" || !step.text || step.text.length > QA_REAL_INPUT_MAX_TEXT_LENGTH) {
        stepError(index, `的 ${step.type}.text 必须是 1–${QA_REAL_INPUT_MAX_TEXT_LENGTH} 字符的字符串。`);
      }
      totalTextLength += step.text.length;
      if (totalTextLength > QA_REAL_INPUT_MAX_TOTAL_TEXT_LENGTH) {
        stepError(index, `使累计文本超过 ${QA_REAL_INPUT_MAX_TOTAL_TEXT_LENGTH} 字符。`);
      }
      return { type: step.type, text: step.text };
    }

    if (step.type === "capture") {
      requireOnlyKeys(step, ["type", "path"], index);
      if (typeof step.path !== "string" || !step.path.trim() || step.path.length > QA_REAL_INPUT_MAX_CAPTURE_PATH_LENGTH) {
        stepError(index, `的 capture.path 必须是 1–${QA_REAL_INPUT_MAX_CAPTURE_PATH_LENGTH} 字符的非空路径。`);
      }
      captureCount += 1;
      if (captureCount > QA_REAL_INPUT_MAX_CAPTURES) {
        stepError(index, `使截图步骤超过 ${QA_REAL_INPUT_MAX_CAPTURES} 项。`);
      }
      return { type: "capture", path: step.path };
    }

    return stepError(index, `使用了不支持的 type“${step.type}”。`);
  });
}

export function parseQaCaptureDelayMs(value: string | undefined) {
  if (value === undefined || value === "") return QA_CAPTURE_DEFAULT_DELAY_MS;
  if (!/^\d+$/.test(value)) {
    throw new Error("CHALKLEE_QA_CAPTURE_DELAY_MS 必须是非负整数。");
  }
  const delay = Number(value);
  if (!Number.isSafeInteger(delay) || delay > QA_CAPTURE_MAX_DELAY_MS) {
    throw new Error(`CHALKLEE_QA_CAPTURE_DELAY_MS 不能超过 ${QA_CAPTURE_MAX_DELAY_MS} ms。`);
  }
  return delay;
}

export function parseQaRealInputConfiguration(
  stepsValue: string | undefined,
  captureDelayValue: string | undefined
) {
  return {
    steps: parseQaRealInputSteps(stepsValue),
    captureDelayMs: parseQaCaptureDelayMs(captureDelayValue)
  };
}

function abortedError(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new Error("QA ordered input 已取消。");
}

function assertQaFlowActive(signal: AbortSignal) {
  if (signal.aborted) throw abortedError(signal);
}

function waitForQaFlow(ms: number, signal: AbortSignal) {
  assertQaFlowActive(signal);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortedError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Execute ordered native input, then the diagnostic script, and only then the
 * final screenshot. The configured capture delay is a not-before timestamp,
 * never a timer that can race ahead of input.
 */
export async function runQaRealInputFlow(options: {
  steps: readonly QaRealInputStep[];
  loadedAtMs: number;
  captureDelayMs: number;
  runtime: QaRealInputRuntime;
  timeoutMs?: number;
  settleMs?: number;
}) {
  const timeoutMs = options.timeoutMs ?? QA_REAL_INPUT_FLOW_TIMEOUT_MS;
  const settleMs = options.settleMs ?? QA_REAL_INPUT_CAPTURE_SETTLE_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("QA ordered input 总时限必须大于 0 ms。");
  if (!Number.isFinite(settleMs) || settleMs < 0) throw new Error("QA ordered input 截图稳定等待不能小于 0 ms。");
  const controller = new AbortController();
  const timeoutError = new Error(`QA ordered input 超过 ${timeoutMs} ms 总时限。`);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  const run = async () => {
    for (const step of options.steps) {
      assertQaFlowActive(controller.signal);
      if (step.type === "wait") {
        await waitForQaFlow(step.ms, controller.signal);
      } else if (step.type === "key") {
        await options.runtime.sendKey(step.keyCode, step.modifiers);
      } else if (step.type === "text") {
        await options.runtime.insertText(step.text);
      } else if (step.type === "paste") {
        await options.runtime.pasteText(step.text);
      } else {
        await options.runtime.captureStep(step.path, controller.signal);
      }
      assertQaFlowActive(controller.signal);
    }

    if (options.runtime.runAfterScript) {
      await options.runtime.runAfterScript(controller.signal);
      assertQaFlowActive(controller.signal);
    }

    const now = options.runtime.now ?? Date.now;
    const remainingDelay = Math.max(0, options.loadedAtMs + options.captureDelayMs - now());
    if (remainingDelay) await waitForQaFlow(remainingDelay, controller.signal);
    if (settleMs) await waitForQaFlow(settleMs, controller.signal);
    assertQaFlowActive(controller.signal);
    await options.runtime.captureFinal(controller.signal);
    assertQaFlowActive(controller.signal);
  };

  try {
    await Promise.race([run(), timedOut]);
  } catch (error) {
    if (!controller.signal.aborted) controller.abort(error);
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
