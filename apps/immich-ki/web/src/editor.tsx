import { useEffect, useRef, useState } from 'react';
import { resolveAutoLogoWithScheme, type LogoRegistryEntry } from '../../../web/src/autoLogo';
import { fetchLogos, uploadResource, type ExifFieldValues } from '../../../web/src/api';
import { fieldOptions, defaultFlowLayout, normalizeStylePatch, type FieldId, type ImprintConfig, type StyleConfig } from '../../../web/src/types';
import { STYLE_PRESETS, buildStyleConfig, marginsForFrame, type StylePresetId } from './defaults';
import {
    brandPath,
    frameFields,
    framePosition,
    frameRegion,
    logoSlot,
    setBrandMode,
    setCanvasMargins,
    setFrameFields,
    setFramePosition,
    setSignature,
    setSignatureEnabled,
    signatureRegion,
    slotLabel,
    type BrandMode,
    type FramePosition,
    type Selection,
} from './editor-state';
export { editableConfig, serializeEditorConfig } from './editor-state';

type Update = (update: (value: ImprintConfig) => ImprintConfig) => void;

type EditorTab = 'style' | 'common' | 'advanced';

const POSITION_LABELS: { value: FramePosition; label: string }[] = [
    { value: 'footer', label: '底部' },
    { value: 'left', label: '左侧' },
    { value: 'right', label: '右侧' },
];

const SIZE_LEVELS: { value: StyleConfig['font_size_level']; label: string }[] = [
    { value: 'small', label: '小' },
    { value: 'medium', label: '中' },
    { value: 'large', label: '大' },
];

function detectStylePreset(config: ImprintConfig): StylePresetId {
    const region = frameRegion(config);
    if (!region) return 'plain';
    const hasLogo = Boolean(region.slots?.asset?.enabled);
    const mode = region.layout?.mode ?? 'dual-track';
    if (mode === 'single-track' && !hasLogo) return 'minimal';
    return 'classic';
}

function slotStyle(config: ImprintConfig, regionId: string, slotId: string): StyleConfig {
    const region = config.regions.find(r => r.id === regionId);
    return region?.slots?.[slotId]?.style ?? config.defaults;
}

function patchSlotStyle(config: ImprintConfig, regionId: string, slotId: string, patch: Partial<StyleConfig>): ImprintConfig {
    return {
        ...config,
        regions: config.regions.map(region => {
            if (region.id !== regionId) return region;
            const existing = region.slots?.[slotId];
            const current = existing?.style ?? config.defaults;
            return { ...region, slots: { ...region.slots, [slotId]: { ...(existing ?? { enabled: true, content: null }), style: normalizeStylePatch(current, patch) } } };
        }),
    };
}

function StyleCard({ id, active, onSelect }: { id: StylePresetId; active: boolean; onSelect: () => void }) {
    const meta = STYLE_PRESETS.find(p => p.id === id)!;
    const preview = (() => {
        if (id === 'classic') return <><span className="style-line style-line-bold">CAMERA · LENS</span><span className="style-line">35MM · f/2.0 · 1/250 · ISO 100</span><span className="style-logo"/></>;
        if (id === 'minimal') return <><span className="style-line style-line-thin">CAMERA</span></>;
        return null;
    })();
    return <button type="button" className={`style-card ${active ? 'active' : ''}`} aria-pressed={active} aria-label={meta.label} onClick={onSelect}>
        <span className="style-card-preview">{preview}</span>
        <span className="style-card-label">{meta.label}</span>
        <span className="style-card-caption">{meta.caption}</span>
    </button>;
}

