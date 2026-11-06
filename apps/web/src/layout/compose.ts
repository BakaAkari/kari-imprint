/**
 * Layer composition — mirror of
 * `packages/kari-core/src/kari_core/shared/layout/compose.py`.
 *
 * `config.layers` describe construction around and on the photo (mats,
 * keylines, rules, fills, text). Layout lowers every geometric layer to
 * axis-aligned integer `rect` draw ops, so the Canvas preview and the PIL
 * renderer paint identical pixels for them. Text layers become ordinary text
 * elements and reuse the shared fitting and drawing path.
 *
 * Every length is a ratio of the photo's short edge, rounded once with
 * pyRound (Python's half-to-even) so both languages agree on every pixel.
 * Fixtures: packages/kari-core/tests/fixtures/compose_cases.json.
 */

import type { ComputedElement, LogoContent, Rect, Size, StyleConfig, TextContent } from './layoutEngine';

/** Named boxes; the letterbox bars exist only after a `letterbox` layer (otherwise they are empty). */
export type BoxRef = 'photo' | 'canvas' | 'margin-top' | 'margin-bottom' | 'margin-left' | 'margin-right' | 'letterbox-top' | 'letterbox-bottom';
export type LayerZ = 'under' | 'over';
export type Edge = 'top' | 'bottom' | 'left' | 'right';

interface LayerBase {
  id: string;
  /** Painted below or above the photo; defaults differ per kind. */
  z?: LayerZ;
}

/** Solid fill of a box, optionally grown (positive) or shrunk (negative). */
export interface FillLayer extends LayerBase {
  kind: 'fill';
  box: BoxRef;
  outset?: number;
  color: string;
  opacity?: number;
}

/** A band of `width` drawn `offset` outside the box edge (negative = inside). */
export interface KeylineLayer extends LayerBase {
  kind: 'keyline';
  box: BoxRef;
  offset: number;
  width: number;
  color: string;
  opacity?: number;
}

/** A straight line along one edge of a box, `offset` away from it, shortened by `inset` at both ends. */
export interface RuleLayer extends LayerBase {
  kind: 'rule';
  box: BoxRef;
  edge: Edge;
  offset: number;
  width: number;
  inset?: number;
  color: string;
  opacity?: number;
}

/**
 * Passe-partout window detail around the photo: an optional inner "reveal"
 * band (the lower mat of a double mat) and an optional bevel core line right
 * at the photo edge. The mat board itself is the canvas background.
 */
export interface MatLayer extends LayerBase {
  kind: 'mat';
  reveal?: { width: number; color: string } | null;
  core?: { width: number; color: string; bevel?: boolean } | null;
}

/** Text anchored inside a box; `size` is the font size as a short-edge ratio. */
export interface TextLayer extends LayerBase {
  kind: 'text';
  box: BoxRef;
  anchor: string;
  offset_x?: number;
  offset_y?: number;
  /** Available length as a ratio of the box's width (horizontal text); defaults to the full box. */
  max_width?: number;
  size: number;
  content: TextContent;
  style?: Partial<StyleConfig> | null;
}

/**
 * A sized rectangle placed at an anchor of a box: the anchor names both the
 * point on the box and the rectangle's own corner/edge pinned to it
 * (top-left grows right and down, bottom-right grows left and up, …).
 */
export interface RectLayer extends LayerBase {
  kind: 'rect';
  box: BoxRef;
  anchor: string;
  offset_x?: number;
  offset_y?: number;
  /** Omitted: the box's own width / height. */
  w?: number;
  h?: number;
  color: string;
  opacity?: number;
  /** Corner radius (short-edge ratio). */
  radius?: number;
  /** Blur whatever is under the panel first ("glass"); sigma as a short-edge ratio. */
  blur?: number;
}

/** Cinema bars over the photo, cropping its visible area to `aspect` (width / height). */
export interface LetterboxLayer extends LayerBase {
  kind: 'letterbox';
  aspect: number;
  color: string;
  opacity?: number;
}

