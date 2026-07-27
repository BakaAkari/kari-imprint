import { useCallback, useContext } from 'react';
import { AppContext } from '../HomePage';
import { type ImprintConfig, type PreviewAspectRatio } from '../types';
import { imprintPresets } from '../presets';
import { getFirstProductPreset } from '../presetSession';
import { ImagePresetRail, type RailPreset } from './ImagePresetRail';
import type { RuntimeCapabilities } from '../api';

interface LeftRailProps {
  aspectRatio?: PreviewAspectRatio;
  onAspectRatioChange?: (ratio: PreviewAspectRatio) => void;
  runtimeCaps?: RuntimeCapabilities | null;
}

export function LeftRail({ aspectRatio, onAspectRatioChange, runtimeCaps }: LeftRailProps) {
  const context = useContext(AppContext);
  if (!context) return null;

  const {
    files,
    activeFileIndex,
    setFiles,
    setActiveFileIndex,
    removeFile,
    clearOutputs,
    randomizePlaceholderExif,
    showToast,
    onPresetChange,
  } = context;

  const applyPreset = useCallback((preset: RailPreset<ImprintConfig>) => {
    // HomePage.onPresetChange 走的是 createPresetSession，UI 只负责传 id。
    onPresetChange(preset.id);
  }, [onPresetChange]);

  const resetConfig = useCallback(() => {
    onPresetChange(getFirstProductPreset().id);
    if (files.length === 0) randomizePlaceholderExif();
    clearOutputs();
  }, [files.length, onPresetChange, randomizePlaceholderExif, clearOutputs]);

  return (
    <ImagePresetRail
      files={files}
      activeFileIndex={activeFileIndex}
      setFiles={setFiles}
      setActiveFileIndex={setActiveFileIndex}
      removeFile={removeFile}
      presets={imprintPresets}
      onApplyPreset={applyPreset}
      onReset={resetConfig}
      showToast={showToast}
      aspectRatio={aspectRatio}
      onAspectRatioChange={onAspectRatioChange}
      runtimeCaps={runtimeCaps}
    />
  );
}
