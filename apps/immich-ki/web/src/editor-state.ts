import { defaultFlowLayout, type FieldId, type ImprintConfig, type RegionConfig, type SlotConfig } from '../../../web/src/types';
import { buildDefaultConfig, buildStyleConfig, marginsForFrame, type StylePresetId } from './defaults';
// The draft is the persisted model. Rendering controls never materializes defaults.
export const editableConfig = (value: ImprintConfig): ImprintConfig => structuredClone(value);
export const serializeEditorConfig = (value: ImprintConfig): ImprintConfig => structuredClone(value);
export function emptySlot(id: string, free = false): SlotConfig {
    return { enabled: false, style: null, content: free
            ? { path: '', invert_mono: false, size_level: 'small', size_ratio: null, orientation: 'upright', placement: 'end', track: 'span' }
            : id === 'asset'
                ? { path: '', size_level: 'medium', size_ratio: null, orientation: 'upright', placement: 'end', track: 'span' }
                : { chips: [], separator: ' ' } };
}
export function updateSlot(config: ImprintConfig, regionId: string, slotId: string, patch: Partial<SlotConfig>): ImprintConfig {
    return { ...config, regions: config.regions.map(region => region.id !== regionId ? region : {
            ...region, slots: { ...region.slots, [slotId]: { ...(region.slots?.[slotId] ?? emptySlot(slotId, region.type === 'free')), ...patch } },
        }) };
}
export function addRegion(config: ImprintConfig, signature = false): ImprintConfig {
    // The product model has one shared frame only.  Signatures remain
    // independent free-position decorations, but a second frame would make
    // the visual hierarchy ambiguous and is not supported by the editor.
    if (!signature && config.regions.some(region => region.type !== 'free')) return config;
    let id = signature ? 'signature' : 'footer';
    while (config.regions.some(region => region.id === id))
        id += '-new';
    const region: RegionConfig = signature
        ? { id, type: 'free', enabled: true, anchor: 'bottom-right', offset_x: -0.02, offset_y: -0.02, offset_unit: 'short_edge_ratio', slots: { sig1: { ...emptySlot('sig1', true), enabled: true } } }
        : { ...structuredClone(buildDefaultConfig().regions[0]), id };
    return { ...config, regions: [...config.regions, region] };
}
export function moveRegion(region: RegionConfig, position: string): RegionConfig {
    const next = { ...region };
    if (position === 'footer') {
        next.type = 'footer-bar';
        next.height ??= 0.15;
        delete next.edge;
        delete next.width;
    }
    else {
        next.type = 'side-bar';
        next.edge = position as 'left' | 'right';
        next.width ??= { mode: 'short_edge_ratio', value: 0.12 };
        delete next.height;
    }
    next.layout ??= defaultFlowLayout();
    return next;
}
export function slotLabel(region: RegionConfig, id: string): string {
    if (id === 'asset')
        return '设备 Logo';
    const horizontal = region.type === 'footer-bar';
    const names: Record<string, string> = horizontal
        ? { 'primary-start': '主轨 · 左侧', 'primary-end': '主轨 · 右侧', 'secondary-start': '次轨 · 左侧', 'secondary-end': '次轨 · 右侧' }
        : { 'primary-start': '主轨 · 起点', 'primary-end': '主轨 · 终点', 'secondary-start': '次轨 · 起点', 'secondary-end': '次轨 · 终点' };
    return names[id] ?? id;
}

// ── 样式 / 选择 / 品牌 ────────────────────────────────────────────────

/** 当前选中的对象：预览中的文字/Logo/署名，或全局默认样式。 */
export type Selection =
    | { kind: 'text'; regionId: string; slotId: string }
    | { kind: 'brand'; regionId: string }
    | { kind: 'signature'; regionId: string; slotId: string }
    | { kind: 'defaults' };

export type FramePosition = 'footer' | 'left' | 'right';

/** 单一信息条（footer-bar / side-bar）；产品模型最多一个。 */
export function frameRegion(config: ImprintConfig): RegionConfig | null {
    return config.regions.find(region => region.type !== 'free') ?? null;
}

export function framePosition(config: ImprintConfig): FramePosition {
    const region = frameRegion(config);
    if (region?.type === 'side-bar') return region.edge === 'left' ? 'left' : 'right';
    return 'footer';
}

/** 应用样式预设：整份配置替换为对应预设（单信息条约束）。 */
export function applyStylePreset(_config: ImprintConfig, id: StylePresetId): ImprintConfig {
    return buildStyleConfig(id);
}

/** 移动信息条位置，并按三边留白契约同步 margin（所在侧由条自身厚度管理）。 */
export function setFramePosition(config: ImprintConfig, position: FramePosition): ImprintConfig {
    if (frameRegion(config) === null) {
        // 纯留白没有信息条：切到底部/侧边时补回一个默认信息条。
        const base = buildDefaultConfig();
        const region = position === 'footer' ? moveRegion(base.regions[0], 'footer') : moveRegion(base.regions[0], position);
        return { ...base, canvas: { ...base.canvas, margins: marginsForFrame(position) }, regions: [region] };
    }
    return {
        ...config,
        canvas: { ...config.canvas, margins: marginsForFrame(position) },
        regions: config.regions.map(region => (region.type !== 'free' ? moveRegion(region, position) : region)),
    };
}

