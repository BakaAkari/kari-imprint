import type { ImprintConfig } from '../../../web/src/types';
export type JobState = 'queued'|'running'|'publishing'|'awaiting_import'|'refresh_pending'|'done'|'failed'|'superseded';
export type AssetStatus = {configured: boolean; job: JobState | null; published: boolean};
export type Asset = {id: string; name: string; status?: AssetStatus};
export type Album = {id: string; name: string; assetCount: number};
export type Saved = {revision: number; config: ImprintConfig | null};
export type Job = {id: string; asset_id: string; revision: number; generation: number; state: JobState; error: string|null};
export async function api<T>(path: string, method='GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {method, signal, headers: body ? {'Content-Type':'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `请求失败 (${response.status})`);
  return payload as T;
}

export type MaintenanceStatus = {freeBytes:number;minimumFreeBytes:number;jobs:Record<string,number>;issues:{assetId:string;issue:string;checked:number}[]};
