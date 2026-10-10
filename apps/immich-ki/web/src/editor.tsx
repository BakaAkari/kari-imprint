import { useEffect, useState } from 'react';
import { fetchLogos, type LogoVariant } from '../../../web/src/api';
import { InspectorPanel } from '../../../web/src/components/InspectorPanel';
import { defaultStyle, defaultFlowLayout, fieldOptions, mergeSlotOverride, normalizeStylePatch, type FieldChip, type FieldId, type ImprintConfig, type RegionConfig, type RootOverrides, type SlotOverride, type TextContent } from '../../../web/src/types';
import { QUICK_FIELD_OPTIONS } from './defaults';

/** Add disabled editing slots without changing the saved composition. */
export function editableConfig(value: ImprintConfig): ImprintConfig {
  const config = structuredClone(value);
  for (const region of config.regions) {
    region.slots ??= {};
    if (region.type === 'free') continue;
    for (const id of ['primary-start', 'primary-end', 'secondary-start', 'secondary-end']) {
      region.slots[id] ??= {enabled:false, style:null, content:null};
      region.slots[id].content ??= {chips:[], separator:' '};
    }
    region.slots.asset ??= {enabled:false, style:null, content:null};
    region.slots.asset.content ??= {path:'',size_level:'medium',size_ratio:null,orientation:'upright',placement:'center',track:'span'};
  }
  if (!config.regions.some(r => r.type === 'free')) {
    let id = 'signature';
    while (config.regions.some(r => r.id === id)) id += '-extra';
    config.regions.push({id,type:'free',enabled:false,anchor:'bottom-right',offset_x:-0.02,offset_y:-0.02,offset_unit:'short_edge_ratio',slots:{sig1:{enabled:true,style:null,content:{path:'',invert_mono:false,size_level:'small',size_ratio:null,orientation:'upright',placement:'end',track:'span'}}}});
  }
  return config;
}

function TrackFields({title, chips, separator, onChange}: {title:string; chips:FieldChip[]; separator:string; onChange:(chips:FieldChip[], separator:string)=>void}) {
  const active = new Set(chips.map(c => c.field_id));
  const toggle = (id:FieldId, checked:boolean) => {
    // Keep canonical option order; preserve any non-quick fields (e.g. custom_text) as-is.
    const extras = chips.filter(c => !QUICK_FIELD_OPTIONS.includes(c.field_id)).map(c => c.field_id);
    const nextIds = QUICK_FIELD_OPTIONS.filter(f => (f === id ? checked : active.has(f)));
    onChange([...nextIds, ...extras].map(fid => chips.find(c => c.field_id === fid) ?? { field_id: fid }), separator);
  };
  return <fieldset className="track-fields"><legend>{title}</legend>
    {QUICK_FIELD_OPTIONS.map(id => <label key={id} className="inline"><input type="checkbox" checked={active.has(id)} onChange={e=>toggle(id, e.target.checked)}/>{fieldOptions.find(o=>o.id===id)?.label||id}</label>)}
  </fieldset>;
}

