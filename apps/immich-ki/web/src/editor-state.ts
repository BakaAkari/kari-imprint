import { defaultFlowLayout, normalizeStylePatch, type FieldId, type FlowLayoutConfig, type ImprintConfig, type RegionConfig, type SizeLevel, type SlotConfig, type StyleConfig } from '../../../web/src/types';
import { buildStyleConfig, canvasEffect, DEFAULT_FRAME_MARGIN, marginsForFrame, withCanvasEffect, type FrameSide, type StylePresetId } from './defaults';

// The draft is the persisted model. Rendering controls never materialize defaults.
export const editableConfig = (value: ImprintConfig): ImprintConfig => structuredClone(value);
export const serializeEditorConfig = (value: ImprintConfig): ImprintConfig => structuredClone(value);

/** Stable comparison used for dirty tracking (key order is produced by our own builders). */
export const sameConfig = (a: ImprintConfig | null, b: ImprintConfig | null): boolean =>
    JSON.stringify(a) === JSON.stringify(b);

export type FramePosition = FrameSide;
export type BrandMode = 'off' | 'auto' | string;

/** Current selection: a text line, the logo, the signature, or nothing. */
export type Selection =
    | { kind: 'text'; regionId: string; slotId: string }
    | { kind: 'brand'; regionId: string }
    | { kind: 'signature'; regionId: string; slotId: string };

const LOGO_CONTENT = (path: string, size_level: SizeLevel = 'medium') =>
    ({ path, size_level, size_ratio: null, orientation: 'upright' as const, placement: 'end' as const, track: 'span' as const });

const mapRegion = (config: ImprintConfig, id: string, update: (region: RegionConfig) => RegionConfig): ImprintConfig =>
    ({ ...config, regions: config.regions.map(region => region.id === id ? update(region) : region) });

// ── 信息条 ───────────────────────────────────────────────────────────

/** The single information frame (footer-bar / side-bar). */
export function frameRegion(config: ImprintConfig): RegionConfig | null {
    return config.regions.find(region => region.type !== 'free') ?? null;
}

export function framePosition(config: ImprintConfig): FramePosition {
    const region = frameRegion(config);
    if (region?.type === 'side-bar') return region.edge === 'left' ? 'left' : 'right';
    return 'footer';
}

/** Width/height of the frame as a ratio of the photo's short edge. */
export function frameThickness(config: ImprintConfig): number {
    const region = frameRegion(config);
    if (!region) return 0;
    if (region.type === 'footer-bar') return region.height ?? 0.15;
    return region.width?.mode === 'short_edge_ratio' ? region.width.value : 0.15;
}

export function setFrameThickness(config: ImprintConfig, value: number): ImprintConfig {
    const region = frameRegion(config);
    if (!region) return config;
    const ratio = Math.min(0.3, Math.max(0.05, Math.round(value * 1000) / 1000));
    return mapRegion(config, region.id, r => r.type === 'footer-bar'
        ? { ...r, height: ratio }
        : { ...r, width: { mode: 'short_edge_ratio', value: ratio } });
}

function moveRegion(region: RegionConfig, position: FramePosition, thickness: number): RegionConfig {
    const next = { ...region };
    if (position === 'footer') {
        next.type = 'footer-bar';
        next.height = thickness;
        delete next.edge;
        delete next.width;
    } else {
        next.type = 'side-bar';
        next.edge = position;
        next.width = { mode: 'short_edge_ratio', value: thickness };
        delete next.height;
    }
    next.layout ??= defaultFlowLayout();
    return next;
}

/** Space on the non-frame sides, in source pixels. */
export function marginValue(config: ImprintConfig): number {
    const m = config.canvas.margins;
    if (!frameRegion(config)) return Math.max(m.top, m.right, m.bottom, m.left);
    const position = framePosition(config);
    return position === 'footer' ? m.top : position === 'left' ? m.right : m.left;
}

/** Set the same margin on the three non-frame sides (all four sides without a frame). */
export function setMarginValue(config: ImprintConfig, value: number): ImprintConfig {
    const px = Math.min(4000, Math.max(0, Math.round(value)));
    const margins = frameRegion(config)
        ? marginsForFrame(framePosition(config), px)
        : { top: px, right: px, bottom: px, left: px };
    return { ...config, canvas: { ...config.canvas, margins } };
}

