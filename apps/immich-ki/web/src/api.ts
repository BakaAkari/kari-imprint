import type { ImprintConfig } from '../../../web/src/types';
export type JobState = 'queued'|'running'|'publishing'|'awaiting_import'|'refresh_pending'|'done'|'failed'|'superseded';
/** Single per-photo state (design 2026-10-20 §1); `none` = no output yet. */
export type PhotoState = 'none' | 'draft' | 'busy' | 'done' | 'stale' | 'failed';
export type AssetStatus = {
  configured: boolean; job: JobState | null; published: boolean;
  /** Present on workers with album looks; older workers omit them. */
  state?: PhotoState; exception?: boolean; draft?: boolean;
};
export type Asset = {id: string; name: string; width?:number|null; height?:number|null; status?: AssetStatus};
export type Album = {id: string; name: string; assetCount: number; isResult?:boolean; thumbnailAssetId?:string|null};
export type Saved = {revision: number; config: ImprintConfig | null};
export type Job = {id: string; asset_id: string; revision: number; generation: number; state: JobState; error: string|null};
export type LookRef = {revision: number; config: ImprintConfig};
export type Look = {revision: number; config: ImprintConfig | null};
export type LookImpact = {follow: number; exceptions: number; stale: number};
export type PhotoMode = 'follow' | 'exception' | 'standalone';
/** GET/PUT /assets/{id}/config and POST /assets/{id}/follow. */
export type AssetConfig = {
  revision: number;
  saved: ImprintConfig | null;
  look: LookRef | null;
  mode: PhotoMode;
  overrides: string[];
  resolved: ImprintConfig | null;
  draft: ImprintConfig | null;
  stale: boolean;
  conflict: boolean;
  /** Exception paths that no longer apply to the current look (e.g. look became plain). */
  dropped?: string[];
};
export type AlbumSummary = {total: number; counts: Record<PhotoState, number>; exceptions: number; look: {revision: number} | null};
/** `id`/`generation` are null for photos that failed before reaching the render queue. */
export type ActivityJob = {assetId: string; id: string | null; state: JobState; error: string | null; generation: number | null; updated?: string};
export type Activity = {jobs: ActivityJob[]; waiting: number; waitingAssetIds?: string[]};
export type RenderScope = 'pending' | 'stale' | 'failed' | 'all' | 'ids';
export type RenderResult = {queued: number; skipped: {upToDate: number; drafts: number; errors: {assetId: string; error: string}[]}};
const errorLabels: Record<string, string> = {
  result_album_read_only: '成品相册不能再次加水印',
  asset_not_in_album: '照片已不在所选相册，请重新选择',
  ambiguous_album_pair: '存在重名或重复配对相册，请先整理相册',
  album_pair_changed: '成品相册已被改名，请检查配对关系',
  not_source_asset: '该照片不在源图库或已被移走',
  file_too_large: '文件超过 256MB 上限',
  image_too_large: '照片超过 4 亿像素上限',
  unsupported_image: '仅支持 JPEG/PNG 图像',
  invalid_image: '仅支持 JPEG/PNG，且不超过 4 亿像素',
  source_changed: '源文件读取时发生变化，请重试',
  unsupported_path: '源文件路径或格式不受支持',
  invalid_preview: '预览生成失败',
  queue_full: '队列已满，请稍后重试',
  insufficient_disk_space: '可用空间不足',
  output_unavailable: '成品存储暂不可写，暂时无法生成；仍可浏览和编辑照片。',
  workspace_unavailable: '照片处理工作目录暂不可用，请稍后重试。',
  storage_unavailable: '存储暂不可用，请稍后重试。',
  output_too_large: '加边框后的成品超过像素上限，请减小留白或信息条',
  render_failed: '生成失败，请重试',
  path_conflict: '成品路径与其他照片冲突，请检查同名文件',
  output_conflict: '成品文件与已有内容冲突',
  output_not_current: '成品已有更新版本，请刷新',
  not_published: '成品尚未写入，请稍后再检查',
  superseded: '已被更新的保存替代',
  output_identity_changed: '成品标识已变更，请重新保存',
  sync_unconfirmed: '已生成，但长时间未能在 Immich 中确认收录，可重新检查或重新保存',
  publication_source_missing: '发布所需的源文件缺失',
  revision_conflict: '这张照片的设置已在其他页面修改，请重新打开后再保存',
  login_required: '登录已失效，请重新登录',
  invalid_origin: '请求来源校验失败',
  immich_unavailable: 'Immich 暂时不可用，请稍后重试',
  invalid_key: 'API Key 无效，请检查后重试',
  key_identity_invalid: 'API Key 无法解析到有效账户，请检查后重试',
  key_scope_insufficient: '该 key 权限不足，请在 Immich 生成包含用户信息读取权限的 key（默认全权限即可）',
  invalid_credentials: 'Immich 账户或密码错误',
  forbidden_account: '该 Immich 账户不是面板的关联账户',
  owner_unbound: '面板尚未绑定归属账户，请重新初始化面板',
  too_many_frames: '每张照片只支持一个信息条',
  login_rate_limited: '尝试次数过多，请 5 分钟后再试',
  invalid_request: '请求不合法',
  init_required: '面板尚未关联 Immich，请先输入 API Key 完成初始化',
  already_initialized: '面板已完成初始化',
  look_required: '这个相册还没有统一样式',
  canonical_v3_required: '配置版本不受支持',
};
/** Human-readable message for any thrown value, without the `Error:` prefix. */
export function errorText(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return '请求已取消';
  if (error instanceof Error) return error.message || '请求失败';
  return String(error);
}

export const BUSY_STATES: JobState[] = ['queued', 'running', 'publishing', 'awaiting_import', 'refresh_pending'];
export const isBusy = (state: JobState | null | undefined) => !!state && BUSY_STATES.includes(state);
export const hasOutput = (state: JobState | null | undefined) => state === 'awaiting_import' || state === 'refresh_pending' || state === 'done';

export async function api<T>(path: string, method='GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {method, signal, headers: body ? {'Content-Type':'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
  let payload: {error?: string} & Record<string, unknown>;
  try { payload = await response.json(); }
  catch { throw new Error(response.ok ? '服务器返回了无法识别的内容' : `请求失败 (${response.status})`); }
  if (!response.ok) throw new ApiError(payload.error ?? '', errorLabels[payload.error ?? ''] || payload.error || `请求失败 (${response.status})`, response.status);
  return payload as T;
}

/** An error response from the worker; `code` is the stable machine code. */
export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message); }
}

export type MaintenanceStatus = {freeBytes:number;minimumFreeBytes:number;jobs:Record<string,number>;issues:{assetId:string;issue:string;checked:number}[]};
