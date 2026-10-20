import { useEffect, useMemo, useState } from 'react';
import { KariImprintCanvas } from '../../../web/src/KariImprintCanvas';
import type { RuntimeCapabilities } from '../../../web/src/api';
import type { ImprintConfig } from '../../../web/src/types';
import { isBusy, type ActivityJob, type AlbumSummary, type Asset, type RenderScope } from './api';
import { FILTER_LABEL, STATUS_LABEL, type GalleryFilter } from './gallery';

const JOB_TEXT: Record<string, string> = {
  queued: '排队中', running: '生成中', publishing: '写入中', awaiting_import: '等待 Immich 收录', refresh_pending: '等待 Immich 刷新',
  done: '已完成', failed: '失败', superseded: '已被新版本替代',
};

export const FAILURE_TEXT: Record<string, string> = {
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
  asset_not_in_album: '照片已不在这个相册',
};
export const failureText = (code: string | null | undefined) => FAILURE_TEXT[code ?? ''] ?? (code ? `生成失败（${code}）` : '生成失败');

/**
 * The album's single next step: generate everything that is not up to date
 * (never generated, stale after a look change, or failed) in one go.
 */
export function nextAction(summary: AlbumSummary | null, hasLook: boolean): { scope: RenderScope; label: string; count: number } | null {
  if (!summary || !hasLook) return null;
  const c = summary.counts;
  const count = c.none + c.stale + c.failed;
  if (!count) return null;
  const parts = [c.none ? `${c.none} 张未生成` : '', c.stale ? `${c.stale} 张过期` : '', c.failed ? `${c.failed} 张失败` : ''].filter(Boolean);
  const label = c.failed === count ? `重试 ${count} 张失败` : `生成 ${count} 张` + (parts.length > 1 ? `（${parts.join('、')}）` : c.stale === count ? '（过期）' : '');
  return { scope: 'all', label, count };
}

/** The album's look rendered on a representative photo (its small thumbnail, original coordinates). */
function LookThumb({ look, sample, caps }: { look: ImprintConfig | null; sample: Asset | null; caps: RuntimeCapabilities | null }) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  useEffect(() => {
    if (!sample) return;
    let image: ImageBitmap | null = null, cancelled = false;
    fetch(`/api/assets/${sample.id}/thumbnail`).then(r => r.ok ? r.blob() : Promise.reject()).then(createImageBitmap)
      .then(value => { if (cancelled) value.close(); else { image = value; setBitmap(value); } }).catch(() => {});
    return () => { cancelled = true; image?.close(); setBitmap(null); };
  }, [sample?.id]);
  const thumbCaps = useMemo(() => caps ? { ...caps, preview: { ...caps.preview, max_edge: 480 } } : null, [caps]);
  const size = sample?.width && sample.height ? { width: sample.width, height: sample.height } : null;
  return <span className="look-thumb">{look && bitmap && thumbCaps ? <KariImprintCanvas config={look} image={bitmap} originalImageSize={size} runtimeCaps={thumbCaps} fieldValues={{}} /> : <span className="look-empty">{look ? '' : '未设定'}</span>}</span>;
}

