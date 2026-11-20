import postcss, { type Declaration, type Rule } from "postcss";
import selectorParser from "postcss-selector-parser";
import valueParser from "postcss-value-parser";

export const CHALKLEE_DESIGN_MAX_LENGTH = 100_000;
const rootProperties = /^(color|font(-family|-size|-style|-weight)?|line-height|letter-spacing|word-spacing|text-align|text-rendering)$/;
const forbiddenProperties = /^(behavior|-moz-binding|zoom|animation.*|transition.*|page|size)$/;
const paintOnlyProperties = /^(color|background-color|border(?:-(?:top|right|bottom|left|block(?:-start|-end)?|inline(?:-start|-end)?))?-color|outline-color|text-decoration-color|text-emphasis-color|-webkit-text-fill-color|-webkit-text-stroke-color)$/i;
const localLayoutProperties = /^(font(?:-family|-size|-style|-weight|-stretch|-kerning|-feature-settings|-variation-settings)?|line-height|letter-spacing|word-spacing|text-align|text-indent|text-rendering|(?:padding|margin)(?:-top|-right|-bottom|-left|-block(?:-start|-end)?|-inline(?:-start|-end)?)?|border(?:-top|-right|-bottom|-left|-block(?:-start|-end)?|-inline(?:-start|-end)?)?(?:-width|-style)?|border-radius)$/i;
const localLayoutClasses = new Set(["chalklee-question-object", "chalklee-question-object-content"]);
const localLayoutAttributes = new Set([
  "data-node-id", "data-chalklee-question", "data-chalklee-region", "data-question-kind", "data-chalklee-options", "data-chalklee-option"
]);
/** Generated text and floats only decorate: they belong to ::before, ::after or ::marker. */
const decorationProperties = /^(content|float)$/;
const decorationPseudoElements = ["::before", "::after", "::marker"];
/** Pictures drawn into the CSS itself; nothing is fetched from elsewhere. */
const inlineImage = /^data:image\/(svg\+xml|png|jpeg|gif|webp)[;,]/i;
const protectedSelector = ':not(:where(.chalklee-question-object-head, .chalklee-question-object-head *, .chalklee-question-settings, .chalklee-question-settings *, .chalklee-image-tools, .chalklee-image-tools *, .chalklee-image-resize-controls, .chalklee-image-resize-controls *, .chalklee-table-tools, .chalklee-table-tools *, .chalklee-page-gap, .chalklee-page-gap *, .chalklee-page-gap-table, .chalklee-page-gap-table *, .chalklee-column-page-skip, .chalklee-column-page-skip *, .chalklee-question-frame-label[data-label-style="filled"], .chalklee-question-frame-label[data-label-style="filled"] *))';

export function compileChalkLeeDesign(css: string, scopeId: string): string {
  return compileDesign(css, scopeId, false).css;
}

/** Compile the scoped sheet and identify styles an isolated question can measure. */
export function compileChalkLeeDesignStyles(css: string, scopeId: string): { css: string; affectsLayout: boolean; measurementCss: string | null } {
  return compileDesign(css, scopeId, true);
}

