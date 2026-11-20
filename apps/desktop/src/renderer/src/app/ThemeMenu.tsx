import { Monitor, Moon, Sun } from "lucide-react";
import { getThemeScale } from "../theme/palette";
import { getThemeVariant, THEME_COLOR_OPTIONS } from "../theme/themes";
import type { EffectiveAppearance, ThemeColor, ThemeColorOption, ThemeMode } from "../theme/themes";

export function ThemeMenu({ activeMode, activeColor, appearance, onModeSelect, onColorSelect }: {
  activeMode: ThemeMode;
  activeColor: ThemeColor;
  appearance: EffectiveAppearance;
  onModeSelect(mode: ThemeMode): void;
  onColorSelect(color: ThemeColor): void;
}) {
  return (
    <div className="complete-theme-menu" role="menu" aria-label="选择界面外观和主题色">
      <section className="complete-theme-mode-section" aria-labelledby="appearance-mode-heading">
        <header className="complete-theme-section-header" id="appearance-mode-heading">
          <strong>外观</strong>
        </header>
        <div className="complete-theme-mode-options" role="group" aria-label="外观模式">
          <ThemeModeOption
            mode="light"
            label="浅色"
            active={activeMode === "light"}
            icon={<Sun size={14} />}
            onSelect={onModeSelect}
          />
          <ThemeModeOption
            mode="dark"
            label="深色"
            active={activeMode === "dark"}
            icon={<Moon size={14} />}
            onSelect={onModeSelect}
          />
          <ThemeModeOption
            mode="system"
            label="跟随系统"
            active={activeMode === "system"}
            icon={<Monitor size={14} />}
            onSelect={onModeSelect}
          />
        </div>
      </section>
      <section className="complete-theme-color-section" aria-labelledby="theme-color-heading">
        <header className="complete-theme-section-header" id="theme-color-heading">
          <strong>主题色</strong>
        </header>
        <div className="complete-theme-options">
          {THEME_COLOR_OPTIONS.map((theme) => (
            <ThemeMenuOption
              key={theme.id}
              theme={theme}
              appearance={appearance}
              active={theme.id === activeColor}
              onSelect={onColorSelect}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function ThemeModeOption({ mode, label, active, icon, onSelect }: {
  mode: ThemeMode;
  label: string;
  active: boolean;
  icon: React.ReactNode;
  onSelect(mode: ThemeMode): void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      className={active ? "active" : ""}
      onClick={() => onSelect(mode)}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ThemeMenuOption({ theme, appearance, active, onSelect }: {
  theme: ThemeColorOption;
  appearance: EffectiveAppearance;
  active: boolean;
  onSelect(color: ThemeColor): void;
}) {
  const variant = getThemeVariant(theme, appearance);
  const scale = getThemeScale(theme.id, appearance);
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      className={active ? "active" : ""}
      style={{
        "--cm-theme-preview-light": variant.preview[0],
        "--cm-theme-preview-accent": variant.preview[1],
        "--cm-theme-preview-deep": scale[appearance === "light" ? 10 : 7],
        "--cm-theme-preview-surface": appearance === "light" ? variant.preview[2] : scale[1]
      } as React.CSSProperties}
      onClick={() => onSelect(theme.id)}
    >
      <span className="complete-theme-swatch" data-appearance={appearance} aria-hidden="true"><i /><i /><i /></span>
      <span className="complete-theme-option-name">{variant.name}</span>
    </button>
  );
}
