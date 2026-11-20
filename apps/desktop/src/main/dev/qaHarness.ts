import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, clipboard, ClipboardItem, type BrowserWindow } from "electron";
import { parseQaRealInputConfiguration, runQaRealInputFlow, type QaRealInputModifier, type QaRealInputStep } from "./qaRealInput";

/**
 * Development-only automation for visual checks: environment variables can open
 * documents, send real input and capture the window. Packaged builds ignore it.
 */
export function installQaHarness(window: BrowserWindow): void {
  if (app.isPackaged) return;
  window.webContents.once("did-finish-load", () => {
    const screenshotPath = process.env.CHALKLEE_QA_SCREENSHOT;
    if (!screenshotPath) return;
    const qaLoadedAtMs = Date.now();
    const requestedDocumentKind = process.env.CHALKLEE_QA_DOCUMENT_KIND;
    const requestedKind = requestedDocumentKind === "docx" ? ".docx" : requestedDocumentKind === "chalklee" ? ".chalklee" : ".pdf";
    const qaAppearance = process.env.CHALKLEE_QA_APPEARANCE === "dark" ? "dark" : null;
    const openTabMenu = process.env.CHALKLEE_QA_TAB_MENU === "1";
    const openThemeMenu = process.env.CHALKLEE_QA_THEME_MENU === "1";
    const exportPdf = process.env.CHALKLEE_QA_EXPORT_PDF === "1";
    const inspectSelector = process.env.CHALKLEE_QA_INSPECT_SELECTOR;
    const qaScript = process.env.CHALKLEE_QA_SCRIPT;
    const qaAfterScript = process.env.CHALKLEE_QA_AFTER_SCRIPT;
    const qaRealClickSelectors = qaJsonStringArray(process.env.CHALKLEE_QA_REAL_CLICK_SELECTORS);
    const qaRealKeys = qaJsonStringArray(process.env.CHALKLEE_QA_REAL_KEYS);
    const qaRealDrag = qaJsonDrag(process.env.CHALKLEE_QA_REAL_DRAG);
    const qaRealText = process.env.CHALKLEE_QA_REAL_TEXT;
    let qaRealInputSteps: QaRealInputStep[];
    let qaCaptureDelayMs: number;
    try {
      const qaConfiguration = parseQaRealInputConfiguration(
        process.env.CHALKLEE_QA_REAL_INPUT_STEPS,
        process.env.CHALKLEE_QA_CAPTURE_DELAY_MS
      );
      qaRealInputSteps = qaConfiguration.steps;
      qaCaptureDelayMs = qaConfiguration.captureDelayMs;
    } catch (error) {
      console.error("[chalklee-qa-config]", qaErrorMessage(error));
      process.exitCode = 1;
      return;
    }
    const tabMenuAction = process.env.CHALKLEE_QA_TAB_ACTION;
    const tabMenuActionIndex = tabMenuAction === "close-others" ? 1
      : tabMenuAction === "close-saved" ? 2
        : tabMenuAction === "close-all" ? 3
          : null;
    setTimeout(() => {
      void window.webContents.executeJavaScript(
        `${qaAppearance ? `document.documentElement.dataset.appearance = "dark"; document.documentElement.style.colorScheme = "dark";` : ""} Array.from(document.querySelectorAll('.tree-file')).find((button) => button.textContent?.toLowerCase().includes(${JSON.stringify(requestedKind)}))?.click(); ${openTabMenu ? "document.querySelector('.unified-tab-menu-trigger')?.click();" : ""} ${openThemeMenu ? "document.querySelector('.complete-theme-trigger')?.click();" : ""} ${tabMenuActionIndex ? `setTimeout(() => document.querySelector('.unified-tab-menu-actions > button:nth-child(${tabMenuActionIndex})')?.click(), 180);` : ""} ${exportPdf ? "setTimeout(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, shiftKey: true, bubbles: true })); setTimeout(() => document.querySelector('.chalklee-output-options button[type=submit]')?.click(), 150); }, 5000);" : ""} ${qaScript ? `setTimeout(() => { ${qaScript} }, 5200);` : ""} ({ api: typeof window.chalkLee, title: document.title })`
      ).then((diagnostic) => console.info("[chalklee-qa]", diagnostic));
    }, 1800);
    if (!qaRealInputSteps.length) {
      setTimeout(() => {
        void window.webContents.capturePage().then((image) => writeFile(screenshotPath, image.toPNG()));
      }, qaCaptureDelayMs);
    }
    if (inspectSelector) {
      setTimeout(() => {
        void window.webContents.executeJavaScript(`(() => {
          const element = document.querySelector(${JSON.stringify(inspectSelector)});
          if (!element) return null;
          const style = getComputedStyle(element);
          return {
            html: element.outerHTML.slice(0, 12000),
            display: style.display,
            position: style.position,
            left: style.left,
            paddingLeft: style.paddingLeft,
            textIndent: style.textIndent,
            children: Array.from(element.children).map((child) => ({
              tag: child.tagName,
              className: child.className,
              attributes: Array.from(child.attributes).map((attribute) => [attribute.name, attribute.value]),
              display: getComputedStyle(child).display
            }))
          };
        })()`).then((diagnostic) => console.info("[chalklee-qa-inspect]", JSON.stringify(diagnostic)));
      }, 9000);
    }
    if (qaRealClickSelectors.length || qaRealKeys.length || qaRealDrag || qaRealText || qaRealInputSteps.length || qaAfterScript) {
      setTimeout(() => {
        void (async () => {
          for (const selector of qaRealClickSelectors) {
            const point = await window.webContents.executeJavaScript(`(() => {
              const element = document.querySelector(${JSON.stringify(selector)});
              if (!element) return null;
              element.scrollIntoView({ block: "center", inline: "center" });
              const next = element.getBoundingClientRect();
              return { x: Math.round(next.left + next.width / 2), y: Math.round(next.top + next.height / 2) };
            })()`) as { x: number; y: number } | null | undefined;
            if (!point || !window) continue;
            window.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
            window.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
            window.webContents.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button: "left", clickCount: 1 });
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          for (const keyCode of qaRealKeys) {
            if (!window) break;
            window.webContents.sendInputEvent({ type: "keyDown", keyCode });
            window.webContents.sendInputEvent({ type: "keyUp", keyCode });
            await new Promise((resolve) => setTimeout(resolve, 220));
          }
          if (qaRealDrag && window) {
            const point = await window.webContents.executeJavaScript(`(() => {
              const element = document.querySelector(${JSON.stringify(qaRealDrag.selector)});
              if (!element) return null;
              element.scrollIntoView({ block: "center", inline: "center" });
              const next = element.getBoundingClientRect();
              return { x: Math.round(next.left + next.width / 2), y: Math.round(next.top + next.height / 2) };
            })()`) as { x: number; y: number } | null;
            if (point) {
              window.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
              window.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
              for (let step = 1; step <= 8; step += 1) {
                window.webContents.sendInputEvent({
                  type: "mouseMove",
                  x: Math.round(point.x + qaRealDrag.deltaX * step / 8),
                  y: Math.round(point.y + qaRealDrag.deltaY * step / 8),
                  button: "left"
                });
                await new Promise((resolve) => setTimeout(resolve, 35));
              }
              window.webContents.sendInputEvent({
                type: "mouseUp",
                x: Math.round(point.x + qaRealDrag.deltaX),
                y: Math.round(point.y + qaRealDrag.deltaY),
                button: "left",
                clickCount: 1
              });
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
          }
          if (qaRealText && window) {
            window.webContents.insertText(qaRealText);
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          if (qaRealInputSteps.length) {
            const qaWindow = window;
            if (!qaWindow) throw new Error("QA 输入执行前窗口已关闭。");
            await runQaRealInputFlow({
              steps: qaRealInputSteps,
              loadedAtMs: qaLoadedAtMs,
              captureDelayMs: qaCaptureDelayMs,
              runtime: {
                sendKey: (keyCode, modifiers) => sendQaKey(qaWindow, keyCode, modifiers),
                insertText: async (text) => {
                  assertQaWindowActive(qaWindow);
                  await qaWindow.webContents.insertText(text);
                  await waitForQaRendererInput(qaWindow);
                },
                pasteText: (text) => pasteQaText(qaWindow, text),
                captureStep: (destination, signal) => captureQaPage(qaWindow, destination, signal),
                runAfterScript: qaAfterScript
                  ? async (signal) => {
                      assertQaFlowActive(signal);
                      assertQaWindowActive(qaWindow);
                      const diagnostic = await qaWindow.webContents.executeJavaScript(`(() => { ${qaAfterScript} })()`);
                      assertQaFlowActive(signal);
                      console.info("[chalklee-qa-after]", diagnostic);
                    }
                  : undefined,
                captureFinal: (signal) => captureQaPage(qaWindow, screenshotPath, signal),
                now: Date.now
              }
            });
            return;
          }
          if (qaAfterScript) {
            const diagnostic = await window.webContents.executeJavaScript(`(() => { ${qaAfterScript} })()`);
            console.info("[chalklee-qa-after]", diagnostic);
          }
        })().catch((error) => {
          console.error("[chalklee-qa-real-input]", qaErrorMessage(error));
          process.exitCode = 1;
        });
      }, 7600);
    }
  });
}

function qaJsonStringArray(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function qaJsonDrag(value: string | undefined): { selector: string; deltaX: number; deltaY: number } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { selector?: unknown; deltaX?: unknown; deltaY?: unknown };
    if (typeof parsed.selector !== "string" || !Number.isFinite(Number(parsed.deltaX)) || !Number.isFinite(Number(parsed.deltaY ?? 0))) return null;
    return { selector: parsed.selector, deltaX: Number(parsed.deltaX), deltaY: Number(parsed.deltaY ?? 0) };
  } catch {
    return null;
  }
}

function qaErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function assertQaWindowActive(window: BrowserWindow) {
  if (window.isDestroyed() || window.webContents.isDestroyed()) {
    throw new Error("QA 输入执行期间窗口已关闭。");
  }
}

function assertQaFlowActive(signal: AbortSignal) {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error("QA ordered input 已取消。");
}

async function sendQaKey(window: BrowserWindow, keyCode: string, modifiers: readonly QaRealInputModifier[] | undefined) {
  assertQaWindowActive(window);
  const inputModifiers = modifiers?.length ? [...modifiers] : undefined;
  const modifierInput = inputModifiers ? { modifiers: inputModifiers } : {};
  window.webContents.sendInputEvent({ type: "keyDown", keyCode, ...modifierInput });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode, ...modifierInput });
  await waitForQaRendererInput(window);
}

async function waitForQaRendererInput(window: BrowserWindow) {
  assertQaWindowActive(window);
  await window.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))"
  );
  assertQaWindowActive(window);
}

async function pasteQaText(window: BrowserWindow, text: string) {
  assertQaWindowActive(window);
  const previousClipboard = await Promise.all((await clipboard.read()).map(async (item) => {
    const contents: Record<string, Blob | Electron.ClipboardBookmark> = {};
    for (const type of item.types) contents[type] = await item.getType(type);
    return new ClipboardItem(contents);
  }));
  try {
    clipboard.clear();
    await clipboard.writeText(text);
    window.webContents.paste();
    await waitForQaRendererInput(window);
  } finally {
    clipboard.clear();
    if (previousClipboard.length) await clipboard.write(previousClipboard);
  }
}

async function captureQaPage(window: BrowserWindow, destinationPath: string, signal: AbortSignal) {
  assertQaFlowActive(signal);
  assertQaWindowActive(window);
  const destination = path.resolve(destinationPath);
  await mkdir(path.dirname(destination), { recursive: true });
  assertQaFlowActive(signal);
  const image = await window.webContents.capturePage();
  assertQaFlowActive(signal);
  await writeFile(destination, image.toPNG(), { signal });
  assertQaFlowActive(signal);
  console.info("[chalklee-qa-capture]", destination);
}
