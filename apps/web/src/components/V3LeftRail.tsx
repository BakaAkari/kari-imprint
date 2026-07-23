import { useCallback, useContext } from 'react';
import { V3AppContext } from '../V3HomePage';
import { type WatermarkConfigV3, type PreviewAspectRatio } from '../v3Types';
import { watermarkPresetsV3 } from '../v3Presets';
import { getFirstProductPreset } from '../v3PresetSession';
import { ImagePresetRail, type RailPreset } from './ImagePresetRail';
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

  const applyPreset = useCallback((preset: RailPreset<WatermarkConfigV3>) => {
    // V3HomePage.onPresetChange 走的是 createPresetSession，UI 只负责传 id。
    onPresetChange(preset.id);
  }, [onPresetChange]);

  const resetConfig = useCallback(() => {
    onPresetChange(getFirstProductPreset().id);
    clearOutputs();
  }, [onPresetChange, clearOutputs]);

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