function BrandSection({ config, fields, onChange, highlighted }: { config: ImprintConfig; fields: ExifFieldValues; onChange: Update; highlighted: boolean }) {
    const found = logoSlot(config);
    const path = brandPath(config) ?? '';
    const enabled = found?.slot.enabled ?? false;
    const mode: BrandMode = !enabled ? 'off' : path === '' ? 'auto' : (path.startsWith('builtin:') ? path.split(':', 2)[1] : 'auto');
    const [logos, setLogos] = useState<readonly LogoRegistryEntry[]>([]);
    const [busy, setBusy] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    useEffect(() => { void fetchLogos().then(setLogos).catch(() => setLogos([])); }, []);
    const make = (fields.make ?? '').trim();
    const autoResolution = resolveAutoLogoWithScheme(make, logos, 'dark', '');
    const detected = autoResolution.stem;
    return <div className={`editor-group ${highlighted ? 'highlighted' : ''}`} data-target="brand">
        <div className="editor-group-title">品牌 Logo</div>
        <div className="segmented" role="radiogroup" aria-label="品牌 Logo 来源">
            <button type="button" role="radio" aria-checked={mode === 'auto'} className={mode === 'auto' ? 'active' : ''} onClick={() => onChange(c => setBrandMode(c, 'auto'))}>自动</button>
            <button type="button" role="radio" aria-checked={mode !== 'auto' && mode !== 'off'} className={mode !== 'auto' && mode !== 'off' ? 'active' : ''} onClick={() => onChange(c => setBrandMode(c, logos[0]?.stem ?? 'auto'))}>手动</button>
            <button type="button" role="radio" aria-checked={mode === 'off'} className={mode === 'off' ? 'active' : ''} onClick={() => onChange(c => setBrandMode(c, 'off'))}>关闭</button>
        </div>
        {mode === 'auto' && <p className="editor-note">{detected ? `已识别：${detected}` : make ? `无法识别「${make}」，请手动选择品牌。` : '未读取到相机品牌，请手动选择。'}</p>}
        {mode !== 'auto' && mode !== 'off' && <select value={mode} aria-label="品牌选择" onChange={e => onChange(c => setBrandMode(c, e.target.value))}>{logos.map(l => <option key={l.stem} value={l.stem}>{l.stem}</option>)}</select>}
        {mode === 'off' && <p className="editor-note">已关闭 Logo，信息条不预留品牌空间。</p>}
        {enabled && path && !path.startsWith('builtin:') && <p className="editor-note">已使用自定义 Logo 资源。</p>}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { const file = e.target.files?.[0]; if (file) { setBusy(true); void uploadResource(file, 'logo').then(r => onChange(c => { const f = logoSlot(c); if (!f) return c; return { ...c, regions: c.regions.map(reg => reg.id === f.regionId ? { ...reg, slots: { ...reg.slots, asset: { enabled: true, style: null, content: { path: r.resource_id, size_level: 'medium', size_ratio: null, orientation: 'upright', placement: 'end', track: 'span' } } } } : reg) }; })).catch(() => {}).finally(() => setBusy(false)); } e.target.value = ''; }} />
        <button type="button" className="mini" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? '上传中…' : '上传自定义 Logo'}</button>
    </div>;
}

function SignatureSection({ config, onChange }: { config: ImprintConfig; onChange: Update }) {
    const region = signatureRegion(config);
    const enabled = Boolean(region?.enabled);
    const fileRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const content = region?.slots?.sig1?.content;
    const currentPath = content && 'path' in content ? content.path : '';
    const toggle = (checked: boolean) => onChange(c => setSignatureEnabled(c, checked));
    return <div className="editor-group" data-target="signature">
        <div className="editor-group-title">署名</div>
        <label className="inline-check"><input type="checkbox" checked={enabled} onChange={e => toggle(e.target.checked)}/>添加署名</label>
        {enabled && <p className="editor-note">署名作为独立图形叠加在照片角落，不影响信息条。{currentPath ? '已使用自定义署名图形。' : '尚未选择图形，请上传。'}</p>}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { const file = e.target.files?.[0]; if (file) { setBusy(true); void uploadResource(file, 'signature').then(r => onChange(c => setSignature(c, r.resource_id))).catch(() => {}).finally(() => setBusy(false)); } e.target.value = ''; }} />
        {enabled && <button type="button" className="mini" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? '上传中…' : '上传署名图形'}</button>}
    </div>;
}

