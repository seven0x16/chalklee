import { amber, amberDark, crimson, crimsonDark, grass, grassDark, green, greenDark, indigo, indigoDark, red, redDark, slateA, slateDarkA, teal, tealDark, tomato, tomatoDark, orange, orangeDark, violet, violetDark, whiteA } from "@radix-ui/colors";
import {
  getNeutralScale,
  getTintSteps,
  getThemeScale,
  getThemeSpark,
  type ThemeAppearance,
  type ThemeColor
} from "./palette";

/** Solid step 9 fills that carry white text, so a plugin keeps its color whatever the theme color is. */
const PLUGIN_TONE_SCALES = {
  tomato: [tomato.tomato9, tomatoDark.tomato9],
  grass: [grass.grass9, grassDark.grass9],
  indigo: [indigo.indigo9, indigoDark.indigo9],
  violet: [violet.violet9, violetDark.violet9],
  teal: [teal.teal9, tealDark.teal9],
  crimson: [crimson.crimson9, crimsonDark.crimson9]
} as const;

export type PluginTone = keyof typeof PLUGIN_TONE_SCALES;
export const PLUGIN_TONES = Object.keys(PLUGIN_TONE_SCALES) as PluginTone[];

function rgb(hex: string): string {
  return [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16)).join(" ");
}

function rgba(hex: string, alpha: number): string {
  return `rgb(${rgb(hex)} / ${alpha})`;
}

