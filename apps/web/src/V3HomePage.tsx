import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fetchImageMetadataV3, fetchRuntimeCapabilitiesV3, processImageV3, type ApiFile, type ExifFieldValues, type RuntimeCapabilities } from './apiV3';
import { TopBar } from './components/TopBar';
import { V3LeftRail } from './components/V3LeftRail';
import V3MainControls from './components/V3MainControls';
import { V3RightRail } from './components/V3RightRail';
import { WatermarkCanvasV3 } from './WatermarkCanvasV3';
import { createLocalPreview } from './localPreview';
import {
  createDefaultWatermarkConfigV3,
  resolveConfig,
  presetDefaultBaseV3,
  defaultMainControls,
  defaultControlSurface,
  type MainControlConfig,
  type RegionConfig,
  type RegionOverrides,
  type RootOverrides,
  type SlotOverride,
  type SlotOverrides,
  type WatermarkConfigV3,
  type PreviewAspectRatio,
} from './v3Types';
import './styles.css';

type ActionState = 'idle' | 'running' | 'success' | 'error';

export type ToastItem = { id: number; message: string; type: 'success' | 'error' | 'info' };

export type V3AppContextType = {
  files: File[];
  activeFileIndex: number;
  config: WatermarkConfigV3;
  preview: ApiFile | null;
  result: ApiFile | null;
  batchResults: ApiFile[];
  status: ActionState;
  message: string;
  progress: number;
  toasts: ToastItem[];
  showToast: (message: string, type: ToastItem['type']) => void;
  removeToast: (id: number) => void;
  runPreview: (opts?: { silent?: boolean }) => Promise<void>;
  runProcess: () => Promise<void>;
  runProcessAll: () => Promise<void>;
  cancelProcessAll: () => void;
  setFiles: React.Dispatch<React.SetStateAction<File[]>>;
  setActiveFileIndex: React.Dispatch<React.SetStateAction<number>>;
  removeFile: (index: number) => void;
  clearOutputs: () => void;
  clearBatchResults: () => void;
  loadPreview: () => void;
  // 新的状态管理 API
  controls: MainControlConfig;
  onControlsChange: (patch: Partial<MainControlConfig>) => void;
  slotOverrides: SlotOverrides;
  onSlotOverridesChange: (overrides: SlotOverrides) => void;
  onPresetChange: (template: WatermarkConfigV3, controls: MainControlConfig, controlSurface?: typeof defaultControlSurface) => void;
};

export const V3AppContext = createContext<V3AppContextType | null>(null);

let toastIdCounter = 0;