function compileDesign(css: string, scopeId: string, prepareMeasurement: boolean) {
  if (typeof css !== "string" || css.length > CHALKLEE_DESIGN_MAX_LENGTH) throw new Error("文档 CSS 不能超过 100000 字符。");
  if (!/^[a-zA-Z0-9_-]+$/.test(scopeId)) throw new Error("无效的文档样式作用域。");
  // Escaped tokens can conceal URL functions or reserved internal variables.
  if (css.includes("\\") || css.includes("\0")) throw new Error("文档 CSS 暂不支持转义字符。");
  const scope = `[data-chalklee-design="${scopeId}"]`;
  const sheet = postcss.parse(css);
  let affectsLayout = false;
  let localLayout = true;
  const rootRules = new Map<Rule, string>();
  sheet.walkAtRules(rule => {
    if (rule.name.toLowerCase() !== "media" || !/^(all|print|screen)$/i.test(rule.params.trim())) {
      throw new Error("文档 CSS 只支持 @media all、screen 或 print；不支持导入、字体下载和动画。");
    }
  });
  sheet.walkRules(rule => {
    if (rule.parent?.type !== "root" && rule.parent?.type !== "atrule") throw new Error("请使用展开的 CSS 选择器，不使用嵌套规则。");
    const selectors: string[] = [];
    let decorationOnly = true;
    let localSelectors = true;
    selectorParser(root => {
      root.each(selector => {
        if (selector.nodes.some(node => node.type === "nesting")) throw new Error("文档 CSS 不支持 & 嵌套选择器。");
        if (selector.toString().trim() === ":root") selectors.push(scope);
        else {
          let pseudoElement = "";
          const last = selector.last;
          if (last?.type === "pseudo" && last.value.startsWith("::")) {
            if (!["::before", "::after", "::first-letter", "::first-line", "::marker"].includes(last.value)) throw new Error("不支持此伪元素。");
            pseudoElement = last.toString(); last.remove();
          }
          if (!decorationPseudoElements.includes(pseudoElement.trim())) decorationOnly = false;
          selector.walkPseudos(pseudo => {
            if ([":root", ":scope", ":host", ":host-context", "::slotted"].includes(pseudo.value.toLowerCase())) throw new Error("请用单独的 :root 声明文档变量，正文使用普通选择器。");
          });
          if (prepareMeasurement) localSelectors &&= isLocalLayoutSelector(selector);
          // Intersect the final target with the content subtree, regardless of ancestor/sibling selectors.
          selectors.push(`:is(${scope} .chalklee-editor-content, ${scope} .chalklee-editor-content *):is(${selector.toString() || "*"})${protectedSelector}${pseudoElement}`);
        }
      });
    }).processSync(rule.selector);
    const isRoot = selectors.includes(scope);
    rule.each(node => {
      if (node.type !== "decl" && node.type !== "comment") throw new Error("文档 CSS 不支持嵌套规则。");
      if (node.type === "decl") {
        const usesAnchor = checkDeclaration(node, { isRoot, decorationOnly, subject: "文档 CSS " });
        if (prepareMeasurement && !paintOnlyProperties.test(node.prop)) {
          affectsLayout = true;
          localLayout &&= localSelectors && !usesAnchor
            && (node.prop.startsWith("--design-") || localLayoutProperties.test(node.prop));
        }
      }
    });
    // Outrank the application's print reset as well as its screen defaults.
    const scoped = (targets: string[]) => targets.flatMap(selector => [selector, `#chalklee-print-root ${selector}`]).join(",\n");
    rule.selector = scoped(selectors);
    if (prepareMeasurement && isRoot) rootRules.set(rule, scoped(selectors.filter(selector => selector !== scope)));
  });
  sheet.each(node => { if (!["rule", "atrule", "comment"].includes(node.type)) throw new Error("文档 CSS 必须使用选择器规则。"); });
  const compiled = sheet.toString();
  if (!localLayout) return { css: compiled, affectsLayout, measurementCss: null };
  if (!affectsLayout) return { css: compiled, affectsLayout, measurementCss: "" };
  // The probe already inherits the live paper's root styles, including relative
  // font sizes. Reapplying a root rule in the probe would apply it twice.
  for (const [rule, selector] of rootRules) {
    if (selector) rule.selector = selector;
    else rule.remove();
  }
  return { css: compiled, affectsLayout, measurementCss: rootRules.size ? sheet.toString() : compiled };
}

/** The off-flow measurement keeps the paper and editor shell around the cloned
 * question. A layout rule must reach its target through that same subtree. */
