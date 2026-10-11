import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { KariImprintCanvas } from '../../../web/src/KariImprintCanvas';
import type { ImprintConfig } from '../../../web/src/types';
import type { ExifFieldValues, RuntimeCapabilities } from '../../../web/src/api';
import { api, type Album, type Asset, type Job, type Saved, type MaintenanceStatus } from './api';
import { Editor, editableConfig, serializeEditorConfig } from './editor';
import { buildDefaultConfig } from './defaults';
import '../../../web/src/styles.css';
import './style.css';
import {Gallery,useGallery} from './gallery';

const initial: ImprintConfig = buildDefaultConfig();
// Job errors are stable machine codes; show the operator what to do instead.
const errorLabel = (code: string | null | undefined): string => {
  switch (code) {
    case 'sync_unconfirmed': return '已生成，但长时间未能在 Immich 中确认收录，可重新保存';
    case 'render_failed': return '生成失败，请重试';
    case 'output_conflict': return '成品文件与已有内容冲突';
    case 'source_changed': return '源照片已变更，请重新保存';
    case 'publication_source_missing': return '发布所需的源文件缺失';
    case 'output_identity_changed': return '成品标识已变更，请重新保存';
    case 'queue_full': return '处理队列已满，请稍后再试';
    case 'insufficient_disk_space': return '磁盘空间不足';
    default: return code ? `处理失败：${code}` : '生成失败';
  }
};
const stateLabel = (job: Job | null, dirty: boolean): string => {
  if (!job) return dirty ? '有未保存的修改' : '未保存';
  switch (job.state) {
    case 'queued': case 'running': case 'publishing': return '正在生成…';
    case 'awaiting_import': return '已生成，等待 Immich 收录…';
    case 'refresh_pending': return '已保存，等待确认…';
    case 'done': return '已保存';
    case 'failed': return errorLabel(job.error);
    case 'superseded': return '已被新版本替代';
  }
};
function App() {
  const [maintenance,setMaintenance]=useState<MaintenanceStatus|null>(null);
  const [backupMessage,setBackupMessage]=useState('');
  const [backingUp,setBackingUp]=useState(false);
  const [authMode,setAuthMode]=useState<'loading'|'ready'|'error'>('loading');
  const [initialized,setInitialized]=useState(false);
  useEffect(()=>{api<{mode:string;initialized:boolean;authenticated:boolean}>('/auth/session').then(s=>{setInitialized(s.initialized);setLogged(s.authenticated);setAuthMode('ready');}).catch(()=>{setAuthMode('error');setMessage('登录服务暂时不可用，请刷新重试。');});},[]);
  const [logged,setLogged]=useState(false), [key,setKey]=useState(''), [email,setEmail]=useState(''), [password,setPassword]=useState(''), [authBusy,setAuthBusy]=useState(false), [message,setMessage]=useState('');
  const [albums,setAlbums]=useState<Album[]>([]), [albumsAvailable,setAlbumsAvailable]=useState(true), [album,setAlbum]=useState('');
  const gallery=useGallery(logged,album);
  const {assets}=gallery;
  const galleryNode=useRef<HTMLElement>(null),scrollPosition=useRef(0);
  const [active,setActive]=useState<Asset|null>(null), [config,setConfig]=useState<ImprintConfig>(initial), [revision,setRevision]=useState(0);
  const [previewSrc,setPreviewSrc]=useState('');
  const [bitmap,setBitmap]=useState<ImageBitmap|null>(null), [fields,setFields]=useState<ExifFieldValues>({});
  const [originalImageSize,setOriginalImageSize]=useState<{width:number;height:number}|null>(null);
  const [loadAttempt,setLoadAttempt]=useState(0);
  const [dirty,setDirty]=useState(false), [busy,setBusy]=useState(false), [job,setJob]=useState<Job|null>(null);
  const [caps,setCaps]=useState<RuntimeCapabilities|null>(null);
  const epoch=useRef(0), photoControl=useRef<AbortController|null>(null);
  // Local, per-photo draft + undo/redo.  A draft is stored on this device only;
  // nothing here claims to be an automatic save to Immich.
  const configRef=useRef(config);
  const [undoStack,setUndoStack]=useState<ImprintConfig[]>([]);
  const [redoStack,setRedoStack]=useState<ImprintConfig[]>([]);
  const [leavePrompt,setLeavePrompt]=useState<null|{action:()=>void}>(null);
  const draftKey = (id: string) => `ki-draft-${id}`;
  const readDraft = (id: string): ImprintConfig | null => {
    try { const raw = localStorage.getItem(draftKey(id)); return raw ? JSON.parse(raw) as ImprintConfig : null; }
    catch { return null; }
  };
  const writeDraft = (id: string, value: ImprintConfig) => {
    try { localStorage.setItem(draftKey(id), JSON.stringify(value)); } catch { /* ignore quota */ }
  };
  const clearDraft = (id: string) => { try { localStorage.removeItem(draftKey(id)); } catch { /* ignore */ } };
  useEffect(()=>{if(!logged)return;const refresh=()=>api<MaintenanceStatus>('/maintenance').then(setMaintenance).catch(()=>{});void refresh();const timer=setInterval(refresh,60000);return()=>clearInterval(timer);},[logged]);
  useEffect(()=>{if(logged)api<RuntimeCapabilities>('/capabilities').then(setCaps).catch(e=>setMessage(String(e)));},[logged]);
  useEffect(()=>{
    if(!logged)return;
    const control=new AbortController();
    api<{albums:Album[];available:boolean}>('/albums','GET',undefined,control.signal).then(data=>{setAlbums(data.albums);setAlbumsAvailable(data.available);}).catch(e=>{if(!control.signal.aborted)setAlbumsAvailable(false);});
    return ()=>control.abort();
  },[logged]);
  function commit(next: ImprintConfig) {
    setUndoStack(s=>[...s, configRef.current]);
    setRedoStack([]);
    configRef.current = next;
    setConfig(next);
    setDirty(true);
    if (active) writeDraft(active.id, next);
  }
  function undo() {
    if (!undoStack.length) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack([...redoStack, configRef.current]);
    configRef.current = prev;
    setConfig(prev);
    setDirty(true);
    if (active) writeDraft(active.id, prev);
  }
  function redo() {
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack([...undoStack, configRef.current]);
    configRef.current = next;
    setConfig(next);
    setDirty(true);
    if (active) writeDraft(active.id, next);
  }
  function resetEditor(){
    ++epoch.current;photoControl.current?.abort();
    setActive(null);setBitmap(null);setPreviewSrc('');setOriginalImageSize(null);
    setFields({});setJob(null);setBusy(false);setMessage('');setConfig(initial);setRevision(0);setDirty(false);
    setUndoStack([]);setRedoStack([]);configRef.current = initial;
  }
  function leaveEditor(action:()=>void, discard:boolean){
    if (active) { if (discard) clearDraft(active.id); }
    resetEditor();
    requestAnimationFrame(()=>{if(galleryNode.current)galleryNode.current.scrollTop=scrollPosition.current;});
    action();
  }
  function requestLeave(action:()=>void){
    if(dirty) setLeavePrompt({action});
    else leaveEditor(action,false);
  }
  function closeEditor(){ requestLeave(()=>{}); }
  function resetToDefault(){
    if(!active||busy)return;
    commit(editableConfig(buildDefaultConfig()));
    setMessage('已恢复默认样式；保存后才生效。');
  }
  function navigate(nextAlbum:string){
    if(nextAlbum===album)return;
    requestLeave(()=>{scrollPosition.current=0;setAlbum(nextAlbum);if(galleryNode.current)galleryNode.current.scrollTop=0;});
  }
  function selectAsset(asset:Asset){
    if(asset.id===active?.id)return;
    requestLeave(()=>{if(!active)scrollPosition.current=galleryNode.current?.scrollTop||0;setActive(asset);});
  }
  useEffect(()=>{
    if(!active)return;
    const id=++epoch.current, controller=new AbortController();
    photoControl.current=controller;
    let image:ImageBitmap|null=null;
    let objectUrl='';
    const timeout=setTimeout(()=>controller.abort(new Error('读取超时，请重试')),30000);
    setBitmap(null);setPreviewSrc('');setOriginalImageSize(null);setFields({});setJob(null);setRevision(0);setDirty(false);setBusy(true);setMessage('正在读取照片…');
    setUndoStack([]);setRedoStack([]);
    Promise.all([
      api<{job:Job|null}>(`/assets/${active.id}/job`,'GET',undefined,controller.signal),
      api<Saved>(`/assets/${active.id}/config`,'GET',undefined,controller.signal),
      api<{fields:ExifFieldValues;width:number;height:number}>(`/assets/${active.id}/metadata`,'GET',undefined,controller.signal),
      fetch(`/api/assets/${active.id}/preview`,{signal:controller.signal}).then(r=>{if(!r.ok)throw new Error('预览读取失败');return r.blob();}).then(b=>{if(!controller.signal.aborted&&id===epoch.current){objectUrl=URL.createObjectURL(b);setPreviewSrc(objectUrl);}return createImageBitmap(b);}).then(value=>{image=value;if(controller.signal.aborted||id!==epoch.current)value.close();return value;}),
    ]).then(([latest,saved,metadata,preview])=>{
      image=preview;
      if(id!==epoch.current || controller.signal.aborted){preview.close();return;}
      void document.fonts.load('700 16px "AkaSemiNoto"').then(()=>{if(id===epoch.current)setConfig(c=>({...c}));}).catch(()=>{});
      const draft = readDraft(active.id);
      const base = draft ?? editableConfig(saved.config||initial);
      configRef.current = base;
      setConfig(base);
      setDirty(!!draft);
      setJob(latest.job);setRevision(saved.revision);setFields(metadata.fields);setOriginalImageSize({width:metadata.width,height:metadata.height});setBitmap(preview);setMessage('');
    }).catch(e=>{if(id===epoch.current)setMessage(controller.signal.aborted?'照片读取超时，请重试或选择其他照片。':String(e));}).finally(()=>{clearTimeout(timeout);if(id===epoch.current)setBusy(false);});
    return ()=>{clearTimeout(timeout);++epoch.current;controller.abort();image?.close();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[active,loadAttempt]);
  useEffect(()=>{
    if(!job || !['queued','running','publishing','awaiting_import'].includes(job.state))return;
    const id=epoch.current, control=new AbortController();
    const timer=setTimeout(()=>api<Job>(`/jobs/${job.id}`,'GET',undefined,control.signal).then(j=>{if(id===epoch.current)setJob(j);}).catch(e=>{if(id===epoch.current){setMessage(String(e));setJob(j=>j?{...j}:j);}}),job.state==='awaiting_import'?5000:1000);
    return ()=>{clearTimeout(timer);control.abort();};
  },[job]);
  async function saveRender(){
    if(!active||!bitmap||busy)return;
    const id=epoch.current;setBusy(true);setMessage('');
    try{
      const saved=await api<Saved>(`/assets/${active.id}/config`,'PUT',{expectedRevision:revision,config:serializeEditorConfig(config)});
      if(id!==epoch.current)return;
      setRevision(saved.revision);setDirty(false);clearDraft(active.id);
      const task=await api<Job>(`/assets/${active.id}/render`,'POST',{revision:saved.revision,sourceAlbumId:album});
      if(id===epoch.current){setJob(task);gallery.setAssets(items=>items.map(a=>a.id===active.id?{...a,status:{configured:true,published:a.status?.published||false,job:task.state}}:a));}
    }catch(e){if(id===epoch.current)setMessage(String(e));}finally{if(id===epoch.current)setBusy(false);}
  }
  function downloadOutput(){
    if(!active||!job||!['awaiting_import','refresh_pending','done'].includes(job.state))return;
    const link=document.createElement('a');
    link.href=`/api/assets/${active.id}/output?generation=${job.generation}`;
    link.download=`${active.name.replace(/\.[^.]+$/,'')}-imprint.jpg`;
    document.body.appendChild(link);link.click();link.remove();
  }
  const saveRef=useRef(saveRender);
  saveRef.current=saveRender;
  useEffect(()=>{
    if(!logged)return;
    const onKey=(e:KeyboardEvent)=>{
      const tag=(e.target as HTMLElement|null)?.tagName||'';
      const typing=tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT';
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();if(!typing)void saveRef.current();return;}
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(!typing){if(e.shiftKey)redo();else undo();}return;}
      if(e.key==='Escape'&&active){e.preventDefault();closeEditor();return;}
      if(typing||!active||!assets.length)return;
      const step=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;
      if(!step)return;
      const index=assets.findIndex(a=>a.id===active?.id);
      const target=assets[index+step];
      if(!target)return;
      selectAsset(target);
    };
    window.addEventListener('keydown',onKey);
    return ()=>window.removeEventListener('keydown',onKey);
  },[logged,assets,active?.id,dirty,busy]);
  const editorEpoch=epoch.current;
  const destinationName = albums.find(a=>a.id===album)?.name ? `${albums.find(a=>a.id===album)!.name} Imprint` : 'Imprint';
  const status = stateLabel(job, dirty);
  if(!logged)return <main className="login"><h1>KARI IMPRINT</h1><p className="login-sub">IMMICH · KI — M1</p>{authMode==='loading'?<p className="login-wait">正在检查登录状态…</p>:authMode==='ready'?initialized?<form onSubmit={e=>{e.preventDefault();setAuthBusy(true);setMessage('');api('/auth/immich-login','POST',{email,password}).then(()=>{setLogged(true);setPassword('');}).catch(e=>setMessage(String(e))).finally(()=>setAuthBusy(false));}}><p className="login-hint-top">使用 Immich 账户登录（与关联面板同一个账户）。</p><label>Immich 邮箱<input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="username"/></label><label>Immich 密码<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password"/></label><button className="login-action" disabled={authBusy||!email||!password}>进入图库</button></form>:<form onSubmit={e=>{e.preventDefault();setAuthBusy(true);setMessage('');api('/init','POST',{key}).then(()=>{setInitialized(true);setLogged(true);setKey('');}).catch(e=>setMessage(String(e))).finally(()=>setAuthBusy(false));}}><p className="login-hint-top">首次部署或配置缺失：输入 Immich API Key 完成关联。之后日常使用下方的 Immich 账户密码登录。</p><label>Immich API Key<input type="password" value={key} onChange={e=>setKey(e.target.value)} autoComplete="off"/></label><button className="login-action" disabled={authBusy||!key}>关联并进入</button></form>:null}<p role="alert" className="login-alert">{message}</p></main>;
  return <div className="immich-app"><header><strong className="wordmark">KARI IMPRINT<span>IMMICH·KI / M1</span></strong><span className="head-note">源照片只读 · 成品独立保存</span><button className="head-logout" onClick={()=>{requestLeave(()=>{api('/auth/logout','POST').then(()=>location.replace('/')).catch(()=>setMessage('退出失败，请重试。'));});}}>退出</button></header>
    <div className={`workspace ${active?'editing':'browsing'}`}><aside className="library"><h2 className="rail-title">相册</h2>
      {!albumsAvailable&&<p role="alert">无法读取相册，请检查 Immich 的 album.read 权限。</p>}
      <div className="album-list">{albums.map(item=>{const result=item.isResult??item.name.trimEnd().toLowerCase().endsWith('imprint');return <button key={item.id} className={`album-card ${album===item.id?'selected':''}`} aria-label={item.name} aria-pressed={album===item.id} disabled={result} onClick={()=>navigate(item.id)}><span className="album-cover"><img src={`/api/albums/${item.id}/thumbnail`} alt="" loading="lazy" onError={e=>{e.currentTarget.style.visibility='hidden';}}/></span><span className="album-title">{item.name}<small>{result?'成品 · 只读':`${item.assetCount} 张`}</small></span></button>;})}</div>
    </aside>
    <main className="gallery-scroll" ref={galleryNode} hidden={!!active} aria-label="相册照片"><div className="gallery-heading"><h2>{albums.find(a=>a.id===album)?.name||'照片'}</h2><span>仅处理你选择的照片</span></div><Gallery assets={assets} loading={gallery.state==='loading'} error={gallery.error} next={gallery.next} onMore={gallery.load} onSelect={selectAsset} selectedAlbum={!!album}/></main>
      {active&&<main className="photo-editor"><div className="editor-toolbar"><button onClick={closeEditor} aria-label="关闭照片">← 返回相册</button><div className="statusbar" role="status"><span className="status-photo">{active.name}</span><span className="status-sep">·</span><span className="status-state">{status}</span>{job?.state==='done'&&<span className="status-dest">已保存到「{destinationName}」</span>}</div><div className="undo-bar"><button onClick={undo} disabled={!undoStack.length} aria-label="撤销">撤销</button><button onClick={redo} disabled={!redoStack.length} aria-label="重做">重做</button><button onClick={resetToDefault} disabled={!bitmap||busy} aria-label="重置为默认">重置</button></div></div>
        <div className="canvas-area">{active&&bitmap&&originalImageSize?<KariImprintCanvas originalImageSize={originalImageSize} runtimeCaps={caps} config={config} image={bitmap} fieldValues={fields} scheme="dark"/>:active?<div className="photo-loading"><img src={previewSrc||`/api/assets/${active.id}/thumbnail`} alt={active.name}/><p>{busy?(previewSrc?'预览已就绪，正在补齐配置和照片信息…':'正在读取照片预览…'):'照片尚未加载'}</p>{!busy&&<button onClick={()=>setLoadAttempt(n=>n+1)}>重新读取</button>}</div>:<p className="canvas-empty">从左侧选择一张照片开始</p>}</div>
        {message&&<p role="alert" className="alert-line">{message}</p>}
        <div className="destination-line">输出目的地：<strong>{destinationName}</strong><span className="destination-note">原照片保持不变，已有成品会更新</span></div>
        {active&&job&&['awaiting_import','refresh_pending','done'].includes(job.state)&&<a className="output-link" href={`/api/assets/${active.id}/output?generation=${job.generation}`} target="_blank" rel="noopener noreferrer">在 Immich 查看</a>}
      </main>}
      {active&&<aside className="controls"><h2 className="rail-title">照片信息框 · {active.name}</h2><div className="save-bar"><button className="save-action" disabled={!bitmap||busy} onClick={saveRender}>保存到 Immich{dirty?' *':''}</button><button className="reset-action" disabled={!bitmap||busy} onClick={resetToDefault}>重置为默认</button><button className="download-action" disabled={!job||!['awaiting_import','refresh_pending','done'].includes(job.state)} onClick={downloadOutput}>下载</button></div>
        <fieldset disabled={!bitmap||busy} key={active?.id||'empty'}><Editor config={config} onChange={update=>{if(epoch.current!==editorEpoch)return;const next=update(configRef.current);if(next!==configRef.current)commit(next);}}/></fieldset>
        {job&&['awaiting_import','refresh_pending'].includes(job.state)&&<button disabled={busy} onClick={()=>{const id=epoch.current;setBusy(true);api<Job>(`/jobs/${job.id}/sync`,'POST').then(value=>{if(id===epoch.current)setJob(value);}).catch(e=>{if(id===epoch.current)setMessage(String(e));}).finally(()=>{if(id===epoch.current)setBusy(false);});}}>重新检查入库</button>}
        <details className="maintenance"><summary>系统 · 维护与备份{maintenance?.issues.length?` [${maintenance.issues.length}]`:''}</summary>
          {maintenance?<><p className="sys-line">FREE {(maintenance.freeBytes/1024**3).toFixed(1)} GB</p>{maintenance.freeBytes<maintenance.minimumFreeBytes&&<p role="alert" className="alert-line">可用空间不足，暂不能生成或上传资源。</p>}{maintenance.issues.length>0&&<p role="alert" className="alert-line">发现源照片、成品或资源异常，已保留文件，请检查后再生成。</p>}{maintenance.issues.map(issue=><p className="sys-line" key={issue.assetId}>{assets.find(a=>a.id===issue.assetId)?.name||issue.assetId.slice(0,8)} — {({source_moved:'源照片路径已变更',source_missing:'源照片已不可用',upstream_unavailable:'暂时无法连接 Immich',output_missing:'成品文件缺失',output_changed:'成品被外部修改',source_or_resource_unavailable:'源照片或资源缺失'} as Record<string,string>)[issue.issue]||'需要检查'}</p>)}</>:<p className="sys-line">正在读取维护状态…</p>}
          <button disabled={backingUp} onClick={()=>{setBackingUp(true);setBackupMessage('正在备份配置和资源…');api<{backupId:string;files:number}>('/maintenance/backup','POST').then(result=>setBackupMessage(`备份已保存：${result.backupId}`)).catch(()=>setBackupMessage('备份失败，请检查可用空间。')).finally(()=>setBackingUp(false));}}>备份配置与资源</button><p role="status" className="sys-line">{backupMessage}</p></details>
        <small className="foot-note">生成后自动检查入库与请求刷新；Immich 若显示旧图，刷新页面即可。当前为隔离预览版。</small>
      </aside>}
    </div>
    {leavePrompt&&<div className="leave-modal" role="dialog" aria-modal="true"><div className="leave-card"><h3>有未保存的修改</h3><p className="editor-note">当前照片的修改尚未保存到 Immich。你可以保留本机草稿，之后回到这张照片继续编辑。</p><div className="leave-actions"><button className="save-action" onClick={()=>{const a=leavePrompt.action;setLeavePrompt(null);leaveEditor(a,false);}}>保存草稿并离开</button><button onClick={()=>{const a=leavePrompt.action;setLeavePrompt(null);leaveEditor(a,true);}}>放弃修改</button><button onClick={()=>setLeavePrompt(null)}>继续编辑</button></div></div></div>}
    </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
