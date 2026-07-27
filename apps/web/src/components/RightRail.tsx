import { useContext, useState } from 'react';
import { AppContext } from '../HomePage';
import { type RegionConfig, type RootOverrides, type SlotOverride, type ImprintConfig, colorSchemes } from '../types';
import type { RuntimeCapabilities } from '../api';
import type { ColorScheme } from '../types';
import {
  LogoAdvanced,
  SignatureAdvanced,
} from './CategoryAdvanced';
import {
  LogoControls,
  SignatureControls,
} from './MainControls';

interface RightRailProps {
  config: ImprintConfig;
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

const LAYOUT_STRUCTURE_OPTIONS = [
  { value: 'side-left', label: '左' },
  { value: 'footer', label: '底' },
  { value: 'side-right', label: '右' },
] as const;

const FOOTER_HEIGHT_LABELS: Record<string, string> = {
  small: '小',
  medium: '中',
  large: '大',
};

/* ── 可复用子行：标签 + 分段按钮组 ──────────────────────────────────── */

function SegmentedRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="layout-structure-row">
      <span className="mini-label">{label}</span>
      <div className="segmented-group layout-structure-options">
        {children}
      </div>
    </div>
  );
}

/* ── 配色细节面板 ────────────────────────────────────────────────── */

interface ColorDetailProps {
  config: ImprintConfig;
  onRootOverride: (patch: Partial<RootOverrides>) => void;
  schemeBackground: string;
}

function ColorDetailPanel({ config, onRootOverride, schemeBackground }: ColorDetailProps) {
  return (
    <div className="detail-sub">
      <div className="form-row">
        <label className="mini-label">底色</label>
        <div className="form-row-right">
          <input
            type="color"
            value={config.canvas.background}
            onChange={(e) => {
              const v = e.target.value;
              onRootOverride({
                canvas: {
                  background: v,
                  border: { ...config.canvas.border, color: v },
                },
              });
            }}
          />
          <button
            className="reset-btn"
            onClick={() => {
              onRootOverride({
                canvas: {
                  background: schemeBackground,
                  border: { ...config.canvas.border, color: schemeBackground },
                },
              });
            }}
          >
            重置
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 无上下文 Fallback ──────────────────────────────────────────── */

function BorderSectionFallback() {
  return (
    <div className="right-section">
      <div className="right-section-title">边框设置</div>
      <div className="right-section-body">
        <SegmentedRow label="配色">
          <button className="segment active" disabled>深色</button>
          <button className="segment" disabled>浅色</button>
        </SegmentedRow>
        <SegmentedRow label="布局结构">
          {LAYOUT_STRUCTURE_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={`segment ${option.value === 'footer' ? 'active' : ''}`}
              disabled
            >
              {option.label}
            </button>
          ))}
        </SegmentedRow>
        <SegmentedRow label="边框">
          <button className="segment active" disabled>开启</button>
          <button className="segment" disabled>关闭</button>
        </SegmentedRow>
        <SegmentedRow label="水印栏高度">
          <button className="segment active" disabled>小</button>
          <button className="segment" disabled>中</button>
          <button className="segment" disabled>大</button>
        </SegmentedRow>
      </div>
    </div>
  );
}

/* ── 主组件 ──────────────────────────────────────────────────── */

export function RightRail({ config, onRegionOverride, onRootOverride, onSlotOverride }: RightRailProps) {
  const ctx = useContext(AppContext);
  const controls = ctx?.controls;
  const onControlsChange = ctx?.onControlsChange;
  const shared = { config, onRegionOverride, onRootOverride, onSlotOverride };
  const [colorDetailOpen, setColorDetailOpen] = useState(false);
  const [borderWidthOpen, setBorderWidthOpen] = useState(false);

  if (!controls || !onControlsChange) {
    return (
      <aside className="right-rail" aria-label="样式、资源和分类设置">
        <BorderSectionFallback />
      </aside>
    );
  }

  const scheme = colorSchemes[controls.scheme] ?? colorSchemes.dark;

  return (
    <aside className="right-rail" aria-label="样式、资源和分类设置">
      {/* ── 边框设置 ── */}
      <div className="right-section">
        <div className="right-section-title">边框设置</div>
        <div className="right-section-body">
          {/* 配色：左（名称）· 中（细节）· 右（选项） */}
          <div className="triple-row">
            <span className="mini-label">配色</span>
            <button
              className={`detail-toggle ${colorDetailOpen ? 'open' : ''}`}
              onClick={() => setColorDetailOpen((v) => !v)}
            >
              细节
            </button>
            <div className="segmented-group layout-structure-options">
              {(['light', 'dark'] as ColorScheme[]).map((s) => (
                <button
                  key={s}
                  className={`segment ${controls.scheme === s ? 'active' : ''}`}
                  onClick={() => {
                    const nextScheme = colorSchemes[s];
                    onControlsChange({ scheme: s });
                    onRootOverride({
                      canvas: {
                        background: nextScheme.background,
                        border: { ...config.canvas.border, color: nextScheme.background },
                      },
                    });
                  }}
                >
                  {s === 'dark' ? '浅色' : '深色'}
                </button>
              ))}
            </div>
          </div>
          {colorDetailOpen && <ColorDetailPanel config={config} onRootOverride={onRootOverride} schemeBackground={scheme.background} />}

          <SegmentedRow label="布局结构">
            {LAYOUT_STRUCTURE_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`segment ${controls.layout_structure === option.value ? 'active' : ''}`}
                onClick={() => onControlsChange({ layout_structure: option.value })}
              >
                {option.label}
              </button>
            ))}
          </SegmentedRow>

          <div className="triple-row">
            <span className="mini-label">边框</span>
            <button
              className={`detail-toggle ${borderWidthOpen ? 'open' : ''}`}
              onClick={() => setBorderWidthOpen((v) => !v)}
            >
              细节
            </button>
            <div className="segmented-group layout-structure-options">
              <button
                className={`segment ${controls.border_enabled ? 'active' : ''}`}
                onClick={() => onControlsChange({ border_enabled: true })}
              >
                开启
              </button>
              <button
                className={`segment ${!controls.border_enabled ? 'active' : ''}`}
                onClick={() => onControlsChange({ border_enabled: false })}
              >
                关闭
              </button>
            </div>
          </div>
          {borderWidthOpen && (
            <div className="detail-sub">
              <div className="form-row">
                <label className="mini-label">宽度</label>
                <div className="segmented-group layout-structure-options">
                  {(['small', 'medium', 'large'] as const).map((level) => (
                    <button
                      key={level}
                      className={`segment ${controls.border_width_level === level ? 'active' : ''}`}
                      onClick={() => onControlsChange({ border_width_level: level })}
                    >
                      {level === 'small' ? '小' : level === 'medium' ? '中' : '大'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <SegmentedRow label="水印栏高度">
            {(['small', 'medium', 'large'] as const).map((level) => (
              <button
                key={level}
                className={`segment ${controls.footer_height_level === level ? 'active' : ''}`}
                onClick={() => onControlsChange({ footer_height_level: level })}
              >
                {FOOTER_HEIGHT_LABELS[level]}
              </button>
            ))}
          </SegmentedRow>

        </div>
      </div>

      {/* ── Logo ── */}
      <LogoControls
        controls={controls}
        onChange={onControlsChange}
        advancedContent={<LogoAdvanced {...shared} />}
      />

      {/* ── 签名 ── */}
      <SignatureControls
        controls={controls}
        onChange={onControlsChange}
        advancedContent={<SignatureAdvanced {...shared} />}
      />
    </aside>
  );
}
