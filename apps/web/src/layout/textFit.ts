/**
 * Text fitting for Flow Layout text slots — line-by-line mirror of
 * `packages/kari-core/src/kari_core/shared/layout/text_fit.py`.
 *
 * Policy (shared with PIL export):
 *   1. Text that fits keeps its size.
 *   2. Otherwise shrink, but never below MIN_FIT_SCALE (80%) of the size.
 *   3. Still too long at 80% → truncate and append "...".
 *   4. Paired start/end slots on one track share the track: a short (or empty)
 *      partner donates its unused length, unless a centered logo separates them.
 *   5. Hierarchy: secondary-track text is never scaled less than primary-track
 *      text in the same region.
 *
 * Golden fixtures (`text_fit_cases.json`) run both implementations with the
 * same deterministic fake measurer.
 */

import type { ComputedElement, TextContent } from './layoutEngine';

export const MIN_FIT_SCALE = 0.8;
/** Three ASCII periods: the CJK font renders U+2026 as vertically centered dots. */
export const ELLIPSIS = '...';
const SLOT_ID_RE = /^(.+)-(primary|secondary)-(start|end)$/;

export type FitMeasure = (element: ComputedElement, text: string, fontSize: number) => number;

export interface FittedText {
  font_size: number;
  text: string;
}

function interval(el: ComputedElement): [number, number, number] {
  const { anchor, rect } = el;
  if (anchor.includes('right')) return [rect.x - rect.w, rect.x, rect.w];
  if (anchor.includes('left')) return [rect.x, rect.x + rect.w, rect.w];
  if (anchor.includes('top')) return [rect.y, rect.y + rect.h, rect.h];
  if (anchor.includes('bottom')) return [rect.y - rect.h, rect.y, rect.h];
  return [rect.x - rect.w / 2, rect.x + rect.w / 2, rect.w];
}

function trackOf(el: ComputedElement): [string, 'primary' | 'secondary'] {
  const match = SLOT_ID_RE.exec(el.id);
  return match ? [match[1], match[2] as 'primary' | 'secondary'] : [el.id, 'primary'];
}

/** Shrink to ≥80%, then truncate with an ellipsis, so `text` fits `maxLength`. */
export function fitSingle(
  text: string,
  fontSize: number,
  maxLength: number,
  measure: (text: string, fontSize: number) => number,
): FittedText {
  if (!text || fontSize <= 0) return { font_size: fontSize, text };
  if (maxLength <= 0) return { font_size: fontSize, text: '' };
  const natural = measure(text, fontSize);
  if (natural <= maxLength) return { font_size: fontSize, text };
  const minSize = Math.max(1, Math.floor(fontSize * MIN_FIT_SCALE));
  const target = Math.floor((fontSize * maxLength) / natural);
  if (target >= minSize) {
    let size = target;
    while (size > minSize && measure(text, size) > maxLength) size -= 1;
    if (measure(text, size) <= maxLength) return { font_size: size, text };
  }
  const size = minSize;
  if (measure(text, size) <= maxLength) return { font_size: size, text };
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = chars.slice(0, mid).join('').trimEnd() + ELLIPSIS;
    if (measure(candidate, size) <= maxLength) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best < 0) return { font_size: size, text: '' };
  return { font_size: size, text: chars.slice(0, best).join('').trimEnd() + ELLIPSIS };
}

/** Fit every horizontal / rotated text element; returns id → FittedText. */
export function fitLayoutTexts(
  elements: readonly ComputedElement[],
  texts: Readonly<Record<string, string>>,
  measure: FitMeasure,
): Record<string, FittedText> {
  const result: Record<string, FittedText> = {};
  const textElements = elements.filter((el) =>
    el.type === 'text' && 'chips' in el.content && !!texts[el.id]);
  const centeredLogoRegions = new Set(
    elements
      .filter((el) => el.type === 'logo' && el.id.endsWith('-asset') && el.anchor === 'middle-center')
      .map((el) => el.id.slice(0, -'-asset'.length)),
  );

  // 1. Available length per element (track sharing between paired slots).
  const available: Record<string, number> = {};
  const groups = new Map<string, { region: string; start?: ComputedElement; end?: ComputedElement }>();
  for (const el of textElements) {
    const match = SLOT_ID_RE.exec(el.id);
    if (!match) {
      available[el.id] = interval(el)[2];
      continue;
    }
    const key = `${match[1]}\u0000${match[2]}`;
    const group = groups.get(key) ?? { region: match[1] };
    group[match[3] as 'start' | 'end'] = el;
    groups.set(key, group);
  }
  for (const { region, start, end } of groups.values()) {
    if (!start || !end || centeredLogoRegions.has(region)) {
      for (const el of [start, end]) if (el) available[el.id] = interval(el)[2];
      continue;
    }
    const [first, second] = interval(start)[0] <= interval(end)[0] ? [start, end] : [end, start];
    const [aLo, aHi, aLen] = interval(first);
    const [bLo, bHi, bLen] = interval(second);
    const gap = Math.max(0, bLo - aHi);
    const total = bHi - aLo;
    const needA = measure(first, texts[first.id], first.style.font_size || 16);
    const needB = measure(second, texts[second.id], second.style.font_size || 16);
    let lenA = aLen;
    let lenB = bLen;
    if (needA > aLen && needB <= bLen) lenA = Math.max(aLen, total - gap - needB);
    else if (needB > bLen && needA <= aLen) lenB = Math.max(bLen, total - gap - needA);
    available[first.id] = lenA;
    available[second.id] = lenB;
  }

  // 2. Fit primaries first, then cap secondaries by the primary scale.
  const primaryScale: Record<string, number> = {};
  const ordered = [...textElements].sort((a, b) =>
    (trackOf(a)[1] === 'primary' ? 0 : 1) - (trackOf(b)[1] === 'primary' ? 0 : 1));
  for (const el of ordered) {
    const text = texts[el.id];
    const size = el.style.font_size || 16;
    const direction = el.style.text_direction ?? 'horizontal';
    if (direction === 'vertical-glyphs') {
      result[el.id] = { font_size: size, text };
      continue;
    }
    const [regionId, track] = trackOf(el);
    let baseSize = size;
    if (track === 'secondary' && regionId in primaryScale) {
      baseSize = Math.max(1, Math.min(size, Math.floor(size * primaryScale[regionId] + 1e-9)));
    }
    const fitted = fitSingle(text, baseSize, available[el.id] ?? 0, (t, s) => measure(el, t, s));
    result[el.id] = fitted;
    if (track === 'primary') {
      const scale = size ? fitted.font_size / size : 1;
      primaryScale[regionId] = Math.min(primaryScale[regionId] ?? 1, scale);
    }
  }
  return result;
}

export function isTextElement(el: ComputedElement): el is ComputedElement & { content: TextContent } {
  return el.type === 'text' && 'chips' in el.content;
}
