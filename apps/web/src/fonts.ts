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
  const faces: [string, string, string, boolean][] = [
    ['AkaSemiNoto', '400', 'NotoSansCJKsc-Regular.otf', true],
    ['AkaSemiNoto', '700', 'NotoSansCJKsc-Bold.otf', true],
    // The serif faces are ~25 MB each: registered, but only fetched when a
    // style first draws with them (the canvas redraws on `loadingdone`).
    ['KariSerif', '400', 'NotoSerifCJKsc-Regular.otf', false],
    ['KariSerif', '700', 'NotoSerifCJKsc-Bold.otf', false],
    ['KariKai', '400', 'LXGWWenKai-Regular.ttf', false],
  ];
  for (const [family, weight, file, eager] of faces) {
    const face = new FontFace(family, `url("${API_BASE}/api/fonts/${file}") format("${file.endsWith('.ttf') ? 'truetype' : 'opentype'}")`, { weight, style: 'normal', display: 'swap' });
    document.fonts.add(face);
    if (eager) void face.load().catch(() => { /* fall back to the system stack */ });
  }
}
