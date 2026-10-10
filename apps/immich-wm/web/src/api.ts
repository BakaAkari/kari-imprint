import type { ImprintConfig } from '../../../web/src/types';
export type JobState = 'queued'|'running'|'publishing'|'awaiting_import'|'refresh_pending'|'done'|'failed'|'superseded';
export type AssetStatus = {configured: boolean; job: JobState | null; published: boolean};
export type Asset = {id: string; name: string; status?: AssetStatus};
export type Album = {id: string; name: string; assetCount: number};
export type Saved = {revision: number; config: ImprintConfig | null};
export type Job = {id: string; asset_id: string; revision: number; generation: number; state: JobState; error: string|null};
const errorLabels: Record<string, string> = {
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
  output_too_large: '输出超过像素上限',
  login_required: '登录已失效，请重新登录',
  invalid_origin: '请求来源校验失败',
  immich_unavailable: 'Immich 暂时不可用，请稍后重试',
  invalid_key: 'API Key 无效，请检查后重试',
  key_scope_insufficient: '该 key 权限不足，请在 Immich 生成包含用户信息读取权限的 key（默认全权限即可）',
  login_rate_limited: '尝试次数过多，请 5 分钟后再试',
  invalid_request: '请求不合法',
  init_required: '面板尚未关联 Immich，请先输入 API Key 完成初始化',
  already_initialized: '面板已完成初始化',
};
export async function api<T>(path: string, method='GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {method, signal, headers: body ? {'Content-Type':'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
  const payload = await response.json();
  if (!response.ok) throw new Error(errorLabels[payload.error] || payload.error || `请求失败 (${response.status})`);
  return payload as T;
}

export type MaintenanceStatus = {freeBytes:number;minimumFreeBytes:number;jobs:Record<string,number>;issues:{assetId:string;issue:string;checked:number}[]};
