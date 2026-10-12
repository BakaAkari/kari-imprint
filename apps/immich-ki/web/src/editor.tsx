import { ContentEditor } from '../../../web/src/components/InspectorPanel';
import { defaultStyle, defaultFlowLayout, normalizeStylePatch, type ImprintConfig, type RegionConfig, type StyleConfig } from '../../../web/src/types';
import { addRegion, emptySlot, moveRegion, slotLabel, updateSlot } from './editor-state';
export { editableConfig, serializeEditorConfig } from './editor-state';
type Update = (update: (value: ImprintConfig) => ImprintConfig) => void;
function TextStyle({ style, onChange }: {
    style: StyleConfig;
    onChange: (value: StyleConfig) => void;
}) {
    const mode = style.font_size != null ? 'pixel' : style.font_size_level != null ? 'level' : style.font_size_ratio != null ? 'ratio' : 'auto';
    const patch = (value: Partial<StyleConfig>) => onChange(normalizeStylePatch(style, value));
    return <div className="editor-fields">
    <label>字号方式<select value={mode} onChange={e => patch(e.target.value === 'auto' ? { font_size: null, font_size_level: null, font_size_ratio: null } : e.target.value === 'pixel' ? { font_size: 24 } : e.target.value === 'level' ? { font_size_level: 'medium' } : { font_size_ratio: 0.2 })}><option value="auto">自动</option><option value="ratio">按比例</option><option value="pixel">像素</option><option value="level">预设大小</option></select></label>
    {mode === 'pixel' ? <label>字号（像素）<input type="number" min={4} max={200} value={style.font_size!} onChange={e => { if (e.target.validity.valid && e.target.value)
            patch({ font_size: Number(e.target.value) }); }}/></label>
            : mode === 'level' ? <label>字号大小<select value={style.font_size_level!} onChange={e => patch({ font_size_level: e.target.value as StyleConfig['font_size_level'] })}>{['small', 'medium', 'large'].map((v, i) => <option key={v} value={v}>{['小', '中', '大'][i]}</option>)}</select></label>
                : mode === 'ratio' ? <label>字号比例<input type="number" min={0} max={0.5} step="any" value={style.font_size_ratio ?? ''} onChange={e => { if (e.target.validity.valid && e.target.value)
                    patch({ font_size_ratio: Number(e.target.value) }); }}/></label> : null}
    <label>字号基准<select value={style.size_reference} onChange={e => patch({ size_reference: e.target.value as StyleConfig['size_reference'] })}><option value="region_height">边框高度</option><option value="short_edge">照片短边</option><option value="long_edge">照片长边</option></select></label>
    <label>文字颜色<input type="color" value={style.color} onChange={e => patch({ color: e.target.value })}/></label>
    <label>字体<select value={style.font_family} onChange={e => patch({ font_family: e.target.value as StyleConfig['font_family'], bold: e.target.value.includes('Bold') })}><option value="NotoSansCJKsc-Regular.otf">思源黑体 · 常规</option><option value="NotoSansCJKsc-Bold.otf">思源黑体 · 粗体</option></select></label>
    <label>行高<input type="number" min={0.5} max={3} step="any" value={style.line_height} onChange={e => { if (e.target.validity.valid && e.target.value)
        patch({ line_height: Number(e.target.value) }); }}/></label>
    <label>文字方向<select value={style.text_direction ?? 'horizontal'} onChange={e => patch({ text_direction: e.target.value as StyleConfig['text_direction'] })}><option value="horizontal">横向</option><option value="rotate-cw">顺时针旋转</option><option value="rotate-ccw">逆时针旋转</option><option value="vertical-glyphs">逐字纵排</option></select></label>
  </div>;
}
function RegionPanel({ region, config, onChange }: {
    region: RegionConfig;
    config: ImprintConfig;
    onChange: Update;
}) {
    const patch = (value: Partial<RegionConfig>) => onChange(current => ({ ...current, regions: current.regions.map(r => r.id === region.id ? { ...r, ...value } : r) }));
    const free = region.type === 'free';
    const ids = free ? Object.keys(region.slots ?? {}) : [...new Set(['primary-start', 'primary-end', 'secondary-start', 'secondary-end', 'asset', ...Object.keys(region.slots ?? {})])];
    const layout = region.layout ?? defaultFlowLayout();
    return <section className="editor-section" aria-label={`区域 ${region.id}`}>
    <div className="editor-section-title"><h3>{free ? '签名与自由定位' : region.type === 'footer-bar' ? '底部边框' : '侧边框'} <small>{region.id}</small></h3><label className="inline"><input type="checkbox" checked={region.enabled} onChange={e => patch({ enabled: e.target.checked })}/>启用区域</label></div>
    {!region.enabled && <p className="editor-note">此区域已停用，内容保留。</p>}
    <details className="editor-layout"><summary>位置与布局</summary><div className="editor-fields">
      {!free ? <>
        <label>边框位置<select value={region.type === 'footer-bar' ? 'footer' : region.edge ?? 'right'} onChange={e => onChange(current => ({ ...current, regions: current.regions.map(r => r.id === region.id ? moveRegion(r, e.target.value) : r) }))}><option value="footer">底栏</option><option value="left">左侧栏</option><option value="right">右侧栏</option></select></label>
        <label>排版轨道<select value={layout.mode} onChange={e => patch({ layout: { ...layout, mode: e.target.value as typeof layout.mode } })}><option value="single-track">单轨</option><option value="dual-track">双轨</option></select></label>
        {region.type === 'footer-bar' ? <label>底栏高度<input type="number" min={0} max={1} step="any" value={region.height ?? 0.15} onChange={e => { if (e.target.validity.valid && e.target.value)
            patch({ height: Number(e.target.value) }); }}/></label> : <label>侧栏宽度<input type="number" min={0} max={region.width?.mode === 'pixel' ? 600 : 1} step="any" value={region.width?.value ?? 0.12} onChange={e => { if (e.target.validity.valid && e.target.value)
            patch({ width: { mode: region.width?.mode ?? 'short_edge_ratio', value: Number(e.target.value) } }); }}/></label>}
        {region.type === 'side-bar' && <label>侧栏宽度单位<select value={region.width?.mode ?? 'short_edge_ratio'} onChange={e => patch({ width: { mode: e.target.value as 'pixel' | 'short_edge_ratio', value: e.target.value === 'pixel' ? 80 : 0.12 } })}><option value="short_edge_ratio">照片短边比例</option><option value="pixel">像素</option></select></label>}
        {/* main_alignment/cross_alignment are schema fields but the flow engine
            does not read them; per the design contract dead controls are
            removed instead of left misleading. */}
        {(['track_gap', 'item_gap'] as const).map((key, i) => <label key={key}>{i ? '内容间距' : '轨道间距'}<select aria-label={i ? '内容间距单位' : '轨道间距单位'} value={layout[key].mode} onChange={e => patch({ layout: { ...layout, [key]: { mode: e.target.value, value: e.target.value === 'pixel' ? 8 : 0.012 } } })}><option value="short_edge_ratio">照片短边比例</option><option value="pixel">像素</option></select><input aria-label={i ? '内容间距数值' : '轨道间距数值'} type="number" min={0} max={layout[key].mode === 'pixel' ? 600 : 1} step="any" value={layout[key].value} onChange={e => { if (e.target.validity.valid && e.target.value)
            patch({ layout: { ...layout, [key]: { ...layout[key], value: Number(e.target.value) } } }); }}/></label>)}
        <label>主轨占比<input type="number" min={0.01} max={0.99} step="any" value={layout.track_ratios[0]} onChange={e => { if (e.target.validity.valid && e.target.value)
            patch({ layout: { ...layout, track_ratios: [Number(e.target.value), 1 - Number(e.target.value)] } }); }}/></label>
        {(['top', 'right', 'bottom', 'left'] as const).map((key, i) => <label key={key}>{['上', '右', '下', '左'][i]}内边距<input type="number" min={0} max={600} value={region.padding?.[key] ?? 8} onChange={e => { if (e.target.validity.valid && e.target.value)
            patch({ padding: { ...region.padding, [key]: Number(e.target.value) } }); }}/></label>)}
        {/* track_order only affects the footer; side-bar column order is
            derived from the edge, so the control is hidden there. */}
        {region.type === 'footer-bar' && <label>轨道顺序<select value={layout.track_order} onChange={e => patch({ layout: { ...layout, track_order: e.target.value as typeof layout.track_order } })}><option value="photo-outward">从照片向外</option><option value="outward-photo">从外向照片</option></select></label>}
        {region.type === 'side-bar' && <label>侧栏文字方向<select value={region.text_orientation ?? 'auto'} onChange={e => patch({ text_orientation: e.target.value as RegionConfig['text_orientation'] })}><option value="auto">跟随侧边</option><option value="horizontal">横向</option><option value="rotate-cw">顺时针旋转</option><option value="rotate-ccw">逆时针旋转</option><option value="vertical-glyphs">逐字纵排</option></select></label>}
      </> : <>
        <label>签名位置<select value={region.anchor ?? 'bottom-right'} onChange={e => patch({ anchor: e.target.value as RegionConfig['anchor'] })}>{['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'].map((v, i) => <option key={v} value={v}>{['左上', '上方居中', '右上', '左侧居中', '中心', '右侧居中', '左下', '下方居中', '右下'][i]}</option>)}</select></label>
        <label>偏移单位<select value={region.offset_unit ?? 'short_edge_ratio'} onChange={e => patch({ offset_unit: e.target.value as RegionConfig['offset_unit'], ...(e.target.value === 'short_edge_ratio' ? { offset_x: Math.max(-1, Math.min(1, region.offset_x ?? 0)), offset_y: Math.max(-1, Math.min(1, region.offset_y ?? 0)) } : {}) })}><option value="short_edge_ratio">照片短边比例</option><option value="pixel">像素</option></select></label>
        {(['offset_x', 'offset_y'] as const).map((key, i) => <label key={key}>{i ? '垂直偏移' : '水平偏移'}<input type="number" min={region.offset_unit === 'pixel' ? -2000 : -1} max={region.offset_unit === 'pixel' ? 2000 : 1} step="any" value={region[key] ?? 0} onChange={e => { if (e.target.validity.valid && e.target.value && Number.isFinite(Number(e.target.value)))
            patch({ [key]: Number(e.target.value) }); }}/></label>)}
      </>}
    </div></details>
    {ids.map(id => {
            const slot = region.slots?.[id] ?? emptySlot(id, free);
            const text = slot.content && 'chips' in slot.content;
            const secondary = id.startsWith('secondary-') && layout.mode === 'single-track' && !free;
            const change = (value: Partial<typeof slot>) => onChange(current => updateSlot(current, region.id, id, value));
            return <details className="editor-slot" key={id} data-slot={id}>
        <summary>{slotLabel(region, id)} <small>{secondary ? '单轨时不显示' : slot.enabled ? '已启用' : '未启用'}</small></summary>
        <label className="inline"><input type="checkbox" checked={slot.enabled} onChange={e => change({ enabled: e.target.checked, ...(!slot.content ? { content: emptySlot(id, free).content } : {}) })}/>显示此内容</label>
        {secondary && <p className="editor-note">切换为双轨后显示；已有内容会保留。</p>}
        {slot.enabled && slot.content && <>
          <ContentEditor content={slot.content} style={slot.style} showStyle={false} onUpdateContent={content => change({ content })} onUpdateStyle={style => change({ style })}/>
          {text && <details className="editor-local-style"><summary>此处文字样式 · {slot.style ? '独立设置' : '跟随默认'}</summary><label className="inline"><input type="checkbox" checked={slot.style !== null} onChange={e => change({ style: e.target.checked ? structuredClone(config.defaults ?? defaultStyle) : null })}/>使用独立样式</label>{slot.style && <TextStyle style={slot.style} onChange={style => change({ style })}/>}</details>}
        </>}
      </details>;
        })}
  </section>;
}
export function Editor({ config, onChange }: {
    config: ImprintConfig;
    onChange: Update;
}) {
    return <div className="watermark-editor">
    <details className="editor-section"><summary>默认文字样式</summary><p className="editor-note">应用于未设置独立样式的文字。</p><TextStyle style={config.defaults ?? defaultStyle} onChange={defaults => onChange(current => ({ ...current, defaults }))}/></details>
    {!config.regions.some(region => region.type !== 'free') && <p className="editor-note">当前没有信息边框。<button type="button" className="linklike" onClick={() => onChange(current => addRegion(current, false))}>恢复默认信息边框</button></p>}
    {config.regions.map(region => <RegionPanel key={region.id} region={region} config={config} onChange={onChange}/>)}
    <div className="editor-add"><button type="button" disabled={config.regions.length >= 10} onClick={() => onChange(current => addRegion(current, true))}>添加签名</button></div>
    <details className="editor-section"><summary>画布与共享文字</summary><div className="editor-fields">
      {(['top', 'right', 'bottom', 'left'] as const).map((edge, i) => <label key={edge}>{['上', '右', '下', '左'][i]}边距<input type="number" min={0} max={600} value={config.canvas.margins[edge]} onChange={e => { if (e.target.validity.valid && e.target.value)
        onChange(current => ({ ...current, canvas: { ...current.canvas, margins: { ...current.canvas.margins, [edge]: Number(e.target.value) } } })); }}/></label>)}
      <label>背景色<input type="color" value={config.canvas.background} onChange={e => onChange(current => ({ ...current, canvas: { ...current.canvas, background: e.target.value } }))}/></label>
      <label>圆角半径<input type="number" min={0} max={160} value={config.canvas.border_radius} onChange={e => { if (e.target.validity.valid && e.target.value)
        onChange(current => ({ ...current, canvas: { ...current.canvas, border_radius: Number(e.target.value) } })); }}/></label>
    </div><label>共享自定义文字<input maxLength={160} value={config.custom_text ?? ''} onChange={e => onChange(current => ({ ...current, custom_text: e.target.value }))}/></label><p className="editor-note">仅用于已添加但未填写内容的“自定义文字”字段；不会自动添加文字。</p></details>
  </div>;
}