/** Move the single frame; the white space value is preserved. Without a frame this is a no-op. */
export function setFramePosition(config: ImprintConfig, position: FramePosition): ImprintConfig {
    const region = frameRegion(config);
    if (!region) return config;
    const margin = marginValue(config);
    const thickness = frameThickness(config);
    return {
        ...config,
        canvas: { ...config.canvas, margins: marginsForFrame(position, margin) },
        regions: config.regions.map(r => (r.type !== 'free' ? moveRegion(r, position, thickness) : r)),
    };
}

export function frameLayout(config: ImprintConfig): FlowLayoutConfig {
    return frameRegion(config)?.layout ?? defaultFlowLayout();
}

export function patchFrameLayout(config: ImprintConfig, patch: Partial<FlowLayoutConfig>): ImprintConfig {
    const region = frameRegion(config);
    if (!region) return config;
    return mapRegion(config, region.id, r => ({ ...r, layout: { ...(r.layout ?? defaultFlowLayout()), ...patch } }));
}

// ── 样式 ─────────────────────────────────────────────────────────────

/** Infer the product style from the configuration structure. */
export function detectStyle(config: ImprintConfig): StylePresetId {
    const region = frameRegion(config);
    if (canvasEffect(config).background === 'blur') return 'blur';
    if (!region) return 'plain';
    if ((region.layout?.mode ?? 'dual-track') === 'single-track') return 'minimal';
    return isDark(config.canvas.background) ? 'dark' : 'classic';
}

export function isDark(hex: string): boolean {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!match) return false;
    const n = parseInt(match[1], 16);
    const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
    return lum < 0.18;
}

/**
 * Switch style while keeping choices that are orthogonal to it: frame
 * position, frame thickness, brand choice, signature and the white-space
 * value (except when entering/leaving the blur style, whose space is part
 * of the look).
 */
export function applyStylePreset(config: ImprintConfig, id: StylePresetId, shortEdge?: number): ImprintConfig {
    let next = buildStyleConfig(id, shortEdge);
    const currentStyle = detectStyle(config);
    const hadFrame = frameRegion(config);
    if (hadFrame && frameRegion(next)) {
        next = setFramePosition(next, framePosition(config));
        if (currentStyle !== 'minimal' && id !== 'minimal') next = setFrameThickness(next, frameThickness(config));
        const brand = brandMode(config);
        if (brandMode(next) !== 'off' && brand !== 'off') next = setBrandMode(next, brand, logoSize(config));
    }
    if (currentStyle !== 'blur' && id !== 'blur') next = setMarginValue(next, marginValue(config));
    const signature = signatureRegion(config);
    if (signature) next = { ...next, regions: [...next.regions.filter(r => r.type !== 'free'), structuredClone(signature)] };
    return next;
}

// ── 文字行 ───────────────────────────────────────────────────────────

const TEXT_SLOT_ORDER = ['primary-start', 'primary-end', 'secondary-start', 'secondary-end'] as const;
export type TextSlotId = typeof TEXT_SLOT_ORDER[number];

export function lineLabel(config: ImprintConfig, slotId: string): string {
    const region = frameRegion(config);
    const single = (region?.layout?.mode ?? 'dual-track') === 'single-track';
    const horizontal = region?.type !== 'side-bar';
    const track = slotId.startsWith('primary') ? (single ? '' : horizontal ? '上行' : '内侧行') : (horizontal ? '下行' : '外侧行');
    const end = slotId.endsWith('end');
    const side = horizontal ? (end ? '右' : '左') : (end ? '下端' : '上端');
    return single ? `${end ? (horizontal ? '右侧' : '下端') : (horizontal ? '左侧' : '上端')}文字` : `${track} · ${side}`;
}

/** Text slots the user may fill: start slots always, end slots only when no logo takes that end. */
export function availableLines(config: ImprintConfig): TextSlotId[] {
    const region = frameRegion(config);
    if (!region) return [];
    const single = (region.layout?.mode ?? 'dual-track') === 'single-track';
    const logoOn = Boolean(region.slots?.asset?.enabled);
    return TEXT_SLOT_ORDER.filter(id => (!single || id.startsWith('primary')) && (!id.endsWith('end') || !logoOn || Boolean(region.slots?.[id]?.enabled)));
}

