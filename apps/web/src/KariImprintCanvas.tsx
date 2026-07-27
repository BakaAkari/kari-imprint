/**
 * KariImprintCanvas — 使用 Region-Based Layout Engine 的 Canvas 渲染器
 *
 * - 不内联计算坐标，全部委托给 computeLayout()
 * - 按 LayoutResult 的顺序绘制元素
 * - 支持 footer-bar / side-bar / free 三种区域类型
 *
 * 显示策略：
 * - canvas 内部逻辑分辨率始终等于布局像素，保证输出质量。
 * - 在页面上 canvas 铺满外层容器，按 CSS `contain` 比例缩放，因此修改参数时
 *   预览区（白色边框/画布背景）在容器内的显示尺寸保持不变，只改变内部比例。
 */

import { useEffect, useRef, useState } from 'react';
import type { ImprintConfig, FieldChip, TextContent, PreviewAspectRatio } from './types';
import { PREVIEW_ASPECT_RATIOS } from './types';
import { computeLayout } from './layout/layoutEngine';
import type { LayoutResult, ComputedElement } from './layout/layoutEngine';
import { builtinLogoUrl, fetchLogos, resourceUrl } from './api';
import type { ExifFieldValues, RuntimeCapabilities } from './api';
import { resolveAutoLogoWithScheme, type LogoRegistryEntry } from './autoLogo';

function resolveAssetSrc(path: string, kind: 'logo' | 'signature', variant: string = '', dark: boolean = false): string {
  if (!path) return '';
  if (path.startsWith('builtin:')) return builtinLogoUrl(path.split(':', 2)[1], variant, dark);
  return resourceUrl(kind, path);
}

/**
 * 在 computeLayout 之前解析所有 logo slot 的 auto-logo。
 * 返回一个浅克隆的 config 副本：
 * - auto-logo 匹配 → path 已填充为 builtin:xxx → layout 预留空间
 * - auto-logo 未匹配 → slot disabled → layout 无 logo 元素
 * - 显式 path → 原样保留
 */
function resolveLogoConfig(
  config: ImprintConfig,
  fieldValues: ExifFieldValues,
  registry: readonly LogoRegistryEntry[],
  scheme: string,
  logoVariant: string,
): ImprintConfig {
  const regions = config.regions.map((region) => {
    const slots = { ...region.slots };
    for (const [slotId, slot] of Object.entries(slots)) {
      if (!slot?.enabled || !slot.content || !('path' in slot.content)) continue;
      const logoContent = slot.content as { path: string };
      if (logoContent.path) continue;
      if (registry.length === 0) {
        slots[slotId] = { ...slot, enabled: false, content: null };
        continue;
      }
      const resolution = resolveAutoLogoWithScheme(fieldValues.make, registry, scheme, logoVariant);
      if (resolution.stem) {
        slots[slotId] = {
          ...slot,
          content: { ...slot.content, path: `builtin:${resolution.stem}` },
        };
      } else {
        slots[slotId] = { ...slot, enabled: false, content: null };
      }
    }
    return { ...region, slots };
  });
  return { ...config, regions };
}

/**
 * Resolve an element's Logo path for preview rendering with scheme-aware dark/light support.
 */
function resolveLogoElementPath(
  content: { path: string },
  fieldValues: ExifFieldValues,
  registry: readonly LogoRegistryEntry[],
  scheme: string,
  logoVariant: string,
): { path: string; variant: string; dark: boolean } {
  if (content.path) return { path: content.path, variant: '', dark: false };
  const resolution = resolveAutoLogoWithScheme(fieldValues.make, registry, scheme, logoVariant);
  return {
    path: resolution.stem ? `builtin:${resolution.stem}` : '',
    variant: resolution.variant,
    dark: resolution.dark,
  };
}

// ── 文本解析（chips → 实际文本）───────────────────────────────────────

function resolveText(chip: FieldChip, customText: string, fieldValues: ExifFieldValues): string {
  if (chip.field_id === 'custom_text') return chip.custom_text || customText || '';
  if (chip.field_id === 'empty') return '';
  return fieldValues[chip.field_id] ?? '';
}

function buildText(content: TextContent, customText: string, fieldValues: ExifFieldValues): string {
  const texts = content.chips
    .filter(c => c.field_id !== 'empty')
    .map(c => resolveText(c, customText, fieldValues));
  return texts.join(content.separator);
}

// ── Logo 缓存 ─────────────────────────────────────────────────────────

const logoCache = new Map<string, HTMLImageElement>();

