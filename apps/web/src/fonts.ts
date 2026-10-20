import { API_BASE } from './env';

/**
 * Register the bundled Noto weights from the API's font route — the same
 * files the server renders with — so the canvas preview measures and draws
 * text exactly like the final output. The fonts are served at
 * `${API_BASE}/api/fonts/`; a relative CSS url would resolve under the built
 * `/assets/` directory and 404.
 */
export function registerFonts(): void {
  if (typeof FontFace === 'undefined' || !document.fonts) return;
  const faces: [string, string][] = [['400', 'NotoSansCJKsc-Regular.otf'], ['700', 'NotoSansCJKsc-Bold.otf']];
  for (const [weight, file] of faces) {
    const face = new FontFace('AkaSemiNoto', `url("${API_BASE}/api/fonts/${file}") format("opentype")`, { weight, style: 'normal', display: 'swap' });
    document.fonts.add(face);
    void face.load().catch(() => { /* fall back to the system stack */ });
  }
}