export function lineFields(config: ImprintConfig, slotId: string): FieldId[] {
    const slot = frameRegion(config)?.slots?.[slotId];
    if (!slot?.enabled) return [];
    const content = slot.content;
    return content && 'chips' in content ? content.chips.map(chip => chip.field_id) : [];
}

export function lineStyle(config: ImprintConfig, slotId: string): StyleConfig {
    return frameRegion(config)?.slots?.[slotId]?.style ?? config.defaults;
}

export function setLineFields(config: ImprintConfig, slotId: string, fields: FieldId[]): ImprintConfig {
    const region = frameRegion(config);
    if (!region) return config;
    return mapRegion(config, region.id, r => {
        const existing = r.slots?.[slotId];
        const style = existing?.style ?? { ...config.defaults, bold: false, font_family: 'NotoSansCJKsc-Regular.otf' as const };
        const separator = existing?.content && 'chips' in existing.content ? existing.content.separator : ' ';
        const slot: SlotConfig = { enabled: fields.length > 0, style, content: { chips: fields.map(field_id => ({ field_id })), separator } };
        return { ...r, slots: { ...r.slots, [slotId]: slot } };
    });
}

/** Toggle a field on one line; a field lives on one line only, so it is removed from the others. */
export function toggleLineField(config: ImprintConfig, slotId: string, field: FieldId): ImprintConfig {
    const current = lineFields(config, slotId);
    if (current.includes(field)) return setLineFields(config, slotId, current.filter(f => f !== field));
    let next = config;
    for (const other of TEXT_SLOT_ORDER) {
        if (other === slotId) continue;
        const fields = lineFields(next, other);
        if (fields.includes(field)) next = setLineFields(next, other, fields.filter(f => f !== field));
    }
    return setLineFields(next, slotId, [...current, field]);
}

export function moveLineField(config: ImprintConfig, slotId: string, index: number, delta: number): ImprintConfig {
    const fields = [...lineFields(config, slotId)];
    const target = index + delta;
    if (target < 0 || target >= fields.length) return config;
    [fields[index], fields[target]] = [fields[target], fields[index]];
    return setLineFields(config, slotId, fields);
}

export function patchLineStyle(config: ImprintConfig, slotId: string, patch: Partial<StyleConfig>): ImprintConfig {
    const region = frameRegion(config);
    const slot = region?.slots?.[slotId];
    if (!region || !slot) return config;
    const next = normalizeStylePatch(slot.style ?? config.defaults, patch);
    if (patch.bold !== undefined) next.font_family = patch.bold ? 'NotoSansCJKsc-Bold.otf' : 'NotoSansCJKsc-Regular.otf';
    return mapRegion(config, region.id, r => ({ ...r, slots: { ...r.slots, [slotId]: { ...slot, style: next } } }));
}

// ── 品牌 ─────────────────────────────────────────────────────────────

export function logoSlot(config: ImprintConfig): { regionId: string; slot: SlotConfig } | null {
    const region = frameRegion(config);
    const slot = region?.slots?.asset;
    return region && slot ? { regionId: region.id, slot } : null;
}

/** 'off', 'auto', a builtin stem, or 'custom' for an uploaded resource. */
export function brandMode(config: ImprintConfig): BrandMode {
    const found = logoSlot(config);
    if (!found?.slot.enabled) return 'off';
    const content = found.slot.content;
    const path = content && 'path' in content ? content.path : '';
    if (!path) return 'auto';
    return path.startsWith('builtin:') ? path.slice('builtin:'.length) : 'custom';
}

export function logoSize(config: ImprintConfig): SizeLevel {
    const content = logoSlot(config)?.slot.content;
    return content && 'path' in content && content.size_level ? content.size_level : 'medium';
}