export function AlbumHeader({ name, look, sample, caps, summary, filter, onFilter, onEditLook, onRender, busy }: {
  name: string; look: ImprintConfig | null; sample: Asset | null; caps: RuntimeCapabilities | null;
  summary: AlbumSummary | null; filter: GalleryFilter; onFilter: (f: GalleryFilter) => void;
  onEditLook: () => void; onRender: (scope: RenderScope) => void; busy: boolean;
}) {
  const action = nextAction(summary, !!look);
  const c = summary?.counts;
  const stats: { key: GalleryFilter; value: number }[] = c ? [
    { key: 'none', value: c.none }, { key: 'draft', value: c.draft }, { key: 'busy', value: c.busy },
    { key: 'done', value: c.done }, { key: 'stale', value: c.stale }, { key: 'failed', value: c.failed },
    { key: 'exception', value: summary!.exceptions },
  ] : [];
  return <section className="album-header" aria-label="相册统一样式">
    <button type="button" className="look-card" onClick={onEditLook} title="编辑这个相册的统一样式（E）">
      <LookThumb look={look} sample={sample} caps={caps} />
      <span className="look-meta">
        <span className="look-title">统一样式</span>
        <span className="look-sub">{look ? '整个相册共用；单张调整会成为例外' : '先为相册设定一个统一样式'}</span>
        <span className="look-edit">{look ? '编辑统一样式' : '设定统一样式'} →</span>
      </span>
    </button>
    <div className="album-side">
      <h2>{name}</h2>
      {summary && <div className="stat-row" role="group" aria-label="照片状态">
        <span className="stat-total">{summary.total} 张</span>
        {stats.filter(s => s.value > 0).map(s => <button key={s.key} type="button" className={`stat ${s.key} ${filter === s.key ? 'active' : ''}`} aria-pressed={filter === s.key}
          onClick={() => onFilter(filter === s.key ? 'all' : s.key)}>{FILTER_LABEL[s.key]} <b>{s.value}</b></button>)}
      </div>}
      <div className="album-actions">
        {action ? <button type="button" className="primary" disabled={busy} onClick={() => onRender(action.scope)}>{action.label}</button>
          : look && summary && summary.counts.busy > 0 ? <span className="all-busy"><span className="spinner" aria-hidden="true" />正在处理 {summary.counts.busy} 张…</span>
          : look && summary && summary.total > 0 ? <span className="all-done">全部已是最新 ✓</span> : null}
        {action && summary && summary.counts.busy > 0 && <span className="all-busy"><span className="spinner" aria-hidden="true" />另有 {summary.counts.busy} 张正在处理</span>}
        {!look && <button type="button" className="primary" onClick={onEditLook}>设定统一样式</button>}
      </div>
    </div>
  </section>;
}

export function Tray({ jobs, waiting, names, onRetry, onRetryAll, onOpen }: {
  jobs: Record<string, ActivityJob>; waiting: number; names: Map<string, string>;
  onRetry: (assetId: string) => void; onRetryAll: () => void; onOpen: (assetId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const list = Object.values(jobs).sort((a, b) => rank(a) - rank(b) || (b.updated ?? '').localeCompare(a.updated ?? ''));
  const busy = list.filter(j => isBusy(j.state)).length;
  const failed = list.filter(j => j.state === 'failed').length;
  const done = list.filter(j => j.state === 'done').length;
  if (!list.length && !waiting) return null;
  const summary = [busy + waiting ? `处理中 ${busy + waiting}` : '', failed ? `失败 ${failed}` : '', done ? `完成 ${done}` : ''].filter(Boolean).join(' · ');
  return <aside className={`tray ${open ? 'open' : ''}`} aria-label="生成任务">
    <button type="button" className="tray-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      {busy + waiting > 0 && <span className="spinner" aria-hidden="true" />}
      <span>{summary || '任务'}</span>
      <span className="section-caret" aria-hidden="true">{open ? '−' : '+'}</span>
    </button>
    {open && <div className="tray-body">
      {waiting > 0 && <p className="hint">另有 {waiting} 张在等待进入队列。</p>}
      {failed > 1 && <button type="button" className="mini" onClick={onRetryAll}>重试全部 {failed} 张失败</button>}
      {done > 0 && <p className="hint">已完成 {done} 张{list.length > busy + failed ? '' : ''}。</p>}
      <ul>{list.filter(job => job.state !== 'done' && job.state !== 'superseded').map(job => <li key={job.assetId} className={`tray-item ${job.state}`}>
        <button type="button" className="link name" onClick={() => onOpen(job.assetId)}>{names.get(job.assetId) ?? job.assetId.slice(0, 8)}</button>
        <span className="state">{job.state === 'failed' ? failureText(job.error) : JOB_TEXT[job.state] ?? job.state}</span>
        {job.state === 'failed' && <button type="button" className="mini" onClick={() => onRetry(job.assetId)}>重试</button>}
      </li>)}</ul>
    </div>}
  </aside>;
}

function rank(job: ActivityJob): number {
  return job.state === 'failed' ? 0 : isBusy(job.state) ? 1 : 2;
}

export { STATUS_LABEL };
