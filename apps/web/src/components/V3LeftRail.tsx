import { useCallback, useContext } from 'react';
import { V3AppContext } from '../V3HomePage';
import { defaultMainControls, type WatermarkConfigV3, type PreviewAspectRatio } from '../v3Types';
import { watermarkPresetsV3, getPresetMainControls } from '../v3Presets';
import { ImagePresetRail } from './ImagePresetRail';
import type { RuntimeCapabilities } from '../apiV3';

interface V3LeftRailProps {
  aspectRatio?: PreviewAspectRatio;
  onAspectRatioChange?: (ratio: PreviewAspectRatio) => void;
  runtimeCaps?: RuntimeCapabilities | null;
}

export function V3LeftRail({ aspectRatio, onAspectRatioChange, runtimeCaps }: V3LeftRailProps) {
  const context = useContext(V3AppContext);
  if (!context) return null;

  const {
    files,
    activeFileIndex,
    setFiles,
    setActiveFileIndex,
    removeFile,
    clearOutputs,
    showToast,
    onPresetChange,
  } = context;

  const applyPreset = useCallback((template: WatermarkConfigV3) => {
    const controls = getPresetMainControls(template);
    onPresetChange(structuredClone(template), controls);
  }, [onPresetChange]);

  const resetConfig = useCallback(() => {
    const defaultPreset = watermarkPresetsV3.find(p => p.id === 'default');
    if (!defaultPreset) return;
    applyPreset(defaultPreset.config);
    clearOutputs();
  }, [applyPreset, clearOutputs]);

  return (
    <ImagePresetRail
      files={files}
      activeFileIndex={activeFileIndex}
      setFiles={setFiles}
      setActiveFileIndex={setActiveFileIndex}
      removeFile={removeFile}
      presets={watermarkPresetsV3}
      onApplyPreset={applyPreset}
      onReset={resetConfig}
      showToast={showToast}
      aspectRatio={aspectRatio}
      onAspectRatioChange={onAspectRatioChange}
      runtimeCaps={runtimeCaps}
    />
  );
}
