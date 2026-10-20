/**
 * Logo preparation for the Canvas preview — mirror of the PIL helpers in
 * `packages/kari-core/src/kari_core/processor/renderer.py`
 * (`_is_opaque_white_box`, `_visible_bbox`, `_white_to_alpha`, `_is_dark_mono`).
 *
 *  - Visible bounds: transparent margins (or the white box of an opaque RGB
 *    logo) are trimmed, so layout aspect ratio and drawing use the real mark.
 *  - Dark backgrounds: a boxed RGB logo loses its white box (colour-to-alpha)
 *    and a dark monochrome mark is inverted to white, unless a dedicated
 *    `_dark` / white variant was resolved.
 *
 * Pixel access needs a CORS-clean image; on a tainted canvas every helper
 * falls back to the untouched image so the preview never breaks.
 */

export interface LogoBounds {
  /** Visible content box in natural pixels. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Opaque logo whose corners are white (a "white box" RGB logo). */
  whiteBox: boolean;
}

const ALPHA_VISIBLE = 8;
const WHITE_DISTANCE = 16;
const ANALYSIS_EDGE = 1024;

const boundsCache = new WeakMap<HTMLImageElement, LogoBounds>();
const preparedCache = new WeakMap<HTMLImageElement, Map<string, HTMLCanvasElement>>();

function fullBounds(img: HTMLImageElement): LogoBounds {
  return { sx: 0, sy: 0, sw: img.naturalWidth, sh: img.naturalHeight, whiteBox: false };
}

function readPixels(source: CanvasImageSource, w: number, h: number): ImageData | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }
}

/** Visible bounds of a logo image (cached per image element). */
export function logoBounds(img: HTMLImageElement): LogoBounds {
  const cached = boundsCache.get(img);
  if (cached) return cached;
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (nw <= 0 || nh <= 0) return fullBounds(img);
  const scale = Math.min(1, ANALYSIS_EDGE / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * scale));
  const h = Math.max(1, Math.round(nh * scale));
  const data = readPixels(img, w, h);
  if (!data) {
    const fallback = fullBounds(img);
    boundsCache.set(img, fallback);
    return fallback;
  }
  const px = data.data;
  let opaque = true;
  for (let i = 3; i < px.length; i += 4) {
    if (px[i] < 250) { opaque = false; break; }
  }
  const corner = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return Math.min(px[i], px[i + 1], px[i + 2]) >= 240;
  };
  const whiteBox = opaque && corner(0, 0) && corner(w - 1, 0) && corner(0, h - 1) && corner(w - 1, h - 1);
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const visible = whiteBox
        ? Math.max(255 - px[i], 255 - px[i + 1], 255 - px[i + 2]) > WHITE_DISTANCE
        : px[i + 3] > ALPHA_VISIBLE;
      if (!visible) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const bounds: LogoBounds = maxX < 0
    ? { ...fullBounds(img), whiteBox }
    : {
      sx: Math.floor(minX / scale),
      sy: Math.floor(minY / scale),
      sw: Math.min(nw, Math.ceil((maxX + 1) / scale)) - Math.floor(minX / scale),
      sh: Math.min(nh, Math.ceil((maxY + 1) / scale)) - Math.floor(minY / scale),
      whiteBox,
    };
  boundsCache.set(img, bounds);
  return bounds;
}

/** Width / height of the visible logo content. */
export function logoVisibleAspectRatio(img: HTMLImageElement): number | undefined {
  const b = logoBounds(img);
  if (b.sw <= 0 || b.sh <= 0) return undefined;
  return b.sw / b.sh;
}

function isDarkMono(px: Uint8ClampedArray): boolean {
  let count = 0;
  let chroma = 0;
  let luminance = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] <= 127) continue;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    chroma += Math.max(r, g, b) - Math.min(r, g, b);
    luminance += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    count += 1;
  }
  if (count === 0) return false;
  return chroma / count < 24 && luminance / count < 110;
}

/**
 * Return a drawable for the visible logo at `w × h` device pixels, adapted to
 * the background. `null` means "draw the trimmed image directly".
 */
export function prepareLogo(
  img: HTMLImageElement,
  w: number,
  h: number,
  options: { onDark: boolean; matteWhite: boolean; dedicatedVariant: boolean },
): HTMLCanvasElement | null {
  const bounds = logoBounds(img);
  const matte = bounds.whiteBox && (options.onDark || options.matteWhite);
  const invertCandidate = options.onDark && !options.dedicatedVariant;
  if (!matte && !invertCandidate) return null;
  const tw = Math.max(1, Math.round(w));
  const th = Math.max(1, Math.round(h));
  const key = `${tw}x${th}:${matte ? 1 : 0}${invertCandidate ? 1 : 0}`;
  let perImage = preparedCache.get(img);
  const hit = perImage?.get(key);
  if (hit) return hit;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, bounds.sx, bounds.sy, bounds.sw, bounds.sh, 0, 0, tw, th);
    const data = ctx.getImageData(0, 0, tw, th);
    const px = data.data;
    if (matte) {
      for (let i = 0; i < px.length; i += 4) {
        const coverage = (255 - Math.min(px[i], px[i + 1], px[i + 2])) / 255;
        const alpha = px[i + 3] / 255;
        for (let c = 0; c < 3; c += 1) {
          px[i + c] = coverage > 0 ? Math.round(255 - (255 - px[i + c]) / coverage) : 0;
        }
        px[i + 3] = Math.round(alpha * coverage * 255);
      }
    }
    if (invertCandidate && isDarkMono(px)) {
      for (let i = 0; i < px.length; i += 4) {
        px[i] = 255 - px[i];
        px[i + 1] = 255 - px[i + 1];
        px[i + 2] = 255 - px[i + 2];
      }
    } else if (!matte) {
      return null;
    }
    ctx.putImageData(data, 0, 0);
    if (!perImage) {
      perImage = new Map();
      preparedCache.set(img, perImage);
    }
    if (perImage.size > 16) perImage.clear();
    perImage.set(key, canvas);
    return canvas;
  } catch {
    return null;
  }
}
