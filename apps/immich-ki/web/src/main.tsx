import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ImprintConfig } from '../../../web/src/types';
import type { ExifFieldValues, RuntimeCapabilities } from '../../../web/src/api';
import {
  api, ApiError, errorText, hasOutput, isBusy,
  type Album, type AlbumSummary, type Asset, type AssetConfig, type Job, type Look, type LookImpact, type RenderResult, type RenderScope,
} from './api';
import { AlbumHeader, Tray, failureText } from './album';
import { Editor, editableConfig, serializeEditorConfig, type Commit } from './editor';
import { applyStylePreset, differingSections, frameRegion, selectionElementId, selectionFromElementId, setFramePosition, type Selection } from './editor-state';
import { buildDefaultConfig, STYLE_PRESETS } from './defaults';
import { Gallery, photoStatus, STATUS_LABEL, useGallery, type GalleryFilter } from './gallery';
import { useEditorDoc } from './history';
import { Filmstrip, PreviewStage } from './preview';
import { isTyping, Login, Maintenance } from './shell';
import { localPrefs, useActivity } from './store';
import './style.css';

const initial: ImprintConfig = buildDefaultConfig();

const JOB_TEXT: Record<string, string> = {
  queued: '排队中…', running: '正在生成…', publishing: '正在写入成品…',
  awaiting_import: '已生成，等待 Immich 收录…', refresh_pending: '已收录，等待 Immich 刷新…',
};

type Tone = 'idle' | 'dirty' | 'busy' | 'good' | 'bad' | 'look';
type PhotoData = { id: string; bitmap: ImageBitmap; size: { width: number; height: number }; fields: ExifFieldValues };
/** What the editor is editing: one photo, or the album look shown on a sample photo. */
type Target = { kind: 'photo'; asset: Asset } | { kind: 'look'; sample: Asset };
type PhotoInfo = Pick<AssetConfig, 'revision' | 'mode' | 'stale' | 'conflict'> & { hadDraft: boolean };

const SHORTCUTS: [string, string][] = [
  ['← / →  或  J / K', '上一张 / 下一张'], ['Enter', '保存并下一张（编辑统一样式时为保存）'], ['⌘S', '保存'],
  ['1 – 5', '切换样式'], ['B / L / R', '信息条在底部 / 左侧 / 右侧'], ['Z', '放大检查 / 适应窗口'],
  ['按住 空格 或 \\', '查看原图'], ['⌘Z / ⇧⌘Z', '撤销 / 重做'], ['E', '编辑相册统一样式'],
  ['Esc', '取消选中 → 返回图库'], ['?', '显示快捷键'],
];

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

