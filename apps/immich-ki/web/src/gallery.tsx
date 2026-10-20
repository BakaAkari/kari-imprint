import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api, isBusy, type ActivityJob, type Asset, type PhotoState } from './api';

/** Paged album photos; bump `version` to reload statuses (e.g. after the look changes). */
export function useGallery(logged: boolean, album: string, version = 0) {
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
  }, [logged, album, load, version]);
  return { assets, state, error, next, load, setAssets };
}

export type PhotoStatus = PhotoState;
export const STATUS_LABEL: Record<PhotoStatus, string> = { none: '未生成', draft: '草稿', busy: '处理中', done: '已完成', stale: '过期', failed: '失败' };

/**
 * One state per photo, by priority busy > failed > draft > stale > done > none.
 * The album activity (live jobs) wins over the page-load status.
 */
export function photoStatus(asset: Asset, job: ActivityJob | undefined): PhotoStatus {
  if (job && isBusy(job.state)) return 'busy';
  const base: PhotoStatus = asset.status?.state ?? legacyState(asset);
  if (job?.state === 'failed') return base === 'draft' ? 'draft' : 'failed';
  if (job?.state === 'done' && (base === 'busy' || base === 'none' || base === 'failed')) return 'done';
  return base;
}

function legacyState(asset: Asset): PhotoStatus {
  const state = asset.status?.job ?? null;
  if (isBusy(state)) return 'busy';
  if (state === 'failed') return 'failed';
  if (asset.status?.draft) return 'draft';
  if (state === 'done' || asset.status?.published) return 'done';
  return 'none';
}

export type GalleryFilter = 'all' | PhotoStatus | 'exception';
const FILTERS: GalleryFilter[] = ['all', 'none', 'draft', 'busy', 'done', 'stale', 'failed', 'exception'];
export const FILTER_LABEL: Record<GalleryFilter, string> = { all: '全部', exception: '例外', ...STATUS_LABEL };

export function Gallery({ assets, statusOf, loading, error, next, onMore, onOpen, selectedAlbum, filter, onFilter, selecting, selected, onToggle, counts }: {
  assets: Asset[];
  statusOf: (asset: Asset) => PhotoStatus;
  loading: boolean; error: string; next: string | null;
  onMore: () => void; onOpen: (asset: Asset) => void; selectedAlbum: boolean;
  filter: GalleryFilter; onFilter: (f: GalleryFilter) => void;
  selecting: boolean; selected: Set<string>; onToggle: (asset: Asset, range: boolean) => void;
  /** Whole-album counts from the server summary; falls back to loaded photos. */
  counts: Partial<Record<GalleryFilter, number>> | null;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = sentinel.current;
    if (!element || loading || error || !next) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) onMore(); }, { root: element.closest('.gallery-scroll'), rootMargin: '600px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [loading, error, next, onMore, assets.length]);
  const matches = (a: Asset) => filter === 'all' || (filter === 'exception' ? !!a.status?.exception : statusOf(a) === filter);
  const local = new Map<GalleryFilter, number>([['all', assets.length]]);
  for (const a of assets) {
    const s = statusOf(a);
    local.set(s, (local.get(s) ?? 0) + 1);
    if (a.status?.exception) local.set('exception', (local.get('exception') ?? 0) + 1);
  }
  const countOf = (f: GalleryFilter) => counts?.[f] ?? local.get(f) ?? 0;
  const shown = assets.filter(matches);
  // Arrow keys move between tiles in reading order (the grid is row-major).
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const tiles = Array.from(grid.current?.querySelectorAll<HTMLButtonElement>('.photo-tile') ?? []);
    const index = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const columns = Math.max(1, Math.round((grid.current?.clientWidth ?? 1) / (tiles[0]?.offsetWidth || 1)));
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? columns : e.key === 'ArrowUp' ? -columns : 0;
    if (!delta) return;
    e.preventDefault();
    tiles[Math.min(tiles.length - 1, Math.max(0, index + delta))]?.focus();
  };
  return <>
    {selectedAlbum && assets.length > 0 && <div className="filter-bar" role="group" aria-label="按状态筛选">
      {FILTERS.filter(f => f === 'all' || f === filter || countOf(f) > 0).map(f => <button key={f} type="button" className={filter === f ? 'active' : ''} aria-pressed={filter === f} onClick={() => onFilter(f)}>
        {FILTER_LABEL[f]}<span className="count">{countOf(f)}</span>
      </button>)}
      {next && <span className="filter-note">已加载 {assets.length} 张，滚动加载更多</span>}
    </div>}
    <div className="photo-grid" ref={grid} onKeyDown={onGridKey}>
      {shown.map(a => {
        const status = statusOf(a);
        const isSelected = selected.has(a.id);
        const exception = !!a.status?.exception;
        return <button key={a.id} type="button" data-asset={a.id} className={`photo-tile ${isSelected ? 'selected' : ''}`} aria-label={`${a.name}，${STATUS_LABEL[status]}${exception ? '，已调整' : ''}`} aria-pressed={selecting ? isSelected : undefined}
          onClick={e => { if (selecting || e.metaKey || e.ctrlKey || e.shiftKey) onToggle(a, e.shiftKey); else onOpen(a); }}>
          <span className="photo-frame"><img src={`/api/assets/${a.id}/thumbnail`} alt="" loading="lazy" decoding="async" /></span>
          <span className="photo-caption">{a.name}</span>
          {status !== 'none' && <span className={`asset-badge ${status}`}>{STATUS_LABEL[status]}</span>}
          {exception && <span className="exception-badge" title="与统一样式不同">已调整</span>}
          {selecting && <span className={`select-mark ${isSelected ? 'on' : ''}`} aria-hidden="true">{isSelected ? '✓' : ''}</span>}
        </button>;
      })}
    </div>
    <div ref={sentinel} className="gallery-sentinel" role="status">
      {!selectedAlbum ? '选择一个相册开始' : loading ? '正在加载照片…' : !assets.length && !error ? '此相册在当前源库中没有可用照片' : shown.length === 0 && !error ? `没有「${FILTER_LABEL[filter]}」的照片` : !next && !error ? `共 ${assets.length} 张` : ''}
      {error && <><p role="alert">{error}</p><button type="button" onClick={onMore}>重新加载</button></>}
    </div>
  </>;
}
