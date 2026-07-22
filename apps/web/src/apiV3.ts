import type { FieldId, WatermarkConfigV3 } from './v3Types';
import { API_BASE } from './env';

export type ApiFile = { filename: string; download_url: string; download_filename?: string };
export type ProcessResponse = { ok: true; file: ApiFile };
export type ApiErrorResponse = {
  ok: false;
  error: { code: string; message: string; detail?: string };
};
export type ResourceUploadResponse = {
  ok: true;
  filename: string;
  kind: string;
  resource_id: string;
};

export type ExifFieldValues = Partial<Record<FieldId, string>>;
export type MetadataResponse = { ok: true; image_id: string; fields: ExifFieldValues; missing: FieldId[] };

export type RuntimeCapabilities = {
  upload: {
    max_file_bytes: number;
    allowed_extensions: string[];
  };
  preview: {
    max_edge: number;
    device_pixel_ratio_limit: number;
  };
  process: {
    max_image_pixels: number;
    concurrency: number;
  };
};

type UploadResponse = { ok: true; image_id: string; expires_in: number; original_filename: string };
type CapabilitiesResponse = { ok: true; capabilities: RuntimeCapabilities };

const uploadedImages = new WeakMap<File, Promise<{ image_id: string; original_filename: string }>>();
const originalNames = new WeakMap<File, string>();

async function ensureUploaded(file: File, signal?: AbortSignal): Promise<{ image_id: string; original_filename: string }> {
  const cached = uploadedImages.get(file);
  if (cached) return cached;

  const request = (async () => {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch(`${API_BASE}/api/uploads`, { method: 'POST', body: form, signal });
    const payload = (await response.json()) as UploadResponse | ApiErrorResponse;
    if (!response.ok || !payload.ok) {
      throw new Error((payload as ApiErrorResponse).error?.message || `上传失败：${response.status}`);
    }
    originalNames.set(file, payload.original_filename);
    return { image_id: payload.image_id, original_filename: payload.original_filename };
  })();

  uploadedImages.set(file, request);
  try {
    return await request;
  } catch (error) {
    uploadedImages.delete(file);
    throw error;
  }
}

export async function fetchImageMetadataV3(
  file: File,
  signal?: AbortSignal,
): Promise<MetadataResponse> {
  const { image_id } = await ensureUploaded(file, signal);
  const form = new FormData();
  form.append('image_id', image_id);
  const response = await fetch(`${API_BASE}/api/metadata`, { method: 'POST', body: form, signal });
  const payload = (await response.json()) as MetadataResponse | ApiErrorResponse;
  if (!response.ok || !payload.ok) {
    throw new Error((payload as ApiErrorResponse).error?.message || `读取 EXIF 失败：${response.status}`);
  }
  return payload;
}

export async function processImageV3(
  endpoint: 'process' | 'preview',
  file: File,
  config: WatermarkConfigV3,
  signal?: AbortSignal
): Promise<ProcessResponse> {
  const { image_id, original_filename } = await ensureUploaded(file, signal);
  const form = new FormData();
  form.append('image_id', image_id);
  form.append('config', JSON.stringify(config));
  form.append('original_filename', original_filename);

  const response = await fetch(`${API_BASE}/api/${endpoint}`, { method: 'POST', body: form, signal });
  const payload = (await response.json()) as ProcessResponse | ApiErrorResponse;
  if (!response.ok || !payload.ok) {
    throw new Error((payload as ApiErrorResponse).error?.message || `请求失败：${response.status}`);
  }
  return payload;
}

export async function fetchLogosV3(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/api/logos`);
  const payload = (await response.json()) as { ok: true; logos: string[] } | ApiErrorResponse;
  if (!response.ok || !payload.ok) return [];
  return payload.logos;
}

export function builtinLogoUrl(name: string): string {
  return `${API_BASE}/api/builtin-logos/${encodeURIComponent(name)}`;
}

export const DEFAULT_LOGO_PLACEHOLDER_URL = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 96"><rect width="320" height="96" rx="18" fill="none" stroke="#999" stroke-width="4"/><text x="160" y="58" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" font-weight="700" fill="#777">LOGO</text></svg>',
)}`;

export async function fetchRuntimeCapabilitiesV3(): Promise<RuntimeCapabilities> {
  const response = await fetch(`${API_BASE}/api/capabilities`);
  const payload = (await response.json()) as CapabilitiesResponse | ApiErrorResponse;
  if (!response.ok || !payload.ok) {
    throw new Error((payload as ApiErrorResponse).error?.message || `请求失败：${response.status}`);
  }
  return payload.capabilities;
}

export async function uploadResourceV3(
  file: File,
  kind: 'logo' | 'signature',
): Promise<ResourceUploadResponse> {
  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);
  const response = await fetch(`${API_BASE}/api/upload-resource`, { method: 'POST', body: form });
  const payload = (await response.json()) as ResourceUploadResponse | ApiErrorResponse;
  if (!response.ok || !payload.ok) {
    throw new Error((payload as ApiErrorResponse).error?.message || `上传失败：${response.status}`);
  }
  return payload;
}

/** Build a preview URL for an uploaded opaque resource id. */
export function resourceUrlV3(kind: 'logo' | 'signature', resourceId: string): string {
  return `${API_BASE}/api/resources/${kind}/${encodeURIComponent(resourceId)}`;
}

export function toDownloadUrl(file: ApiFile): string {
  if (/^https?:\/\//.test(file.download_url)) return file.download_url;
  const base = API_BASE.replace(/\/+$/, '');
  const path = file.download_url.startsWith('/') ? file.download_url : `/${file.download_url}`;
  const apiPath = new URL(base, window.location.origin).pathname.replace(/\/+$/, '');
  if (path === apiPath || path.startsWith(`${apiPath}/`)) {
    return `${new URL(base, window.location.origin).origin}${path}`;
  }
  return `${base}${path}`;
}
