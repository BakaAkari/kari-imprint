/**
 * Region-Based Layout Engine — 纯函数布局计算（TypeScript 版）
 *
 * 此模块不包含任何 Canvas/DOM 依赖，只负责：
 *   - 输入：ImprintConfig + imageW/H
 *   - 输出：LayoutResult（每个元素在画布上的绝对位置和尺寸）
 *
 * 与 Python 版本共享同一套算法逻辑，通过单元测试保证一致性。
 */

import { BORDER_WIDTH_RATIOS, FONT_SIZE_RATIOS, LOGO_SIZE_RATIOS, SIGNATURE_SIZE_RATIOS } from '../designTokens';

// ── 基础几何 ────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

export function rect(x = 0, y = 0, w = 0, h = 0): Rect {
  return { x, y, w, h };
}

export function rectRight(r: Rect): number { return r.x + r.w; }
export function rectBottom(r: Rect): number { return r.y + r.h; }
export function rectCenterX(r: Rect): number { return r.x + Math.floor(r.w / 2); }
export function rectCenterY(r: Rect): number { return r.y + Math.floor(r.h / 2); }

// ── 配置类型 ────────────────────────────────────────────

export interface MarginsConfig {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BorderConfig {
  enabled: boolean;
  width_level: SizeLevel;  // small/medium/large → 边框宽度档位
  color: string;
}

export interface CanvasConfig {
  margins: MarginsConfig;
  background: string;
  border_radius: number;
  border: BorderConfig;
}

export interface FieldChip {
  field_id: string;
  custom_text?: string;
}

export interface TextContent {
  chips: FieldChip[];
  separator: string;
}

export interface LogoContent {
  path: string;
  size_level: SizeLevel | null;
  size_ratio: number | null;
  orientation: string;
  placement: string;
  track: string;
}

export interface SignatureContent {
  path: string;
  invert_mono: boolean;
  size_level: SizeLevel | null;
  size_ratio: number | null;
  orientation: string;
  placement: string;
  track: string;
}

export type SizeLevel = 'small' | 'medium' | 'large';

export type Content = TextContent | LogoContent | SignatureContent;

export type SizeReference = 'region_height' | 'short_edge' | 'long_edge';

export interface StyleConfig {
  font_size: number | null;
  font_size_level: SizeLevel | null;
  font_size_ratio: number | null;
  size_reference: SizeReference;
  color: string;
  font_family: string;
  bold: boolean;
  line_height: number;
  text_direction: 'horizontal' | 'rotate-cw' | 'rotate-ccw' | 'vertical-glyphs' | null;
}

export interface SlotConfig {
  enabled: boolean;
  content: Content | null;
  style: StyleConfig | null;
}

export type RegionType = 'footer-bar' | 'side-bar' | 'free';

export interface FlowLayoutConfig {
  mode: 'single-track' | 'dual-track';
  main_alignment: 'start' | 'center' | 'end' | 'space-between';
  cross_alignment: 'start' | 'center' | 'end';
  track_order: 'photo-outward' | 'outward-photo';
  track_gap: { mode: 'pixel' | 'short_edge_ratio'; value: number };
  item_gap: { mode: 'pixel' | 'short_edge_ratio'; value: number };
  track_ratios: [number, number];
}

export interface RegionConfig {
  id: string;
  type: RegionType;
  enabled: boolean;
  slots?: Record<string, SlotConfig>;
  edge?: 'left' | 'right';
  width?: { mode: 'pixel' | 'short_edge_ratio'; value: number };
  alignment?: 'start' | 'center' | 'end';
  vertical_alignment?: 'start' | 'center' | 'end';
  padding?: Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;
  layout?: FlowLayoutConfig;
  text_orientation?: 'auto' | 'horizontal' | 'rotate-with-edge' | 'rotate-cw' | 'rotate-ccw' | 'vertical-glyphs';
  anchor?: string;        // 九宫格锚点
  offset_x?: number;
  offset_y?: number;
  offset_unit?: 'pixel' | 'short_edge_ratio';
  /** footer-bar 高度占图片短边的比例；由布局引擎解析为实际像素高度。 */
  height?: number;
}

export interface ImprintConfig {
  schema_version: 3;
  canvas: CanvasConfig;
  regions: RegionConfig[];
  defaults: StyleConfig;
}

// ── 布局结果 ────────────────────────────────────────────

export type ElementType = 'text' | 'logo' | 'signature' | 'divider';

export interface ComputedElement {
  id: string;
  type: ElementType;
  rect: Rect;
  anchor: string;         // 九宫格
  content: Content;
  style: StyleConfig;
}

export interface LayoutResult {
  canvas: Size;
  image_rect: Rect;
  elements: ComputedElement[];
}

// ── Layout Diagnostics ───────────────────────────────────────

export type DiagnosticSeverity = 'error' | 'warning';

export interface DiagnosticItem {
  id: string;
  type: string;
  severity: DiagnosticSeverity;
  message: string;
  elementIds?: string[];
}

export interface LayoutResultWithDiagnostics {
  layout: LayoutResult;
  diagnostics: DiagnosticItem[];
}

// ── 布局引擎 ────────────────────────────────────────────

const DEFAULT_ASSET_ASPECT_RATIO = 3.0;
const ASSET_ASPECT_RATIO_MIN = 0.3;
const ASSET_ASPECT_RATIO_MAX = 6.0;

function resolveAssetAspectRatio(assetAspectRatio: number | undefined): number {
  if (assetAspectRatio === undefined || assetAspectRatio === null) return DEFAULT_ASSET_ASPECT_RATIO;
  if (!Number.isFinite(assetAspectRatio) || assetAspectRatio <= 0) return DEFAULT_ASSET_ASPECT_RATIO;
  return Math.min(ASSET_ASPECT_RATIO_MAX, Math.max(ASSET_ASPECT_RATIO_MIN, assetAspectRatio));
}

/**
 * `assetAspectRatio` is the width/height ratio of the Logo image about to be
 * rendered. Passing it replaces the hard-coded `height × 3` box in horizontal
 * layouts so the reserved slot tracks the real logo aspect ratio. Values are
 * clamped to `[0.3, 6.0]`; `undefined` falls back to the legacy `3.0` constant.
 */
export function computeLayout(
  config: ImprintConfig,
  imageW: number,
  imageH: number,
  assetAspectRatio?: number,
): LayoutResult {
  const aspect = resolveAssetAspectRatio(assetAspectRatio);
  // Step 1: 画布尺寸
  const margins = config.canvas.margins;
  const shortEdge = Math.min(imageW, imageH);
  const longEdge = Math.max(imageW, imageH);

  // footer-bar 的 height 为占短边比例，在此解析为实际像素底部边距
  let hasFooter = false;
  for (const region of config.regions) {
    if (region.enabled && region.type === 'footer-bar' && typeof region.height === 'number') {
      margins.bottom = Math.max(20, Math.round(shortEdge * region.height));
      hasFooter = true;
    }
  }

  // side-bar occupies real canvas space rather than overlaying the photo.
  for (const region of config.regions) {
    if (!region.enabled || region.type !== 'side-bar') continue;
    const sideWidth = resolveSideWidth(region, shortEdge);
    if (region.edge === 'left') margins.left = Math.max(margins.left, sideWidth);
    else margins.right = Math.max(margins.right, sideWidth);
  }

  // 边框：在空白边设置 margins，底部有 footer-bar 时不额外加底边
  if (config.canvas.border?.enabled) {
    const bw = Math.max(1, Math.round(shortEdge * BORDER_WIDTH_RATIOS[config.canvas.border.width_level]));
    if (margins.top === 0) margins.top = bw;
    if (margins.left === 0) margins.left = bw;
    if (margins.right === 0) margins.right = bw;
    if (!hasFooter && margins.bottom === 0) margins.bottom = bw;
  }

  const canvasW = imageW + margins.left + margins.right;
  const canvasH = imageH + margins.top + margins.bottom;

  const imageRect = rect(margins.left, margins.top, imageW, imageH);
  const canvas = { w: canvasW, h: canvasH };

  const elements: ComputedElement[] = [];

  // Step 2: 遍历区域
  for (const region of config.regions) {
    if (!region.enabled) continue;

    switch (region.type) {
      case 'footer-bar':
        elements.push(...computeFooterBar(
          region,
          imageRect,
          canvas,
          config.defaults,
          shortEdge,
          longEdge,
          aspect,
        ));
        break;
      case 'side-bar':
        elements.push(...computeSideBar(region, imageRect, canvas, config.defaults, shortEdge, longEdge, aspect));
        break;
      case 'free':
        elements.push(...computeFree(region, imageRect, config.defaults, shortEdge, longEdge));
        break;
    }
  }

  return { canvas, image_rect: imageRect, elements };
}

export function computeLayoutWithDiagnostics(
  config: ImprintConfig,
  imageW: number,
  imageH: number,
  assetAspectRatio?: number,
): LayoutResultWithDiagnostics {
  const layout = computeLayout(config, imageW, imageH, assetAspectRatio);
  const diagnostics = diagnoseLayout(layout, config);
  return { layout, diagnostics };
}

// ── 各区域类型计算 ─────────────────────────────────

const FLOW_SLOT_ORDER = ['primary-start', 'primary-end', 'secondary-start', 'secondary-end', 'asset'] as const;
type FlowSlot = typeof FLOW_SLOT_ORDER[number];

function flowConfig(region: RegionConfig): FlowLayoutConfig {
  return region.layout ?? {
    mode: 'dual-track', main_alignment: 'space-between', cross_alignment: 'center',
    track_order: 'photo-outward',
    track_gap: { mode: 'short_edge_ratio', value: 0.012 },
    item_gap: { mode: 'short_edge_ratio', value: 0.012 },
    track_ratios: [0.6, 0.4],
  };
}

function resolveWidth(value: { mode: 'pixel' | 'short_edge_ratio'; value: number }, shortEdge: number): number {
  return value.mode === 'pixel' ? Math.round(value.value) : Math.round(shortEdge * value.value);
}

function activeFlowSlots(region: RegionConfig): Record<string, SlotConfig> {
  const slots = region.slots ?? {};
  if (flowConfig(region).mode === 'dual-track') return slots;
  return Object.fromEntries(Object.entries(slots).filter(([id]) => !id.startsWith('secondary-')));
}

function computeFooterBar(
  region: RegionConfig, imageRect: Rect, canvas: Size, defaults: StyleConfig,
  shortEdge: number, longEdge: number, assetAspectRatio: number,
): ComputedElement[] {
  const bounds = rect(0, rectBottom(imageRect), canvas.w, canvas.h - rectBottom(imageRect));
  return computeFlowRegion(region, bounds, defaults, shortEdge, longEdge, 'horizontal', assetAspectRatio);
}

function resolveSideWidth(region: RegionConfig, shortEdge: number): number {
  if (!region.width) return Math.max(40, Math.round(shortEdge * 0.12));
  return region.width.mode === 'pixel'
    ? Math.max(1, Math.round(region.width.value))
    : Math.max(40, Math.round(shortEdge * region.width.value));
}

function computeSideBar(
  region: RegionConfig, imageRect: Rect, canvas: Size, defaults: StyleConfig,
  shortEdge: number, longEdge: number, assetAspectRatio: number,
): ComputedElement[] {
  const bounds = region.edge === 'left'
    ? rect(0, 0, imageRect.x, canvas.h)
    : rect(rectRight(imageRect), 0, canvas.w - rectRight(imageRect), canvas.h);
  return computeFlowRegion(region, bounds, defaults, shortEdge, longEdge, 'vertical', assetAspectRatio);
}

/**
 * A side-bar is the footer grid rotated around its adjacent bottom corner.
 * Right edge rotates clockwise: footer left endpoints become side top.
 * Left edge rotates counter-clockwise: footer right endpoints become side top.
 */
function sideEndpoint(region: RegionConfig, endpoint: 'start' | 'end'): 'start' | 'end' {
  if (region.type !== 'side-bar') return endpoint;
  if (region.edge === 'left') return endpoint === 'start' ? 'end' : 'start';
  return endpoint;
}

function sidePlacement(_region: RegionConfig, placement: string): 'start' | 'center' | 'end' {
  // Logo controls are physical positions in side mode: 上 / 中 / 下.
  // Unlike text endpoints, they do not flip with the rotated footer mapping.
  if (placement === 'start' || placement === 'center') return placement;
  return 'end';
}

function resolveTextDirection(region: RegionConfig, style: StyleConfig): NonNullable<StyleConfig['text_direction']> {
  if (style.text_direction) return style.text_direction;
  const policy = region.text_orientation ?? 'auto';
  if (policy === 'rotate-with-edge' || policy === 'auto') {
    if (region.type === 'side-bar') {
      return region.edge === 'left' ? 'rotate-ccw' : 'rotate-cw';
    }
    return 'horizontal';
  }
  return policy;
}

function resolveAssetOrientation(region: RegionConfig, orientation: string): string {
  if (orientation !== 'follow-flow') return orientation;
  if (region.type === 'side-bar') {
    return region.edge === 'left' ? 'rotate-ccw' : 'rotate-cw';
  }
  return 'upright';
}

function computeFlowRegion(
  region: RegionConfig, bounds: Rect, defaults: StyleConfig,
  shortEdge: number, longEdge: number, flow: 'horizontal' | 'vertical',
  assetAspectRatio: number,
): ComputedElement[] {
  const layout = flowConfig(region);
  const slots = activeFlowSlots(region);
  const padding = {
    top: region.padding?.top ?? Math.max(6, Math.round((flow === 'horizontal' ? bounds.h : bounds.w) * 0.14)),
    right: region.padding?.right ?? Math.max(8, Math.round((flow === 'horizontal' ? bounds.h : bounds.w) * 0.14)),
    bottom: region.padding?.bottom ?? Math.max(6, Math.round((flow === 'horizontal' ? bounds.h : bounds.w) * 0.14)),
    left: region.padding?.left ?? Math.max(8, Math.round((flow === 'horizontal' ? bounds.h : bounds.w) * 0.14)),
  };
  const inner = rect(bounds.x + padding.left, bounds.y + padding.top,
    Math.max(1, bounds.w - padding.left - padding.right),
    Math.max(1, bounds.h - padding.top - padding.bottom));
  const trackGap = Math.max(0, resolveWidth(layout.track_gap, shortEdge));
  const itemGap = Math.max(0, resolveWidth(layout.item_gap, shortEdge));
  const ratios = layout.mode === 'single-track' ? [1, 0] : layout.track_ratios;
  const crossSize = flow === 'horizontal' ? inner.h : inner.w;
  const primarySize = Math.max(1, Math.round((crossSize - (layout.mode === 'dual-track' ? trackGap : 0)) * ratios[0]));
  const secondarySize = Math.max(1, crossSize - primarySize - (layout.mode === 'dual-track' ? trackGap : 0));
  const primaryFirst = layout.track_order === 'photo-outward';
  let primary: Rect;
  let secondary: Rect;
  if (flow === 'horizontal') {
    const firstY = inner.y;
    const secondY = inner.y + (primaryFirst ? primarySize : secondarySize) + trackGap;
    primary = rect(inner.x, primaryFirst ? firstY : secondY, inner.w, primarySize);
    secondary = rect(inner.x, primaryFirst ? secondY : firstY, inner.w, secondarySize);
  } else {
    // Rotated-footer semantics: 'photo-outward' puts the primary (former upper)
    // track on the outer edge away from the photo; 'outward-photo' flips it so
    // the primary track sits adjacent to the photo.
    const primaryOnOuter = layout.track_order === 'photo-outward';
    const outerIsLeft = region.edge === 'left';
    const primaryOnLeft = primaryOnOuter ? outerIsLeft : !outerIsLeft;
    const firstX = inner.x;
    const secondX = inner.x + (primaryOnLeft ? primarySize : secondarySize) + trackGap;
    primary = rect(primaryOnLeft ? firstX : secondX, inner.y, primarySize, inner.h);
    secondary = rect(primaryOnLeft ? secondX : firstX, inner.y, secondarySize, inner.h);
  }
  const trackRects: Record<'primary' | 'secondary', Rect> = { primary, secondary };
  const elements: ComputedElement[] = [];

  // 为 Logo/asset 预留空间，避免文字与 logo 重叠
  let logoStartReserve = 0;
  let logoCenterReserve = 0;
  let logoEndReserve = 0;
  let hasDivider = false;
  let dividerStartReserve = 0;
  let dividerEndReserve = 0;
  const asset = slots.asset;
  // Logo 空间预留由上层（Canvas）在 computeLayout 之前解析 auto-logo 后决定：
  // 匹配到 → path 已填充 → 预留；未匹配 → slot disabled → 不预留。
  if (asset?.enabled && asset.content && isLogoContent(asset.content)) {
    const sizeRef = flow === 'horizontal' ? bounds.h : bounds.w;
    const logoSize = resolveLogoSize(asset.content, sizeRef);
    const logoDim = flow === 'horizontal'
      ? Math.min(inner.w, Math.round(logoSize * assetAspectRatio))
      : Math.min(inner.h, Math.round(logoSize / assetAspectRatio));
    const physicalPlacement = flow === 'vertical'
      ? sidePlacement(region, asset.content.placement)
      : asset.content.placement;
    const dividerW = Math.max(1, Math.round(shortEdge * 0.001));
    if (physicalPlacement === 'end') {
      // Keep a real gap on both sides of an edge logo: the old reserve put
      // the divider directly against the logo while leaving only the outer
      // padding visible.
      logoEndReserve = logoDim + dividerW + itemGap * 2;
    } else if (physicalPlacement === 'start') {
      logoStartReserve = logoDim + dividerW + itemGap * 2;
    } else {
      logoCenterReserve = logoDim + itemGap * 2;
    }
    // Divider: thin subtle line between logo and text when logo is on edge
    if (physicalPlacement === 'start' || physicalPlacement === 'end') {
      hasDivider = true;
      if (physicalPlacement === 'start') {
        dividerStartReserve = dividerW + itemGap;
        logoStartReserve = logoDim + dividerW + itemGap * 2;
      } else {
        dividerEndReserve = dividerW + itemGap;
        logoEndReserve = logoDim + dividerW + itemGap * 2;
      }
    }
  }

  for (const trackName of ['primary', 'secondary'] as const) {
    if (trackName === 'secondary' && layout.mode === 'single-track') continue;
    const track = trackRects[trackName];
    for (const endpoint of ['start', 'end'] as const) {
      const slotId = `${trackName}-${endpoint}` as FlowSlot;
      const slot = slots[slotId];
      if (!slot?.enabled || !slot.content) continue;
      const style = mergeStyle(defaults, slot.style);
      style.text_direction = resolveTextDirection(region, style);
      const ref = flow === 'horizontal' ? bounds.h : bounds.w;
      const fontSize = resolveFontSize(style, ref, shortEdge, longEdge);
      const physicalEndpoint = flow === 'vertical' ? sideEndpoint(region, endpoint) : endpoint;
      const anchor = flow === 'horizontal'
        ? (endpoint === 'start' ? 'middle-left' : 'middle-right')
        : (physicalEndpoint === 'start' ? 'top-center' : 'bottom-center');
      const slotBounds = flow === 'horizontal'
        ? (endpoint === 'start'
          ? rect(track.x + logoStartReserve, track.y,
              Math.max(1, Math.floor((track.w - logoCenterReserve) / 2) - itemGap - logoStartReserve), track.h)
          : rect(track.x + Math.floor((track.w + logoCenterReserve) / 2) + itemGap, track.y,
              Math.max(1, Math.floor((track.w - logoCenterReserve) / 2) - itemGap - logoEndReserve), track.h))
        : (physicalEndpoint === 'start'
          ? rect(track.x, track.y + logoStartReserve,
              track.w, Math.max(1, Math.floor((track.h - logoCenterReserve) / 2) - itemGap - logoStartReserve))
          : rect(track.x, track.y + Math.floor((track.h + logoCenterReserve) / 2) + itemGap,
              track.w, Math.max(1, Math.floor((track.h - logoCenterReserve) / 2) - itemGap - logoEndReserve)));
      const pos = applyAnchor(slotBounds, anchor);
      if (isTextContent(slot.content) && slot.content.chips.length > 0) {
        elements.push({ id: `${region.id}-${slotId}`, type: 'text', rect: rect(pos.x, pos.y, slotBounds.w, slotBounds.h),
          anchor, content: slot.content, style: withFontSize(style, fontSize) });
      }
    }
  }
  if (hasDivider && asset?.enabled && asset.content && isLogoContent(asset.content)) {
    const sizeRef = flow === 'horizontal' ? bounds.h : bounds.w;
    const logoH = resolveLogoSize(asset.content, sizeRef);
    const logoDim = flow === 'horizontal'
      ? Math.min(inner.w, Math.round(logoH * assetAspectRatio))
      : Math.min(inner.h, Math.round(logoH / assetAspectRatio));
    const physicalPlacement = flow === 'vertical'
      ? sidePlacement(region, asset.content.placement)
      : asset.content.placement;
    const dividerW = Math.max(1, Math.round(shortEdge * 0.001));
    const emptyContent: Content = { chips: [], separator: '' };
    if (flow === 'horizontal') {
      if (physicalPlacement === 'start') {
        const divX = inner.x + itemGap + logoDim + itemGap;
        elements.push({ id: `${region.id}-divider`, type: 'divider',
          rect: rect(divX, inner.y, dividerW, inner.h), anchor: 'middle-center', content: emptyContent, style: defaults });
      } else {
        const divX = inner.x + inner.w - itemGap - logoDim - itemGap - dividerW;
        elements.push({ id: `${region.id}-divider`, type: 'divider',
          rect: rect(divX, inner.y, dividerW, inner.h), anchor: 'middle-center', content: emptyContent, style: defaults });
      }
    } else {
      if (physicalPlacement === 'start') {
        // Symmetric: itemGap above the logo and itemGap below it (between logo
        // and divider), mirroring the horizontal layout.
        const divY = inner.y + itemGap + logoDim + itemGap;
        elements.push({ id: `${region.id}-divider`, type: 'divider',
          rect: rect(inner.x, divY, inner.w, dividerW), anchor: 'middle-center', content: emptyContent, style: defaults });
      } else {
        const divY = inner.y + inner.h - itemGap - logoDim - itemGap - dividerW;
        elements.push({ id: `${region.id}-divider`, type: 'divider',
          rect: rect(inner.x, divY, inner.w, dividerW), anchor: 'middle-center', content: emptyContent, style: defaults });
      }
    }
  }
  if (asset?.enabled && asset.content && isLogoContent(asset.content)) {
    const sizeRef = flow === 'horizontal' ? bounds.h : bounds.w;
    const logoH = resolveLogoSize(asset.content, sizeRef);
    const physicalPlacement = flow === 'vertical'
      ? sidePlacement(region, asset.content.placement)
      : asset.content.placement;
    const anchor = flow === 'horizontal'
      ? (asset.content.placement === 'start' ? 'middle-left' : asset.content.placement === 'end' ? 'middle-right' : 'middle-center')
      : (physicalPlacement === 'start' ? 'top-center' : physicalPlacement === 'end' ? 'bottom-center' : 'middle-center');
    const assetBounds = flow === 'horizontal'
      ? physicalPlacement === 'start'
        ? rect(inner.x + itemGap, inner.y, Math.max(1, inner.w - itemGap), inner.h)
        : physicalPlacement === 'end'
          ? rect(inner.x, inner.y, Math.max(1, inner.w - itemGap), inner.h)
          : inner
      : physicalPlacement === 'start'
        ? rect(inner.x, inner.y + itemGap, inner.w, Math.max(1, inner.h - itemGap))
        : physicalPlacement === 'end'
          ? rect(inner.x, inner.y, inner.w, Math.max(1, inner.h - itemGap))
          : inner;
    const pos = applyAnchor(assetBounds, anchor);
    const content = { ...asset.content, orientation: resolveAssetOrientation(region, asset.content.orientation) };
    const assetW = flow === 'horizontal'
      ? Math.min(inner.w, Math.round(logoH * assetAspectRatio))
      : Math.min(inner.w, logoH);
    const assetH = flow === 'horizontal'
      ? logoH
      : Math.min(inner.h, Math.round(logoH / assetAspectRatio));
    elements.push({ id: `${region.id}-asset`, type: 'logo', rect: rect(pos.x, pos.y, assetW, assetH),
      anchor, content, style: defaults });
  }
  return elements;
}

function computeFree(
  region: RegionConfig,
  imageRect: Rect,
  defaults: StyleConfig,
  shortEdge: number,
  _longEdge: number,
): ComputedElement[] {
  const elements: ComputedElement[] = [];

  const anchor = region.anchor ?? 'middle-center';
  const anchorX = imageRect.x + imageRect.w * anchorCol(anchor);
  const anchorY = imageRect.y + imageRect.h * anchorRow(anchor);

  const offsetUnit = region.offset_unit === 'short_edge_ratio' ? shortEdge : 1;
  const finalX = anchorX + Math.round((region.offset_x ?? 0) * offsetUnit);
  const finalY = anchorY + Math.round((region.offset_y ?? 0) * offsetUnit);

  if (region.slots) {
    for (const [slotId, slot] of Object.entries(region.slots)) {
      if (!slot.enabled || !slot.content) continue;

      const style = mergeStyle(defaults, slot.style);

      if (isSignatureContent(slot.content)) {
        const sigRatio = slot.content.size_ratio ?? SIGNATURE_SIZE_RATIOS[slot.content.size_level ?? 'medium'];
        const sigH = Math.round(shortEdge * sigRatio);
        elements.push({
          id: `${region.id}-${slotId}`,
          type: 'signature',
          rect: rect(finalX, finalY, sigH, sigH),
          anchor,
          content: slot.content,
          style,
        });
      }
    }
  }

  return elements;
}

// ── Layout Diagnostics 实现 ──────────────────────────────────────

export function diagnoseLayout(layout: LayoutResult, _config: ImprintConfig): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];
  const { canvas, elements } = layout;

  // 1. 重叠
  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const a = elements[i];
      const b = elements[j];
      if (rectsOverlap(a.rect, b.rect)) {
        diagnostics.push({
          id: `overlap-${a.id}-${b.id}`,
          type: 'overlap',
          severity: 'error',
          message: `${a.id} 与 ${b.id} 重叠`,
          elementIds: [a.id, b.id],
        });
      }
    }
  }

  // 2. 越界
  for (const el of elements) {
    if (
      el.rect.x < 0 ||
      el.rect.y < 0 ||
      rectRight(el.rect) > canvas.w ||
      rectBottom(el.rect) > canvas.h
    ) {
      diagnostics.push({
        id: `oob-${el.id}`,
        type: 'out-of-bounds',
        severity: 'error',
        message: `${el.id} 越出画布`,
        elementIds: [el.id],
      });
    }
  }

  // 3. 空内容 / 缺资源
  for (const el of elements) {
    if (el.type === 'text') {
      if (isTextContent(el.content)) {
        const nonEmpty = el.content.chips.filter((c) => c.field_id !== 'empty').length > 0;
        if (!nonEmpty) {
          diagnostics.push({
            id: `empty-${el.id}`,
            type: 'empty-enabled-slot',
            severity: 'warning',
            message: `${el.id} 已启用但没有字段`,
            elementIds: [el.id],
          });
        }
      }
    } else if (el.type === 'logo') {
      if (isLogoContent(el.content) && el.content.path === '') {
        // 自动 logo，不算警告
      }
    } else if (el.type === 'signature') {
      if (isSignatureContent(el.content) && el.content.path === '') {
        diagnostics.push({
          id: `missing-sig-${el.id}`,
          type: 'missing-resource',
          severity: 'warning',
          message: `${el.id} 未上传签名`,
          elementIds: [el.id],
        });
      }
    }
  }

  // 4. 字号过大
  for (const el of elements) {
    if (el.type === 'text' && el.style.font_size && el.style.font_size > el.rect.h) {
      diagnostics.push({
        id: `font-large-${el.id}`,
        type: 'font-too-large',
        severity: 'warning',
        message: `${el.id} 字号超过 slot 高度`,
        elementIds: [el.id],
      });
    }
  }

  return diagnostics;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return !(
    rectRight(a) <= b.x ||
    a.x >= rectRight(b) ||
    rectBottom(a) <= b.y ||
    a.y >= rectBottom(b)
  );
}