export function setCanvasMargins(config: ImprintConfig, margins: ImprintConfig['canvas']['margins']): ImprintConfig {
    return { ...config, canvas: { ...config.canvas, margins } };
}

/** 设置信息条主轨（primary-start）展示的照片信息字段。 */
export function setFrameFields(config: ImprintConfig, fields: FieldId[]): ImprintConfig {
    const region = frameRegion(config);
    if (!region) return config;
    return {
        ...config,
        regions: config.regions.map(r => {
            if (r.id !== region.id) return r;
            const chips = fields.map(field_id => ({ field_id }));
            const existing = r.slots?.['primary-start'];
            return {
                ...r,
                slots: {
                    ...r.slots,
                    'primary-start': { ...(existing ?? emptySlot('primary-start')), enabled: fields.length > 0, content: { chips, separator: ' ' } },
                },
            };
        }),
    };
}

/** 信息条当前展示的主轨字段。 */
export function frameFields(config: ImprintConfig): FieldId[] {
    const region = frameRegion(config);
    const content = region?.slots?.['primary-start']?.content;
    if (content && 'chips' in content) return content.chips.map(chip => chip.field_id);
    return [];
}

export function logoSlot(config: ImprintConfig): { regionId: string; slot: SlotConfig } | null {
    const region = frameRegion(config);
    const slot = region?.slots?.['asset'];
    return region && slot ? { regionId: region.id, slot } : null;
}

export type BrandMode = 'off' | 'auto' | string;

export function brandPath(config: ImprintConfig): string | null {
    const found = logoSlot(config);
    if (!found || !found.slot.enabled) return null;
    const content = found.slot.content;
    return content && 'path' in content ? content.path : '';
}

/** 设置品牌：'off' 关闭 Logo，'auto' 按 EXIF 自动识别，否则为内置品牌 stem。 */
export function setBrandMode(config: ImprintConfig, mode: BrandMode): ImprintConfig {
    const found = logoSlot(config);
    if (!found) return config;
    const regionId = found.regionId;
    const path = mode === 'off' ? null : mode === 'auto' ? '' : `builtin:${mode}`;
    return {
        ...config,
        regions: config.regions.map(region => {
            if (region.id !== regionId) return region;
            const existing = region.slots?.['asset'];
            const slot: SlotConfig = path === null
                ? { enabled: false, style: null, content: null }
                : { enabled: true, style: null, content: { path, size_level: 'medium', size_ratio: null, orientation: 'upright', placement: 'end', track: 'span' } };
            return { ...region, slots: { ...region.slots, asset: slot } };
        }),
        logo_position: path === null ? config.logo_position : config.logo_position,
    };
}

export function signatureRegion(config: ImprintConfig): RegionConfig | null {
    return config.regions.find(region => region.type === 'free') ?? null;
}

export function setSignature(config: ImprintConfig, path: string | ''): ImprintConfig {
    const enabled = Boolean(path);
    let region = signatureRegion(config);
    if (!region) {
        if (!enabled) return config;
        region = { id: 'signature', type: 'free', enabled: true, anchor: 'bottom-right', offset_x: -0.02, offset_y: -0.02, offset_unit: 'short_edge_ratio', slots: {} };
        config = { ...config, regions: [...config.regions, region] };
    }
    const prev = region.slots?.sig1?.content;
    const prevPath = prev && 'path' in prev ? prev.path : '';
    const contentPath = enabled ? path : prevPath;
    return {
        ...config,
        regions: config.regions.map(r => r.id !== region!.id ? r : {
            ...r,
            enabled,
            slots: { sig1: { enabled, style: null, content: { path: contentPath, invert_mono: false, size_level: 'small', size_ratio: null, orientation: 'upright', placement: 'end', track: 'span' } } },
        }),
    };
}

/** 开关署名，不改变其图形路径；首次开启时补一个空署名区域。 */
export function setSignatureEnabled(config: ImprintConfig, enabled: boolean): ImprintConfig {
    let region = signatureRegion(config);
    if (!region) {
        if (!enabled) return config;
        region = { id: 'signature', type: 'free', enabled: true, anchor: 'bottom-right', offset_x: -0.02, offset_y: -0.02, offset_unit: 'short_edge_ratio', slots: {} };
        config = { ...config, regions: [...config.regions, region] };
    }
    const prev = region.slots?.sig1?.content;
    const path = prev && 'path' in prev ? prev.path : '';
    return {
        ...config,
        regions: config.regions.map(r => r.id !== region!.id ? r : {
            ...r,
            enabled,
            slots: { sig1: { enabled, style: null, content: { path, invert_mono: false, size_level: 'small', size_ratio: null, orientation: 'upright', placement: 'end', track: 'span' } } },
        }),
    };
}

/** 把布局元素 id 映射为选择目标。 */
export function selectionFromElementId(elementId: string, config: ImprintConfig): Selection | null {
    if (elementId.endsWith('-divider')) {
        const regionId = elementId.slice(0, -'-divider'.length);
        return { kind: 'brand', regionId };
    }
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
    if (!selection || selection.kind === 'defaults') return null;
    return `${selection.regionId}-${selection.kind === 'brand' ? 'asset' : selection.slotId}`;
}
