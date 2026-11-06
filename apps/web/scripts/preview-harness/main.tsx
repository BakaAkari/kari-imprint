/**
 * Preview parity harness (dev only). Renders every catalog case through the
 * real KariImprintCanvas and diffs it against the PIL render produced by
 * scripts/render_preview_references.py. Results land in `window.__results`.
 *
 * A pixel "differs" when any channel is more than DIFF_THRESHOLD apart;
 * anti-aliased text edges and blur legitimately differ a little.
 */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { KariImprintCanvas, setTextureBase } from '../../src/KariImprintCanvas';
import type { ExifFieldValues, RuntimeCapabilities } from '../../src/api';
import type { ImprintConfig } from '../../src/types';

const DIFF_THRESHOLD = 32;
// Public files follow the dev server's base path (/ or /tools/kari-imprint/).
const BASE = `${import.meta.env.BASE_URL}harness`;

interface HarnessCase { id: string; file: string; orientation: 'landscape' | 'portrait'; config: ImprintConfig }
interface Result { id: string; width: number; height: number; refWidth: number; refHeight: number; meanDiff: number; differing: number }

const caps: RuntimeCapabilities = {
  upload: { max_file_bytes: 1, allowed_extensions: [] },
  preview: { max_edge: 4000, device_pixel_ratio_limit: 1 },
  process: { max_image_pixels: 1, concurrency: 1 },
} as RuntimeCapabilities;

async function loadFonts() {
  const faces: [string, string, string][] = [
    ['AkaSemiNoto', '400', 'NotoSansCJKsc-Regular.otf'], ['AkaSemiNoto', '700', 'NotoSansCJKsc-Bold.otf'],
    ['KariSerif', '400', 'NotoSerifCJKsc-Regular.otf'], ['KariSerif', '700', 'NotoSerifCJKsc-Bold.otf'],
    ['KariKai', '400', 'LXGWWenKai-Regular.ttf'],
  ];
  await Promise.all(faces.map(async ([family, weight, file]) => {
    const face = new FontFace(family, `url("${BASE}/fonts/${file}")`, { weight });
    document.fonts.add(face);
    await face.load();
  }));
}

// onload rather than decode(): decode() can stall while the browser pane is hidden.
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

function diff(canvas: HTMLCanvasElement, ref: HTMLImageElement, heat: HTMLCanvasElement): [number, number] {
  const w = Math.min(canvas.width, ref.naturalWidth), h = Math.min(canvas.height, ref.naturalHeight);
  const a = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
  const scratch = document.createElement('canvas');
  scratch.width = w; scratch.height = h;
  const sctx = scratch.getContext('2d')!;
  sctx.drawImage(ref, 0, 0);
  const b = sctx.getImageData(0, 0, w, h).data;
  heat.width = w; heat.height = h;
  const hctx = heat.getContext('2d')!;
  const out = hctx.createImageData(w, h);
  let sum = 0, differing = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    sum += d;
    const bad = d > DIFF_THRESHOLD;
    if (bad) differing += 1;
    out.data[i] = bad ? 255 : b[i] * 0.25;
    out.data[i + 1] = bad ? 40 : b[i + 1] * 0.25;
    out.data[i + 2] = bad ? 40 : b[i + 2] * 0.25;
    out.data[i + 3] = 255;
  }
  hctx.putImageData(out, 0, 0);
  return [sum / (w * h), differing / (w * h)];
}

function Case({ item, photo, fields, onDone }: { item: HarnessCase; photo: ImageBitmap; fields: ExifFieldValues; onDone: (r: Result) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const heat = useRef<HTMLCanvasElement>(null);
  const [result, setResult] = useState<Result | null>(null);
  const report = useRef(onDone);
  report.current = onDone;
  useEffect(() => {
    let cancelled = false;
    // Give textures (loaded on first draw) time to arrive and trigger a redraw.
    const timer = setTimeout(async () => {
      const canvas = host.current?.querySelector('canvas');
      if (!canvas || !heat.current || cancelled) return;
      const ref = await loadImage(`${BASE}/ref/${item.file}.png`);
      const [meanDiff, differing] = diff(canvas, ref, heat.current);
      const r = { id: item.id, width: canvas.width, height: canvas.height, refWidth: ref.naturalWidth, refHeight: ref.naturalHeight, meanDiff, differing };
      setResult(r);
      report.current(r);
    }, 900);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [item]);
  const bad = result && (result.differing > 0.01 || result.width !== result.refWidth || result.height !== result.refHeight);
  return <div className={`case ${bad ? 'bad' : ''}`}>
    <div className="meta"><b>{item.id}</b><br />{result ? `${result.width}×${result.height} vs ${result.refWidth}×${result.refHeight}` : 'rendering…'}
      <br />{result ? `mean Δ ${result.meanDiff.toFixed(2)} · differing ${(result.differing * 100).toFixed(2)}%` : ''}</div>
    <div className="frame" ref={host}><KariImprintCanvas config={structuredClone(item.config)} image={photo}
      originalImageSize={{ width: photo.width, height: photo.height }} runtimeCaps={caps} fieldValues={fields} /></div>
    <div className="frame"><img src={`${BASE}/ref/${item.file}.png`} alt="PIL reference" /></div>
    <div className="frame"><canvas ref={heat} /></div>
  </div>;
}

function Harness() {
  const [data, setData] = useState<{ cases: HarnessCase[]; fields: Record<string, ExifFieldValues>; photos: Record<string, ImageBitmap> } | null>(null);
  const [done, setDone] = useState<Result[]>([]);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    (async () => {
      setTextureBase(`${BASE}/textures/`);
      await loadFonts();
      const json = await (await fetch(`${BASE}/fields.json`)).json();
      const photos: Record<string, ImageBitmap> = {};
      for (const name of ['landscape', 'portrait']) photos[name] = await createImageBitmap(await loadImage(`${BASE}/photo-${name}.png`));
      const only = new URLSearchParams(location.search).get('only');
      const cases = (json.cases as HarnessCase[]).filter((c) => !only || c.id.startsWith(only));
      setData({ cases, fields: json.fields, photos });
    })();
  }, []);
  useEffect(() => {
    (window as unknown as { __results: Result[]; __complete: boolean }).__results = done;
    (window as unknown as { __complete: boolean }).__complete = !!data && done.length === data.cases.length;
  }, [done, data]);
  if (!data) return <p>Loading fonts and references…</p>;
  // Render cases one after another so each gets the main thread for its texture loads.
  const visible = data.cases.slice(0, index + 1);
  const bad = done.filter((r) => r.differing > 0.01 || r.width !== r.refWidth || r.height !== r.refHeight);
  return <>
    <div className="summary">{done.length}/{data.cases.length} compared · {bad.length} above 1% differing pixels</div>
    {visible.map((item) => <Case key={item.id} item={item} photo={data.photos[item.orientation]} fields={data.fields[item.orientation]}
      onDone={(r) => { setDone((list) => list.some((x) => x.id === r.id) ? list : [...list, r]); setIndex((i) => Math.max(i, data.cases.indexOf(item) + 1)); }} />)}
  </>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
