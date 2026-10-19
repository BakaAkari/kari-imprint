import type { SizeLevel } from './types';

export const FONT_SIZE_RATIOS: Record<SizeLevel, number> = { small: 0.18, medium: 0.23, large: 0.25 };
// Logo height / bar height. Matches the two-line text block (≈ 40–45% of the bar).
export const LOGO_SIZE_RATIOS: Record<SizeLevel, number> = { small: 0.36, medium: 0.44, large: 0.54 };
export const SIGNATURE_SIZE_RATIOS: Record<SizeLevel, number> = { small: 0.15, medium: 0.20, large: 0.25 };
export const BORDER_WIDTH_RATIOS: Record<SizeLevel, number> = { small: 0.0075, medium: 0.0165, large: 0.022 };
export const FOOTER_HEIGHT_RATIOS: Record<SizeLevel, number> = { small: 0.06, medium: 0.09, large: 0.13 };
