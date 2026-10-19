import { useEffect, useMemo, useRef, useState } from 'react';
import { KariImprintCanvas } from '../../../web/src/KariImprintCanvas';
import type { ExifFieldValues, RuntimeCapabilities } from '../../../web/src/api';
import type { ImprintConfig } from '../../../web/src/types';
import type { Asset } from './api';
import type { PhotoStatus } from './gallery';

/**
 * The large preview. `zoom` shows the preview raster at one device pixel per
 * pixel inside a scrollable stage; `compare` shows the untouched photo.
 * The canvas sizes itself to its container when it draws, so a resize bumps
 * a tick that hands it a fresh config object to redraw against.
 */
export function PreviewStage({ config, image, size, caps, fields, previewSrc, zoom, compare, epoch, selectedElementId, onElementClick }: {
  config: ImprintConfig; image: ImageBitmap | null; size: { width: number; height: number } | null; caps: RuntimeCapabilities | null;
  fields: ExifFieldValues; previewSrc: string; zoom: boolean; compare: boolean; epoch: number;
  selectedElementId: string | null; onElementClick: (id: string) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    let frame = 0;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setTick(t => t + 1)); });
    observer.observe(node);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const drawn = useMemo(() => ({ ...config }), [config, tick, zoom, epoch]);
  return <div ref={stage} className={`preview-stage ${zoom ? 'zoomed' : ''}`}>
    {image && size && caps
      ? <KariImprintCanvas config={drawn} image={image} originalImageSize={size} runtimeCaps={caps} fieldValues={fields} scheme="dark" onElementClick={zoom ? undefined : onElementClick} selectedElementId={selectedElementId} />
      : null}
    {compare && previewSrc && <div className="compare-layer"><img src={previewSrc} alt="原图" /><span className="compare-tag">原图</span></div>}
  </div>;
}

export function Filmstrip({ assets, activeId, statusOf, onOpen }: { assets: Asset[]; activeId: string; statusOf: (a: Asset) => PhotoStatus; onOpen: (a: Asset) => void }) {
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = strip.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(activeId)}"]`);
    node?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [activeId]);
  return <div ref={strip} className="filmstrip" aria-label="相册中的照片">
    {assets.map(a => {
      const status = statusOf(a);
      return <button key={a.id} type="button" data-id={a.id} className={`film-item ${a.id === activeId ? 'current' : ''}`} aria-current={a.id === activeId ? 'true' : undefined} aria-label={a.name} onClick={() => onOpen(a)}>
        <img src={`/api/assets/${a.id}/thumbnail`} alt="" loading="lazy" decoding="async" />
        {status !== 'none' && <span className={`film-dot ${status}`} aria-hidden="true" />}
      </button>;
    })}
  </div>;
}