function App() {
  // ── session ──
  const [authMode, setAuthMode] = useState<'loading' | 'ready' | 'error'>('loading');
  const [initialized, setInitialized] = useState(false), [logged, setLogged] = useState(false), [identity, setIdentity] = useState('');
  useEffect(() => { api<{ initialized: boolean; authenticated: boolean; identity: string }>('/auth/session').then(s => { setInitialized(s.initialized); setLogged(s.authenticated); setIdentity(s.identity || ''); setAuthMode('ready'); }).catch(() => setAuthMode('error')); }, []);
  const prefs = useMemo(() => localPrefs(identity), [identity]);
  const [caps, setCaps] = useState<RuntimeCapabilities | null>(null);
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), toast.action ? 9000 : 5000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { if (logged) api<RuntimeCapabilities>('/capabilities').then(setCaps).catch(e => setToast({ text: errorText(e) })); }, [logged]);
  const compact = useMediaQuery('(max-width: 820px)');
  // The phone tab bar sits right above the save dock, whose height varies with its notes.
  useEffect(() => {
    if (!compact) return;
    let observer: ResizeObserver | null = null;
    const attach = () => {
      const dock = document.querySelector<HTMLElement>('.save-dock');
      observer?.disconnect();
      if (!dock) return;
      observer = new ResizeObserver(() => document.documentElement.style.setProperty('--dock-h', `${dock.offsetHeight}px`));
      observer.observe(dock);
    };
    const mutation = new MutationObserver(attach);
    mutation.observe(document.body, { childList: true, subtree: true });
    attach();
    return () => { mutation.disconnect(); observer?.disconnect(); };
  }, [compact]);

  // ── albums ──
  const [albums, setAlbums] = useState<Album[]>([]), [albumsAvailable, setAlbumsAvailable] = useState(true), [albumsLoaded, setAlbumsLoaded] = useState(false);
  const [album, setAlbum] = useState('');
  const [albumSort, setAlbumSort] = useState<'name-asc' | 'count-desc' | 'count-asc'>('name-asc');
  useEffect(() => { if (album) prefs.album.write(album); }, [album, prefs]);
  useEffect(() => {
    if (!logged) return;
    const control = new AbortController();
    api<{ albums: Album[]; available: boolean }>('/albums', 'GET', undefined, control.signal)
      .then(data => {
        const usable = data.albums.filter(a => !(a.isResult ?? a.name.trimEnd().toLowerCase().endsWith('imprint')));
        setAlbums(usable); setAlbumsAvailable(data.available); setAlbumsLoaded(true);
        // Reopen the album used last time on this device, if it is still offered.
        setAlbum(current => usable.some(a => a.id === current) ? current : (usable.find(a => a.id === prefs.album.read())?.id ?? ''));
      })
      .catch(() => { if (!control.signal.aborted) setAlbumsAvailable(false); });
    return () => control.abort();
  }, [logged, prefs]);
  const sortedAlbums = useMemo(() => [...albums].sort((a, b) => {
    if (albumSort === 'name-asc') return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
    return (albumSort === 'count-desc' ? b.assetCount - a.assetCount : a.assetCount - b.assetCount) || a.name.localeCompare(b.name);
  }), [albums, albumSort]);
  const albumName = albums.find(a => a.id === album)?.name ?? '';
  const destination = albumName ? `${albumName} Imprint` : 'Imprint';

  // ── album look, summary, activity, gallery ──
  const [look, setLook] = useState<Look | null>(null);
  const [summary, setSummary] = useState<AlbumSummary | null>(null);
  const [summaryTick, setSummaryTick] = useState(0);
  const [galleryVersion, setGalleryVersion] = useState(0);
  const refreshAlbum = useCallback(() => setSummaryTick(t => t + 1), []);
  useEffect(() => {
    setLook(null); setSummary(null);
    if (!logged || !album) return;
    const control = new AbortController();
    api<Look>(`/albums/${album}/look`, 'GET', undefined, control.signal).then(setLook).catch(() => setLook({ revision: 0, config: null }));
    return () => control.abort();
  }, [logged, album]);
  useEffect(() => {
    if (!logged || !album) return;
    const control = new AbortController();
    api<AlbumSummary>(`/albums/${album}/summary`, 'GET', undefined, control.signal).then(setSummary).catch(() => {});
    return () => control.abort();
  }, [logged, album, summaryTick]);
  const gallery = useGallery(logged, album, galleryVersion);
  const { assets } = gallery;
  const activity = useActivity(album, logged);
  // When the last busy job finishes, refresh the counts once.
  const anyBusy = activity.waiting > 0 || Object.values(activity.jobs).some(j => isBusy(j.state));
  const wasBusy = useRef(false);
  useEffect(() => { if (wasBusy.current && !anyBusy) refreshAlbum(); wasBusy.current = anyBusy; }, [anyBusy, refreshAlbum]);
  // Keep the album counts in step with the live jobs (throttled to one refresh per 2 s).
  const jobSignature = Object.values(activity.jobs).map(j => j.state).sort().join(',') + '|' + activity.waiting;
  useEffect(() => { const t = setTimeout(refreshAlbum, 2000); return () => clearTimeout(t); }, [jobSignature, refreshAlbum]);
  // While anything is processing, also refresh the counts on a steady beat.
  useEffect(() => { if (!anyBusy) return; const t = setInterval(refreshAlbum, 4000); return () => clearInterval(t); }, [anyBusy, refreshAlbum]);
  const statusOf = useCallback((a: Asset) => photoStatus(a, activity.jobs[a.id]), [activity.jobs]);
  const names = useMemo(() => new Map(assets.map(a => [a.id, a.name])), [assets]);
  const [filter, setFilter] = useState<GalleryFilter>('all');
  const [selecting, setSelecting] = useState(false), [selected, setSelected] = useState<Set<string>>(new Set());
  const lastToggled = useRef<string | null>(null);
  const galleryNode = useRef<HTMLElement>(null), scrollPosition = useRef(0);
  useEffect(() => { setSelected(new Set()); setSelecting(false); setFilter('all'); }, [album]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [lookSavedAt, setLookSavedAt] = useState(0);

  // ── editor ──
  const [target, setTarget] = useState<Target | null>(null);
  const editing = target !== null;
  const imageAsset = target ? (target.kind === 'photo' ? target.asset : target.sample) : null;
  const photoAsset = target?.kind === 'photo' ? target.asset : null;
  const lastEdited = useRef<string | null>(null);
  // Restore the gallery offset synchronously when it remounts, and give focus
  // back to the photo that was being edited (keyboard users keep their place).
  useLayoutEffect(() => {
    if (editing || !galleryNode.current) return;
    galleryNode.current.scrollTop = scrollPosition.current;
    if (lastEdited.current) galleryNode.current.querySelector<HTMLElement>(`[data-asset="${CSS.escape(lastEdited.current)}"]`)?.focus({ preventScroll: true });
  }, [editing]);
  const [photo, setPhoto] = useState<PhotoData | null>(null);
  const [info, setInfo] = useState<PhotoInfo | null>(null);
  const [docReady, setDocReady] = useState(false);
  const [previewSrc, setPreviewSrc] = useState(''), [loadError, setLoadError] = useState(''), [loadAttempt, setLoadAttempt] = useState(0);
  const { doc, dirty, load, commit: commitDoc, undo, redo, markSaved } = useEditorDoc(initial);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [saving, setSaving] = useState(false), [message, setMessage] = useState('');
  const [zoom, setZoom] = useState(false), [compare, setCompare] = useState(false), [help, setHelp] = useState(false), [fontEpoch, setFontEpoch] = useState(0);
  const loaded = !!photo && photo.id === imageAsset?.id && docReady;
  const job = photoAsset ? activity.jobs[photoAsset.id] : undefined;
  const configRef = useRef(doc.config); configRef.current = doc.config;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const lookConfig = look?.config ?? null;

  const commit: Commit = useCallback((update, key) => { const next = update(configRef.current); if (next !== configRef.current) commitDoc(next, key); }, [commitDoc]);

  // Image (preview bitmap + EXIF) of the photo on screen.
  useEffect(() => {
    if (!imageAsset) return;
    const controller = new AbortController();
    let bitmap: ImageBitmap | null = null, objectUrl = '', timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
    setLoadError(''); setSelection(null); setZoom(false); setCompare(false);
    Promise.all([
      api<{ fields: ExifFieldValues; width: number; height: number }>(`/assets/${imageAsset.id}/metadata`, 'GET', undefined, controller.signal),
      fetch(`/api/assets/${imageAsset.id}/preview`, { signal: controller.signal }).then(r => { if (!r.ok) throw new Error('预览读取失败'); return r.blob(); })
        .then(b => { objectUrl = URL.createObjectURL(b); setPreviewSrc(objectUrl); return createImageBitmap(b); }),
    ]).then(([metadata, preview]) => {
      bitmap = preview;
      if (controller.signal.aborted) { preview.close(); return; }
      setPhoto({ id: imageAsset.id, bitmap: preview, size: { width: metadata.width, height: metadata.height }, fields: metadata.fields });
      // Canvas text measured before the web font arrives would be wrong; redraw once it is ready.
      void document.fonts.load('700 16px "AkaSemiNoto"').then(() => { if (!controller.signal.aborted) setFontEpoch(n => n + 1); }).catch(() => {});
    }).catch(e => { if (timedOut) setLoadError('照片读取超时，请重试。'); else if (!controller.signal.aborted) setLoadError(errorText(e)); })
      .finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); bitmap?.close(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [imageAsset?.id, loadAttempt]);

  // Document: a photo's working config (server draft, else its resolved look + exceptions).
  useEffect(() => {
    if (!photoAsset || !album) return;
    const controller = new AbortController();
    setDocReady(false); setInfo(null); setMessage('');
    api<AssetConfig>(`/assets/${photoAsset.id}/config?album=${encodeURIComponent(album)}`, 'GET', undefined, controller.signal).then(data => {
      const baseline = editableConfig(data.resolved ?? data.saved ?? data.look?.config ?? lookConfig ?? initial);
      load(data.draft ? editableConfig(data.draft) : baseline, baseline);
      setInfo({ revision: data.revision, mode: data.mode, stale: data.stale, conflict: data.conflict, hadDraft: !!data.draft });
      if (data.look) setLook(current => current && current.revision >= data.look!.revision ? current : { revision: data.look!.revision, config: data.look!.config });
      setDocReady(true);
    }).catch(e => { if (!controller.signal.aborted) setLoadError(errorText(e)); });
    return () => controller.abort();
    // lookConfig only seeds a never-saved photo; reloading on look changes would drop edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoAsset?.id, album, load, loadAttempt]);

  // Document: the album look (entered explicitly; switching sample photos keeps edits).
  const lookEntry = target?.kind === 'look';
  useEffect(() => {
    if (!lookEntry) return;
    const config = editableConfig(lookConfig ?? initial);
    // A never-saved look has no baseline, so it always counts as unsaved.
    load(config, lookConfig ? config : null);
    setInfo(null); setDocReady(true); setMessage('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookEntry, load]);

  // Server drafts: keep the working copy while it differs from the saved result.
  const draftTimer = useRef(0);
  const flushDraft = useCallback((assetId: string, config: ImprintConfig, isDirty: boolean, hadDraft: boolean) => {
    clearTimeout(draftTimer.current);
    if (isDirty) return api(`/assets/${assetId}/draft`, 'PUT', { config: serializeEditorConfig(config), album }).catch(() => {});
    if (hadDraft) return api(`/assets/${assetId}/draft`, 'DELETE').catch(() => {});
    return Promise.resolve();
  }, [album]);
  useEffect(() => {
    if (!photoAsset || !loaded || !info) return;
    const id = photoAsset.id, config = doc.config, isDirty = dirty, hadDraft = info.hadDraft;
    if (!isDirty && !hadDraft) return;
    clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => {
      void flushDraft(id, config, isDirty, hadDraft);
      setInfo(i => i && { ...i, hadDraft: isDirty });
      gallery.setAssets(items => items.map(a => a.id === id && a.status ? { ...a, status: { ...a.status, draft: isDirty, state: isDirty ? 'draft' : a.status.state === 'draft' ? (a.status.published ? 'done' : 'none') : a.status.state } } : a));
    }, 700);
    return () => clearTimeout(draftTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.config, dirty, photoAsset?.id, loaded]);

  /** Leave the current photo: its unsaved edits stay on the server as a draft. */
  const leavePhoto = useCallback(() => {
    if (!photoAsset || !info) return;
    const id = photoAsset.id, name = photoAsset.name;
    if (dirtyRef.current) {
      void flushDraft(id, configRef.current, true, info.hadDraft);
      gallery.setAssets(items => items.map(a => a.id === id && a.status ? { ...a, status: { ...a.status, draft: true, state: 'draft' } } : a));
      setToast({ text: `「${name}」的修改已存为草稿`, action: { label: '放弃草稿', run: () => { void api(`/assets/${id}/draft`, 'DELETE').then(() => { setGalleryVersion(v => v + 1); refreshAlbum(); }).catch(() => {}); } } });
    }
  }, [photoAsset, info, flushDraft, refreshAlbum, gallery]);

  const openTarget = useCallback((next: Target) => {
    if (!target) scrollPosition.current = galleryNode.current?.scrollTop ?? 0;
    else leavePhoto();
    if (next.kind === 'photo') lastEdited.current = next.asset.id;
    setPhoto(null);
    setPreviewSrc('');
    setTarget(next);
  }, [target, leavePhoto]);
  const openAsset = useCallback((asset: Asset) => {
    if (target?.kind === 'photo' && asset.id === target.asset.id) return;
    // While editing the look, other photos only change the preview sample.
    if (target?.kind === 'look') { if (asset.id !== target.sample.id) { setPhoto(null); setPreviewSrc(''); setTarget({ kind: 'look', sample: asset }); } return; }
    openTarget({ kind: 'photo', asset });
  }, [target, openTarget]);
  const editLook = useCallback(() => {
    const sample = photoAsset ?? assets[0];
    if (!sample) { setToast({ text: '相册里还没有可用照片' }); return; }
    openTarget({ kind: 'look', sample });
  }, [photoAsset, assets, openTarget]);
  const closeEditor = useCallback(() => {
    if (target?.kind === 'look' && dirtyRef.current) setToast({ text: '统一样式的修改未保存，已放弃' });
    leavePhoto();
    setTarget(null); setPhoto(null); setPreviewSrc(''); setSelection(null); setDocReady(false);
    refreshAlbum();
  }, [target, leavePhoto, refreshAlbum]);

  const neighbour = useCallback((step: number) => {
    if (!imageAsset) return null;
    const index = assets.findIndex(a => a.id === imageAsset.id);
    return assets[index + step] ?? null;
  }, [imageAsset, assets]);
  useEffect(() => { if (imageAsset && neighbour(1) === null && gallery.next) void gallery.load(); }, [imageAsset, neighbour, gallery]);

  const ensureLook = useCallback(async (config: ImprintConfig): Promise<Look> => {
    if (look?.config) return look;
    // The first saved photo of an album defines its look.
    const created = await api<Look & { impact: LookImpact }>(`/albums/${album}/look`, 'PUT', { expectedRevision: look?.revision ?? 0, config: serializeEditorConfig(config) });
    const value = { revision: created.revision, config: created.config };
    setLook(value);
    return value;
  }, [look, album]);

  const renderAlbum = useCallback(async (scope: RenderScope, assetIds?: string[]) => {
    if (!album) return;
    setBatchBusy(true);
    try {
      const result = await api<RenderResult>(`/albums/${album}/render`, 'POST', assetIds ? { scope, assetIds } : { scope });
      const notes = [result.skipped.drafts ? `${result.skipped.drafts} 张有草稿未包含（请先保存）` : '', result.skipped.errors.length ? `${result.skipped.errors.length} 张无法加入` : ''].filter(Boolean).join('，');
      setToast({ text: result.queued ? `已加入生成队列 ${result.queued} 张${notes ? `；${notes}` : ''}` : `没有需要生成的照片${notes ? `；${notes}` : ''}` });
      activity.refresh(); refreshAlbum();
      setGalleryVersion(v => v + 1);
    } catch (e) { setToast({ text: errorText(e) }); }
    finally { setBatchBusy(false); }
  }, [album, activity, refreshAlbum]);

  const savePhoto = useCallback(async (): Promise<boolean> => {
    if (!photoAsset || !info || !loaded || saving) return false;
    const config = configRef.current, id = photoAsset.id;
    setSaving(true); setMessage('');
    try {
      await ensureLook(config);
      const saved = await api<AssetConfig>(`/assets/${id}/config`, 'PUT', { expectedRevision: info.revision, config: serializeEditorConfig(config), album });
      markSaved(config);
      clearTimeout(draftTimer.current);
      setInfo({ revision: saved.revision, mode: saved.mode, stale: false, conflict: saved.conflict, hadDraft: false });
      await api<Job>(`/assets/${id}/render`, 'POST', { revision: saved.revision, sourceAlbumId: album || null });
      gallery.setAssets(items => items.map(a => a.id === id ? { ...a, status: { configured: true, job: 'queued', published: a.status?.published ?? false, state: 'busy', exception: saved.mode !== 'follow', draft: false } } : a));
      activity.refresh(); refreshAlbum();
      return true;
    } catch (e) { setMessage(errorText(e)); return false; }
    finally { setSaving(false); }
  }, [photoAsset, info, loaded, saving, ensureLook, album, markSaved, gallery, activity, refreshAlbum]);

  const saveLook = useCallback(async () => {
    if (target?.kind !== 'look' || saving) return;
    const config = configRef.current;
    setSaving(true); setMessage('');
    try {
      const saved = await api<Look & { impact: LookImpact }>(`/albums/${album}/look`, 'PUT', { expectedRevision: look?.revision ?? 0, config: serializeEditorConfig(config) });
      setLook({ revision: saved.revision, config: saved.config });
      markSaved(config);
      setLookSavedAt(Date.now());
      setGalleryVersion(v => v + 1); refreshAlbum();
      const { exceptions, stale } = saved.impact;
      // Photos never saved yet are not bound to the look but follow it too.
      const follow = Math.max(saved.impact.follow, (summary?.total ?? 0) - exceptions);
      setToast({
        text: `统一样式已保存 · 跟随 ${follow} 张，例外 ${exceptions} 张${stale ? `，${stale} 张成品已过期` : ''}`,
        action: { label: '生成待处理的照片', run: () => void renderAlbum('all') },
      });
    } catch (e) {
      setMessage(e instanceof ApiError && e.code === 'revision_conflict' ? '统一样式已在其他页面修改，请返回图库后重新打开' : errorText(e));
    } finally { setSaving(false); }
  }, [target, saving, album, look, markSaved, refreshAlbum, renderAlbum, summary]);

  const restoreSelected = useCallback(async () => {
    let done = 0;
    for (const id of selected) {
      try {
        const current = await api<AssetConfig>(`/assets/${id}/config?album=${encodeURIComponent(album)}`);
        if (current.mode === 'follow') continue;
        await api<AssetConfig>(`/assets/${id}/follow`, 'POST', { album, expectedRevision: current.revision });
        done++;
      } catch { /* the refreshed summary shows what is left */ }
    }
    setToast({ text: done ? `${done} 张已恢复为统一样式，可重新生成` : '所选照片都已跟随统一样式' });
    setSelected(new Set()); setSelecting(false);
    setGalleryVersion(v => v + 1); refreshAlbum();
  }, [selected, album, refreshAlbum]);

  const saveAndNext = useCallback(async () => {
    const next = neighbour(1);
    if (!(await savePhoto())) return;
    // The saved photo is clean now; leaving it must not store a stale draft.
    dirtyRef.current = false;
    if (next) openAsset(next); else setToast({ text: '已经是最后一张照片' });
  }, [neighbour, savePhoto, openAsset]);

  const copySettings = useCallback(() => { if (!imageAsset) return; prefs.clipboard.write(configRef.current, imageAsset.name); setToast({ text: '已复制当前设置，可在其他照片或相册粘贴' }); }, [imageAsset, prefs]);
  const pasteSettings = useCallback(() => {
    const clip = prefs.clipboard.read();
    if (!clip) { setToast({ text: '还没有复制的设置' }); return; }
    commitDoc(editableConfig(clip.config)); setToast({ text: `已粘贴「${clip.from}」的设置，可撤销` });
  }, [prefs, commitDoc]);

  // ── batch selection ──
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

  // ── keyboard ──
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    const typing = isTyping(e.target);
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    const tag = (e.target as HTMLElement | null)?.tagName ?? '';
    if (e.key === 'Escape') {
      if (help) { setHelp(false); return; }
      if (typing) { (e.target as HTMLElement).blur(); return; }
      if (target && selection) { setSelection(null); return; }
      if (target) { closeEditor(); return; }
      if (selecting) { setSelecting(false); setSelected(new Set()); }
      return;
    }
    if (mod && key === 's') { e.preventDefault(); if (target?.kind === 'look') void saveLook(); else if (target) void savePhoto(); return; }
    if (mod && e.key === 'Enter') { e.preventDefault(); if (target?.kind === 'photo') void saveAndNext(); return; }
    if (typing) return;
    if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && key === 'y') { e.preventDefault(); redo(); return; }
    if (mod || e.altKey) return;
    if (e.key === '?') { setHelp(h => !h); return; }
    if (!target) { if (key === 'e' && album) editLook(); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || key === 'j' || key === 'k') {
      if (tag === 'INPUT' && e.key.startsWith('Arrow')) return; // sliders own their arrow keys
      e.preventDefault();
      const next = neighbour(e.key === 'ArrowRight' || key === 'j' ? 1 : -1);
      if (next) openAsset(next);
      return;
    }
    if (e.key === 'Enter' && tag !== 'BUTTON' && tag !== 'A' && tag !== 'INPUT') { e.preventDefault(); if (target.kind === 'look') void saveLook(); else void saveAndNext(); return; }
    if (key === 'e' && target.kind === 'photo') { editLook(); return; }
    if (!loaded) return;
    if (e.key === ' ' || e.key === '\\') { if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT') return; e.preventDefault(); setCompare(true); return; }
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
    const up = (e: KeyboardEvent) => { if (e.key === ' ' || e.key === '\\') setCompare(false); };
    const blur = () => setCompare(false);
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [logged]);

  if (!logged) return <Login initialized={initialized} mode={authMode} onDone={init => { if (init) setInitialized(true); setLogged(true); }} />;

  // ── status ──
  const published = !!photoAsset?.status?.published || hasOutput(job?.state);
  let tone: Tone = 'idle', status = '未生成';
  if (target?.kind === 'look') { tone = 'look'; status = dirty ? '统一样式 · 有未保存修改' : '统一样式'; }
  else if (target && !loaded) { status = loadError ? '读取失败' : '正在读取照片…'; }
  else if (saving) { tone = 'busy'; status = '正在保存…'; }
  else if (job && isBusy(job.state)) { tone = 'busy'; status = JOB_TEXT[job.state] + (dirty ? ' · 有新的修改' : ''); }
  else if (dirty) { tone = 'dirty'; status = published ? '草稿 · Immich 中仍是上次成品' : '草稿 · 尚未保存'; }
  else if (job?.state === 'failed') { tone = 'bad'; status = failureText(job.error); }
  else if (info?.stale) { tone = 'dirty'; status = '过期 · 统一样式已更新，需要重新生成'; }
  else if (published) { tone = 'good'; status = '已保存到 Immich'; }
  const index = imageAsset ? assets.findIndex(a => a.id === imageAsset.id) : -1;
  const prev = neighbour(-1), next = neighbour(1);
  const differs = target?.kind === 'photo' ? differingSections(doc.config, lookConfig) : [];
  const affected = summary ? summary.total : assets.length;

  const tray = (inline: boolean) => <Tray inline={inline} since={lookSavedAt} jobs={activity.jobs} waiting={activity.waiting} names={names}
    onRetry={id => void renderAlbum('ids', [id])} onRetryAll={() => void renderAlbum('failed')}
    onOpen={id => { const a = assets.find(x => x.id === id); if (a) openAsset(a); }} />;

  const modeBar = target?.kind === 'look'
    ? <div className="mode-bar look"><b>正在编辑「{albumName}」的统一样式</b><span>影响 {affected} 张{summary?.exceptions ? `（${summary.exceptions} 张例外保留各自调整）` : ''}。←/→ 换一张照片预览效果。</span></div>
    : target?.kind === 'photo' && loaded ? (!lookConfig
      ? <div className="mode-bar"><b>相册还没有统一样式</b><span>保存这张时，它的设置会成为统一样式。</span><button type="button" className="link" onClick={editLook}>先设定统一样式</button></div>
      : info?.mode === 'standalone' && !differs.length ? <div className="mode-bar"><b>独立设置（旧版）</b><span>这张照片的设置来自统一样式之前。</span><button type="button" className="link" onClick={() => commitDoc(editableConfig(lookConfig))}>改为跟随统一样式</button></div>
      : differs.length ? <div className="mode-bar exception"><b>例外 · 已调整 {differs.length} 项</b><span>统一样式的其他改动仍会作用到这张。</span><button type="button" className="link" onClick={() => commitDoc(editableConfig(lookConfig))}>全部恢复统一</button></div>
      : <div className="mode-bar follow"><b>跟随统一样式</b><span>修改任何设置会让这张成为例外。</span><button type="button" className="link" onClick={editLook}>编辑统一样式</button></div>)
    : null;

  return <div className={`app ${target ? 'is-editing' : 'is-browsing'} ${compact ? 'compact' : ''}`}>
    <header className="topbar">
      <strong className="wordmark">KARI IMPRINT</strong>
      {target ? <nav className="crumbs" aria-label="位置">
        <button type="button" className="ghost" onClick={closeEditor}>← {albumName || '图库'}</button>
        <span className="crumb-count">{index + 1} / {summary?.total ?? assets.length}</span>
        <button type="button" className="ghost icon" aria-label="上一张" disabled={!prev} onClick={() => prev && openAsset(prev)}>‹</button>
        <button type="button" className="ghost icon" aria-label="下一张" disabled={!next} onClick={() => next && openAsset(next)}>›</button>
        <span className="crumb-name" title={imageAsset?.name}>{imageAsset?.name}</span>
      </nav> : <span className="crumb-name">{albumName}</span>}
      <span className="spacer" />
      {target && <span className={`status-pill ${tone}`} role="status">{status}</span>}
      <button type="button" className="ghost icon help-button" aria-label="快捷键" title="快捷键 (?)" onClick={() => setHelp(true)}>?</button>
      <Maintenance assets={assets} />
      <button type="button" className="ghost logout" onClick={() => { leavePhoto(); api('/auth/logout', 'POST').then(() => location.replace('/')).catch(() => setToast({ text: '退出失败，请重试。' })); }}>退出</button>
    </header>

    {!target && <div className="browse">
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
        {album ? <AlbumHeader name={albumName} look={lookConfig} sample={assets.find(a => (a.width ?? 0) >= (a.height ?? 1)) ?? assets[0] ?? null} caps={caps} summary={summary} filter={filter} onFilter={setFilter}
          onEditLook={editLook} onRender={scope => void renderAlbum(scope)} busy={batchBusy} />
          : <div className="gallery-head"><h2>选择相册</h2></div>}
        {album && assets.length > 0 && <div className="gallery-tools">
          <button type="button" className={selecting ? 'active' : ''} aria-pressed={selecting} onClick={() => { setSelecting(s => !s); setSelected(new Set()); }}>{selecting ? '完成选择' : '选择'}</button>
        </div>}
        <Gallery assets={assets} statusOf={statusOf} loading={gallery.state === 'loading'} error={gallery.error} next={gallery.next} onMore={gallery.load} onOpen={openAsset}
          selectedAlbum={!!album} filter={filter} onFilter={setFilter} selecting={selecting} selected={selected} onToggle={toggleSelect}
          counts={summary ? { all: summary.total, ...summary.counts, exception: summary.exceptions } : null} />
        {selecting && <div className="selection-bar" role="toolbar" aria-label="批量操作">
          <span>已选 {selected.size} 张</span>
          <button type="button" onClick={() => setSelected(new Set((filter === 'all' ? assets : assets.filter(a => filter === 'exception' ? a.status?.exception : statusOf(a) === filter)).map(a => a.id)))}>全选</button>
          <button type="button" disabled={!selected.size} onClick={() => void restoreSelected()}>恢复为统一样式</button>
          <button type="button" className="primary" disabled={!selected.size || batchBusy || !lookConfig} onClick={() => void renderAlbum('ids', [...selected])}>生成所选 {selected.size} 张</button>
        </div>}
      </main>
    </div>}

    {target && imageAsset && <div className="edit">
      <section className="stage" aria-label="预览">
        <div className="stage-tools">
          <button type="button" className={`desktop-only ${zoom ? 'active' : ''}`} aria-pressed={zoom} onClick={() => setZoom(z => !z)} title="快捷键 Z">{zoom ? '适应窗口' : '放大检查'}</button>
          <button type="button" className="desktop-only" aria-pressed={compare} onPointerDown={() => setCompare(true)} onPointerUp={() => setCompare(false)} onPointerLeave={() => setCompare(false)} title="按住查看原图（或按住空格 / \）">按住看原图</button>
          <span className="spacer" />
          {tray(true)}
          <button type="button" disabled={!doc.undo.length} onClick={undo} title="⌘Z">撤销</button>
          <button type="button" disabled={!doc.redo.length} onClick={redo} title="⇧⌘Z">重做</button>
        </div>
        <div className="stage-body">
          {loaded && photo ? <PreviewStage config={doc.config} image={photo.bitmap} size={photo.size} caps={caps} fields={photo.fields} previewSrc={previewSrc} zoom={zoom} compare={compare} epoch={fontEpoch}
            selectedElementId={selectionElementId(selection)} onElementClick={id => setSelection(selectionFromElementId(id, doc.config))}
            onSwipe={step => { const n = neighbour(step); if (n) openAsset(n); }} onHold={setCompare} />
            : <div className="photo-loading">
              <img src={previewSrc || `/api/assets/${imageAsset.id}/thumbnail`} alt="" />
              {loadError ? <p role="alert">{loadError} <button type="button" onClick={() => setLoadAttempt(n => n + 1)}>重新读取</button></p> : <p className="progress-line" aria-hidden="true" />}
            </div>}
        </div>
        <Filmstrip assets={assets} activeId={imageAsset.id} statusOf={statusOf} onOpen={openAsset} />
      </section>
      <aside className="panel" aria-label="设置">
        {modeBar}
        <div className="panel-scroll">
          <fieldset disabled={!loaded}>
            <Editor config={doc.config} commit={commit} fields={photo?.fields ?? {}} selection={selection} onSelect={setSelection} image={loaded && photo ? photo.bitmap : null} size={loaded && photo ? photo.size : null} caps={caps}
              look={target.kind === 'photo' ? lookConfig : null} compact={compact} />
          </fieldset>
          {!compact && <div className="panel-utilities">
            <button type="button" className="mini" disabled={!loaded} onClick={copySettings} title="⇧C">复制设置</button>
            <button type="button" className="mini" disabled={!loaded} onClick={pasteSettings} title="⇧V">粘贴设置</button>
            <button type="button" className="mini" disabled={!loaded || !dirty || !doc.baseline} onClick={() => commitDoc(editableConfig(doc.baseline ?? initial))}>放弃本次修改</button>
          </div>}
        </div>
        <div className="save-dock">
          {message && <p className="dock-alert" role="alert">{message}</p>}
          {target.kind === 'photo' && job?.state === 'failed' && !dirty && <p className="dock-alert" role="alert">{failureText(job.error)}，可直接重新保存重试。</p>}
          {target.kind === 'photo' && job && ['awaiting_import', 'refresh_pending'].includes(job.state) && <p className="dock-note">成品已写入，正在等待 Immich 收录。<button type="button" className="link" onClick={() => api<Job>(`/jobs/${job.id}/sync`, 'POST').then(() => activity.refresh()).catch(e => setMessage(errorText(e)))}>立即检查</button></p>}
          {target.kind === 'photo'
            ? <p className="dock-note">保存到「<strong>{destination}</strong>」· 原照片不变{published ? ' · 会替换已有成品' : ''}</p>
            : <p className="dock-note">保存后，跟随统一样式的照片会标为待生成或过期；确认后再批量生成。</p>}
          <div className="dock-actions">
            {target.kind === 'photo' ? <>
              <button type="button" className="primary" disabled={!loaded || saving} onClick={() => void savePhoto()} title="⌘S">{saving ? '正在保存…' : (job?.state === 'failed' && !dirty) ? '重试生成' : '保存到 Immich'}</button>
              <button type="button" disabled={!loaded || saving || !next} onClick={() => void saveAndNext()} title="Enter">保存并下一张</button>
              {job && hasOutput(job.state) && <a className="button" href={`/api/assets/${imageAsset.id}/output?generation=${job.generation}&variant=full`} download={`${imageAsset.name.replace(/\.[^.]+$/, '')}-imprint.jpg`} title={dirty ? '下载的是上次保存的成品' : '下载原尺寸成品'}>下载</a>}
            </> : <>
              <button type="button" className="primary" disabled={!loaded || saving || (!dirty && !!lookConfig)} onClick={() => void saveLook()} title="⌘S / Enter">{saving ? '正在保存…' : lookConfig ? '保存统一样式' : '设为统一样式'}</button>
              <button type="button" onClick={closeEditor}>完成</button>
            </>}
          </div>
        </div>
      </aside>
    </div>}

    {album && !target && tray(false)}
    {toast && <div className="toast" role="status"><span>{toast.text}</span>{toast.action && <button type="button" className="link" onClick={() => { toast.action!.run(); setToast(null); }}>{toast.action.label}</button>}</div>}
    {help && <div className="modal" role="dialog" aria-modal="true" aria-label="快捷键" onClick={() => setHelp(false)}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>快捷键</h3>
        <dl className="shortcuts">{SHORTCUTS.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>
        <p className="hint">图库中按住 ⌘ 或 ⇧ 点击照片可多选，方向键在照片间移动、Enter 打开；在输入框中快捷键不会触发。照片状态：{Object.values(STATUS_LABEL).join(' / ')}。</p>
        <button type="button" autoFocus onClick={() => setHelp(false)}>知道了</button>
      </div>
    </div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