function CommonSection({ config, fields, onChange }: { config: ImprintConfig; fields: ExifFieldValues; onChange: Update }) {
    const position = framePosition(config);
    const margins = config.canvas.margins;
    const marginValue = Math.max(margins.top, margins.left, margins.right, margins.bottom);
    const current = frameFields(config);
    const toggleField = (id: FieldId) => {
        const next = current.includes(id) ? current.filter(f => f !== id) : [...current, id];
        onChange(c => setFrameFields(c, next));
    };
    // 三边留白（信息条所在侧由条自身厚度管理，保持 0）。
    const applyMargin = (value: number) => onChange(c => {
        const pos = framePosition(c);
        const base = marginsForFrame(pos);
        const m = { ...base };
        if (pos === 'footer') { m.top = value; m.left = value; m.right = value; }
        else if (pos === 'left') { m.top = value; m.bottom = value; m.right = value; }
        else { m.top = value; m.bottom = value; m.left = value; }
        return setCanvasMargins(c, m);
    });
    return <div className="editor-stack">
        <div className="editor-group" data-target="position">
            <div className="editor-group-title">信息条位置</div>
            <div className="segmented" role="radiogroup" aria-label="信息条位置">
                {POSITION_LABELS.map(p => <button key={p.value} type="button" role="radio" aria-checked={position === p.value} className={position === p.value ? 'active' : ''} onClick={() => onChange(c => setFramePosition(c, p.value))}>{p.label}</button>)}
            </div>
        </div>
        <div className="editor-group" data-target="margin">
            <label className="field">留白（像素）<input type="number" min={0} max={600} value={marginValue} onChange={e => { if (e.target.validity.valid && e.target.value) applyMargin(Number(e.target.value)); }} /></label>
        </div>
        <div className="editor-group" data-target="fields">
            <div className="editor-group-title">照片信息</div>
            <div className="field-toggle-list">
                {fieldOptions.filter(o => ['camera_model', 'lens_model', 'focal_length', 'aperture', 'shutter', 'iso', 'datetime'].includes(o.id)).map(o => <label key={o.id} className="inline-check"><input type="checkbox" checked={current.includes(o.id)} onChange={() => toggleField(o.id)}/>{o.label}</label>)}
            </div>
        </div>
        <BrandSection config={config} fields={fields} onChange={onChange} highlighted={false} />
        <SignatureSection config={config} onChange={onChange} />
    </div>;
}

function TextSlotControls({ config, regionId, slotId, onChange }: { config: ImprintConfig; regionId: string; slotId: string; onChange: Update }) {
    const region = config.regions.find(r => r.id === regionId);
    const slot = region?.slots?.[slotId];
    if (!slot) return null;
    const style = slot.style ?? config.defaults;
    const content = slot.content;
    const chips = content && 'chips' in content ? content.chips : [];
    const setStyle = (patch: Partial<StyleConfig>) => onChange(c => patchSlotStyle(c, regionId, slotId, patch));
    const moveChip = (index: number, delta: number) => {
        const next = [...chips];
        const target = index + delta;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        onChange(c => ({ ...c, regions: c.regions.map(r => r.id === regionId ? { ...r, slots: { ...r.slots, [slotId]: { ...(r.slots?.[slotId] ?? { enabled: true, style: null }), content: { ...(content as { chips: typeof chips; separator: string }), chips: next } } } } : r) }));
    };
    return <div className="editor-stack">
        <div className="editor-group-title">文字样式 · {slotLabel(region, slotId)}</div>
        <div className="segmented" role="radiogroup" aria-label="字号">
            {SIZE_LEVELS.map(s => <button key={s.value} type="button" role="radio" aria-checked={style.font_size_level === s.value} className={style.font_size_level === s.value ? 'active' : ''} onClick={() => setStyle({ font_size: null, font_size_ratio: null, font_size_level: s.value })}>{s.label}</button>)}
        </div>
        <label className="inline-check"><input type="checkbox" checked={style.bold} onChange={e => setStyle({ bold: e.target.checked })}/>加粗</label>
        <label className="field">文字颜色<input type="color" value={style.color} onChange={e => setStyle({ color: e.target.value })}/></label>
        {chips.length > 0 && <div className="chip-order">
            <div className="editor-group-title">信息顺序</div>
            {chips.map((chip, i) => <div key={`${chip.field_id}-${i}`} className="chip-order-row"><span>{fieldOptions.find(o => o.id === chip.field_id)?.label ?? chip.field_id}</span><span className="chip-order-actions"><button type="button" aria-label={`上移 ${i + 1}`} disabled={i === 0} onClick={() => moveChip(i, -1)}>↑</button><button type="button" aria-label={`下移 ${i + 1}`} disabled={i === chips.length - 1} onClick={() => moveChip(i, 1)}>↓</button></span></div>)}
        </div>}
    </div>;
}

