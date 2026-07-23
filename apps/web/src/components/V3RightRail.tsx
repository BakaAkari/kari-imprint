import { useContext } from 'react';
import { V3AppContext } from '../V3HomePage';
import { type RegionConfig, type RootOverrides, type SlotOverride, type WatermarkConfigV3 } from '../v3Types';
import type { RuntimeCapabilities } from '../apiV3';
import {
  BorderAdvancedV3,
  LogoAdvancedV3,
  SignatureAdvancedV3,
} from './V3CategoryAdvanced';
import {
  V3BorderControls,
  V3LogoControls,
  V3SignatureControls,
} from './V3MainControls';

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

const LAYOUT_STRUCTURE_LABELS: Record<string, string> = {
  footer: '底',
  'side-left': '左',
  'side-right': '右',
};

export function V3RightRail({ config, onRegionOverride, onRootOverride, onSlotOverride }: V3RightRailProps) {
  const ctx = useContext(V3AppContext);
  const controls = ctx?.controls;
  const onControlsChange = ctx?.onControlsChange;
  const shared = { config, onRegionOverride, onRootOverride, onSlotOverride };

  if (!controls || !onControlsChange) {
    return (
      <aside className="v3-right-rail" aria-label="样式、资源和分类设置">
        <V3BorderControls controls={{ border_enabled: true, scheme: 'dark' } as any} onChange={() => {}} />
        <div className="v3-right-section">
          <div className="v3-layout-structure-row">
            <span className="v3-right-section-title">布局结构</span>
            <select className="v3-compact-select" value="footer" disabled>
              <option value="footer">底</option>
              <option value="side-left">左</option>
              <option value="side-right">右</option>
            </select>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="v3-right-rail" aria-label="样式、资源和分类设置">
      <V3BorderControls controls={controls} onChange={onControlsChange}
        advancedContent={<BorderAdvancedV3 {...shared} />} />
      <div className="v3-right-section">
        <div className="v3-layout-structure-row">
          <span className="v3-right-section-title">布局结构</span>
          <select
            className="v3-compact-select"
            value={controls.layout_structure}
            onChange={(e) => onControlsChange({ layout_structure: e.target.value as any })}
          >
            <option value="footer">{LAYOUT_STRUCTURE_LABELS.footer}</option>
            <option value="side-left">{LAYOUT_STRUCTURE_LABELS['side-left']}</option>
            <option value="side-right">{LAYOUT_STRUCTURE_LABELS['side-right']}</option>
          </select>
        </div>
      </div>
      <V3LogoControls controls={controls} onChange={onControlsChange}
        advancedContent={<LogoAdvancedV3 {...shared} />} />
      <V3SignatureControls controls={controls} onChange={onControlsChange}
        advancedContent={<SignatureAdvancedV3 {...shared} />} />
    </aside>
  );
}