export function Editor({config,onChange}: {config:ImprintConfig;onChange:(update:(value:ImprintConfig)=>ImprintConfig)=>void}) {
  const [logos,setLogos]=useState<LogoVariant[]>([]);
  useEffect(()=>{void fetchLogos().then(setLogos).catch(()=>setLogos([]));},[]);
  const flow = config.regions.find(r => r.type === 'footer-bar' || r.type === 'side-bar');
  function region(id:string, patch:Partial<RegionConfig>) {
    onChange(current=>({...current,regions:current.regions.map(r=>r.id===id?{...r,...patch}:r)}));
  }
  function root(patch:Partial<RootOverrides>) {
    onChange(current=>({...current,
      canvas: {...current.canvas,...patch.canvas,margins:{...current.canvas.margins,...patch.canvas?.margins}},
      defaults:normalizeStylePatch(current.defaults||defaultStyle,patch.defaults||{}),
    }));
  }
  function slot(key:string, patch:SlotOverride) {
    const split=key.lastIndexOf(':');const id=key.slice(0,split),slotId=key.slice(split+1);
    onChange(current=>({...current,regions:current.regions.map(r=>r.id!==id?r:{...r,slots:{...r.slots,[slotId]:mergeSlotOverride(r.slots?.[slotId]||{enabled:false,content:null,style:null},patch)}})}));
  }
  return <>
    {flow && <div className="editor-basics">
      <label>设备 Logo<select aria-label="设备 Logo" value={!flow.slots?.asset?.enabled?'none':(flow.slots.asset.content&&'path' in flow.slots.asset.content&&flow.slots.asset.content.path?flow.slots.asset.content.path:'auto')} onChange={e=>{
        const value=e.target.value;
        slot(`${flow.id}:asset`,{enabled:value!=='none',content:{path:value==='auto'||value==='none'?'':value}});
      }}><option value="none">不显示</option><option value="auto">按照片品牌自动匹配</option>{logos.map(logo=><option key={logo.stem} value={`builtin:${logo.stem}`}>{logo.stem}</option>)}{flow.slots?.asset?.content&&'path' in flow.slots.asset.content&&flow.slots.asset.content.path&&!flow.slots.asset.content.path.startsWith('builtin:')&&<option value={flow.slots.asset.content.path}>当前上传的 Logo</option>}</select></label>
      <label>边框位置<select aria-label="边框位置" value={flow.type==='footer-bar'?'footer':flow.edge==='left'?'left':'right'} onChange={e=>{
        const footer=e.target.value==='footer';
        region(flow.id,{type:footer?'footer-bar':'side-bar',edge:footer?undefined:e.target.value as 'left'|'right',height:footer?0.15:undefined,width:footer?undefined:{mode:'short_edge_ratio',value:0.12}});
      }}><option value="footer">底栏</option><option value="left">左侧栏</option><option value="right">右侧栏</option></select></label>
      <label>排版轨道<select aria-label="排版轨道" value={flow.layout?.mode||'single-track'} onChange={e=>region(flow.id,{layout:{...defaultFlowLayout(),...flow.layout,mode:e.target.value as 'single-track'|'dual-track'}})}><option value="single-track">单轨</option><option value="dual-track">双轨</option></select></label>
      {flow.type==='footer-bar' && <label>底栏高度<input type="range" min="0.05" max="0.35" step="0.01" value={flow.height||0.15} onChange={e=>region(flow.id,{height:Number(e.target.value)})}/></label>}
    </div>}
    {flow && <div className="editor-typography">
      <label>字号比例<input type="range" min={0.5} max={2} step={0.05} value={config.defaults?.font_size_ratio ?? 1} onChange={e=>root({defaults:{font_size_ratio:Number(e.target.value)}})}/></label>
      <div className="type-row">
        <label>文字颜色<input type="color" value={config.defaults?.color||'#222222'} onChange={e=>root({defaults:{color:e.target.value}})}/></label>
        <label>字体<select aria-label="字体" value={config.defaults?.font_family||'NotoSansCJKsc-Bold.otf'} onChange={e=>root({defaults:{font_family:e.target.value as 'NotoSansCJKsc-Bold.otf'|'NotoSansCJKsc-Regular.otf'}})}><option value="NotoSansCJKsc-Bold.otf">粗体</option><option value="NotoSansCJKsc-Regular.otf">常规</option></select></label>
        <label className="inline"><input type="checkbox" checked={config.defaults?.bold ?? true} onChange={e=>root({defaults:{bold:e.target.checked}})}/>加粗</label>
      </div>
      {(['primary-start','secondary-start'] as const).map(key => {
        const slotConfig = flow.slots?.[key];
        const content = slotConfig?.content && 'chips' in slotConfig.content ? slotConfig.content as TextContent : {chips:[],separator:key==='primary-start'?' ':' · '};
        return <TrackFields key={key} title={key==='primary-start'?'上排文字字段':'下排文字字段'} chips={content.chips} separator={content.separator} onChange={(next,sep)=>slot(`${flow.id}:${key}`,{content:{chips:next,separator:sep}})}/>;
      })}
    </div>}
    <label>自定义文字<input maxLength={500} value={config.custom_text||''} onChange={e=>{const text=e.target.value;onChange(current=>({...current,custom_text:text}));}}/></label>
    <details className="advanced-params">
      <summary>高级参数 · ADVANCED</summary>
      <p className="editor-note">展开区域可编辑文字、Logo 和签名。自定义文字需添加到对应文字字段中。</p>
      <InspectorPanel config={config} onRegionOverride={region} onRootOverride={root} onSlotOverride={slot}/>
    </details>
  </>;
}
