/**
 * Background-luminance colour scheme — mirror of the helpers in
 * `packages/kari-core/src/kari_core/shared/layout/layout_engine.py`
 * (`relative_luminance`, `is_dark_background`, `resolve_ink_scheme`, `_INK_COLORS`).
 *
 * Naming follows the existing renderer convention:
 *   - 'dark'  ink → light backgrounds (dark text, regular logos)
 *   - 'light' ink → dark backgrounds or the blurred-photo effect (light text,
 *     white-box logos matted, dark mono logos inverted)
 */

export type InkScheme = 'dark' | 'light';

/** The single "auto" text colour: slots that keep it follow the background. */
export const DEFAULT_TEXT_COLOR = '#222222';
/** WCAG relative luminance below which light ink reads better than dark ink. */
export const DARK_BACKGROUND_LUMINANCE = 0.18;
export const DIVIDER_OPACITY = 0.25;

export const INK_COLORS: Record<InkScheme, { primary: string; secondary: string; divider: string }> = {
  dark: { primary: '#222222', secondary: '#7A7A7A', divider: '#222222' },
  light: { primary: '#F5F5F5', secondary: '#A3A3A3', divider: '#F5F5F5' },
};

/** WCAG relative luminance of `#RRGGBB` (or `#RRGGBBAA`); `null` for unparsable input. */
export function relativeLuminance(color: string): number | null {
  const text = color.trim().replace(/^#/, '');
  if (!/^(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text)) return null;
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = parseInt(text.slice(0, 2), 16);
  const g = parseInt(text.slice(2, 4), 16);
  const b = parseInt(text.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function isDarkBackground(color: string): boolean {
  const luminance = relativeLuminance(color);
  return luminance !== null && luminance < DARK_BACKGROUND_LUMINANCE;
}

/** 'dark' ink for light backgrounds, 'light' ink for dark or blurred-photo ones. */
export function resolveInkScheme(
  background: string,
  effect?: { background?: 'solid' | 'blur' } | null,
): InkScheme {
  if (effect?.background === 'blur') return 'light';
  return isDarkBackground(background) ? 'light' : 'dark';
}

export function dividerColor(scheme: string): string {
  return (INK_COLORS[scheme as InkScheme] ?? INK_COLORS.dark).divider;
}

/** Only the default colour adapts to the background; explicit colours are respected. */
export function resolveTextColor(color: string, track: 'primary' | 'secondary', scheme: string): string {
  if ((color || '').toUpperCase() !== DEFAULT_TEXT_COLOR) return color;
  const ink = INK_COLORS[scheme as InkScheme] ?? INK_COLORS.dark;
  return track === 'secondary' ? ink.secondary : ink.primary;
}
