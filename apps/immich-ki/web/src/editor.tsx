import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { KariImprintCanvas } from '../../../web/src/KariImprintCanvas';
import { resolveAutoLogoWithScheme, type LogoRegistryEntry } from '../../../web/src/autoLogo';
import { fetchLogos, uploadResource, type ExifFieldValues, type RuntimeCapabilities } from '../../../web/src/api';
import { fieldOptions, type FieldId, type ImprintConfig, type SizeLevel } from '../../../web/src/types';
import { BACKGROUND_SWATCHES, QUICK_FIELD_OPTIONS, STYLE_PRESETS, type StylePresetId } from './defaults';
import {
  applyStylePreset, availableLines, brandMode, canvasEffect, detectStyle, framePosition, frameRegion, frameLayout, frameThickness,
  isDark, lineFields, lineLabel, lineStyle, logoSize, marginValue, moveLineField, patchFrameLayout, patchLineStyle, setBackground,
  setBrandMode, setCustomLogo, setFramePosition, setFrameThickness, setLogoSize, setMarginValue, setSignature, signatureState,
  toggleLineField, withCanvasEffect, type FramePosition, type Selection,
} from './editor-state';
import { errorText } from './api';

export { editableConfig, serializeEditorConfig } from './editor-state';

/** Apply a change; `key` coalesces continuous edits (typing, dragging) into one undo step. */
export type Commit = (update: (value: ImprintConfig) => ImprintConfig, key?: string) => void;

const POSITIONS: { value: FramePosition; label: string; key: string }[] = [
  { value: 'footer', label: '底部', key: 'B' },
  { value: 'left', label: '左侧', key: 'L' },
  { value: 'right', label: '右侧', key: 'R' },
];
const SIZES: { value: SizeLevel; label: string }[] = [{ value: 'small', label: '小' }, { value: 'medium', label: '中' }, { value: 'large', label: '大' }];
const fieldLabel = (id: FieldId) => fieldOptions.find(o => o.id === id)?.label ?? id;

export type SectionId = 'text' | 'brand' | 'background' | 'signature' | 'spacing';