export function fitPreviewDimensions(width: number, height: number, maxEdge: number) {
  if (width <= 0 || height <= 0 || maxEdge <= 0) throw new Error('Invalid preview dimensions');
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function loadLogo(path: string): Promise<HTMLImageElement> {
  const cached = logoCache.get(path);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      logoCache.set(path, img);
      resolve(img);
    };
    img.onerror = reject;
    img.src = path;
  });
}

// ── 渲染函数 ──────────────────────────────────────────────────────────

function renderCanvas(
  ctx: CanvasRenderingContext2D,
  layout: LayoutResult,
  image: CanvasImageSource | null,
  logos: Map<string, HTMLImageElement>,
  _config: ImprintConfig,
  fieldValues: ExifFieldValues,
  builtins: readonly LogoRegistryEntry[],
  scheme: string,
  logoVariant: string,
) {
  const { canvas, image_rect, elements } = layout;

  // 1. 绘制画布背景
  ctx.fillStyle = _config.canvas.background;
  ctx.fillRect(0, 0, canvas.w, canvas.h);

  // 1b. 绘制边框（填充 margin 区域，底部有 footer 时不画底边）
  const border = _config.canvas.border;
  if (border?.enabled) {
    ctx.fillStyle = border.color;
    // 顶部边
    if (image_rect.y > 0) ctx.fillRect(0, 0, canvas.w, image_rect.y);
    // 左边
    const hasLeftSideBar = _config.regions?.some(r => r.type === 'side-bar' && r.enabled && r.edge === 'left');
    if (image_rect.x > 0 && !hasLeftSideBar) ctx.fillRect(0, image_rect.y, image_rect.x, image_rect.h);
    // 右边
    const rightGap = canvas.w - (image_rect.x + image_rect.w);
    const hasRightSideBar = _config.regions?.some(r => r.type === 'side-bar' && r.enabled && r.edge !== 'left');
    if (rightGap > 0 && !hasRightSideBar) ctx.fillRect(image_rect.x + image_rect.w, image_rect.y, rightGap, image_rect.h);
    // 底部：仅当底部 margin 不是由 footer-bar 占据时才画
    const bottomGap = canvas.h - (image_rect.y + image_rect.h);
    const hasFooter = _config.regions?.some(r => r.type === 'footer-bar' && r.enabled);
    if (bottomGap > 0 && !hasFooter) ctx.fillRect(0, image_rect.y + image_rect.h, canvas.w, bottomGap);
  }

  // 2. 绘制照片主体（或占位）
  if (image) {
    ctx.drawImage(image, image_rect.x, image_rect.y, image_rect.w, image_rect.h);
  } else {
    // Placeholder
    const grad = ctx.createLinearGradient(
      image_rect.x, image_rect.y,
      image_rect.x + image_rect.w, image_rect.y + image_rect.h,
    );
    grad.addColorStop(0, '#3a3832');
    grad.addColorStop(0.5, '#2a2824');
    grad.addColorStop(1, '#1a1814');
    ctx.fillStyle = grad;
    ctx.fillRect(image_rect.x, image_rect.y, image_rect.w, image_rect.h);

    // Placeholder decoration belongs strictly to the photo rectangle. Side-bar
    // layouts offset the photo inside a larger canvas, so clipping is required;
    // otherwise the diagonal strokes extend across the white watermark rail.
    ctx.save();
    ctx.beginPath();
    ctx.rect(image_rect.x, image_rect.y, image_rect.w, image_rect.h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(138,122,92,0.15)';
    ctx.lineWidth = 1;
    const diagonalSpan = image_rect.w + image_rect.h;
    for (let i = -image_rect.h; i < diagonalSpan; i += 60) {
      ctx.beginPath();
      ctx.moveTo(image_rect.x + i, image_rect.y);
      ctx.lineTo(image_rect.x + i - image_rect.h, image_rect.y + image_rect.h);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 3. 绘制边框元素
  for (const el of elements) {
    drawElement(ctx, el, logos, _config.custom_text ?? '', fieldValues, builtins, scheme, logoVariant);
  }

  // 4. 全局效果（圆角裁剪）— 需要在最外层 clip
  // 圆角裁剪在组件层通过 clip 设置
}

function drawElement(
  ctx: CanvasRenderingContext2D,
  el: ComputedElement,
  logos: Map<string, HTMLImageElement>,
  customText: string,
  fieldValues: ExifFieldValues,
  builtins: readonly LogoRegistryEntry[],
  scheme: string,
  logoVariant: string,
) {
  const { type, rect, anchor, content, style } = el;

  switch (type) {
    case 'text': {
      if (!('chips' in content)) return;
      const text = buildText(content as TextContent, customText, fieldValues);
      if (!text) return;

      const fontWeight = style.bold ? '700' : '400';
      const fontSize = style.font_size ?? 16;
      ctx.save();
      ctx.font = `${fontWeight} ${fontSize}px "AkaSemiNoto", "Microsoft YaHei", sans-serif`;
      ctx.fillStyle = style.color;
      const direction = style.text_direction ?? 'horizontal';
      if (direction === 'rotate-cw' || direction === 'rotate-ccw') {
        // Side-bar is the footer Flow rotated by 90°: rect.h is the available
        // text length, rect.w is its thickness. Respect both exactly so top /
        // bottom endpoints cannot spill outside their slot.
        const origin = anchorOrigin(rect, anchor);
        const measuredWidth = Math.max(1, ctx.measureText(text).width);
        const lengthScale = Math.min(1, rect.h / measuredWidth);
        const drawFontSize = Math.max(1, fontSize * lengthScale);
        ctx.beginPath();
        ctx.rect(origin.x, origin.y, rect.w, rect.h);
        ctx.clip();
        ctx.font = `${fontWeight} ${drawFontSize}px "AkaSemiNoto", "Microsoft YaHei", sans-serif`;
        // Preserve footer endpoint alignment after rotation: top slots grow
        // downward from the top inset; bottom slots grow upward from the bottom.
        const isTop = anchor.includes('top');
        const endpointY = isTop ? origin.y : origin.y + rect.h;
        ctx.translate(origin.x + rect.w / 2, endpointY);
        ctx.rotate(direction === 'rotate-cw' ? Math.PI / 2 : -Math.PI / 2);
        const growsPositive =
          (direction === 'rotate-cw' && isTop) ||
          (direction === 'rotate-ccw' && !isTop);
        ctx.textAlign = growsPositive ? 'left' : 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 0, 0);
      } else if (direction === 'vertical-glyphs') {
        const glyphs = Array.from(text);
        const advance = Math.round(fontSize * style.line_height);
        const startY = rect.y - ((glyphs.length - 1) * advance) / 2;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        glyphs.forEach((glyph, index) => ctx.fillText(glyph, rect.x, startY + index * advance));
      } else {
        ctx.textAlign = anchor.includes('right') ? 'right' : anchor.includes('center') ? 'center' : 'left';
        ctx.textBaseline = anchor.includes('bottom') ? 'bottom' : anchor.includes('middle') ? 'middle' : 'top';
        ctx.fillText(text, rect.x, rect.y);
      }
      ctx.restore();
      break;
    }

    case 'logo': {
      if (!('path' in content)) return;
      const resolved = resolveLogoElementPath(content, fieldValues, builtins, scheme, logoVariant);
      const logoPath = resolveAssetSrc(resolved.path, 'logo', resolved.variant, resolved.dark);
      const img = logoPath ? logos.get(logoPath) : undefined;
      if (img) {
        const origin = anchorOrigin(rect, anchor);
        const orientation = 'orientation' in content ? content.orientation : 'upright';
        if (orientation === 'rotate-cw' || orientation === 'rotate-ccw') {
          ctx.save();
          ctx.translate(rect.x, rect.y);
          ctx.rotate(orientation === 'rotate-cw' ? Math.PI / 2 : -Math.PI / 2);
          drawImageContain(ctx, img, -rect.h / 2, -rect.w / 2, rect.h, rect.w, 'top-left');
          ctx.restore();
        } else {
          drawImageContain(ctx, img, origin.x, origin.y, rect.w, rect.h, anchor);
        }
      } else if (logoPath) {
        // Logo 尚未加载：绘制骨架占位
        drawLogoSkeleton(ctx, rect, anchor);
      }
      // 自动模式无匹配（!logoPath）：不绘制，留空
      break;
    }

    case 'signature': {
      if (!('path' in content) || !content.path) return;
      const sigPath = resolveAssetSrc(content.path, 'signature');
      const img = logos.get(sigPath);
      const origin = anchorOrigin(rect, anchor);
      if (img) {
        drawImageContain(ctx, img, origin.x, origin.y, rect.w, rect.h, anchor);
      } else {
        ctx.fillStyle = '#aaaaaa';
        ctx.fillRect(origin.x, origin.y, rect.w, rect.h);
      }
      break;
    }

    case 'divider': {
      ctx.save();
      ctx.fillStyle = style.color ?? '#888888';
      ctx.globalAlpha = 0.25;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
      break;
    }
  }
}

function drawImageContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  anchor: string,
) {
  const imgRatio = img.naturalWidth / img.naturalHeight;
  const boxRatio = w / h;
  let drawW: number;
  let drawH: number;
  if (boxRatio > imgRatio) {
    // 盒子更宽，按高度缩放
    drawH = h;
    drawW = h * imgRatio;
  } else {
    // 盒子更高或相等，按宽度缩放
    drawW = w;
    drawH = w / imgRatio;
  }

  let drawX = x;
  if (anchor.includes('right')) {
    drawX = x + w - drawW;
  } else if (anchor.includes('center')) {
    drawX = x + (w - drawW) / 2;
  }

  let drawY = y;
  if (anchor.includes('bottom')) {
    drawY = y + h - drawH;
  } else if (anchor.includes('middle')) {
    drawY = y + (h - drawH) / 2;
  }

  ctx.drawImage(img, drawX, drawY, drawW, drawH);
}


function drawLogoSkeleton(
  ctx: CanvasRenderingContext2D,
  rect: ComputedElement['rect'],
  anchor: string,
) {
  const origin = anchorOrigin(rect, anchor);
  const w = Math.max(1, rect.w);
  const h = Math.max(1, rect.h);
  const radius = Math.min(w, h) * 0.12;
  const dash = Math.max(4, Math.round(h * 0.16));
  ctx.save();
  ctx.strokeStyle = 'rgba(128, 128, 128, 0.55)';
  ctx.lineWidth = Math.max(1, Math.round(h * 0.06));
  ctx.setLineDash([dash, dash]);
  ctx.beginPath();
  const x = origin.x + 0.5;
  const y = origin.y + 0.5;
  const right = origin.x + w - 0.5;
  const bottom = origin.y + h - 0.5;
  ctx.moveTo(x + radius, y);
  ctx.lineTo(right - radius, y);
  ctx.quadraticCurveTo(right, y, right, y + radius);
  ctx.lineTo(right, bottom - radius);
  ctx.quadraticCurveTo(right, bottom, right - radius, bottom);
  ctx.lineTo(x + radius, bottom);
  ctx.quadraticCurveTo(x, bottom, x, bottom - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function anchorOrigin(rect: ComputedElement['rect'], anchor: string): { x: number; y: number } {
  const x = anchor.includes('right')
    ? rect.x - rect.w
    : anchor.includes('center')
      ? rect.x - rect.w / 2
      : rect.x;
  const y = anchor.includes('bottom')
    ? rect.y - rect.h
    : anchor.includes('middle')
      ? rect.y - rect.h / 2
      : rect.y;
  return { x, y };
}

// ── 组件 ──────────────────────────────────────────────────────────────

export function KariImprintCanvas({
  config,
  image,
  placeholderAspectRatio = '3:2',
  runtimeCaps,
  fieldValues = {},
  scheme = 'dark',
  logoVariant = '',
}: {
  config: ImprintConfig;
  image: ImageBitmap | null;
  placeholderAspectRatio?: PreviewAspectRatio;
  runtimeCaps?: RuntimeCapabilities | null;
  fieldValues?: ExifFieldValues;
  scheme?: string;
  logoVariant?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [logoImages, setLogoImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const [builtinLogos, setBuiltinLogos] = useState<readonly LogoRegistryEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchLogos()
      .then((entries) => {
        if (!cancelled) setBuiltinLogos(entries.map((e) => ({ stem: e.stem, variants: e.variants })));
      })
      .catch(() => {
        // Silent: an empty registry cleanly downgrades to skeleton via the resolver.
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 确定图片尺寸（无图时使用所选预览比例）
    let sourceW: number, sourceH: number;
    if (image) {
      sourceW = image.width;
      sourceH = image.height;
    } else {
      const ratio = PREVIEW_ASPECT_RATIOS.find(r => r.id === placeholderAspectRatio) ?? PREVIEW_ASPECT_RATIOS[0];
      sourceW = ratio.width;
      sourceH = ratio.height;
    }

    // Never allocate a browser canvas at full camera resolution. Large photos
    // multiplied by DPR can exceed the browser's backing-store limit and make
    // the entire canvas (photo and imprint) silently disappear.
    if (!runtimeCaps) return;
    const previewSize = fitPreviewDimensions(sourceW, sourceH, runtimeCaps.preview.max_edge);
    const imgW = previewSize.width;
    const imgH = previewSize.height;

    // 在 computeLayout 之前解析 auto-logo：
    // - 匹配到 → 填充 path → layout 预留空间 + 推开文字
    // - 未匹配 → disable slot → layout 不产生 logo 元素 → 无空白
    const resolvedConfig = resolveLogoConfig(config, fieldValues, builtinLogos, scheme, logoVariant);
    const layout = computeLayout(resolvedConfig, imgW, imgH);

    // 容器显示尺寸
    const rect = container.getBoundingClientRect();
    const containerW = rect.width;
    const containerH = rect.height;

    // 按 contain 模式在容器内计算缩放后的显示尺寸
    const layoutRatio = layout.canvas.w / layout.canvas.h;
    const containerRatio = containerW / containerH;
    let displayW: number;
    let displayH: number;
    if (containerRatio > layoutRatio) {
      // 容器更宽，按高度缩放
      displayH = containerH;
      displayW = containerH * layoutRatio;
    } else {
      // 容器更高或相等，按宽度缩放
      displayW = containerW;
      displayH = containerW / layoutRatio;
    }

    // 设置 canvas 显示尺寸为 contain 计算结果，居中由外层 flex 保证
    canvas.style.width = `${displayW}px`;
    canvas.style.height = `${displayH}px`;

    // DPR 处理：逻辑分辨率固定为布局尺寸，保证绘制质量
    // A 1600px preview at DPR 2 is already sharp on Retina screens. Capping
    // DPR avoids recreating another oversized backing store on DPR 3+ devices.
    const dpr = Math.min(window.devicePixelRatio || 1, runtimeCaps.preview.device_pixel_ratio_limit);
    canvas.width = layout.canvas.w * dpr;
    canvas.height = layout.canvas.h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 圆角裁剪（如果需要）
    if (config.canvas.border_radius > 0) {
      ctx.save();
      const r = config.canvas.border_radius;
      const cw = layout.canvas.w;
      const ch = layout.canvas.h;
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(cw - r, 0);
      ctx.quadraticCurveTo(cw, 0, cw, r);
      ctx.lineTo(cw, ch - r);
      ctx.quadraticCurveTo(cw, ch, cw - r, ch);
      ctx.lineTo(r, ch);
      ctx.quadraticCurveTo(0, ch, 0, ch - r);
      ctx.lineTo(0, r);
      ctx.quadraticCurveTo(0, 0, r, 0);
      ctx.closePath();
      ctx.clip();
    }

    // 收集需要加载的 logo / 签名路径。对 logo 元素做 auto-Logo 解析，
    // 只有解析到具体品牌资源时才发起加载请求；未解析则由骨架占位处理。
    const logoPaths: string[] = [];
    for (const el of layout.elements) {
      if (el.type === 'signature' && 'path' in el.content && el.content.path) {
        const path = resolveAssetSrc(el.content.path, 'signature');
        if (path && !logoImages.has(path)) logoPaths.push(path);
      } else if (el.type === 'logo' && 'path' in el.content) {
        const resolved = resolveLogoElementPath(el.content, fieldValues, builtinLogos, scheme, logoVariant);
        if (!resolved.path) continue;
        const path = resolveAssetSrc(resolved.path, 'logo', resolved.variant, resolved.dark);
        if (path && !logoImages.has(path)) logoPaths.push(path);
      }
    }

    // 绘制（可能尚未加载 logo，先占位）。Closed ImageBitmap should
    // never reach this point, but a defensive fallback keeps the workspace
    // usable if a stale async render races with file removal.
    try {
      renderCanvas(ctx, layout, image, logoImages, config, fieldValues, builtinLogos, scheme, logoVariant);
    } catch (error) {
      if (image && error instanceof DOMException) {
        renderCanvas(ctx, layout, null, logoImages, config, fieldValues, builtinLogos, scheme, logoVariant);
      } else {
        throw error;
      }
    }

    // 恢复 clip
    if (config.canvas.border_radius > 0) {
      ctx.restore();
    }

    // 异步加载缺失的 logo 并重新渲染
    if (logoPaths.length > 0) {
      Promise.all(logoPaths.map(p => loadLogo(p).then(img => ({ p, img }))))
        .then(results => {
          setLogoImages(prev => {
            const next = new Map(prev);
            for (const { p, img } of results) {
              next.set(p, img);
            }
            return next;
          });
        })
        .catch(() => {
          // 失败时保持占位状态
        });
    }
  }, [config, image, placeholderAspectRatio, logoImages, runtimeCaps, fieldValues, builtinLogos, scheme, logoVariant]);

  return (
    <div ref={containerRef} className="canvas-scaler">
      {!image && <div className="sample-badge">示例预览 · 上传照片后替换</div>}
      <canvas ref={canvasRef} />
    </div>
  );
}
