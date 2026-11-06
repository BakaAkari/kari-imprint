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

import type { ComputedElement, Rect, Size, StyleConfig, TextContent } from './layoutEngine';

export type BoxRef = 'photo' | 'canvas' | 'margin-top' | 'margin-bottom' | 'margin-left' | 'margin-right';
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

export type LayerConfig = FillLayer | KeylineLayer | RuleLayer | MatLayer | TextLayer;

export interface DrawOp {
  id: string;
  op: 'rect';
  rect: Rect;
  color: string;
  opacity: number;
  z: LayerZ;
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

export function resolveBox(box: BoxRef, photo: Rect, canvas: Size): Rect {
  switch (box) {
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

export function composeLayers(
  layers: readonly LayerConfig[] | null | undefined,
  photo: Rect,
  canvas: Size,
  shortEdge: number,
  defaults: StyleConfig,
): ComposeResult {
  const ops: DrawOp[] = [];
  const elements: ComputedElement[] = [];
  for (const layer of layers ?? []) {
    switch (layer.kind) {
      case 'fill': {
        const r = grow(resolveBox(layer.box, photo, canvas), px(layer.outset, shortEdge));
        if (r.w > 0 && r.h > 0) ops.push({ id: layer.id, op: 'rect', rect: r, color: layer.color, opacity: opacityOf(layer.opacity), z: layer.z ?? 'under' });
        break;
      }
      case 'keyline': {
        const inner = grow(resolveBox(layer.box, photo, canvas), px(layer.offset, shortEdge));
        const width = Math.max(1, px(layer.width, shortEdge));
        const c = layer.color;
        ops.push(...ring(layer.id, inner, width, [c, c, c, c], opacityOf(layer.opacity), layer.z ?? 'under'));
        break;
      }
      case 'rule': {
        const b = resolveBox(layer.box, photo, canvas);
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
      case 'text': {
        const b = resolveBox(layer.box, photo, canvas);
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
          rect: { x: point.x + px(layer.offset_x, shortEdge), y: point.y + px(layer.offset_y, shortEdge), w: width, h: Math.max(fontSize, b.h) },
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
