import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isBusy, type Asset, type Job } from './api';

export function useGallery(logged: boolean, album: string) {
  const [assets, setAssets] = useState<Asset[]>([]), [state, setState] = useState<'loading' | 'ready' | 'error'>('ready'), [error, setError] = useState(''), [next, setNext] = useState<string | null>(null);
  const control = useRef<AbortController | null>(null), loading = useRef(false), cursor = useRef<string | null>('1'), seen = useRef(new Set<string>());
  const load = useCallback(async () => {
    const owner = control.current, page = cursor.current;
    if (!owner || owner.signal.aborted || loading.current || !page) return;
    loading.current = true; setState('loading'); setError('');
    try {
      const data = await api<{ items: Asset[]; nextPage: string | null }>(`/assets?page=${encodeURIComponent(page)}&album=${encodeURIComponent(album)}`, 'GET', undefined, owner.signal);
      if (owner !== control.current || owner.signal.aborted) return;
      seen.current.add(page);
      setAssets(old => Array.from(new Map([...old, ...data.items].map(a => [a.id, a])).values()));
      const following = data.nextPage && !seen.current.has(String(data.nextPage)) ? String(data.nextPage) : null;
      cursor.current = following; setNext(following); setState('ready');
    } catch (e) {
      if (owner === control.current && !owner.signal.aborted) { setError(e instanceof Error ? e.message : String(e)); setState('error'); }
    } finally { if (owner === control.current) loading.current = false; }
  }, [album]);
  useEffect(() => {
    control.current?.abort(); control.current = new AbortController(); loading.current = false;
    setAssets([]); setError(''); seen.current.clear(); cursor.current = '1'; setNext(null);
    if (logged && album) void load(); else setState('ready');
    return () => control.current?.abort();
  }, [logged, album, load]);
  return { assets, state, error, next, load, setAssets };
}

export type PhotoStatus = 'busy' | 'failed' | 'draft' | 'done' | 'none';
export const STATUS_LABEL: Record<PhotoStatus, string> = { busy: '处理中', failed: '失败', draft: '草稿', done: '有成品', none: '未制作' };

/** One status per photo, by priority: processing > failed > local draft > has output > not made. */
export function photoStatus(asset: Asset, job: Job | undefined, hasDraft: boolean): PhotoStatus {
  const state = job?.state ?? asset.status?.job ?? null;
  if (isBusy(state)) return 'busy';
  if (state === 'failed') return 'failed';
  if (hasDraft) return 'draft';
  if (state === 'done' || asset.status?.published) return 'done';
  return 'none';
}

export type GalleryFilter = 'all' | PhotoStatus;
const FILTERS: GalleryFilter[] = ['all', 'none', 'draft', 'failed', 'done'];

export function Gallery({ assets, statusOf, loading, error, next, onMore, onOpen, selectedAlbum, filter, onFilter, selecting, selected, onToggle }: {
  assets: Asset[];
  statusOf: (asset: Asset) => PhotoStatus;
  loading: boolean; error: string; next: string | null;
  onMore: () => void; onOpen: (asset: Asset) => void; selectedAlbum: boolean;
  filter: GalleryFilter; onFilter: (f: GalleryFilter) => void;
  selecting: boolean; selected: Set<string>; onToggle: (asset: Asset, range: boolean) => void;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = sentinel.current;
    if (!element || loading || error || !next) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) onMore(); }, { root: element.closest('.gallery-scroll'), rootMargin: '600px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [loading, error, next, onMore, assets.length]);
  const counts = new Map<GalleryFilter, number>([['all', assets.length]]);
  for (const a of assets) { const s = statusOf(a); counts.set(s, (counts.get(s) ?? 0) + 1); }
  const shown = filter === 'all' ? assets : assets.filter(a => statusOf(a) === filter);
  return <>
    {selectedAlbum && assets.length > 0 && <div className="filter-bar" role="group" aria-label="按状态筛选">
      {FILTERS.map(f => <button key={f} type="button" className={filter === f ? 'active' : ''} aria-pressed={filter === f} onClick={() => onFilter(f)}>
        {f === 'all' ? '全部' : STATUS_LABEL[f]}<span className="count">{counts.get(f) ?? 0}</span>
      </button>)}
      {next && <span className="filter-note">已加载 {assets.length} 张，滚动加载更多</span>}
    </div>}
    <div className="photo-grid">
      {shown.map(a => {
        const status = statusOf(a);
        const isSelected = selected.has(a.id);
        return <button key={a.id} type="button" className={`photo-tile ${isSelected ? 'selected' : ''}`} aria-label={`${a.name}，${STATUS_LABEL[status]}`} aria-pressed={selecting ? isSelected : undefined}
          onClick={e => { if (selecting || e.metaKey || e.ctrlKey || e.shiftKey) onToggle(a, e.shiftKey); else onOpen(a); }}>
          <span className="photo-frame"><img src={`/api/assets/${a.id}/thumbnail`} alt="" loading="lazy" decoding="async" /></span>
          <span className="photo-caption">{a.name}</span>
          {status !== 'none' && <span className={`asset-badge ${status}`}>{STATUS_LABEL[status]}</span>}
          {selecting && <span className={`select-mark ${isSelected ? 'on' : ''}`} aria-hidden="true">{isSelected ? '✓' : ''}</span>}
        </button>;
      })}
    </div>
    <div ref={sentinel} className="gallery-sentinel" role="status">
      {!selectedAlbum ? '选择一个相册开始' : loading ? '正在加载照片…' : !assets.length && !error ? '此相册在当前源库中没有可用照片' : shown.length === 0 && !error ? '没有符合筛选条件的照片' : !next && !error ? `共 ${assets.length} 张` : ''}
      {error && <><p role="alert">{error}</p><button type="button" onClick={onMore}>重新加载</button></>}
    </div>
  </>;
}