export function V3HomePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [activeFileIndex, setActiveFileIndex] = useState(0);

  // ── 新三层状态 ──────────────────────────────────────────
  const [template, setTemplate] = useState<WatermarkConfigV3>(presetDefaultBaseV3);
  const [controls, setControls] = useState<MainControlConfig>(defaultMainControls);
  const [controlSurface, setControlSurface] = useState(defaultControlSurface);
  const [slotOverrides, setSlotOverrides] = useState<SlotOverrides>({});
  const [regionOverrides, setRegionOverrides] = useState<RegionOverrides>({});
  const [rootOverrides, setRootOverrides] = useState<RootOverrides>({});
  const config = useMemo(
    () => resolveConfig(template, controls, slotOverrides, regionOverrides, rootOverrides, controlSurface),
    [template, controls, slotOverrides, regionOverrides, rootOverrides, controlSurface],
  );

  const onControlsChange = useCallback((patch: Partial<MainControlConfig>) => {
    setControls(prev => ({ ...prev, ...patch }));
  }, []);

  const onSlotOverridesChange = useCallback((overrides: SlotOverrides) => {
    setSlotOverrides(overrides);
  }, []);

  const onRegionOverride = useCallback((regionId: string, patch: Partial<RegionConfig>) => {
    setRegionOverrides(prev => ({ ...prev, [regionId]: { ...prev[regionId], ...patch } }));
  }, []);

  const onRootOverride = useCallback((patch: Partial<RootOverrides>) => {
    setRootOverrides(prev => ({ ...prev, ...patch }));
  }, []);

  const onSlotOverride = useCallback((key: string, override: SlotOverride) => {
    setSlotOverrides(prev => ({ ...prev, [key]: override }));
  }, []);

  const onPresetChange = useCallback(
    (newTemplate: WatermarkConfigV3, newControls: MainControlConfig, nextControlSurface = defaultControlSurface) => {
      setTemplate(structuredClone(newTemplate));
      setControls(newControls);
      setControlSurface(structuredClone(nextControlSurface));
      setSlotOverrides({});
      clearOutputs();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [result, setResult] = useState<ApiFile | null>(null);
  const [batchResults, setBatchResults] = useState<ApiFile[]>([]);
  const [preview, setPreview] = useState<ApiFile | null>(null);
  const [status, setStatus] = useState<ActionState>('idle');
  const [message, setMessage] = useState('V3 Region 水印编辑器');
  const [progress, setProgress] = useState(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [runtimeCaps, setRuntimeCaps] = useState<RuntimeCapabilities | null>(null);
  const previewRequestId = useRef(0);
  const processingAbort = useRef<AbortController | null>(null);
  const [canvasImage, setCanvasImage] = useState<ImageBitmap | null>(null);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [previewAspectRatio, setPreviewAspectRatio] = useState<PreviewAspectRatio>('3:2');
  const [fieldValues, setFieldValues] = useState<ExifFieldValues>({});

  const showToast = useCallback((message: string, type: ToastItem['type']) => {
    const id = ++toastIdCounter;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  // Decode once into a bounded local proxy. The original File remains untouched
  // and is uploaded only when Process is invoked.
  useEffect(() => {
    const file = files[activeFileIndex];
    if (!file || !runtimeCaps) {
      setCanvasImage((previous) => {
        previous?.close();
        return null;
      });
      return;
    }
    let disposed = false;
    let bitmap: ImageBitmap | null = null;
    setCanvasImage((previous) => {
      previous?.close();
      return null;
    });
    void createLocalPreview(file, runtimeCaps.preview.max_edge)
      .then((previewSource) => {
        bitmap = previewSource.bitmap;
        if (disposed) {
          bitmap.close();
          return;
        }
        setCanvasImage(bitmap);
        setStatus('success');
        setMessage('本地预览已就绪');
      })
      .catch((error) => {
        if (disposed) return;
        setCanvasImage(null);

        const text = error instanceof Error ? error.message : '浏览器无法生成预览';
        setStatus('error');
        setMessage(text);
        showToast(`${text}，当前格式仍可尝试直接 Process`, 'error');
      });
    return () => {
      disposed = true;
      bitmap?.close();
    };
  }, [files, activeFileIndex, runtimeCaps, showToast, previewRevision]);


  useEffect(() => {
    const file = files[activeFileIndex];
    if (!file) {
      setFieldValues({});
      return;
    }
    const controller = new AbortController();
    void fetchImageMetadataV3(file, controller.signal)
      .then((metadata) => {
        setFieldValues(metadata.fields);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setFieldValues({});
        showToast(error instanceof Error ? error.message : '读取 EXIF 失败，预览使用示例字段', 'error');
      });
    return () => controller.abort();
  }, [files, activeFileIndex, showToast]);

  /** Refresh local preview state on explicit user request. */
  const loadPreview = useCallback(() => {
    const file = files[activeFileIndex];
    if (!file) return;
    setPreview(null);
    setPreviewRevision((value) => value + 1);
    setStatus('running');
    setMessage('正在刷新本地预览...');
  }, [files, activeFileIndex]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const caps = await fetchRuntimeCapabilitiesV3();
        if (!cancelled) setRuntimeCaps(caps);
      } catch (error) {
        if (cancelled) return;
        setStatus('error');
        setMessage('运行配置加载失败');
        showToast(error instanceof Error ? error.message : '运行配置加载失败', 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [showToast]);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const clearOutputs = useCallback(() => {
    previewRequestId.current += 1;
    setPreview(null);
    setResult(null);
    setProgress(0);
  }, []);

  const clearBatchResults = useCallback(() => setBatchResults([]), []);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) { clearOutputs(); setStatus('idle'); setMessage('V3 Region 水印编辑器'); setActiveFileIndex(0); }
      else setActiveFileIndex(prevIdx => prevIdx >= next.length ? next.length - 1 : prevIdx);
      return next;
    });
  }, [clearOutputs]);

  const runPreview = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    const file = files[activeFileIndex];
    if (!file) { setPreview(null); return; }
    if (!silent) { setStatus('running'); setMessage('正在刷新本地预览...'); }
    setPreview(null);
    setStatus('success');
    setMessage('本地预览已就绪');
  }, [files, activeFileIndex]);

  const runPreviewRef = useRef(runPreview);
  runPreviewRef.current = runPreview;

  const runProcess = useCallback(async () => {
    const file = files[activeFileIndex];
    if (!file) { showToast('请先选择图片', 'error'); return; }
    setStatus('running'); setMessage('正在处理原图...'); setProgress(0);
    try {
      const response = await processImageV3('process', file, config);
      setResult(response.file);
      setStatus('success'); setMessage('处理完成'); setProgress(100);
      showToast('图片处理完成', 'success');
    } catch (error) {
      setStatus('error');
      const msg = error instanceof Error ? error.message : '处理失败';
      setMessage(msg); showToast(msg, 'error');
    }
  }, [files, activeFileIndex, config, showToast]);

  const runProcessAll = useCallback(async () => {
    if (files.length === 0) { showToast('请先选择图片', 'error'); return; }
    processingAbort.current?.abort();
    const abortController = new AbortController();
    processingAbort.current = abortController;
    setStatus('running'); setMessage(`0/${files.length}...`); setProgress(0); setBatchResults([]);
    const results: ApiFile[] = [];
    for (let i = 0; i < files.length; i++) {
      if (abortController.signal.aborted) break;
      try {
        const r = await processImageV3('process', files[i], config, abortController.signal);
        results.push(r.file); setBatchResults(prev => [...prev, r.file]);
        setProgress(Math.round(((i + 1) / files.length) * 100));
        setMessage(`${i + 1}/${files.length}...`);
      } catch (error) {
        if (abortController.signal.aborted) break;
        showToast(`第 ${i + 1} 张处理失败`, 'error');
      }
    }
    if (abortController.signal.aborted) { setStatus('idle'); setMessage('已取消'); return; }
    setStatus('success'); setMessage(`完成 ${results.length}/${files.length}`); setProgress(100);
  }, [files, config, showToast]);

  const cancelProcessAll = useCallback(() => { processingAbort.current?.abort(); processingAbort.current = null; setStatus('idle'); setMessage('已取消'); }, []);

  const contextValue = useMemo<V3AppContextType>(() => ({
    files, activeFileIndex, config, preview, result, batchResults,
    status, message, progress, toasts,
    showToast, removeToast,
    runPreview, runProcess, runProcessAll, cancelProcessAll,
    setFiles, setActiveFileIndex, removeFile, clearOutputs, clearBatchResults, loadPreview,
    // 新 API
    controls,
    onControlsChange,
    slotOverrides,
    onSlotOverridesChange,
    onPresetChange,
  }), [
    files, activeFileIndex, config, preview, result, batchResults,
    status, message, progress, toasts,
    showToast, removeToast,
    runPreview, runProcess, runProcessAll, cancelProcessAll,
    setFiles, setActiveFileIndex, removeFile, clearOutputs, clearBatchResults, loadPreview,
    controls, onControlsChange, slotOverrides, onSlotOverridesChange, onPresetChange,
  ]);

  return (
    <V3AppContext.Provider value={contextValue}>
      <div className="app-shell">
        <TopBar controller={contextValue} />
        <div className="workspace-v3">
          <V3LeftRail aspectRatio={previewAspectRatio} onAspectRatioChange={setPreviewAspectRatio} runtimeCaps={runtimeCaps} />
          <main className="v3-main-workspace">
            <div className="canvas-area">
              <WatermarkCanvasV3
                config={config}
                image={canvasImage}
                placeholderAspectRatio={previewAspectRatio}
                runtimeCaps={runtimeCaps}
                fieldValues={fieldValues}
              />
            </div>
            <V3MainControls config={config} onChange={onControlsChange} />
          </main>
          <V3RightRail config={config} runtimeCaps={runtimeCaps}
            onRegionOverride={onRegionOverride}
            onRootOverride={onRootOverride}
            onSlotOverride={onSlotOverride}
          />
        </div>
        <div className="toast-container">
          {toasts.map(t => (
            <div key={t.id} className={`toast toast-${t.type}`} onClick={() => removeToast(t.id)}>
              {t.message}
            </div>
          ))}
        </div>
      </div>
    </V3AppContext.Provider>
  );
}