function isLocalLayoutSelector(selector: selectorParser.Selector): boolean {
  let editor = false;
  let block = false;
  for (const part of selector.nodes) {
    if (part.type === "combinator") {
      if ((!editor && !block) || !["", ">"].includes(part.value.trim())) return false;
    } else if (part.type === "class") {
      if (part.value === "chalklee-editor-content") editor = true;
      else if (localLayoutClasses.has(part.value)) block = true;
      else return false;
    } else if (part.type === "attribute") {
      if (!localLayoutAttributes.has(part.attribute)) return false;
      block = true;
    } else if (part.type === "tag") {
      block ||= /^(p|h[1-6])$/i.test(part.value);
    } else if (part.type !== "universal") {
      return false;
    }
  }
  return block;
}

export function validateChalkLeeDesign(css: string): void { compileChalkLeeDesign(css, "validation"); }

/** One declaration of document or box style CSS: what may be set, and pictures only from the CSS itself. */
function checkDeclaration(node: Declaration, { isRoot, decorationOnly, subject }: { isRoot: boolean; decorationOnly: boolean; subject: string }) {
  const property = node.prop.toLowerCase();
  if (property.startsWith("--") && !property.startsWith("--design-")) throw new Error("自定义变量请使用 --design- 前缀，保留应用和分页变量。");
  if (forbiddenProperties.test(property)) throw new Error(`${subject}不支持 ${property}；纸张尺寸、页边距和分栏请使用 page 参数，不使用动画。`);
  if (decorationProperties.test(property) && (!decorationOnly || isRoot)) throw new Error(`${property} 只能用于 ::before、::after 或 ::marker 装饰。`);
  if (property === "position" && !/^(static|relative|absolute)(\s*!important)?$/i.test(node.value.trim())) throw new Error("position 只能是 static、relative 或 absolute，装饰留在卷面内。");
  if (property === "z-index" && !/^(auto|-[0-5]|[0-3])(\s*!important)?$/i.test(node.value.trim())) throw new Error("z-index 只能是 auto 或 -5 到 3 的整数，避免盖住编辑控件。");
  if (/^overflow(-[xy])?$/.test(property) && !/^(visible|hidden|clip)(\s*!important)?$/i.test(node.value.trim())) throw new Error(`${property} 只能是 visible、hidden 或 clip。`);
  if (isRoot && !property.startsWith("--design-") && !rootProperties.test(property)) throw new Error(":root 只用于字体、颜色和 --design- 变量；边框、底色和间距请作用于正文元素。");
  let usesAnchor = false;
  valueParser(node.value).walk(value => {
    if (value.type !== "function") return;
    usesAnchor ||= /^anchor(?:-size)?$/i.test(value.value);
    if (/^url$/i.test(value.value)) {
      const address = value.nodes.map(part => part.value).join("").trim();
      if (!inlineImage.test(address)) throw new Error(`${subject}只能使用写在 CSS 里的图片（data:image/svg+xml 或 data:image/png 等），不能引用网址或文件。`);
      return false;
    }
    if (/^(src|image|image-set|-webkit-image-set|paint|element|expression)$/i.test(value.value)) throw new Error(`${subject}不支持外部资源；装饰图案请用 url("data:image/svg+xml,…")。`);
  });
  return usesAnchor;
}

export const CHALKLEE_BOX_STYLE_CSS_MAX_LENGTH = 20_000;
export const CHALKLEE_BOX_STYLE_NAME = /^[A-Za-z0-9._-]{1,80}$/;
/** Editing controls inside a box stay the application's. */
const boxProtectedSelector = ':not(:where(.chalklee-box-head, .chalklee-box-head *, .chalklee-question-object-head, .chalklee-question-object-head *, .chalklee-question-settings, .chalklee-question-settings *, .chalklee-image-tools, .chalklee-image-tools *, .chalklee-image-resize-controls, .chalklee-image-resize-controls *, .chalklee-table-tools, .chalklee-table-tools *, .chalklee-page-gap, .chalklee-page-gap *, .chalklee-region-assistant, .chalklee-region-assistant *))';