/** A brand logo (or uploaded mark) of `height` pinned to a box anchor; '' = automatic brand. */
export interface LogoLayer extends LayerBase {
  kind: 'logo';
  box: BoxRef;
  anchor: string;
  offset_x?: number;
  offset_y?: number;
  height: number;
  path: string;
}

/** Seven-segment digits (date stamps) drawn as integer rects; `height` is the digit height. */
export interface SegmentsLayer extends LayerBase {
  kind: 'segments';
  box: BoxRef;
  anchor: string;
  offset_x?: number;
  offset_y?: number;
  height: number;
  content: TextContent;
  color: string;
  glow?: boolean;
}

export type LayerConfig = FillLayer | KeylineLayer | RuleLayer | MatLayer | TextLayer | RectLayer | LetterboxLayer | LogoLayer | SegmentsLayer;

export interface DrawOp {
  id: string;
  op: 'rect';
  rect: Rect;
  color: string;
  opacity: number;
  z: LayerZ;
  /** Corner radius in px (rect panels). */
  radius?: number;
  /** Backdrop blur sigma in px (glass panels). */
  blur?: number;
}

export interface ComposeResult {
  ops: DrawOp[];
  elements: ComputedElement[];
}

/** Bevel lighting: the top/left faces catch light, the bottom/right faces fall into shade. */
export const BEVEL_LIGHT_PERCENT = 35;
export const BEVEL_SHADE_PERCENT = 18;

/** Python's round(): half-to-even. */
function pyRound(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

function px(ratio: number | undefined, shortEdge: number): number {
  return pyRound((ratio ?? 0) * shortEdge);
}

function grow(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

function hex2(value: number): string {
  return value.toString(16).padStart(2, '0').toUpperCase();
}

/** Integer per-channel mix toward white (percent > 0) or black (percent < 0). */
export function shiftColor(color: string, percent: number): string {
  const text = color.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}/.test(text)) return color;
  const channels = [0, 2, 4].map((i) => parseInt(text.slice(i, i + 2), 16));
  const target = percent >= 0 ? 255 : 0;
  const p = Math.abs(percent);
  const mixed = channels.map((c) => Math.floor((c * (100 - p) + target * p) / 100));
  return `#${mixed.map(hex2).join('')}`;
}

export function resolveBox(box: BoxRef, photo: Rect, canvas: Size, dynamic: Partial<Record<BoxRef, Rect>> = {}): Rect {
  const found = dynamic[box];
  if (found) return { ...found };
  switch (box) {
    case 'letterbox-top': return { x: photo.x, y: photo.y, w: photo.w, h: 0 };
    case 'letterbox-bottom': return { x: photo.x, y: photo.y + photo.h, w: photo.w, h: 0 };
    case 'photo': return { ...photo };
    case 'canvas': return { x: 0, y: 0, w: canvas.w, h: canvas.h };
    case 'margin-top': return { x: 0, y: 0, w: canvas.w, h: photo.y };
    case 'margin-bottom': return { x: 0, y: photo.y + photo.h, w: canvas.w, h: canvas.h - photo.y - photo.h };
    case 'margin-left': return { x: 0, y: photo.y, w: photo.x, h: photo.h };
    case 'margin-right': return { x: photo.x + photo.w, y: photo.y, w: canvas.w - photo.x - photo.w, h: photo.h };
  }
}

/** Four rects forming a ring between `inner` and `inner` grown by `width`. */
function ring(id: string, inner: Rect, width: number, colors: [string, string, string, string], opacity: number, z: LayerZ): DrawOp[] {
  if (width <= 0 || inner.w <= 0 || inner.h <= 0) return [];
  const outer = grow(inner, width);
  const [top, left, bottom, right] = colors;
  return [
    { id: `${id}-top`, op: 'rect', rect: { x: outer.x, y: outer.y, w: outer.w, h: width }, color: top, opacity, z },
    { id: `${id}-left`, op: 'rect', rect: { x: outer.x, y: inner.y, w: width, h: inner.h }, color: left, opacity, z },
    { id: `${id}-bottom`, op: 'rect', rect: { x: outer.x, y: inner.y + inner.h, w: outer.w, h: width }, color: bottom, opacity, z },
    { id: `${id}-right`, op: 'rect', rect: { x: inner.x + inner.w, y: inner.y, w: width, h: inner.h }, color: right, opacity, z },
  ];
}

