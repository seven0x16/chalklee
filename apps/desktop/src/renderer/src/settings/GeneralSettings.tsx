import { Check, Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { AppSelect } from "../ui/AppSelect";
import { THEME_COLOR_OPTIONS, getThemeColorOption, getThemeVariant, type EffectiveAppearance, type ThemeColor, type ThemeMode } from "../theme/themes";
import { SettingsGroup, SettingsPageHeader, SettingsRow } from "./settingsControls";

export interface AppearanceControls {
  mode: ThemeMode;
  color: ThemeColor;
  /** Light or dark as currently shown, which names the color variants. */
  appearance: EffectiveAppearance;
  onMode(mode: ThemeMode): void;
  onColor(color: ThemeColor): void;
}

const MODES: readonly { mode: ThemeMode; label: string; icon: ReactNode }[] = [
  { mode: "light", label: "浅色", icon: <Sun size={14} aria-hidden="true" /> },
  { mode: "dark", label: "深色", icon: <Moon size={14} aria-hidden="true" /> },
  { mode: "system", label: "跟随系统", icon: <Monitor size={14} aria-hidden="true" /> }
];

// English is planned; the list grows when the interface is translated.
const LANGUAGES = [{ value: "zh-CN", label: "简体中文" }];

export function GeneralSettings({ appearance }: { appearance: AppearanceControls }) {
  const current = getThemeVariant(getThemeColorOption(appearance.color), appearance.appearance);
  return <div className="settings-general">
    <SettingsPageHeader title="通用" />
    <SettingsGroup>
      <SettingsRow id="general-language" label="语言">
        <AppSelect className="settings-select" label="语言" value="zh-CN" options={LANGUAGES} onChange={() => undefined} />
      </SettingsRow>
    </SettingsGroup>
    <SettingsGroup title="外观">
      <SettingsRow id="general-appearance" label="外观模式" description={appearance.mode === "system" ? `跟随系统，当前为${appearance.appearance === "dark" ? "深色" : "浅色"}` : undefined}>
        <div className="settings-segmented" role="radiogroup" aria-label="外观模式">
          {MODES.map(item => <button key={item.mode} type="button" role="radio" aria-checked={appearance.mode === item.mode}
            className={appearance.mode === item.mode ? "active" : ""} onClick={() => appearance.onMode(item.mode)}>
            {item.icon}<span>{item.label}</span>
          </button>)}
        </div>
      </SettingsRow>
      <SettingsRow id="general-theme-color" label="主题色" description={current.name}>
        <div className="settings-swatches" role="radiogroup" aria-label="主题色">
          {THEME_COLOR_OPTIONS.map(theme => {
            const variant = getThemeVariant(theme, appearance.appearance);
            const active = theme.id === appearance.color;
            return <button key={theme.id} type="button" role="radio" aria-checked={active} aria-label={variant.name} title={variant.name}
              className={`settings-swatch${active ? " active" : ""}`} style={{ "--settings-swatch": variant.preview[1] } as React.CSSProperties}
              onClick={() => appearance.onColor(theme.id)}>
              {active ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : null}
            </button>;
          })}
        </div>
      </SettingsRow>
    </SettingsGroup>
  </div>;
}