function DefaultStyleControls({ config, onChange }: { config: ImprintConfig; onChange: Update }) {
    const style = config.defaults;
    const setStyle = (patch: Partial<StyleConfig>) => onChange(c => ({ ...c, defaults: normalizeStylePatch(c.defaults, patch) }));
    return <div className="editor-stack">
        <div className="editor-group-title">全局默认文字</div>
        <div className="segmented" role="radiogroup" aria-label="字号">
            {SIZE_LEVELS.map(s => <button key={s.value} type="button" role="radio" aria-checked={style.font_size_level === s.value} className={style.font_size_level === s.value ? 'active' : ''} onClick={() => setStyle({ font_size: null, font_size_ratio: null, font_size_level: s.value })}>{s.label}</button>)}
        </div>
        <label className="inline-check"><input type="checkbox" checked={style.bold} onChange={e => setStyle({ bold: e.target.checked })}/>加粗</label>
        <label className="field">文字颜色<input type="color" value={style.color} onChange={e => setStyle({ color: e.target.value })}/></label>
    </div>;
}

function AdvancedSection({ config, selection, onChange }: { config: ImprintConfig; selection: Selection | null; onChange: Update }) {
    const region = frameRegion(config);
    const layout = region?.layout ?? defaultFlowLayout();
    const patchLayout = (patch: Partial<typeof layout>) => onChange(c => {
        const r = frameRegion(c);
        if (!r) return c;
        return { ...c, regions: c.regions.map(reg => reg.id === r.id ? { ...reg, layout: { ...(reg.layout ?? defaultFlowLayout()), ...patch } } : reg) };
    });
    const setLogoSize = (level: StyleConfig['font_size_level']) => onChange(c => {
        const f = logoSlot(c);
        if (!f) return c;
        const content = f.slot.content;
        if (!content || !('path' in content) || 'invert_mono' in content) return c;
        return { ...c, regions: c.regions.map(reg => reg.id === f.regionId ? { ...reg, slots: { ...reg.slots, asset: { ...f.slot, content: { ...content, size_level: level, size_ratio: null } } } } : reg) };
    });
    const setSigSize = (level: StyleConfig['font_size_level']) => onChange(c => {
        const r = signatureRegion(c);
        if (!r) return c;
        const content = r.slots?.sig1?.content;
        if (!content || !('invert_mono' in content)) return c;
        return { ...c, regions: c.regions.map(reg => reg.id === r.id ? { ...reg, slots: { ...reg.slots, sig1: { ...reg.slots!.sig1, content: { ...content, size_level: level, size_ratio: null } } } } : reg) };
    });
    return <div className="editor-stack">
        {selection?.kind === 'text' ? <TextSlotControls config={config} regionId={selection.regionId} slotId={selection.slotId} onChange={onChange} />
            : selection?.kind === 'brand' ? <div className="editor-stack"><div className="editor-group-title">品牌 Logo 大小</div><div className="segmented" role="radiogroup" aria-label="Logo 大小">{SIZE_LEVELS.map(s => <button key={s.value} type="button" role="radio" aria-checked={false} onClick={() => setLogoSize(s.value)}>{s.label}</button>)}</div></div>
            : selection?.kind === 'signature' ? <div className="editor-stack"><div className="editor-group-title">署名大小</div><div className="segmented" role="radiogroup" aria-label="署名大小">{SIZE_LEVELS.map(s => <button key={s.value} type="button" role="radio" aria-checked={false} onClick={() => setSigSize(s.value)}>{s.label}</button>)}</div></div>
            : <DefaultStyleControls config={config} onChange={onChange} />}
        <div className="editor-group" data-target="spacing">
            <div className="editor-group-title">间距与排版</div>
            <label className="field">内容间距<input type="number" min={0} max={600} step="any" value={layout.item_gap.mode === 'pixel' ? layout.item_gap.value : Math.round(layout.item_gap.value * 1000) / 10} onChange={e => { if (e.target.validity.valid && e.target.value) patchLayout({ item_gap: { mode: 'pixel', value: Number(e.target.value) } }); }} /></label>
            <label className="field">轨道间距<input type="number" min={0} max={600} step="any" value={layout.track_gap.mode === 'pixel' ? layout.track_gap.value : Math.round(layout.track_gap.value * 1000) / 10} onChange={e => { if (e.target.validity.valid && e.target.value) patchLayout({ track_gap: { mode: 'pixel', value: Number(e.target.value) } }); }} /></label>
            <label className="field">背景色<input type="color" value={config.canvas.background} onChange={e => onChange(c => ({ ...c, canvas: { ...c.canvas, background: e.target.value } }))}/></label>
        </div>
    </div>;
}