// ── 辅助函数 ────────────────────────────────────────────

function resolveFontSize(
  style: StyleConfig,
  regionHeight: number,
  shortEdge: number,
  longEdge: number,
): number {
  if (style.font_size !== null && style.font_size > 0) {
    return style.font_size;
  }

  const ratio = style.font_size_ratio ?? FONT_SIZE_RATIOS[style.font_size_level ?? 'medium'];

  let ref: number;
  switch (style.size_reference) {
    case 'short_edge':
      ref = shortEdge;
      break;
    case 'long_edge':
      ref = longEdge;
      break;
    default:
      ref = regionHeight;
  }

  return Math.max(8, Math.round(ref * ratio));
}

function resolveLogoSize(content: LogoContent, regionHeight: number): number {
  // Logo 高度按所在区域高度的 size_ratio 缩放，默认使用中号 token，随底栏/边框条高度变化
  const ratio = content.size_ratio ?? LOGO_SIZE_RATIOS[content.size_level ?? 'medium'];
  return Math.max(16, Math.round(regionHeight * ratio));
}

function mergeStyle(defaults: StyleConfig, override: StyleConfig | null): StyleConfig {
  if (!override) {
    return {
      font_size: defaults.font_size,
      font_size_level: defaults.font_size_level,
      font_size_ratio: defaults.font_size_ratio,
      size_reference: defaults.size_reference,
      color: defaults.color,
      font_family: defaults.font_family,
      bold: defaults.bold,
      line_height: defaults.line_height,
      text_direction: defaults.text_direction,
    };
  }
  return {
    font_size: override.font_size !== null ? override.font_size : defaults.font_size,
    font_size_level: override.font_size_level !== null ? override.font_size_level : defaults.font_size_level,
    font_size_ratio: override.font_size_ratio !== null ? override.font_size_ratio : defaults.font_size_ratio,
    size_reference: override.size_reference || defaults.size_reference,
    color: override.color || defaults.color,
    font_family: override.font_family || defaults.font_family,
    bold: override.bold,
    line_height: override.line_height || defaults.line_height,
    text_direction: override.text_direction || defaults.text_direction,
  };
}

