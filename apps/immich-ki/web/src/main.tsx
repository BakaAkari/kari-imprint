import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ImprintConfig } from '../../../web/src/types';
import type { ExifFieldValues, RuntimeCapabilities } from '../../../web/src/api';
import { api, errorText, hasOutput, isBusy, type Album, type Asset, type Job, type MaintenanceStatus, type Saved } from './api';
import { Editor, editableConfig, serializeEditorConfig, type Commit } from './editor';
import { applyStylePreset, frameRegion, selectionElementId, selectionFromElementId, setFramePosition, type Selection } from './editor-state';
import { buildDefaultConfig, STYLE_PRESETS } from './defaults';
import { Gallery, photoStatus, useGallery, type GalleryFilter } from './gallery';
import { useEditorDoc } from './history';
import { Filmstrip, PreviewStage } from './preview';
import { clipboardStore, draftStore, useJobTracker } from './store';
import './style.css';

const initial: ImprintConfig = buildDefaultConfig();

const JOB_TEXT: Record<string, string> = {
  queued: '排队中…', running: '正在生成…', publishing: '正在写入成品…',
  awaiting_import: '已生成，等待 Immich 收录…', refresh_pending: '已收录，等待 Immich 刷新…',
};
const FAILURE_TEXT: Record<string, string> = {
  sync_unconfirmed: '已生成，但长时间未能在 Immich 中确认收录',
  render_failed: '生成失败',
  output_conflict: '成品文件与已有内容冲突',
  source_changed: '源照片已变更',
  publication_source_missing: '发布所需的源文件缺失',
  output_identity_changed: '成品标识已变更',
  queue_full: '处理队列已满',
  insufficient_disk_space: '磁盘空间不足',
  output_too_large: '成品超过像素上限，请减小留白或信息条',
  image_too_large: '照片超过像素上限',
  unsupported_image: '照片格式不受支持',
};
const ISSUE_TEXT: Record<string, string> = {
  source_moved: '源照片路径已变更', source_missing: '源照片已不可用', upstream_unavailable: '暂时无法连接 Immich',
  output_missing: '成品文件缺失', output_changed: '成品被外部修改', source_or_resource_unavailable: '源照片或资源缺失',
};

type Tone = 'idle' | 'dirty' | 'busy' | 'good' | 'bad';
type PhotoData = { id: string; bitmap: ImageBitmap; size: { width: number; height: number }; fields: ExifFieldValues; revision: number };

const SHORTCUTS: [string, string][] = [
  ['← / →', '上一张 / 下一张'], ['1 – 5', '切换样式'], ['B / L / R', '信息条在底部 / 左侧 / 右侧'],
  ['Z', '放大检查 / 适应窗口'], ['按住 空格', '查看原图'], ['⌘S', '保存到 Immich'], ['⌘↩', '保存并下一张'],
  ['⌘Z / ⇧⌘Z', '撤销 / 重做'], ['⇧C / ⇧V', '复制 / 粘贴设置'], ['Esc', '取消选中 → 返回图库'], ['?', '显示快捷键'],
];

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
  if (tag !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return !['checkbox', 'radio', 'range', 'button', 'color', 'file'].includes(type);
}

function Login({ initialized, mode, onDone }: { initialized: boolean; mode: 'loading' | 'ready' | 'error'; onDone: (init: boolean) => void }) {
  const [key, setKey] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState(mode === 'error' ? '登录服务暂时不可用，请刷新重试。' : '');
  const submit = (path: string, body: unknown, init: boolean) => { setBusy(true); setMessage(''); api(path, 'POST', body).then(() => onDone(init)).catch(e => setMessage(errorText(e))).finally(() => setBusy(false)); };
  return <main className="login">
    <h1>KARI IMPRINT</h1><p className="login-sub">为 Immich 照片加上摄影信息边框</p>
    {mode === 'loading' ? <p className="hint">正在检查登录状态…</p> : mode === 'ready' && initialized
      ? <form onSubmit={e => { e.preventDefault(); submit('/auth/immich-login', { email, password }, false); }}>
        <label>Immich 邮箱<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" autoFocus /></label>
        <label>Immich 密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>
        <button className="primary" disabled={busy || !email || !password}>{busy ? '正在登录…' : '登录'}</button>
        <p className="hint">使用与面板关联的同一个 Immich 账户。</p>
      </form>
      : mode === 'ready' ? <form onSubmit={e => { e.preventDefault(); submit('/init', { key }, true); }}>
        <p className="hint">首次使用：输入 Immich API Key 完成关联。之后用 Immich 账户密码登录。</p>
        <label>Immich API Key<input type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" autoFocus /></label>
        <button className="primary" disabled={busy || !key}>{busy ? '正在关联…' : '关联并进入'}</button>
      </form> : null}
    <p role="alert" className="login-alert">{message}</p>
  </main>;
}

