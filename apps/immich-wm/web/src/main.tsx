import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { KariImprintCanvas } from '../../../web/src/KariImprintCanvas';
import { defaultStyle, type ImprintConfig } from '../../../web/src/types';
import type { ExifFieldValues, RuntimeCapabilities } from '../../../web/src/api';
import { api, type Album, type Asset, type AssetStatus, type Job, type Saved, type MaintenanceStatus } from './api';
import { Editor, editableConfig } from './editor';
import '../../../web/src/styles.css';
import './style.css';

const initial: ImprintConfig = {
  schema_version: 3, canvas: {margins: {top:0,right:0,bottom:0,left:0},background:'#FFFFFF',border_radius:0,border:{enabled:false,width_level:'medium',color:'#FFFFFF'}},
  regions: [{id:'footer',type:'footer-bar',enabled:true,height:0.15,slots:{
    'primary-start': {enabled:true,style:null,content:{chips:[{field_id:'camera_model'}],separator:' '}},
    'primary-end': {enabled:true,style:null,content:{chips:[{field_id:'aperture'},{field_id:'shutter'},{field_id:'iso'}],separator:' · '}}
  }}], defaults:defaultStyle,custom_text:'',logo_position:'right',
};
const labels: Record<Job['state'],string> = {queued:'排队中',running:'渲染中',publishing:'保存成品',awaiting_import:'待入库',refresh_pending:'已请求刷新',done:'完成',failed:'失败',superseded:'已替代'};
function Thumbnail({id}:{id:string}) {
  const [failed,setFailed]=useState(false);
  return <span className="asset-thumb">{failed?<span>无缩略图</span>:<img src={`/api/assets/${id}/thumbnail`} alt="" loading="lazy" decoding="async" onError={()=>setFailed(true)}/>}</span>;
}
const ACTIVE_BADGE = new Set(['queued','running','publishing','awaiting_import','refresh_pending']);
function badge(status?: AssetStatus): {cls:string;text:string} | null {
  if (!status || (!status.configured && !status.job && !status.published)) return null;
  if (status.job === 'queued' || status.job === 'running' || status.job === 'publishing') return {cls:'busy', text:'处理中'};
  if (status.job === 'awaiting_import') return {cls:'wait', text:'待入库'};
  if (status.job === 'refresh_pending') return {cls:'wait', text:'已请求刷新'};
  if (status.job === 'failed') return {cls:'bad', text:'失败'};
  if (status.published) return {cls:'done', text:'已出图'};
  if (status.configured) return {cls:'saved', text:'已保存'};
  return null;
}
function App() {
  const [maintenance,setMaintenance]=useState<MaintenanceStatus|null>(null);
  const [backupMessage,setBackupMessage]=useState('');
  const [backingUp,setBackingUp]=useState(false);
  const [authMode,setAuthMode]=useState<'loading'|'ready'|'error'>('loading');
  const [initialized,setInitialized]=useState(false);
  useEffect(()=>{api<{mode:string;initialized:boolean;authenticated:boolean}>('/auth/session').then(s=>{setInitialized(s.initialized);setLogged(s.authenticated);setAuthMode('ready');}).catch(()=>{setAuthMode('error');setMessage('登录服务暂时不可用，请刷新重试。');});},[]);
  const [logged,setLogged]=useState(false), [key,setKey]=useState(''), [email,setEmail]=useState(''), [password,setPassword]=useState(''), [authBusy,setAuthBusy]=useState(false), [message,setMessage]=useState('');
  const [assets,setAssets]=useState<Asset[]>([]), [page,setPage]=useState(1), [next,setNext]=useState<string|null>(null);
  const [albums,setAlbums]=useState<Album[]>([]), [albumsAvailable,setAlbumsAvailable]=useState(true), [album,setAlbum]=useState('');
  const [active,setActive]=useState<Asset|null>(null), [config,setConfig]=useState<ImprintConfig>(initial), [revision,setRevision]=useState(0);
  const [previewSrc,setPreviewSrc]=useState('');
  const [bitmap,setBitmap]=useState<ImageBitmap|null>(null), [fields,setFields]=useState<ExifFieldValues>({});
  const [originalImageSize,setOriginalImageSize]=useState<{width:number;height:number}|null>(null);
  const [loadAttempt,setLoadAttempt]=useState(0);
  const [dirty,setDirty]=useState(false), [busy,setBusy]=useState(false), [job,setJob]=useState<Job|null>(null);
  const [caps,setCaps]=useState<RuntimeCapabilities|null>(null);
  const epoch=useRef(0);
  useEffect(()=>{if(!logged)return;const refresh=()=>api<MaintenanceStatus>('/maintenance').then(setMaintenance).catch(()=>{});void refresh();const timer=setInterval(refresh,60000);return()=>clearInterval(timer);},[logged]);
  useEffect(()=>{if(logged)api<RuntimeCapabilities>('/capabilities').then(setCaps).catch(e=>setMessage(String(e)));},[logged]);
  useEffect(()=>{
    if(!logged)return;
    const control=new AbortController();
    api<{albums:Album[];available:boolean}>('/albums','GET',undefined,control.signal).then(data=>{setAlbums(data.albums);setAlbumsAvailable(data.available);}).catch(e=>{if(!control.signal.aborted)setAlbumsAvailable(false);});
    return ()=>control.abort();
  },[logged]);
  const loadPage=(page:number,album:string,signal?:AbortSignal)=>api<{items:Asset[];nextPage:string|null}>(`/assets?page=${page}${album?`&album=${album}`:''}`,'GET',undefined,signal).then(data=>{setAssets(data.items);setNext(data.nextPage);});
  useEffect(()=>{
    if(!logged)return;
    const control=new AbortController();
    loadPage(page,album,control.signal).catch(e=>{if(!control.signal.aborted)setMessage(String(e));});
    return ()=>control.abort();
  },[logged,page,album]);
  useEffect(()=>{
    if(!logged||!assets.some(asset=>asset.status&&ACTIVE_BADGE.has(asset.status.job!)))return;
    const timer=setInterval(()=>{loadPage(page,album).catch(()=>{});},5000);
    return ()=>clearInterval(timer);
  },[logged,page,album,assets]);
  useEffect(()=>{
    if(!active)return;
    const id=++epoch.current, controller=new AbortController();
    let image:ImageBitmap|null=null;
    let objectUrl='';
    const timeout=setTimeout(()=>controller.abort(new Error('读取超时，请重试')),30000);
    setBitmap(null);setPreviewSrc('');setOriginalImageSize(null);setFields({});setJob(null);setBusy(true);setMessage('正在读取照片…');
    Promise.all([
      api<{job:Job|null}>(`/assets/${active.id}/job`,'GET',undefined,controller.signal),
      api<Saved>(`/assets/${active.id}/config`,'GET',undefined,controller.signal),
      api<{fields:ExifFieldValues;width:number;height:number}>(`/assets/${active.id}/metadata`,'GET',undefined,controller.signal),
      fetch(`/api/assets/${active.id}/preview`,{signal:controller.signal}).then(r=>{if(!r.ok)throw new Error('预览读取失败');return r.blob();}).then(b=>{if(!controller.signal.aborted&&id===epoch.current){objectUrl=URL.createObjectURL(b);setPreviewSrc(objectUrl);}return createImageBitmap(b);}).then(value=>{image=value;if(controller.signal.aborted)value.close();return value;}),
    ]).then(([latest,saved,metadata,preview])=>{
      image=preview;
      if(id!==epoch.current || controller.signal.aborted){preview.close();return;}
      // Redraw silently once the preview webfont arrives; fallback fonts stay
      // usable in the meantime and no misleading message is shown.
      void document.fonts.load('700 16px "AkaSemiNoto"').then(()=>{if(id===epoch.current)setConfig(c=>({...c}));}).catch(()=>{});
      setConfig(editableConfig(saved.config||initial));setJob(latest.job);setRevision(saved.revision);setFields(metadata.fields);setOriginalImageSize({width:metadata.width,height:metadata.height});setBitmap(preview);setDirty(false);setMessage('');
    }).catch(e=>{if(id===epoch.current)setMessage(controller.signal.aborted?'照片读取超时，请重试或选择其他照片。':String(e));}).finally(()=>{clearTimeout(timeout);if(id===epoch.current)setBusy(false);});
    return ()=>{clearTimeout(timeout);++epoch.current;controller.abort();image?.close();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[active,loadAttempt]);
  useEffect(()=>{
    if(!job || !['queued','running','publishing','awaiting_import'].includes(job.state))return;
    const id=epoch.current;
    const timer=setTimeout(()=>api<Job>(`/jobs/${job.id}`).then(j=>{if(id===epoch.current)setJob(j);}).catch(e=>{if(id===epoch.current){setMessage(String(e));setJob(j=>j?{...j}:j);}}),job.state==='awaiting_import'?5000:1000);
    return ()=>clearTimeout(timer);
  },[job]);
  async function saveRender(){
    if(!active)return;
    const id=epoch.current;setBusy(true);setMessage('');
    try{
      const saved=await api<Saved>(`/assets/${active.id}/config`,'PUT',{expectedRevision:revision,config});
      if(id!==epoch.current)return;
      setRevision(saved.revision);setDirty(false);
      const task=await api<Job>(`/assets/${active.id}/render`,'POST',{revision:saved.revision});
      if(id===epoch.current)setJob(task);
    }catch(e){if(id===epoch.current)setMessage(String(e));}finally{if(id===epoch.current)setBusy(false);}
  }
  const editorEpoch=epoch.current;
  if(!logged)return <main className="login"><h1>KARI IMPRINT</h1><p className="login-sub">IMMICH · WM — M1</p>{authMode==='loading'?<p className="login-wait">正在检查登录状态…</p>:authMode==='ready'?initialized?<form onSubmit={e=>{e.preventDefault();setAuthBusy(true);setMessage('');api('/auth/immich-login','POST',{email,password}).then(()=>{setLogged(true);setPassword('');}).catch(e=>setMessage(String(e))).finally(()=>setAuthBusy(false));}}><p className="login-hint-top">使用 Immich 账户登录（与关联面板同一个账户）。</p><label>Immich 邮箱<input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="username"/></label><label>Immich 密码<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password"/></label><button className="login-action" disabled={authBusy||!email||!password}>进入图库</button></form>:<form onSubmit={e=>{e.preventDefault();setAuthBusy(true);setMessage('');api('/init','POST',{key}).then(()=>{setInitialized(true);setLogged(true);setKey('');}).catch(e=>setMessage(String(e))).finally(()=>setAuthBusy(false));}}><p className="login-hint-top">首次部署或配置缺失：输入 Immich API Key 完成关联。之后日常使用下方的 Immich 账户密码登录。</p><label>Immich API Key<input type="password" value={key} onChange={e=>setKey(e.target.value)} autoComplete="off"/></label><button className="login-action" disabled={authBusy||!key}>关联并进入</button></form>:null}<p role="alert" className="login-alert">{message}</p></main>;
  return <div className="immich-app"><header><strong className="wordmark">KARI IMPRINT<span>IMMICH·WM / M1</span></strong><span className="head-note">源照片只读 · 成品独立保存</span><button className="head-logout" onClick={()=>{if(dirty&&!window.confirm('退出将放弃未保存的修改，继续？'))return;api('/auth/logout','POST').then(()=>location.replace('/')).catch(()=>setMessage('退出失败，请重试。'));}}>退出</button></header>
    <div className="workspace"><aside className="library"><h2 className="rail-title">01 · 图库</h2>
        {albumsAvailable?<label className="album-filter">相册过滤<select aria-label="相册过滤" value={album} disabled={busy} onChange={e=>{setAlbum(e.target.value);setPage(1);}}><option value="">全部照片</option>{albums.map(item=><option key={item.id} value={item.id}>{item.name}（{item.assetCount}）</option>)}</select></label>:<p className="album-note">相册过滤需要 Immich key 具备 album.read 权限，当前不可用。</p>}
        <div className="asset-list">{assets.map(asset=>{const mark=badge(asset.status);return <button key={asset.id} disabled={busy} aria-label={asset.name} aria-pressed={active?.id===asset.id} title={asset.name} className={`asset-card ${active?.id===asset.id?'selected':''}`} onClick={()=>{if(dirty&&!window.confirm('放弃当前未保存的修改？'))return;setActive(asset);}}><span className="asset-thumb-wrap"><Thumbnail id={asset.id}/>{mark&&<span className={`asset-badge ${mark.cls}`}>{mark.text}</span>}</span><span className="asset-name">{asset.name}</span></button>;})}</div><nav><button disabled={page===1||busy} onClick={()=>setPage(page-1)}>上一页</button><span className="page-no">{String(page).padStart(2,'0')}</span><button disabled={!next||busy} onClick={()=>setPage(page+1)}>下一页</button></nav></aside>
      <main><div className="statusbar" role="status">{active?`${active.name} — REV ${revision}${job?` — GEN ${job.generation} — ${labels[job.state]}`:''}`:'未选择照片'}{job?.error?` — ${job.error}`:''}</div>
        <div className="canvas-area">{active&&bitmap&&originalImageSize?<KariImprintCanvas originalImageSize={originalImageSize} runtimeCaps={caps} config={config} image={bitmap} fieldValues={fields} scheme="dark"/>:active?<div className="photo-loading"><img src={previewSrc||`/api/assets/${active.id}/thumbnail`} alt={active.name}/><p>{busy?(previewSrc?'预览已就绪，正在补齐配置和照片信息…':'正在读取照片预览…'):'照片尚未加载'}</p>{!busy&&<button onClick={()=>setLoadAttempt(n=>n+1)}>重新读取</button>}</div>:<p className="canvas-empty">从左侧选择一张照片开始</p>}</div>
        {message&&<p role="alert" className="alert-line">{message}</p>}
        {active&&job&&['awaiting_import','refresh_pending','done'].includes(job.state)&&<a className="output-link" href={`/api/assets/${active.id}/output?generation=${job.generation}`} target="_blank" rel="noopener noreferrer">查看成品 ↗ GEN {job.generation}</a>}
      </main>
      <aside className="controls"><h2 className="rail-title">02 · 参数{active?` / ${active.name}`:''}</h2><div className="save-bar"><button className="save-action" disabled={!bitmap||busy} onClick={saveRender}>保存并生成{dirty?' *':''}</button><span className="rev-tag">REV {revision}</span></div>
        <fieldset disabled={!bitmap||busy} key={active?.id||'empty'}><Editor config={config} onChange={value=>{if(epoch.current!==editorEpoch)return;setConfig(value);setDirty(true);}}/></fieldset>
        {job&&['awaiting_import','refresh_pending'].includes(job.state)&&<button disabled={busy} onClick={()=>{setBusy(true);api<Job>(`/jobs/${job.id}/sync`,'POST').then(setJob).catch(e=>setMessage(String(e))).finally(()=>setAuthBusy(false));}}>重新检查入库</button>}
        <details className="maintenance"><summary>系统 · 维护与备份{maintenance?.issues.length?` [${maintenance.issues.length}]`:''}</summary>
          {maintenance?<><p className="sys-line">FREE {(maintenance.freeBytes/1024**3).toFixed(1)} GB</p>{maintenance.freeBytes<maintenance.minimumFreeBytes&&<p role="alert" className="alert-line">可用空间不足，暂不能生成或上传资源。</p>}{maintenance.issues.length>0&&<p role="alert" className="alert-line">发现源照片、成品或资源异常，已保留文件，请检查后再生成。</p>}{maintenance.issues.map(issue=><p className="sys-line" key={issue.assetId}>{assets.find(a=>a.id===issue.assetId)?.name||issue.assetId.slice(0,8)} — {({source_moved:'源照片路径已变更',source_missing:'源照片已不可用',upstream_unavailable:'暂时无法连接 Immich',output_missing:'成品文件缺失',output_changed:'成品被外部修改',source_or_resource_unavailable:'源照片或资源缺失'} as Record<string,string>)[issue.issue]||'需要检查'}</p>)}</>:<p className="sys-line">正在读取维护状态…</p>}
          <button disabled={backingUp} onClick={()=>{setBackingUp(true);setBackupMessage('正在备份配置和资源…');api<{backupId:string;files:number}>('/maintenance/backup','POST').then(result=>setBackupMessage(`备份已保存：${result.backupId}`)).catch(()=>setBackupMessage('备份失败，请检查可用空间。')).finally(()=>setBackingUp(false));}}>备份配置与资源</button><p role="status" className="sys-line">{backupMessage}</p></details>
        <small className="foot-note">生成后自动检查入库与请求刷新；Immich 若显示旧图，刷新页面即可。当前为隔离预览版。</small>
      </aside>
    </div></div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