function opacityOf(value: number | undefined): number {
  if (value === undefined || value === null || !Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function anchorPoint(bounds: Rect, anchor: string): { x: number; y: number } {
  let x = bounds.x;
  if (anchor.includes('center')) x = bounds.x + Math.floor(bounds.w / 2);
  else if (anchor.includes('right')) x = bounds.x + bounds.w;
  let y = bounds.y;
  if (anchor.includes('middle')) y = bounds.y + Math.floor(bounds.h / 2);
  else if (anchor.includes('bottom')) y = bounds.y + bounds.h;
  return { x, y };
}

// ── Seven-segment digits ──────────────────────────────────────────────
//
// Segments: a top, b upper-right, c lower-right, d bottom, e lower-left,
// f upper-left, g middle. Integer geometry shared by both renderers.

const SEGMENT_DIGITS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
  '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcfgd', '-': 'g',
};
export const SEGMENT_GLOW_OPACITY = 0.22;

function segmentAdvance(ch: string, h: number): number {
  if (ch in SEGMENT_DIGITS) return pyRound(h * 0.55);
  if (ch === "'" || ch === '.' || ch === ':') return pyRound(h * 0.22);
  return pyRound(h * 0.38);
}

/** Rects for `text` with its anchor point at (x, y) and digit height `h`; unknown characters become spaces. */
export function segmentRects(text: string, x: number, y: number, h: number, anchor: string): Rect[] {
  const t = Math.max(1, pyRound(h * 0.12));
  const gap = Math.max(1, pyRound(h * 0.16));
  const chars = Array.from(text);
  const total = chars.reduce((sum, ch) => sum + segmentAdvance(ch, h), 0) + gap * Math.max(0, chars.length - 1);
  let cx = anchor.includes('right') ? x - total : anchor.includes('center') ? x - Math.floor(total / 2) : x;
  const top = anchor.includes('bottom') ? y - h : anchor.includes('middle') ? y - Math.floor(h / 2) : y;
  const mid = top + Math.floor((h - t) / 2);
  const bot = top + h - t;
  const rects: Rect[] = [];
  for (const ch of chars) {
    const w = segmentAdvance(ch, h);
    const segments = SEGMENT_DIGITS[ch];
    if (segments) {
      const span = w - 2 * t;
      const upper = mid - top - t;
      const lower = bot - mid - t;
      const shapes: Record<string, Rect> = {
        a: { x: cx + t, y: top, w: span, h: t },
        g: { x: cx + t, y: mid, w: span, h: t },
        d: { x: cx + t, y: bot, w: span, h: t },
        f: { x: cx, y: top + t, w: t, h: upper },
        b: { x: cx + w - t, y: top + t, w: t, h: upper },
        e: { x: cx, y: mid + t, w: t, h: lower },
        c: { x: cx + w - t, y: mid + t, w: t, h: lower },
      };
      for (const seg of segments) rects.push(shapes[seg]);
    } else if (ch === "'") {
      rects.push({ x: cx + Math.floor((w - t) / 2), y: top, w: t, h: pyRound(h * 0.3) });
    } else if (ch === '.' ) {
      rects.push({ x: cx + Math.floor((w - t) / 2), y: bot, w: t, h: t });
    } else if (ch === ':') {
      rects.push({ x: cx + Math.floor((w - t) / 2), y: top + pyRound(h * 0.25), w: t, h: t });
      rects.push({ x: cx + Math.floor((w - t) / 2), y: top + pyRound(h * 0.7), w: t, h: t });
    }
    cx += w + gap;
  }
  return rects;
}

/** Draw ops for a resolved date stamp: a soft glow ring under each segment, then the segment. */
export function segmentOps(id: string, text: string, el: { rect: Rect; anchor: string }, color: string, glow: boolean): DrawOp[] {
  const rects = segmentRects(text, el.rect.x, el.rect.y, el.rect.h, el.anchor);
  const spread = Math.max(1, pyRound(el.rect.h * 0.07));
  const ops: DrawOp[] = [];
  if (glow) rects.forEach((r, i) => ops.push({ id: `${id}-glow-${i}`, op: 'rect', rect: grow(r, spread), color, opacity: SEGMENT_GLOW_OPACITY, z: 'over' }));
  rects.forEach((r, i) => ops.push({ id: `${id}-${i}`, op: 'rect', rect: r, color, opacity: 1, z: 'over' }));
  return ops;
}

export function composeLayers(
  layers: readonly LayerConfig[] | null | undefined,
  photo: Rect,
  canvas: Size,
  shortEdge: number,
  defaults: StyleConfig,
  assetAspect = 3,
): ComposeResult {
  const ops: DrawOp[] = [];
  const elements: ComputedElement[] = [];
  const dynamic: Partial<Record<BoxRef, Rect>> = {};
  const box = (ref: BoxRef) => resolveBox(ref, photo, canvas, dynamic);
  for (const layer of layers ?? []) {
    switch (layer.kind) {
      case 'fill': {
        const r = grow(box(layer.box), px(layer.outset, shortEdge));
        if (r.w > 0 && r.h > 0) ops.push({ id: layer.id, op: 'rect', rect: r, color: layer.color, opacity: opacityOf(layer.opacity), z: layer.z ?? 'under' });
        break;
      }
      case 'keyline': {
        const inner = grow(box(layer.box), px(layer.offset, shortEdge));
        const width = Math.max(1, px(layer.width, shortEdge));
        const c = layer.color;
        ops.push(...ring(layer.id, inner, width, [c, c, c, c], opacityOf(layer.opacity), layer.z ?? 'under'));
        break;
      }
      case 'rule': {
        const b = box(layer.box);
        const offset = px(layer.offset, shortEdge);
        const width = Math.max(1, px(layer.width, shortEdge));
        const inset = px(layer.inset, shortEdge);
        let r: Rect;
        if (layer.edge === 'top') r = { x: b.x + inset, y: b.y - offset - width, w: b.w - 2 * inset, h: width };
        else if (layer.edge === 'bottom') r = { x: b.x + inset, y: b.y + b.h + offset, w: b.w - 2 * inset, h: width };
        else if (layer.edge === 'left') r = { x: b.x - offset - width, y: b.y + inset, w: width, h: b.h - 2 * inset };
        else r = { x: b.x + b.w + offset, y: b.y + inset, w: width, h: b.h - 2 * inset };
        if (r.w > 0 && r.h > 0) ops.push({ id: layer.id, op: 'rect', rect: r, color: layer.color, opacity: opacityOf(layer.opacity), z: layer.z ?? 'under' });
        break;
      }
      case 'mat': {
        const core = layer.core ?? null;
        const coreW = core ? Math.max(1, px(core.width, shortEdge)) : 0;
        const reveal = layer.reveal ?? null;
        const revealW = reveal ? Math.max(1, px(reveal.width, shortEdge)) : 0;
        if (reveal) {
          ops.push(...ring(`${layer.id}-reveal`, grow(photo, coreW), revealW, [reveal.color, reveal.color, reveal.color, reveal.color], 1, 'under'));
        }
        if (core) {
          const lit = core.bevel ? shiftColor(core.color, BEVEL_LIGHT_PERCENT) : core.color;
          const shade = core.bevel ? shiftColor(core.color, -BEVEL_SHADE_PERCENT) : core.color;
          ops.push(...ring(`${layer.id}-core`, photo, coreW, [lit, lit, shade, shade], 1, 'under'));
        }
        break;
      }
      case 'rect': {
        const b = box(layer.box);
        const point = anchorPoint(b, layer.anchor);
        const w = Math.max(1, layer.w === undefined || layer.w === null ? b.w : px(layer.w, shortEdge));
        const h = Math.max(1, layer.h === undefined || layer.h === null ? b.h : px(layer.h, shortEdge));
        const x0 = point.x + px(layer.offset_x, shortEdge);
        const y0 = point.y + px(layer.offset_y, shortEdge);
        const x = layer.anchor.includes('right') ? x0 - w : layer.anchor.includes('center') ? x0 - Math.floor(w / 2) : x0;
        const y = layer.anchor.includes('bottom') ? y0 - h : layer.anchor.includes('middle') ? y0 - Math.floor(h / 2) : y0;
        const op: DrawOp = { id: layer.id, op: 'rect', rect: { x, y, w, h }, color: layer.color, opacity: opacityOf(layer.opacity), z: layer.z ?? 'under' };
        const radius = px(layer.radius, shortEdge);
        const blur = px(layer.blur, shortEdge);
        if (radius > 0) op.radius = Math.min(radius, Math.floor(Math.min(w, h) / 2));
        if (blur > 0) op.blur = blur;
        ops.push(op);
        break;
      }
      case 'letterbox': {
        if (!(layer.aspect > 0)) break;
        const visible = pyRound(photo.w / layer.aspect);
        if (visible >= photo.h) break;
        const top = Math.floor((photo.h - visible) / 2);
        const bottom = photo.h - visible - top;
        const opacity = opacityOf(layer.opacity);
        dynamic['letterbox-top'] = { x: photo.x, y: photo.y, w: photo.w, h: top };
        dynamic['letterbox-bottom'] = { x: photo.x, y: photo.y + photo.h - bottom, w: photo.w, h: bottom };
        ops.push({ id: `${layer.id}-top`, op: 'rect', rect: dynamic['letterbox-top'], color: layer.color, opacity, z: 'over' });
        ops.push({ id: `${layer.id}-bottom`, op: 'rect', rect: dynamic['letterbox-bottom'], color: layer.color, opacity, z: 'over' });
        break;
      }
      case 'logo': {
        const b = box(layer.box);
        const point = anchorPoint(b, layer.anchor);
        const h = Math.max(1, px(layer.height, shortEdge));
        const w = Math.max(1, pyRound(h * assetAspect));
        const content: LogoContent = {
          path: layer.path, size_level: null, size_ratio: null, orientation: 'upright',
          placement: layer.anchor.includes('right') ? 'end' : layer.anchor.includes('center') ? 'center' : 'start', track: 'span',
        };
        elements.push({
          id: layer.id, type: 'logo', anchor: layer.anchor, content, style: { ...defaults },
          rect: { x: point.x + px(layer.offset_x, shortEdge), y: point.y + px(layer.offset_y, shortEdge), w, h },
        });
        break;
      }
      case 'segments': {
        if (!layer.content.chips.length) break;
        const b = box(layer.box);
        const point = anchorPoint(b, layer.anchor);
        const h = Math.max(4, px(layer.height, shortEdge));
        elements.push({
          id: layer.id, type: 'segments', anchor: layer.anchor, content: layer.content,
          style: { ...defaults, color: layer.color, opacity: layer.glow === false ? 0 : 1 },
          rect: { x: point.x + px(layer.offset_x, shortEdge), y: point.y + px(layer.offset_y, shortEdge), w: 0, h },
        });
        break;
      }
      case 'text': {
        const b = box(layer.box);
        const point = anchorPoint(b, layer.anchor);
        const fontSize = Math.max(8, px(layer.size, shortEdge));
        const width = layer.max_width !== undefined && layer.max_width !== null ? Math.max(1, pyRound(b.w * layer.max_width)) : b.w;
        const style: StyleConfig = {
          ...defaults,
          ...(layer.style ?? {}),
          font_size: fontSize,
          font_size_level: null,
          font_size_ratio: null,
        };
        if (!layer.content.chips.length) break;
        elements.push({
          id: layer.id,
          type: 'text',
          // Text layers are horizontal; textFit reads a top/bottom-anchored slot's length from
          // `h` (side-bar convention), so both extents carry the available width.
          rect: { x: point.x + px(layer.offset_x, shortEdge), y: point.y + px(layer.offset_y, shortEdge), w: width, h: width },
          anchor: layer.anchor,
          content: layer.content,
          style,
        });
        break;
      }
    }
  }
  return { ops, elements };
}