function Maintenance({ assets }: { assets: Asset[] }) {
  const [status, setStatus] = useState<MaintenanceStatus | null>(null), [backup, setBackup] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { const refresh = () => api<MaintenanceStatus>('/maintenance').then(setStatus).catch(() => {}); void refresh(); const timer = setInterval(refresh, 60000); return () => clearInterval(timer); }, []);
  const low = status ? status.freeBytes < status.minimumFreeBytes : false;
  const count = (status?.issues.length ?? 0) + (low ? 1 : 0);
  return <details className="menu">
    <summary className={count ? 'warn' : ''}>系统{count ? ` · ${count}` : ''}</summary>
    <div className="menu-card">
      {status ? <>
        <p>可用空间 {(status.freeBytes / 1024 ** 3).toFixed(1)} GB</p>
        {low && <p className="bad">可用空间不足，暂不能生成或上传资源。</p>}
        {status.issues.length > 0 && <p className="bad">发现源照片、成品或资源异常，相关文件已保留。</p>}
        {status.issues.map(issue => <p key={issue.assetId}>{assets.find(a => a.id === issue.assetId)?.name || issue.assetId.slice(0, 8)} — {ISSUE_TEXT[issue.issue] || '需要检查'}</p>)}
      </> : <p>正在读取维护状态…</p>}
      <button type="button" disabled={busy} onClick={() => { setBusy(true); setBackup('正在备份配置和资源…'); api<{ backupId: string }>('/maintenance/backup', 'POST').then(r => setBackup(`备份已保存：${r.backupId}`)).catch(() => setBackup('备份失败，请检查可用空间。')).finally(() => setBusy(false)); }}>备份配置与资源</button>
      {backup && <p role="status">{backup}</p>}
      <p className="hint">原照片只读；成品写入独立的 Imprint 相册。Immich 若显示旧图，刷新页面即可。</p>
    </div>
  </details>;
}