function Section({ id, title, summary, open, onToggle, highlighted, children }: { id: SectionId; title: string; summary?: string; open: boolean; onToggle: (id: SectionId) => void; highlighted?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (highlighted) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [highlighted]);
  return <section ref={ref} className={`panel-section ${open ? 'open' : ''} ${highlighted ? 'highlighted' : ''}`} data-section={id}>
    <button type="button" className="section-head" aria-expanded={open} onClick={() => onToggle(id)}>
      <span className="section-title">{title}</span>
      {summary && <span className="section-summary">{summary}</span>}
      <span className="section-caret" aria-hidden="true">{open ? '−' : '+'}</span>
    </button>
    {open && <div className="section-body">{children}</div>}
  </section>;
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T | null; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void }) {
  return <div className="segmented" role="radiogroup" aria-label={label}>
    {options.map(o => <button key={o.value} type="button" role="radio" aria-checked={value === o.value} title={o.title} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}
  </div>;
}

function Slider({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return <label className="slider">
    <span className="slider-head"><span>{label}</span><output>{format(value)}</output></span>
    <input type="range" min={min} max={max} step={step} value={Math.min(max, Math.max(min, value))} onChange={e => onChange(Number(e.target.value))} />
  </label>;
}

function StyleCards({ config, current, onPick, image, size, caps, fields }: { config: ImprintConfig; current: StylePresetId; onPick: (id: StylePresetId) => void; image: ImageBitmap | null; size: { width: number; height: number } | null; caps: RuntimeCapabilities | null; fields: ExifFieldValues }) {
  const shortEdge = size ? Math.min(size.width, size.height) : undefined;
  // Each card renders the current photo in that style, keeping the user's orthogonal choices.
  const previews = useMemo(() => STYLE_PRESETS.map(p => ({ ...p, config: applyStylePreset(config, p.id, shortEdge) })), [config, shortEdge]);
  const thumbCaps = useMemo(() => caps ? { ...caps, preview: { ...caps.preview, max_edge: 420 } } : null, [caps]);
  return <div className="style-cards" role="radiogroup" aria-label="样式">
    {previews.map((p, index) => <button key={p.id} type="button" role="radio" aria-checked={current === p.id} className={`style-card ${current === p.id ? 'active' : ''}`} onClick={() => onPick(p.id)} title={`${p.caption}（快捷键 ${index + 1}）`}>
      <span className="style-thumb">{image && size && thumbCaps ? <KariImprintCanvas config={p.config} image={image} originalImageSize={size} runtimeCaps={thumbCaps} fieldValues={fields} scheme="dark" /> : null}</span>
      <span className="style-name">{p.label}</span>
    </button>)}
  </div>;
}

function LineEditor({ config, slotId, commit, fields, highlighted }: { config: ImprintConfig; slotId: string; commit: Commit; fields: ExifFieldValues; highlighted: boolean }) {
  const active = lineFields(config, slotId);
  const style = lineStyle(config, slotId);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (highlighted) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [highlighted]);
  const preview = active.map(id => fields[id as keyof ExifFieldValues] || '').filter(Boolean).join(' ');
  const missing = active.filter(id => !fields[id as keyof ExifFieldValues]);
  return <div ref={ref} className={`line-card ${highlighted ? 'highlighted' : ''}`}>
    <div className="line-head"><span className="line-name">{lineLabel(config, slotId)}</span><span className="line-preview" title={preview}>{preview || (active.length ? '（这张照片缺少所选信息）' : '空')}</span></div>
    <div className="chip-toggles" role="group" aria-label={`${lineLabel(config, slotId)} 显示的信息`}>
      {QUICK_FIELD_OPTIONS.map(id => <button key={id} type="button" aria-pressed={active.includes(id)} className={`chip ${active.includes(id) ? 'on' : ''} ${active.includes(id) && !fields[id as keyof ExifFieldValues] ? 'missing' : ''}`} onClick={() => commit(c => toggleLineField(c, slotId, id))}>{fieldLabel(id)}</button>)}
    </div>
    {active.length > 1 && <div className="chip-order" aria-label="信息顺序">
      {active.map((id, i) => <span key={id} className="order-item">
        <button type="button" aria-label={`把 ${fieldLabel(id)} 前移`} disabled={i === 0} onClick={() => commit(c => moveLineField(c, slotId, i, -1))}>‹</button>
        {fieldLabel(id)}
        <button type="button" aria-label={`把 ${fieldLabel(id)} 后移`} disabled={i === active.length - 1} onClick={() => commit(c => moveLineField(c, slotId, i, 1))}>›</button>
      </span>)}
    </div>}
    {missing.length > 0 && <p className="hint">这张照片没有{missing.map(fieldLabel).join('、')}，成品中会自动省略。</p>}
    {active.length > 0 && <div className="line-style">
      <Segmented label="字号" value={style.font_size_level} options={SIZES} onChange={v => commit(c => patchLineStyle(c, slotId, { font_size: null, font_size_ratio: null, font_size_level: v }))} />
      <Segmented label="字重" value={style.bold ? 'bold' : 'regular'} options={[{ value: 'regular', label: '常规' }, { value: 'bold', label: '粗体' }]} onChange={v => commit(c => patchLineStyle(c, slotId, { bold: v === 'bold' }))} />
      <label className="color-input" title="文字颜色"><input type="color" value={style.color} onChange={e => commit(c => patchLineStyle(c, slotId, { color: e.target.value }), `color-${slotId}`)} /><span>{style.color.toUpperCase()}</span></label>
    </div>}
  </div>;
}

function useLogos() {
  const [logos, setLogos] = useState<readonly LogoRegistryEntry[]>([]);
  useEffect(() => { void fetchLogos().then(entries => setLogos(entries.map(e => ({ stem: e.stem, variants: e.variants })))).catch(() => setLogos([])); }, []);
  return logos;
}

function Upload({ label, kind, onDone }: { label: string; kind: 'logo' | 'signature'; onDone: (id: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <>
    <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      setBusy(true); setError('');
      void uploadResource(file, kind).then(r => onDone(r.resource_id)).catch(err => setError(`上传失败：${errorText(err)}`)).finally(() => setBusy(false));
    }} />
    <button type="button" className="mini" disabled={busy} onClick={() => ref.current?.click()}>{busy ? '上传中…' : label}</button>
    {error && <p className="hint error" role="alert">{error}</p>}
  </>;
}

function BrandControls({ config, commit, fields }: { config: ImprintConfig; commit: Commit; fields: ExifFieldValues }) {
  const logos = useLogos();
  const mode = brandMode(config);
  const make = (fields.make ?? '').trim();
  const detected = resolveAutoLogoWithScheme(make, logos, isDark(config.canvas.background) ? 'light' : 'dark', '', fields.camera_model ?? '').stem;
  const kind = mode === 'off' ? 'off' : mode === 'auto' ? 'auto' : 'manual';
  return <div className="stack">
    <Segmented label="品牌 Logo" value={kind} options={[{ value: 'auto', label: '自动识别' }, { value: 'manual', label: '指定' }, { value: 'off', label: '不显示' }]}
      onChange={v => commit(c => setBrandMode(c, v === 'manual' ? (detected || logos[0]?.stem || 'auto') : v))} />
    {kind === 'auto' && <p className="hint">{detected ? <>已识别为 <strong>{detected}</strong>。</> : make ? <>无法识别「{make}」，成品中不会显示 Logo，可改为指定品牌。</> : '照片没有相机品牌信息，成品中不会显示 Logo。'}</p>}
    {kind === 'manual' && <select aria-label="品牌" value={mode === 'custom' ? '' : mode} onChange={e => commit(c => setBrandMode(c, e.target.value))}>
      {mode === 'custom' && <option value="">自定义上传</option>}
      {logos.map(l => <option key={l.stem} value={l.stem}>{l.stem}</option>)}
    </select>}
    {kind !== 'off' && <>
      <Segmented label="Logo 大小" value={logoSize(config)} options={SIZES} onChange={v => commit(c => setLogoSize(c, v))} />
      <Upload label={mode === 'custom' ? '更换自定义 Logo' : '上传自定义 Logo'} kind="logo" onDone={id => commit(c => setCustomLogo(c, id))} />
    </>}
    <p className="hint">品牌选择只影响这张照片。</p>
  </div>;
}

function SignatureControls({ config, commit }: { config: ImprintConfig; commit: Commit }) {
  const state = signatureState(config);
  return <div className="stack">
    {state.path ? <label className="check"><input type="checkbox" checked={state.enabled} onChange={e => commit(c => setSignature(c, { enabled: e.target.checked }))} />在照片右下角显示署名</label>
      : <p className="hint">上传一张透明背景的签名图（PNG），会叠加在照片右下角。</p>}
    {state.enabled && <Segmented label="署名大小" value={state.size} options={SIZES} onChange={v => commit(c => setSignature(c, { size: v }))} />}
    <Upload label={state.path ? '更换署名图' : '上传署名图'} kind="signature" onDone={id => commit(c => setSignature(c, { path: id, enabled: true }))} />
    {state.path && <button type="button" className="mini" onClick={() => commit(c => setSignature(c, { path: '', enabled: false }))}>移除署名</button>}
  </div>;
}

function BackgroundControls({ config, commit }: { config: ImprintConfig; commit: Commit }) {
  const effect = canvasEffect(config);
  const bg = config.canvas.background.toUpperCase();
  return <div className="stack">
    <Segmented label="背景" value={effect.background} options={[{ value: 'solid', label: '纯色' }, { value: 'blur', label: '模糊照片' }]} onChange={v => commit(c => withCanvasEffect(c, { background: v }))} />
    {effect.background === 'solid' && <div className="swatches" role="radiogroup" aria-label="背景颜色">
      {BACKGROUND_SWATCHES.map(s => <button key={s.value} type="button" role="radio" aria-checked={bg === s.value} aria-label={s.label} title={s.label} className={`swatch ${bg === s.value ? 'active' : ''}`} style={{ background: s.value }} onClick={() => commit(c => setBackground(c, s.value))} />)}
      <label className="swatch custom" title="自定义颜色"><input type="color" aria-label="自定义背景颜色" value={config.canvas.background} onChange={e => commit(c => setBackground(c, e.target.value), 'background')} /></label>
    </div>}
    {effect.background === 'blur' && <p className="hint">背景使用这张照片放大模糊后的画面，文字建议使用浅色。</p>}
    <Slider label="照片圆角" value={effect.photo_radius * 100} min={0} max={8} step={0.5} format={v => v === 0 ? '无' : `短边 ${v.toFixed(1)}%`} onChange={v => commit(c => withCanvasEffect(c, { photo_radius: Math.round(v * 10) / 1000 }), 'radius')} />
    <label className="check"><input type="checkbox" checked={effect.shadow} onChange={e => commit(c => withCanvasEffect(c, { shadow: e.target.checked }))} />照片投影</label>
  </div>;
}

function SpacingControls({ config, commit }: { config: ImprintConfig; commit: Commit }) {
  const layout = frameLayout(config);
  const asRatio = (gap: { mode: string; value: number }, shortEdgeFallback = 0.012) => gap.mode === 'short_edge_ratio' ? gap.value : shortEdgeFallback;
  const dual = layout.mode === 'dual-track';
  return <div className="stack">
    <Segmented label="行数" value={layout.mode} options={[{ value: 'dual-track', label: '两行' }, { value: 'single-track', label: '一行' }]} onChange={v => commit(c => patchFrameLayout(c, { mode: v }))} />
    <Slider label="元素间距" value={asRatio(layout.item_gap) * 100} min={0} max={5} step={0.1} format={v => `短边 ${v.toFixed(1)}%`} onChange={v => commit(c => patchFrameLayout(c, { item_gap: { mode: 'short_edge_ratio', value: Math.round(v * 10) / 1000 } }), 'item-gap')} />
    {dual && <Slider label="行间距" value={asRatio(layout.track_gap) * 100} min={0} max={5} step={0.1} format={v => `短边 ${v.toFixed(1)}%`} onChange={v => commit(c => patchFrameLayout(c, { track_gap: { mode: 'short_edge_ratio', value: Math.round(v * 10) / 1000 } }), 'track-gap')} />}
  </div>;
}

export function Editor({ config, commit, fields, selection, onSelect, image, size, caps }: {
  config: ImprintConfig;
  commit: Commit;
  fields: ExifFieldValues;
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  image: ImageBitmap | null;
  size: { width: number; height: number } | null;
  caps: RuntimeCapabilities | null;
}) {
  const [open, setOpen] = useState<Set<SectionId>>(() => new Set(['text']));
  const toggle = (id: SectionId) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Selecting an object in the preview opens and highlights its section.
  const focus: SectionId | null = selection?.kind === 'text' ? 'text' : selection?.kind === 'brand' ? 'brand' : selection?.kind === 'signature' ? 'signature' : null;
  useEffect(() => { if (focus) setOpen(s => s.has(focus) ? s : new Set([...s, focus])); }, [focus, selection]);
  const style = detectStyle(config);
  const region = frameRegion(config);
  const shortEdge = size ? Math.min(size.width, size.height) : null;
  const margin = marginValue(config);
  const lines = availableLines(config);
  const brand = brandMode(config);
  const sig = signatureState(config);
  return <div className="editor-panel">
    <div className="panel-block">
      <div className="block-title">样式</div>
      <StyleCards config={config} current={style} onPick={id => { commit(c => applyStylePreset(c, id, shortEdge ?? undefined)); onSelect(null); }} image={image} size={size} caps={caps} fields={fields} />
    </div>
    <div className="panel-block">
      {region && <div className="row">
        <span className="row-label">信息条</span>
        <Segmented label="信息条位置" value={framePosition(config)} options={POSITIONS.map(p => ({ value: p.value, label: p.label, title: `快捷键 ${p.key}` }))} onChange={v => commit(c => setFramePosition(c, v))} />
      </div>}
      {region && <Slider label="信息条厚度" value={frameThickness(config) * 100} min={5} max={30} step={0.5} format={v => `短边 ${v.toFixed(1)}%`} onChange={v => commit(c => setFrameThickness(c, v / 100), 'thickness')} />}
      <Slider label={region ? '其余三边留白' : '四边留白'} value={margin} min={0} max={shortEdge ? Math.max(600, Math.round(shortEdge * 0.2)) : 600} step={shortEdge && shortEdge > 3000 ? 10 : 2}
        format={v => shortEdge ? `${v}px · 短边 ${(v / shortEdge * 100).toFixed(1)}%` : `${v}px`} onChange={v => commit(c => setMarginValue(c, v), 'margin')} />
    </div>
    {region && <Section id="text" title="文字" summary={lines.map(l => lineFields(config, l).length).reduce((a, b) => a + b, 0) + ' 项信息'} open={open.has('text')} onToggle={toggle} highlighted={focus === 'text'}>
      {lines.map(slotId => <LineEditor key={slotId} config={config} slotId={slotId} commit={commit} fields={fields} highlighted={selection?.kind === 'text' && selection.slotId === slotId} />)}
      {brand !== 'off' && <p className="hint">关闭 Logo 后可在右侧添加文字。</p>}
    </Section>}
    {region && <Section id="brand" title="品牌 Logo" summary={brand === 'off' ? '不显示' : brand === 'auto' ? '自动' : brand === 'custom' ? '自定义' : brand} open={open.has('brand')} onToggle={toggle} highlighted={focus === 'brand'}>
      <BrandControls config={config} commit={commit} fields={fields} />
    </Section>}
    <Section id="background" title="背景与效果" summary={canvasEffect(config).background === 'blur' ? '模糊照片' : config.canvas.background.toUpperCase()} open={open.has('background')} onToggle={toggle}>
      <BackgroundControls config={config} commit={commit} />
    </Section>
    <Section id="signature" title="署名" summary={sig.enabled ? '已开启' : '未开启'} open={open.has('signature')} onToggle={toggle} highlighted={focus === 'signature'}>
      <SignatureControls config={config} commit={commit} />
    </Section>
    {region && <Section id="spacing" title="排版细节" open={open.has('spacing')} onToggle={toggle}>
      <SpacingControls config={config} commit={commit} />
    </Section>}
  </div>;
}
