import { BrowserWindow } from "electron";
import { HTML_PAGE_MAX_STEPS, type HtmlPageStep } from "./htmlPages";

export type { HtmlPageStep } from "./htmlPages";

/** A common projector screen, so an agent sees the page about as a class will. */
export const HTML_PAGE_VIEWPORT = { width: 1280, height: 800 } as const;
/** Time for scripts, fonts and first animations after the page has loaded. */
const SETTLE_MS = 800;
const LOAD_TIMEOUT_MS = 20_000;
const SCRIPT_TIMEOUT_MS = 5_000;
const MAX_ERRORS = 20;

export interface HtmlPageShots {
  viewport: { width: number; height: number };
  title: string;
  /** Screens of viewport height the page's content needs. */
  screenCount: number;
  /** Script errors and resources that failed to load, as the page's console reported them. */
  errors: string[];
  /** Set when the page did not finish loading; the shots show what had appeared. */
  loadProblem?: string;
  images: Array<{ screen: number; dataUrl: string }>;
}

const within = <T>(promise: Promise<T>, ms: number, message: string) => {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })])
    .finally(() => clearTimeout(timer));
};
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** Time for the page to answer a step, such as an animation started by a click. */
const STEP_PAUSE_MS = 400;

/**
 * The element a step names: a CSS selector, or else the visible text of a button, link or other
 * control, exact before partial. Runs in the page and returns where to click, or why it cannot.
 */
const FIND_ELEMENT = `(target, scroll) => {
  let element = null;
  try { element = document.querySelector(target); } catch {}
  if (!element) {
    const controls = Array.from(document.querySelectorAll("button, a, input[type=button], input[type=submit], [role=button], [onclick], label, summary, li, span, div"));
    const text = node => (node.value && node.tagName === "INPUT" ? node.value : node.textContent || "").trim();
    element = controls.find(node => text(node) === target) || controls.filter(node => text(node).includes(target)).sort((a, b) => text(a).length - text(b).length)[0] || null;
  }
  if (!element) return { error: "页面上找不到“" + target + "”" };
  if (scroll) element.scrollIntoView({ block: "center", inline: "center" });
  const box = element.getBoundingClientRect();
  if (!box.width || !box.height) return { error: "“" + target + "”没有显示出来" };
  return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
}`;

async function runStep(contents: Electron.WebContents, step: HtmlPageStep, script: (code: string) => Promise<unknown>): Promise<string | null> {
  const mouse = (x: number, y: number) => {
    contents.sendInputEvent({ type: "mouseMove", x, y });
    contents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    contents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  };
  if ("wait" in step) { await pause(Math.min(5000, Math.max(0, step.wait))); return null; }
  if ("clickAt" in step) { mouse(Math.round(step.clickAt.x), Math.round(step.clickAt.y)); return null; }
  if ("press" in step) {
    contents.sendInputEvent({ type: "keyDown", keyCode: step.press });
    if (step.press.length === 1) contents.sendInputEvent({ type: "char", keyCode: step.press });
    contents.sendInputEvent({ type: "keyUp", keyCode: step.press });
    return null;
  }
  if ("fill" in step) {
    const result = await script(`(() => {
      let field = null; try { field = document.querySelector(${JSON.stringify(step.fill)}); } catch {}
      if (!field) field = Array.from(document.querySelectorAll("input, textarea, select")).find(node => [node.name, node.id, node.placeholder, node.getAttribute("aria-label"), node.labels && node.labels[0] && node.labels[0].textContent.trim()].includes(${JSON.stringify(step.fill)})) || null;
      if (!field || !("value" in field)) return "页面上找不到输入框“" + ${JSON.stringify(step.fill)} + "”";
      field.focus(); field.value = ${JSON.stringify(step.value)};
      field.dispatchEvent(new Event("input", { bubbles: true })); field.dispatchEvent(new Event("change", { bubbles: true }));
      return null;
    })()`);
    return typeof result === "string" ? result : null;
  }
  const found = await script(`(${FIND_ELEMENT})(${JSON.stringify(step.click)}, true)`) as { x?: number; y?: number; error?: string };
  if (found.error || found.x === undefined || found.y === undefined) return found.error ?? "无法点击";
  await pause(100);
  mouse(found.x, found.y);
  return null;
}

/**
 * Opens a served workspace page in a hidden, muted window and captures the
 * requested screens. The page cannot navigate away or open windows; its
 * response header keeps it sandboxed like the in-app preview.
 */
export async function captureHtmlPage(url: string, screens: number[] | undefined, signal: AbortSignal, steps: readonly HtmlPageStep[] = []): Promise<HtmlPageShots> {
  signal.throwIfAborted();
  const { width, height } = HTML_PAGE_VIEWPORT;
  const window = new BrowserWindow({
    show: false, width, height, useContentSize: true, paintWhenInitiallyHidden: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  const contents = window.webContents;
  const errors: string[] = [];
  const close = () => { if (!window.isDestroyed()) window.destroy(); };
  signal.addEventListener("abort", close, { once: true });
  try {
    contents.setAudioMuted(true);
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", event => event.preventDefault());
    contents.on("console-message", details => {
      if (details.level === "error" && errors.length < MAX_ERRORS) errors.push(details.message.slice(0, 500));
    });
    let loadProblem: string | undefined;
    await within(contents.loadURL(url), LOAD_TIMEOUT_MS, "网页在 20 秒内没有加载完成，截图为当时已显示的内容。")
      .catch(error => { loadProblem = error instanceof Error ? error.message : String(error); });
    signal.throwIfAborted();
    await pause(SETTLE_MS);
    const script = (code: string) => within(contents.executeJavaScript(code, true), SCRIPT_TIMEOUT_MS, "网页脚本长时间没有响应，可能有死循环。");
    for (const [index, step] of steps.slice(0, HTML_PAGE_MAX_STEPS).entries()) {
      signal.throwIfAborted();
      const problem = await runStep(contents, step, script).catch(error => error instanceof Error ? error.message : String(error));
      if (problem) { errors.push(`第 ${index + 1} 步没有完成：${problem}`); break; }
      await pause("wait" in step ? 0 : STEP_PAUSE_MS);
    }
    // Missing workspace files are reported by the page server; pictures from the web are read from the page itself.
    const page = await script(`({
      height: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0), title: document.title,
      brokenImages: Array.from(document.images).filter(image => image.complete && !image.naturalWidth && /^https?:/.test(image.currentSrc)).map(image => image.getAttribute("src")).slice(0, 10)
    })`) as { height: number; title: string; brokenImages: string[] };
    for (const source of page.brokenImages) if (errors.length < MAX_ERRORS) errors.push(`网络图片没有加载：${source.slice(0, 300)}`);
    const screenCount = Math.max(1, Math.ceil(page.height / height));
    const selected = screens ?? [1];
    if (selected.some(screen => screen > screenCount)) throw new Error(`网页共 ${screenCount} 屏，请选择有效的屏数；省略 pages 查看第 1 屏。`);
    const images: HtmlPageShots["images"] = [];
    for (const screen of selected) {
      signal.throwIfAborted();
      await script(`window.scrollTo(0, ${(screen - 1) * height})`);
      await pause(150);
      const image = await contents.capturePage();
      const scaled = image.getSize().width > width ? image.resize({ width, quality: "good" }) : image;
      images.push({ screen, dataUrl: `data:image/jpeg;base64,${scaled.toJPEG(85).toString("base64")}` });
    }
    return { viewport: { width, height }, title: page.title, screenCount, errors, ...(loadProblem ? { loadProblem } : {}), images };
  } finally {
    signal.removeEventListener("abort", close);
    close();
  }
}
