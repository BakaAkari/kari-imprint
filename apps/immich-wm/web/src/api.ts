import type { ImprintConfig } from '../../../web/src/types';
export type JobState = 'queued'|'running'|'publishing'|'awaiting_import'|'refresh_pending'|'done'|'failed'|'superseded';
export type AssetStatus = {configured: boolean; job: JobState | null; published: boolean};
export type Asset = {id: string; name: string; status?: AssetStatus};
export type Album = {id: string; name: string; assetCount: number};
export type Saved = {revision: number; config: ImprintConfig | null};
export type Job = {id: string; asset_id: string; revision: number; generation: number; state: JobState; error: string|null};
const errorLabels: Record<string, string> = {
  not_source_asset: '该照片不在源图库或已被移走',
  file_too_large: '文件超过 100MB 上限',
  invalid_image: '仅支持 JPEG/PNG，且不超过 6000 万像素',
  source_changed: '源文件读取时发生变化，请重试',
  unsupported_path: '源文件路径或格式不受支持',
  invalid_preview: '预览生成失败',
  queue_full: '队列已满，请稍后重试',
  insufficient_disk_space: '可用空间不足',
  output_too_large: '输出超过像素上限',
  login_required: '登录已失效，请重新登录',
  invalid_origin: '请求来源校验失败',
  immich_unavailable: 'Immich 暂时不可用，请稍后重试',
};
export async function api<T>(path: string, method='GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {method, signal, headers: body ? {'Content-Type':'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
  const payload = await response.json();
  if (!response.ok) throw new Error(errorLabels[payload.error] || payload.error || `请求失败 (${response.status})`);
  return payload as T;
}

export type MaintenanceStatus = {freeBytes:number;minimumFreeBytes:number;jobs:Record<string,number>;issues:{assetId:string;issue:string;checked:number}[]};