export function Editor({ config, onChange, fields, selection, onSelect }: {
    config: ImprintConfig;
    onChange: Update;
    fields: ExifFieldValues;
    selection: Selection | null;
    onSelect: (sel: Selection | null) => void;
}) {
    const [tab, setTab] = useState<EditorTab>('style');
    useEffect(() => {
        if (selection?.kind === 'text' || selection?.kind === 'defaults') setTab('advanced');
        else if (selection?.kind === 'brand') setTab('common');
        else if (selection?.kind === 'signature') setTab('common');
    }, [selection]);
    const region = frameRegion(config);
    const slots = region ? (Object.keys(region.slots ?? {}) as string[]) : [];
    const currentStyle = detectStylePreset(config);
    return <div className="watermark-editor">
        <div className="editor-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'style'} className={tab === 'style' ? 'active' : ''} onClick={() => setTab('style')}>样式</button>
            <button type="button" role="tab" aria-selected={tab === 'common'} className={tab === 'common' ? 'active' : ''} onClick={() => setTab('common')}>常用</button>
            <button type="button" role="tab" aria-selected={tab === 'advanced'} className={tab === 'advanced' ? 'active' : ''} onClick={() => setTab('advanced')}>精细</button>
        </div>
        {tab === 'style' && <div className="style-grid" role="group" aria-label="样式预设">
            {STYLE_PRESETS.map(p => <StyleCard key={p.id} id={p.id} active={currentStyle === p.id} onSelect={() => { onChange(c => buildStyleConfig(p.id)); onSelect(null); }} />)}
        </div>}
        {tab === 'common' && <CommonSection config={config} fields={fields} onChange={onChange} />}
        {tab === 'advanced' && <><AdvancedSection config={config} selection={selection} onChange={onChange} /></>}
        {tab === 'advanced' && region && <div className="editor-group" data-target="objects">
            <div className="editor-group-title">选择对象</div>
            <div className="object-list">
                {slots.filter(id => id !== 'asset').map(id => <button key={id} type="button" className={selection?.kind === 'text' && selection.slotId === id ? 'active' : ''} onClick={() => onSelect({ kind: 'text', regionId: region.id, slotId: id })}>{slotLabel(region, id)}</button>)}
                <button type="button" className={selection?.kind === 'brand' ? 'active' : ''} onClick={() => onSelect({ kind: 'brand', regionId: region.id })}>品牌 Logo</button>
                {signatureRegion(config) && <button type="button" className={selection?.kind === 'signature' ? 'active' : ''} onClick={() => onSelect({ kind: 'signature', regionId: signatureRegion(config)!.id, slotId: 'sig1' })}>署名</button>}
            </div>
        </div>}
    </div>;
}