function App() {
  // ── session ──
  const [authMode, setAuthMode] = useState<'loading' | 'ready' | 'error'>('loading');
  const [initialized, setInitialized] = useState(false), [logged, setLogged] = useState(false), [identity, setIdentity] = useState('');
  useEffect(() => { api<{ initialized: boolean; authenticated: boolean; identity: string }>('/auth/session').then(s => { setInitialized(s.initialized); setLogged(s.authenticated); setIdentity(s.identity || ''); setAuthMode('ready'); }).catch(() => setAuthMode('error')); }, []);
  const drafts = useMemo(() => draftStore(identity), [identity]);
  const clipboard = useMemo(() => clipboardStore(identity), [identity]);
  const [draftIds, setDraftIds] = useState<Set<string>>(new Set());
  const refreshDrafts = useCallback(() => setDraftIds(drafts.ids()), [drafts]);
  useEffect(refreshDrafts, [refreshDrafts]);
  const [caps, setCaps] = useState<RuntimeCapabilities | null>(null);
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { if (logged) api<RuntimeCapabilities>('/capabilities').then(setCaps).catch(e => setToast({ text: errorText(e) })); }, [logged]);

  // ── albums & gallery ──
  const [albums, setAlbums] = useState<Album[]>([]), [albumsAvailable, setAlbumsAvailable] = useState(true), [albumsLoaded, setAlbumsLoaded] = useState(false);
  const [album, setAlbum] = useState(() => { try { return sessionStorage.getItem('ki-album') || ''; } catch { return ''; } });
  const [albumSort, setAlbumSort] = useState<'name-asc' | 'count-desc' | 'count-asc'>('name-asc');
  useEffect(() => { try { sessionStorage.setItem('ki-album', album); } catch { /* ignore */ } }, [album]);
  useEffect(() => {
    if (!logged) return;
    const control = new AbortController();
    api<{ albums: Album[]; available: boolean }>('/albums', 'GET', undefined, control.signal)
      // The worker lists only albums with processable photos; result (Imprint)
      // albums are dropped here too in case an older worker still returns them.
      .then(data => {
        const usable = data.albums.filter(a => !(a.isResult ?? a.name.trimEnd().toLowerCase().endsWith('imprint')));
        setAlbums(usable); setAlbumsAvailable(data.available); setAlbumsLoaded(true);
        setAlbum(current => usable.some(a => a.id === current) ? current : '');
      })
      .catch(() => { if (!control.signal.aborted) setAlbumsAvailable(false); });
    return () => control.abort();
  }, [logged]);
  const sortedAlbums = useMemo(() => [...albums].sort((a, b) => {
    if (albumSort === 'name-asc') return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
    return (albumSort === 'count-desc' ? b.assetCount - a.assetCount : a.assetCount - b.assetCount) || a.name.localeCompare(b.name);
  }), [albums, albumSort]);
  const albumName = albums.find(a => a.id === album)?.name ?? '';
  const destination = albumName ? `${albumName} Imprint` : 'Imprint';
  const gallery = useGallery(logged, album);
  const { assets } = gallery;
  const { jobs, track } = useJobTracker();
  const statusOf = useCallback((a: Asset) => photoStatus(a, jobs[a.id], draftIds.has(a.id)), [jobs, draftIds]);
  const [filter, setFilter] = useState<GalleryFilter>('all');
  const [selecting, setSelecting] = useState(false), [selected, setSelected] = useState<Set<string>>(new Set());
  const lastToggled = useRef<string | null>(null);
  const galleryNode = useRef<HTMLElement>(null), scrollPosition = useRef(0);
  useEffect(() => { setSelected(new Set()); setSelecting(false); setFilter('all'); }, [album]);

  // ── editor ──
  const [active, setActive] = useState<Asset | null>(null);
  // Restore the gallery offset synchronously when it remounts after editing,
  // before paint, so it can neither flash at the top nor overwrite a later scroll.
  const editing = active !== null;
  useLayoutEffect(() => { if (!editing && galleryNode.current) galleryNode.current.scrollTop = scrollPosition.current; }, [editing]);
  const [photo, setPhoto] = useState<PhotoData | null>(null);
  const [previewSrc, setPreviewSrc] = useState(''), [loadError, setLoadError] = useState(''), [loadAttempt, setLoadAttempt] = useState(0);
  const { doc, dirty, load, commit: commitDoc, undo, redo, markSaved } = useEditorDoc(initial);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [saving, setSaving] = useState(false), [message, setMessage] = useState('');
  const [zoom, setZoom] = useState(false), [compare, setCompare] = useState(false), [help, setHelp] = useState(false), [fontEpoch, setFontEpoch] = useState(0);
  const loaded = !!photo && photo.id === active?.id;
  const job = active ? jobs[active.id] : undefined;
  const configRef = useRef(doc.config); configRef.current = doc.config;

  const commit: Commit = useCallback((update, key) => { const next = update(configRef.current); if (next !== configRef.current) commitDoc(next, key); }, [commitDoc]);

  // Persist the working copy as a device-local draft while it differs from the saved config.
  useEffect(() => {
    if (!active || !loaded) return;
    const id = active.id;
    const timer = setTimeout(() => { if (dirty) drafts.write(id, doc.config); else drafts.clear(id); refreshDrafts(); }, 300);
    return () => clearTimeout(timer);
  }, [doc.config, dirty, active, loaded, drafts, refreshDrafts]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let bitmap: ImageBitmap | null = null, objectUrl = '', timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
    setLoadError(''); setMessage(''); setSelection(null); setZoom(false); setCompare(false);
    Promise.all([
      api<{ job: Job | null }>(`/assets/${active.id}/job`, 'GET', undefined, controller.signal),
      api<Saved>(`/assets/${active.id}/config`, 'GET', undefined, controller.signal),
      api<{ fields: ExifFieldValues; width: number; height: number }>(`/assets/${active.id}/metadata`, 'GET', undefined, controller.signal),
      fetch(`/api/assets/${active.id}/preview`, { signal: controller.signal }).then(r => { if (!r.ok) throw new Error('预览读取失败'); return r.blob(); })
        .then(b => { objectUrl = URL.createObjectURL(b); setPreviewSrc(objectUrl); return createImageBitmap(b); }),
    ]).then(([latest, saved, metadata, preview]) => {
      bitmap = preview;
      if (controller.signal.aborted) { preview.close(); return; }
      const baseline = editableConfig(saved.config || initial);
      const draft = drafts.read(active.id);
      load(draft ?? baseline, baseline);
      if (latest.job) track(latest.job);
      setPhoto({ id: active.id, bitmap: preview, size: { width: metadata.width, height: metadata.height }, fields: metadata.fields, revision: saved.revision });
      // Canvas text measured before the web font arrives would be wrong; redraw once it is ready.
      void document.fonts.load('700 16px "AkaSemiNoto"').then(() => { if (!controller.signal.aborted) setFontEpoch(n => n + 1); }).catch(() => {});
    }).catch(e => { if (timedOut) setLoadError('照片读取超时，请重试。'); else if (!controller.signal.aborted) setLoadError(errorText(e)); })
      .finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); bitmap?.close(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [active, loadAttempt, drafts, load, track]);

  const openAsset = useCallback((asset: Asset) => {
    if (asset.id === active?.id) return;
    if (!active) scrollPosition.current = galleryNode.current?.scrollTop ?? 0;
    else if (dirty) {
      const name = active.name, id = active.id, config = configRef.current;
      drafts.write(id, config); refreshDrafts();
      setToast({ text: `「${name}」的修改已保留为本机草稿`, action: { label: '放弃草稿', run: () => { drafts.clear(id); refreshDrafts(); } } });
    }
    setPhoto(null); setPreviewSrc('');
    setActive(asset);
  }, [active, dirty, drafts, refreshDrafts]);

  const closeEditor = useCallback(() => {
    if (active && dirty) {
      const id = active.id;
      drafts.write(id, configRef.current); refreshDrafts();
      setToast({ text: `「${active.name}」的修改已保留为本机草稿`, action: { label: '放弃草稿', run: () => { drafts.clear(id); refreshDrafts(); } } });
    }
    setActive(null); setPhoto(null); setPreviewSrc(''); setSelection(null);
  }, [active, dirty, drafts, refreshDrafts]);

  const neighbour = useCallback((step: number) => {
    if (!active) return null;
    const index = assets.findIndex(a => a.id === active.id);
    return assets[index + step] ?? null;
  }, [active, assets]);
  useEffect(() => { if (active && neighbour(1) === null && gallery.next) void gallery.load(); }, [active, neighbour, gallery]);

  const saveCurrent = useCallback(async (): Promise<boolean> => {
    if (!active || !photo || photo.id !== active.id || saving) return false;
    const config = configRef.current, id = active.id;
    setSaving(true); setMessage('');
    try {
      const saved = await api<Saved>(`/assets/${id}/config`, 'PUT', { expectedRevision: photo.revision, config: serializeEditorConfig(config) });
      setPhoto(p => p && p.id === id ? { ...p, revision: saved.revision } : p);
      markSaved(config); drafts.clear(id); refreshDrafts();
      const task = await api<Job>(`/assets/${id}/render`, 'POST', { revision: saved.revision, sourceAlbumId: album || null });
      track(task);
      return true;
    } catch (e) { setMessage(errorText(e)); return false; }
    finally { setSaving(false); }
  }, [active, photo, saving, album, markSaved, drafts, refreshDrafts, track]);

  const saveAndNext = useCallback(async () => {
    const target = neighbour(1);
    if (await saveCurrent()) { if (target) openAsset(target); else setToast({ text: '已经是最后一张照片' }); }
  }, [neighbour, saveCurrent, openAsset]);

  const copySettings = useCallback(() => { if (!active) return; clipboard.write(configRef.current, active.name); setToast({ text: '已复制当前设置，可在下一张照片粘贴，或在图库多选后批量粘贴' }); }, [active, clipboard]);
  const pasteSettings = useCallback(() => {
    const clip = clipboard.read();
    if (!clip) { setToast({ text: '还没有复制的设置' }); return; }
    commitDoc(editableConfig(clip.config)); setToast({ text: `已粘贴「${clip.from}」的设置，可撤销` });
  }, [clipboard, commitDoc]);

  const syncJob = useCallback(() => { if (!job) return; api<Job>(`/jobs/${job.id}/sync`, 'POST').then(track).catch(e => setMessage(errorText(e))); }, [job, track]);

  // ── batch ──
  const [batch, setBatch] = useState<{ done: number; total: number; failed: string[] } | null>(null);
  const toggleSelect = useCallback((asset: Asset, range: boolean) => {
    setSelecting(true);
    setSelected(current => {
      const next = new Set(current);
      if (range && lastToggled.current) {
        const a = assets.findIndex(x => x.id === lastToggled.current), b = assets.findIndex(x => x.id === asset.id);
        if (a >= 0 && b >= 0) for (const x of assets.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x.id);
      } else if (next.has(asset.id)) next.delete(asset.id); else next.add(asset.id);
      lastToggled.current = asset.id;
      return next;
    });
  }, [assets]);
  const pasteToSelected = () => {
    const clip = clipboard.read();
    if (!clip) return;
    for (const id of selected) drafts.write(id, editableConfig(clip.config));
    refreshDrafts();
    setToast({ text: `已把「${clip.from}」的设置写入 ${selected.size} 张照片的草稿，确认后可批量保存` });
  };
  const selectedDrafts = [...selected].filter(id => draftIds.has(id));
  const saveSelected = async () => {
    const ids = selectedDrafts;
    setBatch({ done: 0, total: ids.length, failed: [] });
    for (const id of ids) {
      const config = drafts.read(id), name = assets.find(a => a.id === id)?.name ?? id;
      try {
        if (!config) throw new Error('草稿不存在');
        const current = await api<Saved>(`/assets/${id}/config`);
        const saved = await api<Saved>(`/assets/${id}/config`, 'PUT', { expectedRevision: current.revision, config: serializeEditorConfig(config) });
        drafts.clear(id);
        track(await api<Job>(`/assets/${id}/render`, 'POST', { revision: saved.revision, sourceAlbumId: album || null }));
        setBatch(b => b && { ...b, done: b.done + 1 });
      } catch (e) { setBatch(b => b && { ...b, done: b.done + 1, failed: [...b.failed, `${name}：${errorText(e)}`] }); }
    }
    refreshDrafts();
  };
  const discardSelectedDrafts = () => { for (const id of selectedDrafts) drafts.clear(id); refreshDrafts(); setToast({ text: `已放弃 ${selectedDrafts.length} 份草稿` }); };

  // ── keyboard ──
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    const typing = isTyping(e.target);
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') {
      if (help) { setHelp(false); return; }
      if (typing) { (e.target as HTMLElement).blur(); return; }
      if (active && selection) { setSelection(null); return; }
      if (active) { closeEditor(); return; }
      if (selecting) { setSelecting(false); setSelected(new Set()); }
      return;
    }
    if (mod && key === 's') { e.preventDefault(); if (active) void saveCurrent(); return; }
    if (mod && e.key === 'Enter') { e.preventDefault(); if (active) void saveAndNext(); return; }
    if (typing) return;
    if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && key === 'y') { e.preventDefault(); redo(); return; }
    if (mod || e.altKey) return;
    if (e.key === '?') { setHelp(h => !h); return; }
    if (!active) return;
    const tag = (e.target as HTMLElement | null)?.tagName ?? '';
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || key === 'j' || key === 'k') {
      if (tag === 'INPUT' && e.key.startsWith('Arrow')) return; // sliders own their arrow keys
      e.preventDefault();
      const target = neighbour(e.key === 'ArrowRight' || key === 'k' ? 1 : -1);
      if (target) openAsset(target);
      return;
    }
    if (!loaded) return;
    if (e.key === ' ') { if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT') return; e.preventDefault(); setCompare(true); return; }
    if (e.shiftKey && key === 'c') { copySettings(); return; }
    if (e.shiftKey && key === 'v') { pasteSettings(); return; }
    if (key === 'z') { setZoom(z => !z); return; }
    const index = Number(e.key) - 1;
    if (Number.isInteger(index) && index >= 0 && index < STYLE_PRESETS.length) { commit(c => applyStylePreset(c, STYLE_PRESETS[index].id, Math.min(photo!.size.width, photo!.size.height))); return; }
    const position = key === 'b' ? 'footer' : key === 'l' ? 'left' : key === 'r' ? 'right' : null;
    if (position && frameRegion(configRef.current)) commit(c => setFramePosition(c, position));
  };
  useEffect(() => {
    if (!logged) return;
    const down = (e: KeyboardEvent) => keyHandler.current(e);
    const up = (e: KeyboardEvent) => { if (e.key === ' ') setCompare(false); };
    const blur = () => setCompare(false);
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [logged]);

  if (!logged) return <Login initialized={initialized} mode={authMode} onDone={init => { if (init) setInitialized(true); setLogged(true); }} />;

  // ── status ──
  const published = !!active?.status?.published || hasOutput(job?.state);
  let tone: Tone = 'idle', status = '未制作';
  if (active && !loaded) { tone = 'idle'; status = loadError ? '读取失败' : '正在读取照片…'; }
  else if (saving) { tone = 'busy'; status = '正在保存…'; }
  else if (job && isBusy(job.state)) { tone = 'busy'; status = JOB_TEXT[job.state] + (dirty ? ' · 有新的未保存修改' : ''); }
  else if (dirty) { tone = 'dirty'; status = published ? '有未保存修改 · Immich 中仍是上次成品' : '有未保存修改'; }
  else if (job?.state === 'failed') { tone = 'bad'; status = FAILURE_TEXT[job.error ?? ''] ?? '生成失败'; }
  else if (published) { tone = 'good'; status = '已保存到 Immich'; }
  const index = active ? assets.findIndex(a => a.id === active.id) : -1;
  const prev = neighbour(-1), next = neighbour(1);

  return <div className={`app ${active ? 'is-editing' : 'is-browsing'}`}>
    <header className="topbar">
      <strong className="wordmark">KARI IMPRINT</strong>
      {active ? <nav className="crumbs" aria-label="位置">
        <button type="button" className="ghost" onClick={closeEditor}>← {albumName || '图库'}</button>
        <span className="crumb-count">{index + 1} / {assets.length}{gallery.next ? '+' : ''}</span>
        <button type="button" className="ghost icon" aria-label="上一张" disabled={!prev} onClick={() => prev && openAsset(prev)}>‹</button>
        <button type="button" className="ghost icon" aria-label="下一张" disabled={!next} onClick={() => next && openAsset(next)}>›</button>
        <span className="crumb-name" title={active.name}>{active.name}</span>
      </nav> : <span className="crumb-name">{albumName}</span>}
      <span className="spacer" />
      {active && <span className={`status-pill ${tone}`} role="status">{status}</span>}
      <button type="button" className="ghost icon help-button" aria-label="快捷键" title="快捷键 (?)" onClick={() => setHelp(true)}>?</button>
      <Maintenance assets={assets} />
      <button type="button" className="ghost logout" onClick={() => { if (active && dirty) drafts.write(active.id, configRef.current); api('/auth/logout', 'POST').then(() => location.replace('/')).catch(() => setToast({ text: '退出失败，请重试。' })); }}>退出</button>
    </header>

    {!active && <div className="browse">
      <aside className="albums" aria-label="相册">
        <div className="albums-head"><span className="block-title">相册</span>
          <select aria-label="相册排序" value={albumSort} onChange={e => setAlbumSort(e.target.value as typeof albumSort)}>
            <option value="name-asc">名称</option><option value="count-desc">照片多→少</option><option value="count-asc">照片少→多</option>
          </select></div>
        {!albumsAvailable && <p className="hint error" role="alert">无法读取相册，请检查 Immich 的 album.read 权限。</p>}
        {albumsLoaded && albumsAvailable && !albums.length && <p className="hint">没有可处理的相册。这里只列出含有 JPEG/PNG 成片的相册，RAW 原片相册和 Imprint 成品相册不会显示。</p>}
        <div className="album-list">{sortedAlbums.map(item =>
          <button key={item.id} type="button" className={`album-item ${album === item.id ? 'selected' : ''}`} aria-pressed={album === item.id} title={item.name} onClick={() => setAlbum(item.id)}>
            <span className="album-cover"><img src={`/api/albums/${item.id}/thumbnail`} alt="" loading="lazy" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} /></span>
            <span className="album-meta"><span className="album-name">{item.name}</span><small>{item.assetCount} 张</small></span>
          </button>)}</div>
      </aside>
      <main className="gallery-scroll" ref={galleryNode} aria-label="相册照片">
        <div className="gallery-head">
          <h2>{albumName || '选择相册'}</h2>
          {album && assets.length > 0 && <div className="gallery-actions">
            <button type="button" className={selecting ? 'active' : ''} aria-pressed={selecting} onClick={() => { setSelecting(s => !s); setSelected(new Set()); }}>{selecting ? '完成选择' : '多选'}</button>
          </div>}
        </div>
        <Gallery assets={assets} statusOf={statusOf} loading={gallery.state === 'loading'} error={gallery.error} next={gallery.next} onMore={gallery.load} onOpen={openAsset}
          selectedAlbum={!!album} filter={filter} onFilter={setFilter} selecting={selecting} selected={selected} onToggle={toggleSelect} />
        {selecting && <div className="selection-bar" role="toolbar" aria-label="批量操作">
          <span>已选 {selected.size} 张</span>
          <button type="button" onClick={() => setSelected(new Set((filter === 'all' ? assets : assets.filter(a => statusOf(a) === filter)).map(a => a.id)))}>全选</button>
          <button type="button" disabled={!selected.size || !clipboard.read()} title={clipboard.read() ? `粘贴「${clipboard.read()!.from}」的设置` : '先在编辑页复制设置（⇧C）'} onClick={pasteToSelected}>粘贴设置为草稿</button>
          <button type="button" className="primary" disabled={!selectedDrafts.length || (batch !== null && batch.done < batch.total)} onClick={() => void saveSelected()}>保存 {selectedDrafts.length} 份草稿到 Immich</button>
          <button type="button" disabled={!selectedDrafts.length} onClick={discardSelectedDrafts}>放弃草稿</button>
        </div>}
      </main>
    </div>}

    {active && <div className="edit">
      <section className="stage" aria-label="预览">
        <div className="stage-tools">
          <button type="button" className={zoom ? 'active' : ''} aria-pressed={zoom} onClick={() => setZoom(z => !z)} title="快捷键 Z">{zoom ? '适应窗口' : '放大检查'}</button>
          <button type="button" aria-pressed={compare} onPointerDown={() => setCompare(true)} onPointerUp={() => setCompare(false)} onPointerLeave={() => setCompare(false)} title="按住查看原图（或按住空格）">按住看原图</button>
          <span className="spacer" />
          <button type="button" disabled={!doc.undo.length} onClick={undo} title="⌘Z">撤销</button>
          <button type="button" disabled={!doc.redo.length} onClick={redo} title="⇧⌘Z">重做</button>
        </div>
        <div className="stage-body">
          {loaded ? <PreviewStage config={doc.config} image={photo.bitmap} size={photo.size} caps={caps} fields={photo.fields} previewSrc={previewSrc} zoom={zoom} compare={compare} epoch={fontEpoch}
            selectedElementId={selectionElementId(selection)} onElementClick={id => setSelection(selectionFromElementId(id, doc.config))} />
            : <div className="photo-loading">
              <img src={previewSrc || `/api/assets/${active.id}/thumbnail`} alt="" />
              {loadError ? <p role="alert">{loadError} <button type="button" onClick={() => setLoadAttempt(n => n + 1)}>重新读取</button></p> : <p className="progress-line" aria-hidden="true" />}
            </div>}
        </div>
        <Filmstrip assets={assets} activeId={active.id} statusOf={statusOf} onOpen={openAsset} />
      </section>
      <aside className="panel" aria-label="设置">
        <div className="panel-scroll">
          <fieldset disabled={!loaded}>
            <Editor config={doc.config} commit={commit} fields={photo?.fields ?? {}} selection={selection} onSelect={setSelection} image={loaded ? photo.bitmap : null} size={loaded ? photo.size : null} caps={caps} />
          </fieldset>
          <div className="panel-utilities">
            <button type="button" className="mini" disabled={!loaded} onClick={copySettings} title="⇧C">复制设置</button>
            <button type="button" className="mini" disabled={!loaded} onClick={pasteSettings} title="⇧V">粘贴设置</button>
            <button type="button" className="mini" disabled={!loaded || !dirty} onClick={() => commitDoc(editableConfig(doc.baseline ?? initial))}>还原到已保存</button>
            <button type="button" className="mini" disabled={!loaded} onClick={() => commitDoc(editableConfig(initial))}>恢复默认</button>
          </div>
        </div>
        <div className="save-dock">
          {message && <p className="dock-alert" role="alert">{message}</p>}
          {job?.state === 'failed' && !dirty && <p className="dock-alert" role="alert">{FAILURE_TEXT[job.error ?? ''] ?? '生成失败'}，可直接重新保存重试。</p>}
          {job && ['awaiting_import', 'refresh_pending'].includes(job.state) && <p className="dock-note">成品已写入，正在等待 Immich 收录。<button type="button" className="link" onClick={syncJob}>立即检查</button></p>}
          <p className="dock-note">保存到「<strong>{destination}</strong>」· 原照片不变{published ? ' · 将更新已有成品' : ''}</p>
          <div className="dock-actions">
            <button type="button" className="primary" disabled={!loaded || saving} onClick={() => void saveCurrent()} title="⌘S">{saving ? '正在保存…' : '保存到 Immich'}</button>
            <button type="button" disabled={!loaded || saving || !next} onClick={() => void saveAndNext()} title="⌘↩">保存并下一张</button>
            {active && job && hasOutput(job.state) && <a className="button" href={`/api/assets/${active.id}/output?generation=${job.generation}&variant=full`} download={`${active.name.replace(/\.[^.]+$/, '')}-imprint.jpg`} title={dirty ? '下载的是上次保存的成品' : '下载原尺寸成品'}>下载</a>}
          </div>
        </div>
      </aside>
    </div>}

    {batch && <div className="batch-toast" role="status">
      <span>{batch.done < batch.total ? `正在保存 ${batch.done}/${batch.total}…` : `已提交 ${batch.total - batch.failed.length}/${batch.total} 张，正在生成`}</span>
      {batch.failed.length > 0 && <details><summary>{batch.failed.length} 张失败</summary>{batch.failed.map(f => <p key={f}>{f}</p>)}</details>}
      {batch.done >= batch.total && <button type="button" className="link" onClick={() => setBatch(null)}>关闭</button>}
    </div>}
    {toast && <div className="toast" role="status"><span>{toast.text}</span>{toast.action && <button type="button" className="link" onClick={() => { toast.action!.run(); setToast(null); }}>{toast.action.label}</button>}</div>}
    {help && <div className="modal" role="dialog" aria-modal="true" aria-label="快捷键" onClick={() => setHelp(false)}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>快捷键</h3>
        <dl className="shortcuts">{SHORTCUTS.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>
        <p className="hint">图库中按住 ⌘ 或 ⇧ 点击照片可多选；在输入框中快捷键不会触发。</p>
        <button type="button" autoFocus onClick={() => setHelp(false)}>知道了</button>
      </div>
    </div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

