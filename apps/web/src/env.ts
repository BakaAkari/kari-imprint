/** Browser route base. Production uses the deployed subpath; local dev can use `/`. */
export const PUBLIC_BASE: string = import.meta.env.VITE_PUBLIC_BASE || import.meta.env.VITE_API_BASE || '/tools/watermark-v3';

/** API base URL. VITE_API_ORIGIN is only needed for direct local-development access. */
const API_ORIGIN: string = import.meta.env.VITE_API_ORIGIN || '';
const API_PATH: string = import.meta.env.VITE_API_BASE || '/tools/watermark-v3';
export const API_BASE: string = `${API_ORIGIN}${API_PATH}`;
