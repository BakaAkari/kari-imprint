import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppContext } from '../HomePage';
import { DEFAULT_LOGO_PLACEHOLDER_URL, fetchLogos, uploadResource, type LogoVariant } from '../api';
import {
  type FieldChip,
  type FieldId,
  type FlowMode,
  type LogoPosition,
  type MainControlConfig,
  type ColorScheme,
  type SizeLevel,
  type ImprintConfig,
  FLOW_MODE_LABELS,
  LOGO_POSITION_LABELS,
  fieldOptions,
  getFieldLabel,
} from '../types';

interface MainControlsProps {
  config: ImprintConfig;
  onChange: (config: ImprintConfig) => void;
  diagnostics?: DiagnosticItem[];
}

export type DiagnosticItem = {
  id: string;
  type: string;
  severity: 'error' | 'warning';
  message: string;
  elementIds?: string[];
};

export default function MainControls({ config: _config }: MainControlsProps) {
  const ctx = useContext(AppContext);
  const controls = ctx?.controls;
  const onControlsChange = ctx?.onControlsChange;

  if (!controls || !onControlsChange) {
    // Fallback for backward compat: infer from config
    return null;
  }

  const [addingFor, setAddingFor] = useState<string | null>(null);

  const flowRegion = _config.regions.find((region) => region.type === 'footer-bar' || region.type === 'side-bar');
  const isSideBar = flowRegion?.type === 'side-bar';
  const isDual = controls.flow_mode === 'dual-track';
  const labels = isSideBar
    ? { primary_start: '内上', primary_end: '内下', secondary_start: '外上', secondary_end: '外下' }
    : { primary_start: '左上', primary_end: '右上', secondary_start: '左下', secondary_end: '右下' };
  const rows = useMemo(() => {
    const all = [
      { id: 'primary_start', label: labels.primary_start, chips: controls.primary_start, position: 'primary-start' },
      { id: 'primary_end', label: labels.primary_end, chips: controls.primary_end, position: 'primary-end' },
      { id: 'secondary_start', label: labels.secondary_start, chips: controls.secondary_start, position: 'secondary-start' },
      { id: 'secondary_end', label: labels.secondary_end, chips: controls.secondary_end, position: 'secondary-end' },
    ];
    return isDual ? all : all.filter(row => row.id.startsWith('primary_'));
  }, [controls, isDual, isSideBar]);

  const updateRow = useCallback(
    (rowId: string, chips: FieldChip[]) => {
      const patch: Partial<MainControlConfig> = {};
      patch[rowId as keyof MainControlConfig] = chips as any;
      onControlsChange(patch);
    },
    [onControlsChange],
  );

  const handleAddChip = useCallback(
    (rowId: string, fieldId: FieldId) => {
      const row = rows.find(r => r.id === rowId);
      if (!row) return;
      const next = [...row.chips, { field_id: fieldId }];
      updateRow(rowId, next);
      setAddingFor(null);
    },
    [rows, updateRow],
  );

  const handleRemoveChip = useCallback(
    (rowId: string, idx: number) => {
      const row = rows.find(r => r.id === rowId);
      if (!row) return;
      const next = [...row.chips];
      next.splice(idx, 1);
      updateRow(rowId, next);
    },
    [rows, updateRow],
  );

  // 无 Flow 边框栏时，主控制面不渲染槽位编辑块，
  // 避免用户编辑一组不会写入任何 Region 的空转控件。
  if (!flowRegion) return null;

  return (
    <div className="main-controls">
      <div className="footer-bar">
        <div className="footer-bar-header">
          <div className="footer-bar-title">{isSideBar ? `${flowRegion.edge === 'left' ? '左' : '右'}侧边框栏` : '底部边框栏'}</div>
          <div className="footer-bar-actions">
            <button
              className="btn btn-sm"
              onClick={() =>
                onControlsChange({
                  flow_mode: controls.flow_mode === 'dual-track' ? 'single-track' : 'dual-track',
                })
              }
              title={isSideBar ? "切换单列/双列" : "切换单排/双排"}
            >
              {isSideBar ? (isDual ? '内外双列' : '单列') : FLOW_MODE_LABELS[controls.flow_mode]}
            </button>
          </div>
        </div>
        <div className={`footer-bar-rows footer-bar-rows-${controls.flow_mode}`}>
          {rows.map(row => (
            <div key={row.id} className={`footer-row footer-row-${row.position}`}>
              <div className="footer-row-label">{row.label}</div>
              <select
                className="footer-row-size"
                aria-label={`${row.label}字号`}
                value={controls.text_sizes[row.id as keyof typeof controls.text_sizes]}
                onChange={(e) => onControlsChange({
                  text_sizes: { ...controls.text_sizes, [row.id]: e.target.value as SizeLevel },
                })}
              >
                <option value="small">小</option>
                <option value="medium">中</option>
                <option value="large">大</option>
              </select>
              <div className="footer-row-chips">
                {row.chips.map((chip: FieldChip, idx: number) => (
                  <div key={`${row.id}-${idx}`} className="field-chip">
                    <span>{getFieldLabel(chip.field_id)}</span>
                    <button
                      className="chip-remove"
                      onClick={() => handleRemoveChip(row.id, idx)}
                      title="移除"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {addingFor === row.id ? (
                  <select
                    className="chip-select"
                    autoFocus
                    value=""
                    onChange={(e) => handleAddChip(row.id, e.target.value as FieldId)}
                    onBlur={() => setAddingFor(null)}
                  >
                    <option value="" disabled>
                      选择字段...
                    </option>
                    {fieldOptions
                      .filter((o: { id: FieldId; label: string }) => !row.chips.some((c: FieldChip) => c.field_id === o.id))
                      .map((o: { id: FieldId; label: string }) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                  </select>
                ) : (
                  <button className="add-chip" onClick={() => setAddingFor(row.id)}>
                    +
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

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

export function LogoControls({
  controls,
  onChange,
  advancedContent,
}: {
  controls: MainControlConfig;
  onChange: (patch: Partial<MainControlConfig>) => void;
  advancedContent?: React.ReactNode;
}) {
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [builtinLogos, setBuiltinLogos] = useState<LogoVariant[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    void fetchLogos().then(setBuiltinLogos);
  }, []);

  const logoPath = controls.logo_path;
  const logoMode = logoPath ? 'custom' : 'auto';

  const allVariants = [...new Set(builtinLogos.flatMap((l) => l.variants))].sort();

  const handleLogoChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploadStatus('上传中...');
      void uploadResource(file, 'logo')
        .then((result) => {
          onChange({ logo_path: result.resource_id });
          setUploadStatus('');
        })
        .catch((error: unknown) => {
          setUploadStatus(error instanceof Error ? error.message : '上传失败');
        });
      e.target.value = '';
    },
    [onChange],
  );

  const isSide = controls.layout_structure === 'side-left' || controls.layout_structure === 'side-right';
  const posLabels: Record<string, string> = isSide
    ? { left: '上', center: '中', right: '下' }
    : { left: '左', center: '中', right: '右' };

  const logoEnabled = controls.logo_enabled;
  return (
    <div className="right-section logo-drawer">
      <div className="right-section-title">Logo</div>
      <div className="right-section-body">
        <div className="triple-row">
          <span className="mini-label">Logo</span>
          <button
            className={`detail-toggle ${detailOpen ? 'open' : ''}`}
            onClick={() => setDetailOpen((v) => !v)}
            disabled={!logoEnabled}
          >
            细节
          </button>
          <div className="segmented-group layout-structure-options">
            <button
              className={`segment ${logoEnabled ? 'active' : ''}`}
              onClick={() => onChange({ logo_enabled: true })}
            >
              开启
            </button>
            <button
              className={`segment ${!logoEnabled ? 'active' : ''}`}
              onClick={() => onChange({ logo_enabled: false })}
            >
              关闭
            </button>
          </div>
        </div>
        {logoEnabled && detailOpen && (
          <div className="detail-sub">
            {allVariants.length > 0 && (
              <div className="form-row">
                <label className="mini-label">款式</label>
                <div className="segmented-group layout-structure-options">
                  <button
                    className={`segment ${!controls.logo_variant ? 'active' : ''}`}
                    onClick={() => onChange({ logo_variant: '' })}
                  >
                    默认
                  </button>
                  {allVariants.map((v) => (
                    <button
                      key={v}
                      className={`segment ${controls.logo_variant === v ? 'active' : ''}`}
                      onClick={() => onChange({ logo_variant: v })}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="form-row">
              <label className="mini-label">来源</label>
              <div className="segmented-group">
                <button
                  className={`segment ${logoMode === 'auto' ? 'active' : ''}`}
                  onClick={() => onChange({ logo_path: '' })}
                >
                  自动
                </button>
                <button
                  className={`segment ${logoMode === 'custom' ? 'active' : ''}`}
                  onClick={() => logoInputRef.current?.click()}
                >
                  上传
                </button>
              </div>
              <input ref={logoInputRef} type="file" accept="image/*" className="hidden-input" onChange={handleLogoChange} />
              {uploadStatus && <div className="control-note">{uploadStatus}</div>}
            </div>
            {logoMode === 'auto' && (
              <div className="form-row">
                <img
                  src={DEFAULT_LOGO_PLACEHOLDER_URL}
                  alt="logo 预览"
                  style={{ maxHeight: 32, maxWidth: 120, objectFit: 'contain' }}
                  onError={(e) => {
                    e.currentTarget.src = DEFAULT_LOGO_PLACEHOLDER_URL;
                  }}
                />
              </div>
            )}
            {advancedContent}
          </div>
        )}
        <SegmentedRow label="位置">
          {(Object.keys(LOGO_POSITION_LABELS) as LogoPosition[]).map((pos) => (
            <button
              key={pos}
              className={`segment ${controls.logo_position === pos ? 'active' : ''}`}
              onClick={() => onChange({ logo_position: pos })}
              disabled={!logoEnabled}
            >
              {posLabels[pos]}
            </button>
          ))}
        </SegmentedRow>
        <SegmentedRow label="大小">
          {(['small', 'medium', 'large'] as SizeLevel[]).map((s) => (
            <button
              key={s}
              className={`segment ${controls.logo_size === s ? 'active' : ''}`}
              onClick={() => onChange({ logo_size: s })}
              disabled={!logoEnabled}
            >
              {s === 'small' ? '小' : s === 'medium' ? '中' : '大'}
            </button>
          ))}
        </SegmentedRow>
      </div>
    </div>
  );
}

export function SignatureControls({
  controls,
  onChange,
  advancedContent,
}: {
  controls: MainControlConfig;
  onChange: (patch: Partial<MainControlConfig>) => void;
  advancedContent?: React.ReactNode;
}) {
  const sigInputRef = useRef<HTMLInputElement>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');

  const handleSignatureChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploadStatus('上传中...');
      void uploadResource(file, 'signature')
        .then((result) => {
          onChange({ signature_path: result.resource_id });
          setUploadStatus('');
        })
        .catch((error: unknown) => {
          setUploadStatus(error instanceof Error ? error.message : '上传失败');
        });
      e.target.value = '';
    },
    [onChange],
  );

  return (
    <div className="right-section">
      <div className="right-section-title">签名</div>
      <div className="right-section-body">
        <div className="form-row">
          <label>资源</label>
          <div className="file-row">
            <button className="btn btn-sm" onClick={() => sigInputRef.current?.click()}>
              {controls.signature_path ? '更换' : '上传'}
            </button>
            {controls.signature_path && (
              <button className="btn btn-sm btn-ghost" onClick={() => onChange({ signature_path: '' })}>
                清除
              </button>
            )}
            <input ref={sigInputRef} type="file" accept="image/*" className="hidden-input" onChange={handleSignatureChange} />
          </div>
          {uploadStatus && <div className="control-note">{uploadStatus}</div>}
        </div>
        {controls.signature_path && (
          <div className="form-row">
            <label>大小</label>
            <select value={controls.signature_size} onChange={(e) => onChange({ signature_size: e.target.value as SizeLevel })}>
              {(['small', 'medium', 'large'] as SizeLevel[]).map(s => (
                <option key={s} value={s}>{s === 'small' ? '小' : s === 'medium' ? '中' : '大'}</option>
              ))}
            </select>
          </div>
        )}
        {advancedContent && (
          <>
            <button className="section-advanced-toggle" onClick={() => setAdvancedOpen((value) => !value)}>
              <span>高级设置</span><span>{advancedOpen ? '收起' : '展开'}</span>
            </button>
            {advancedOpen && <div className="category-advanced">{advancedContent}</div>}
          </>
        )}
      </div>
    </div>
  );
}

export function BorderControls({
  controls,
  onChange,
  advancedContent,
}: {
  controls: MainControlConfig;
  onChange: (patch: Partial<MainControlConfig>) => void;
  advancedContent?: React.ReactNode;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  return (
    <div className="right-section">
      <div className="right-section-title">边框</div>
      <div className="right-section-body">
        <div className="tone-row">
          <button
            className={`segment ${controls.border_enabled ? 'active' : ''}`}
            onClick={() => onChange({ border_enabled: true })}
          >
            开启
          </button>
          <button
            className={`segment ${!controls.border_enabled ? 'active' : ''}`}
            onClick={() => onChange({ border_enabled: false })}
          >
            关闭
          </button>
        </div>
        <div className="tone-row">
          {(['dark', 'light'] as ColorScheme[]).map(s => (
            <button
              key={s}
              className={`segment ${controls.scheme === s ? 'active' : ''}`}
              onClick={() => onChange({ scheme: s })}
            >
              {s === 'dark' ? '浅色边框' : '深色边框'}
            </button>
          ))}
        </div>
        <button className="section-advanced-toggle" onClick={() => setAdvancedOpen((value) => !value)}>
          <span>高级设置</span><span>{advancedOpen ? '收起' : '展开'}</span>
        </button>
        {advancedOpen && (
          <div className="category-advanced">
            <div className="form-row">
              <label>宽度</label>
              <select value={controls.border_width_level}
                onChange={(e) => onChange({ border_width_level: e.target.value as SizeLevel })}>
                <option value="small">小</option>
                <option value="medium">中</option>
                <option value="large">大</option>
              </select>
            </div>
            {advancedContent}
          </div>
        )}
      </div>
    </div>
  );
}

export type { FieldChip, FieldId, FlowMode, LogoPosition, MainControlConfig, ColorScheme, SizeLevel };