function withFontSize(style: StyleConfig, fontSize: number): StyleConfig {
  return {
    font_size: fontSize,
    font_size_level: null,
    font_size_ratio: null,
    size_reference: style.size_reference,
    color: style.color,
    font_family: style.font_family,
    bold: style.bold,
    line_height: style.line_height,
    text_direction: style.text_direction,
  };
}

function anchorCol(anchor: string): number {
  if (anchor.includes('left')) return 0.0;
  if (anchor.includes('right')) return 1.0;
  return 0.5;
}

function anchorRow(anchor: string): number {
  if (anchor.includes('top')) return 0.0;
  if (anchor.includes('bottom')) return 1.0;
  return 0.5;
}

function applyAnchor(bounds: Rect, anchor: string): Point {
  let ax = bounds.x;
  if (anchor.includes('center') || anchor.includes('right')) {
    ax = anchor.includes('center') ? rectCenterX(bounds) : rectRight(bounds);
  }

  let ay = bounds.y;
  if (anchor.includes('middle') || anchor.includes('bottom')) {
    ay = anchor.includes('middle') ? rectCenterY(bounds) : rectBottom(bounds);
  }

  return { x: ax, y: ay };
}

// ── 类型守卫 ────────────────────────────────────────────

function isTextContent(c: Content): c is TextContent {
  return 'chips' in c && 'separator' in c;
}

function isLogoContent(c: Content): c is LogoContent {
  return 'path' in c && !('invert_mono' in c);
}

function isSignatureContent(c: Content): c is SignatureContent {
  return 'path' in c && 'invert_mono' in c;
}
