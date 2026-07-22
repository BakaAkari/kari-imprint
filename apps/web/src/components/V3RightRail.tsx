import { useContext, useState, type ReactNode } from 'react';
import { V3AppContext } from '../V3HomePage';
import { type RegionConfig, type RootOverrides, type SlotOverride, type WatermarkConfigV3 } from '../v3Types';
import type { RuntimeCapabilities } from '../apiV3';
import {
  AppearanceAdvancedV3,
  BorderAdvancedV3,
  LayoutAdvancedV3,
  LogoAdvancedV3,
  SignatureAdvancedV3,
} from './V3CategoryAdvanced';
import {
  V3AppearanceControls,
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

function CategorySection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="v3-right-section">
      <div className="v3-right-section-title">{title}</div>
      <div className="v3-right-section-body">
        <button className="v3-section-advanced-toggle" onClick={() => setOpen((value) => !value)}>
          <span>高级设置</span><span>{open ? '收起' : '展开'}</span>
        </button>
        {open && <div className="v3-category-advanced">{children}</div>}
      </div>
    </div>
  );
}

export function V3RightRail({ config, onRegionOverride, onRootOverride, onSlotOverride }: V3RightRailProps) {
  const ctx = useContext(V3AppContext);
  const controls = ctx?.controls;
  const onControlsChange = ctx?.onControlsChange;
  const shared = { config, onRegionOverride, onRootOverride, onSlotOverride };

  if (!controls || !onControlsChange) {
    return (
      <aside className="v3-right-rail" aria-label="样式、资源和分类设置">
        <CategorySection title="布局结构"><LayoutAdvancedV3 {...shared} /></CategorySection>
      </aside>
    );
  }

  return (
    <aside className="v3-right-rail" aria-label="样式、资源和分类设置">
      <V3LogoControls controls={controls} onChange={onControlsChange}
        advancedContent={<LogoAdvancedV3 {...shared} />} />
      <V3AppearanceControls controls={controls} onChange={onControlsChange}
        advancedContent={<AppearanceAdvancedV3 {...shared} />} />
      <V3SignatureControls controls={controls} onChange={onControlsChange}
        advancedContent={<SignatureAdvancedV3 {...shared} />} />
      <V3BorderControls controls={controls} onChange={onControlsChange}
        advancedContent={<BorderAdvancedV3 {...shared} />} />
      <CategorySection title="布局结构"><LayoutAdvancedV3 {...shared} /></CategorySection>
    </aside>
  );
}
