import { defaultFlowLayout, type ImprintConfig, type RegionConfig, type SlotConfig } from '../../../web/src/types';
import { buildDefaultConfig } from './defaults';
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
