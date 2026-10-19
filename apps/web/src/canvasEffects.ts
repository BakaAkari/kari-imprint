/**
 * Canvas preview of `canvas.effect` — mirror of
 * `packages/kari-core/src/kari_core/processor/effects.py`. Constants are the
 * shared contract; keep both files in sync.
 *
 * Like PIL, the blur and the shadow are computed on a work canvas whose long
 * edge is at most WORK_EDGE (layout pixels), never at full resolution.
 */

import type { CanvasEffect } from './types';
import { DEFAULT_CANVAS_EFFECT, MAX_PHOTO_RADIUS } from './types';

export const WORK_EDGE = 1200;
export const BLUR_SIGMA_RATIO = 0.05;
export const DARKEN_OPACITY = 0.25;
export const SHADOW_OPACITY = 0.35;
export const SHADOW_OFFSET_RATIO = 0.006;
export const SHADOW_SIGMA_RATIO = 0.015;

interface Box { x: number; y: number; w: number; h: number }

/** Effective effect with defaults applied; `null` / missing ≡ no-op. */
export function canvasEffectOf(effect: Partial<CanvasEffect> | null | undefined): CanvasEffect {
  return { ...DEFAULT_CANVAS_EFFECT, ...(effect ?? {}) };
}

export function isEffectActive(effect: Partial<CanvasEffect> | null | undefined): boolean {
  const e = canvasEffectOf(effect);
  return e.background === 'blur' || e.photo_radius > 0 || e.shadow;
}

export function photoRadiusPx(effect: Partial<CanvasEffect> | null | undefined, photo: Box): number {
  const e = canvasEffectOf(effect);
  if (!(e.photo_radius > 0)) return 0;
  const short = Math.min(photo.w, photo.h);
  const radius = Math.round(Math.min(MAX_PHOTO_RADIUS, e.photo_radius) * short);
  return Math.max(0, Math.min(radius, Math.floor(short / 2)));
}

export function roundedRectPath(ctx: CanvasRenderingContext2D, box: Box, radius: number) {
  const r = Math.max(0, Math.min(radius, box.w / 2, box.h / 2));
  ctx.beginPath();
  ctx.moveTo(box.x + r, box.y);
  ctx.lineTo(box.x + box.w - r, box.y);
  ctx.arcTo(box.x + box.w, box.y, box.x + box.w, box.y + r, r);
  ctx.lineTo(box.x + box.w, box.y + box.h - r);
  ctx.arcTo(box.x + box.w, box.y + box.h, box.x + box.w - r, box.y + box.h, r);
  ctx.lineTo(box.x + r, box.y + box.h);
  ctx.arcTo(box.x, box.y + box.h, box.x, box.y + box.h - r, r);
  ctx.lineTo(box.x, box.y + r);
  ctx.arcTo(box.x, box.y, box.x + r, box.y, r);
  ctx.closePath();
}

function supportsFilter(ctx: CanvasRenderingContext2D): boolean {
  return typeof (ctx as { filter?: unknown }).filter === 'string';
}

function sourceSize(image: CanvasImageSource): { w: number; h: number } {
  const anyImage = image as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
  return {
    w: anyImage.naturalWidth || anyImage.width || 1,
    h: anyImage.naturalHeight || anyImage.height || 1,
  };
}

/** Draw `image` scaled to cover the `w × h` box at (x, y). */
function drawCover(ctx: CanvasRenderingContext2D, image: CanvasImageSource, x: number, y: number, w: number, h: number) {
  const src = sourceSize(image);
  const scale = Math.max(w / src.w, h / src.h);
  const dw = src.w * scale;
  const dh = src.h * scale;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** Software fallback for engines without `ctx.filter` (older Safari): box-downscale blur. */
function approximateBlur(source: HTMLCanvasElement, sigma: number): HTMLCanvasElement {
  const factor = Math.max(1, sigma * 0.75);
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(source.width / factor));
  small.height = Math.max(1, Math.round(source.height / factor));
  const sctx = small.getContext('2d');
  if (!sctx) return source;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(source, 0, 0, small.width, small.height);
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const octx = out.getContext('2d');
  if (!octx) return source;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(small, 0, 0, out.width, out.height);
  return out;
}

/**
 * Paint the effect background (blurred photo and/or soft shadow) over the
 * whole layout canvas `canvasW × canvasH` in layout coordinates.
 */
export function drawEffectBackground(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  photo: Box,
  image: CanvasImageSource | null,
  background: string,
  effectInput: Partial<CanvasEffect> | null | undefined,
) {
  const effect = canvasEffectOf(effectInput);
  const scale = Math.min(1, WORK_EDGE / Math.max(canvasW, canvasH));
  const workW = Math.max(1, Math.round(canvasW * scale));
  const workH = Math.max(1, Math.round(canvasH * scale));
  const work = document.createElement('canvas');
  work.width = workW;
  work.height = workH;
  const wctx = work.getContext('2d');
  if (!wctx) return;
  if (effect.background === 'blur' && image) {
    const sigma = Math.max(1, BLUR_SIGMA_RATIO * Math.min(workW, workH));
    // Pad by 3σ with the same cover image so the blur does not pull in
    // transparent edges (PIL extends edge pixels).
    const pad = Math.ceil(sigma * 3);
    const padded = document.createElement('canvas');
    padded.width = workW + pad * 2;
    padded.height = workH + pad * 2;
    const pctx = padded.getContext('2d');
    if (pctx) {
      pctx.imageSmoothingQuality = 'high';
      drawCover(pctx, image, 0, 0, padded.width, padded.height);
      if (supportsFilter(wctx)) {
        wctx.filter = `blur(${sigma}px)`;
        wctx.drawImage(padded, -pad, -pad);
        wctx.filter = 'none';
      } else {
        wctx.drawImage(approximateBlur(padded, sigma), -pad, -pad);
      }
    }
    wctx.fillStyle = `rgba(0, 0, 0, ${DARKEN_OPACITY})`;
    wctx.fillRect(0, 0, workW, workH);
  } else {
    wctx.fillStyle = background;
    wctx.fillRect(0, 0, workW, workH);
  }
  if (effect.shadow) {
    const short = Math.min(photo.w, photo.h);
    const offset = SHADOW_OFFSET_RATIO * short * scale;
    const sigma = Math.max(0.5, SHADOW_SIGMA_RATIO * short * scale);
    const radius = photoRadiusPx(effect, photo) * scale;
    const shadow = document.createElement('canvas');
    shadow.width = workW;
    shadow.height = workH;
    const sctx = shadow.getContext('2d');
    if (sctx) {
      sctx.fillStyle = '#000';
      roundedRectPath(sctx, { x: photo.x * scale, y: photo.y * scale + offset, w: photo.w * scale, h: photo.h * scale }, radius);
      sctx.fill();
      wctx.save();
      wctx.globalAlpha = SHADOW_OPACITY;
      if (supportsFilter(wctx)) {
        wctx.filter = `blur(${sigma}px)`;
        wctx.drawImage(shadow, 0, 0);
        wctx.filter = 'none';
      } else {
        wctx.drawImage(approximateBlur(shadow, sigma), 0, 0);
      }
      wctx.restore();
    }
  }
  ctx.save();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(work, 0, 0, canvasW, canvasH);
  ctx.restore();
}
