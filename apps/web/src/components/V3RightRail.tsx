import { useContext, useState } from 'react';
import { V3AppContext } from '../V3HomePage';
import { type RegionConfig, type RootOverrides, type SlotOverride, type WatermarkConfigV3 } from '../v3Types';
import type { RuntimeCapabilities } from '../apiV3';
import { InspectorPanelV3 } from './InspectorPanelV3';
import { V3StyleControls, V3ResourceControls, V3LogoPositionControls } from './V3MainControls';

interface V3RightRailProps {
  config: WatermarkConfigV3;
  onRegionOverride: (regionId: string, patch: Partial<RegionConfig>) => void;
  onRootOverride: (patch: Partial<RootOverrides>) => void;
  onSlotOverride: (key: string, override: SlotOverride) => void;
  diagnostics?: DiagnosticItem[];
  runtimeCaps?: RuntimeCapabilities | null;
}

export type DiagnosticItem = {
  id: string;
  type: string;
  severity: 'error' | 'warning';
  message: string;
  elementIds?: string[];
};

export function V3RightRail({ config, onRegionOverride, onRootOverride, onSlotOverride, diagnostics: _diagnostics, runtimeCaps: _runtimeCaps }: V3RightRailProps) {
  const ctx = useContext(V3AppContext);
  const controls = ctx?.controls;
  const onControlsChange = ctx?.onControlsChange;

  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Fallback if no context (backward compat)
  if (!controls || !onControlsChange) {
    return (
      <aside className="v3-right-rail" aria-label="样式、资源和高级设置">
        <div className="v3-right-section">
          <div className="v3-right-section-title">高级设置</div>
          <div className="v3-right-section-body">
            <InspectorPanelV3 config={config}
              onRegionOverride={onRegionOverride}
              onRootOverride={onRootOverride}
              onSlotOverride={onSlotOverride} />
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="v3-right-rail" aria-label="样式、资源和高级设置">
      <V3StyleControls controls={controls} onChange={onControlsChange} />
      <V3ResourceControls controls={controls} onChange={onControlsChange} />
      <V3LogoPositionControls controls={controls} onChange={onControlsChange} />

      <div className="v3-right-section">
        <div className="v3-right-section-title">高级设置</div>
        <div className="v3-right-section-body">
          <button
            className="v3-btn v3-btn-sm v3-btn-ghost"
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            {advancedOpen ? '收起高级' : '编辑结构'}
          </button>
          {advancedOpen && (
            <div className="v3-advanced-panel">
              <InspectorPanelV3 config={config}
                onRegionOverride={onRegionOverride}
                onRootOverride={onRootOverride}
                onSlotOverride={onSlotOverride} />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