export function getThemeCssVariables(color: ThemeColor, appearance: ThemeAppearance): Record<string, string> {
  const accent = getThemeScale(color, appearance);
  const neutral = getNeutralScale(appearance);
  const light = appearance === "light";
  const tint = getTintSteps(color, appearance);
  const surface = light ? neutral[0] : neutral[1];
  const onAccent = light ? "#ffffff" : neutral[0];
  const folder = light ? amber : amberDark;
  const pdf = light ? red : redDark;
  const html = light ? orange : orangeDark;
  const tex = light ? grass : grassDark;
  const danger = light ? red : redDark;
  const docx = light ? teal : tealDark;
  const success = light ? green : greenDark;
  const warning = light ? amber : amberDark;
  const accentVariables = Object.fromEntries(accent.map((value, index) => [`--cm-theme-step-${index + 1}`, value]));
  const neutralVariables = Object.fromEntries(neutral.map((value, index) => [`--cm-neutral-step-${index + 1}`, value]));

  return {
    ...accentVariables,
    ...neutralVariables,
    ...Object.fromEntries(PLUGIN_TONES.map(tone => [`--cm-plugin-${tone}`, PLUGIN_TONE_SCALES[tone][light ? 0 : 1]])),
    "--cm-plugin-on-tone": "#ffffff",
    "--cm-theme-shell": light ? "var(--cm-neutral-step-3)" : "var(--cm-neutral-step-1)",
    "--cm-theme-glow-strong-rgb": rgb(accent[8]),
    "--cm-theme-glow-soft-rgb": rgb(accent[light ? 7 : 6]),
    "--cm-theme-shadow-rgb": light ? rgb(neutral[11]) : "0 0 0",
    "--cm-theme-accent-rgb": rgb(accent[8]),
    "--cm-theme-accent": "var(--cm-theme-step-9)",
    "--cm-theme-accent-ink": "var(--cm-theme-step-11)",
    "--cm-theme-accent-strong": "var(--cm-theme-step-11)",
    "--cm-theme-accent-deep": "var(--cm-theme-step-12)",
    "--cm-theme-accent-soft": "var(--cm-theme-step-2)",
    "--cm-theme-on-accent": onAccent,
    "--cm-control-accent": "var(--cm-theme-step-11)",
    "--cm-control-on-accent": onAccent,
    "--cm-control-track": rgba(accent[8], light ? 0.2 : 0.38),
    "--cm-control-thumb": whiteA.whiteA12,
    // Selected, pressed and open controls share the file tree's current row: a pale theme tint, theme text and a
    // hairline lift. Hover stays neutral grey, so the two never read alike. The tint step keeps every theme color
    // equally visible on the dark sidebar.
    "--cm-ui-selected-fg": "var(--cm-theme-accent-ink)",
    "--cm-ui-selected-bg": `var(--cm-theme-step-${tint.selected})`,
    "--cm-ui-selected-shadow": light
      ? "0 0 0 .5px rgb(var(--cm-theme-shadow-rgb) / .05), 0 1px 2px rgb(var(--cm-theme-shadow-rgb) / .09)"
      : "inset 0 0 0 .5px rgb(255 255 255 / .06)",
    "--cm-theme-selection-surface": "var(--cm-theme-step-3)",
    "--cm-theme-selection-border": "var(--cm-theme-step-7)",
    // Hover stays neutral so the theme color only marks selected and enabled states. The alpha step
    // reads on every surface it lands on, from the window canvas to raised menus.
    "--cm-theme-hover-fg": "var(--cm-ui-text)",
    "--cm-theme-hover-bg": light ? slateA.slateA3 : slateDarkA.slateA3,
    "--cm-theme-soft-hover-bg": "var(--cm-theme-step-4)",
    // Controls resting on a grey fill (ChalkLee AI's add and model buttons) step up one alpha shade under the pointer.
    "--cm-ui-fill": light ? slateA.slateA3 : slateDarkA.slateA3,
    "--cm-ui-fill-hover": light ? slateA.slateA4 : slateDarkA.slateA4,
    "--cm-theme-hover-border": "var(--cm-neutral-step-8)",
    "--cm-theme-canvas-tint": light ? "rgb(255 255 255 / .72)" : rgba(neutral[1], 0.9),
    "--cm-theme-canvas": light ? "var(--cm-neutral-step-2)" : "var(--cm-neutral-step-3)",
    "--cm-theme-canvas-dot-rgb": rgb(accent[7]),
    "--cm-theme-state-surface": "var(--cm-theme-step-2)",
    "--cm-theme-state-border": "var(--cm-theme-step-6)",
    "--cm-theme-icon-surface": "var(--cm-theme-step-3)",
    "--cm-theme-spark": getThemeSpark(color, appearance),
    // Middle of ChalkLee AI's star. Radix dark step 9 of red, green and violet is far darker than the spark and
    // the step 11 tail, which pulls the star's weight upward; dark mode takes step 11 so every theme reads even.
    "--cm-theme-raised-tint": `var(--cm-theme-step-${tint.raised})`,
    "--cm-theme-spark-body": light ? "var(--cm-theme-accent)" : "var(--cm-theme-step-11)",
    "--cm-ui-text": "var(--cm-neutral-step-12)",
    "--cm-ui-fg": "var(--cm-ui-text)",
    "--cm-ui-heading": "var(--cm-neutral-step-12)",
    "--cm-ui-muted": "var(--cm-neutral-step-11)",
    "--cm-ui-subtle": "var(--cm-neutral-step-10)",
    "--cm-ui-danger": danger.red11,
    "--cm-ui-danger-surface": danger.red3,
    "--cm-ui-danger-border": danger.red6,
    "--cm-ui-danger-solid": danger.red9,
    "--cm-ui-on-danger": "#ffffff",
    "--cm-ui-success": success.green11,
    "--cm-ui-success-surface": success.green3,
    "--cm-ui-success-indicator": success.green9,
    "--cm-ui-warning": warning.amber11,
    "--cm-ui-warning-surface": warning.amber3,
    "--cm-ui-warning-border": warning.amber6,
    "--cm-ui-warning-indicator": warning.amber9,
    "--cm-ui-tooltip-surface": light ? neutral[11] : neutral[2],
    "--cm-ui-tooltip-text": light ? neutral[0] : neutral[11],
    "--cm-ui-tooltip-border": light ? neutral[11] : neutral[5],
    "--cm-ui-surface": surface,
    "--cm-ui-surface-soft": light ? "var(--cm-neutral-step-2)" : "var(--cm-neutral-step-3)",
    "--cm-ui-unified-fill": "var(--cm-ui-surface-soft)",
    "--cm-ui-surface-raised": light ? "#ffffff" : "var(--cm-neutral-step-4)",
    "--cm-ui-surface-bright": light ? "#ffffff" : surface,
    "--cm-ui-surface-glass": rgba(surface, 0.94),
    "--cm-ui-menu-surface": rgba(surface, 0.98),
    "--cm-ui-border": "var(--cm-neutral-step-6)",
    "--cm-ui-border-strong": "var(--cm-neutral-step-7)",
    "--cm-ui-divider": "var(--cm-neutral-step-6)",
    "--cm-ui-scrollbar": "var(--cm-neutral-step-8)",
    "--cm-document-paper-bg": "#ffffff",
    "--cm-document-paper-ink": "#111111",
    "--cm-document-paper-rule": "#aaaaaa",
    // The paper stays white in dark mode, so notes on it keep the light amber steps.
    "--cm-document-paper-flag-bg": amber.amber3,
    "--cm-document-paper-flag-border": amber.amber7,
    "--cm-document-paper-flag-ink": amber.amber11,
    "--cm-folder-icon-front": light ? folder.amber8 : folder.amber11,
    "--cm-folder-icon-back": light ? folder.amber11 : folder.amber8,
    "--cm-pdf-icon-accent": light ? pdf.red9 : pdf.red11,
    "--cm-pdf-icon-strong": light ? pdf.red11 : pdf.red9,
    "--cm-docx-icon-accent": light ? docx.teal9 : docx.teal11,
    "--cm-docx-icon-strong": light ? docx.teal11 : docx.teal9,
    "--cm-markdown-icon-accent": light ? neutral[8] : neutral[10],
    "--cm-markdown-icon-strong": light ? neutral[10] : neutral[8],
    "--cm-html-icon-accent": light ? html.orange9 : html.orange11,
    "--cm-html-icon-strong": light ? html.orange11 : html.orange9,
    "--cm-tex-icon-accent": light ? tex.grass9 : tex.grass11,
    "--cm-tex-icon-strong": light ? tex.grass11 : tex.grass9
  };
}