/**
 * A box style's own decoration CSS. Every selector starts with `[data-chalklee-box]`, the box itself, and goes on to
 * its parts: `> [data-chalklee-frame-label]` (the title), `> [data-chalklee-frame-decoration]` (a layer over the
 * whole box for drawn decoration) or the content inside. The CSS applies only to boxes of that style under `root`,
 * a selector the application supplies (one paper, or a gallery of previews); the same rules as document CSS apply.
 * On the paper editing controls inside a box stay the application's; `keepControls: false` is for previews drawn
 * without any, which may sit inside the application's own panels.
 */
export function compileChalkLeeBoxStyleCss(css: string, styleName: string, root: string, { keepControls = true }: { keepControls?: boolean } = {}): string {
  if (typeof css !== "string" || css.length > CHALKLEE_BOX_STYLE_CSS_MAX_LENGTH) throw new Error("盒子样式的 CSS 不能超过 20000 字符。");
  if (!CHALKLEE_BOX_STYLE_NAME.test(styleName)) throw new Error("无效的盒子样式名。");
  if (css.includes("\\") || css.includes("\0")) throw new Error("盒子样式的 CSS 暂不支持转义字符。");
  const box = `${root} [data-chalklee-box][data-box-style="${styleName}"]`;
  const sheet = postcss.parse(css);
  sheet.walkAtRules(rule => {
    if (rule.name.toLowerCase() !== "media" || !/^(all|print|screen)$/i.test(rule.params.trim())) {
      throw new Error("盒子样式的 CSS 只支持 @media all、screen 或 print；不支持导入、字体下载和动画。");
    }
  });
  sheet.walkRules(rule => {
    if (rule.parent?.type !== "root" && rule.parent?.type !== "atrule") throw new Error("请使用展开的 CSS 选择器，不使用嵌套规则。");
    const selectors: string[] = [];
    let decorationOnly = true;
    selectorParser(selectorRoot => {
      selectorRoot.each(selector => {
        if (selector.nodes.some(node => node.type === "nesting")) throw new Error("盒子样式的 CSS 不支持 & 嵌套选择器。");
        const first = selector.first;
        if (first?.type !== "attribute" || first.attribute !== "data-chalklee-box" || first.value !== undefined) {
          throw new Error("盒子样式的选择器须以 [data-chalklee-box] 开头，表示盒子本身。");
        }
        let pseudoElement = "";
        const last = selector.last;
        if (last?.type === "pseudo" && last.value.startsWith("::")) {
          if (!["::before", "::after", "::first-letter", "::first-line", "::marker"].includes(last.value)) throw new Error("不支持此伪元素。");
          pseudoElement = last.toString(); last.remove();
        }
        if (!decorationPseudoElements.includes(pseudoElement.trim())) decorationOnly = false;
        selector.walkPseudos(pseudo => {
          if ([":root", ":scope", ":host", ":host-context", "::slotted"].includes(pseudo.value.toLowerCase())) throw new Error("盒子样式的选择器不能使用 :root。");
        });
        first.remove();
        selectors.push(`${box}${selector.toString()}${keepControls ? boxProtectedSelector : ""}${pseudoElement}`);
      });
    }).processSync(rule.selector);
    rule.each(node => {
      if (node.type !== "decl" && node.type !== "comment") throw new Error("盒子样式的 CSS 不支持嵌套规则。");
      if (node.type === "decl") checkDeclaration(node, { isRoot: false, decorationOnly, subject: "盒子样式的 CSS " });
    });
    rule.selector = selectors.flatMap(selector => [selector, `#chalklee-print-root ${selector}`]).join(",\n");
  });
  sheet.each(node => { if (!["rule", "atrule", "comment"].includes(node.type)) throw new Error("盒子样式的 CSS 必须使用选择器规则。"); });
  return sheet.toString();
}

export function validateChalkLeeBoxStyleCss(css: string): void { compileChalkLeeBoxStyleCss(css, "validation", "[data-chalklee-validation]"); }