/** Set the brand: 'off' disables the logo, 'auto' resolves from EXIF, otherwise a builtin stem. */
export function setBrandMode(config: ImprintConfig, mode: BrandMode, size: SizeLevel = logoSize(config)): ImprintConfig {
    const region = frameRegion(config);
    if (!region) return config;
    if (mode === 'custom') return config;
    const slot: SlotConfig = mode === 'off'
        ? { enabled: false, style: null, content: null }
        : { enabled: true, style: null, content: LOGO_CONTENT(mode === 'auto' ? '' : `builtin:${mode}`, size) };
    return mapRegion(config, region.id, r => ({ ...r, slots: { ...r.slots, asset: slot } }));
}

export function setCustomLogo(config: ImprintConfig, resourceId: string): ImprintConfig {
    const region = frameRegion(config);
    if (!region) return config;
    return mapRegion(config, region.id, r => ({ ...r, slots: { ...r.slots, asset: { enabled: true, style: null, content: LOGO_CONTENT(resourceId, logoSize(config)) } } }));
}

export function setLogoSize(config: ImprintConfig, size: SizeLevel): ImprintConfig {
    const found = logoSlot(config);
    const content = found?.slot.content;
    if (!found || !content || !('path' in content) || 'invert_mono' in content) return config;
    return mapRegion(config, found.regionId, r => ({ ...r, slots: { ...r.slots, asset: { ...found.slot, content: { ...content, size_level: size, size_ratio: null } } } }));
}

// ── 署名 ─────────────────────────────────────────────────────────────

export function signatureRegion(config: ImprintConfig): RegionConfig | null {
    return config.regions.find(region => region.type === 'free') ?? null;
}

export type SignatureState = { enabled: boolean; path: string; size: SizeLevel };

export function signatureState(config: ImprintConfig): SignatureState {
    const region = signatureRegion(config);
    const content = region?.slots?.sig1?.content;
    const path = content && 'path' in content ? content.path : '';
    const size = content && 'invert_mono' in content && content.size_level ? content.size_level : 'small';
    return { enabled: Boolean(region?.enabled && path), path, size };
}

/** Write the signature region; a signature without an uploaded graphic is never enabled. */
export function setSignature(config: ImprintConfig, patch: Partial<SignatureState>): ImprintConfig {
    const state = { ...signatureState(config), ...patch };
    const enabled = state.enabled && Boolean(state.path);
    const others = config.regions.filter(r => r.type !== 'free');
    if (!state.path) return { ...config, regions: others };
    const existing = signatureRegion(config);
    const region: RegionConfig = {
        id: existing?.id ?? 'signature', type: 'free', enabled,
        anchor: existing?.anchor ?? 'bottom-right', offset_x: existing?.offset_x ?? -0.02, offset_y: existing?.offset_y ?? -0.02, offset_unit: 'short_edge_ratio',
        slots: { sig1: { enabled, style: null, content: { path: state.path, invert_mono: false, size_level: state.size, size_ratio: null, orientation: 'upright', placement: 'end', track: 'span' } } },
    };
    return { ...config, regions: [...others, region] };
}

// ── 背景与效果 ───────────────────────────────────────────────────────

export function setBackground(config: ImprintConfig, color: string): ImprintConfig {
    return { ...config, canvas: { ...config.canvas, background: color.toUpperCase() } };
}

export { canvasEffect, withCanvasEffect, DEFAULT_FRAME_MARGIN };

// ── 选择 ─────────────────────────────────────────────────────────────

/** Map a layout element id to a selection target. */
export function selectionFromElementId(elementId: string, config: ImprintConfig): Selection | null {
    if (elementId.endsWith('-divider')) return { kind: 'brand', regionId: elementId.slice(0, -'-divider'.length) };
    for (const region of config.regions) {
        if (elementId === `${region.id}-asset`) return { kind: 'brand', regionId: region.id };
        if (elementId.startsWith(region.id + '-')) {
            const slotId = elementId.slice(region.id.length + 1);
            if (region.type === 'free') return { kind: 'signature', regionId: region.id, slotId };
            return { kind: 'text', regionId: region.id, slotId };
        }
    }
    return null;
}

export function selectionElementId(selection: Selection | null): string | null {
    if (!selection) return null;
    return `${selection.regionId}-${selection.kind === 'brand' ? 'asset' : selection.slotId}`;
}
