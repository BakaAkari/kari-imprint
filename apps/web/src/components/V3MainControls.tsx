import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { V3AppContext } from '../V3HomePage';
import { DEFAULT_LOGO_PLACEHOLDER_URL, builtinLogoUrl, fetchLogosV3, uploadResourceV3 } from '../apiV3';
import {
  type FieldChip,
  type FieldId,
  type FlowMode,
  type LogoPosition,
  type MainControlConfig,
  type ColorScheme,
  type SizeLevel,
  type WatermarkConfigV3,
  FLOW_MODE_LABELS,
  LOGO_POSITION_LABELS,
  fieldOptionsV3,
  getFieldLabel,
} from '../v3Types';

interface V3MainControlsProps {
  config: WatermarkConfigV3;
  onChange: (config: WatermarkConfigV3) => void;
  diagnostics?: DiagnosticItem[];
}

export type DiagnosticItem = {
  id: string;
  type: string;
  severity: 'error' | 'warning';
  message: string;
  elementIds?: string[];
};

export default function V3MainControls({ config: _config }: V3MainControlsProps) {
  const ctx = useContext(V3AppContext);
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
    ? { primary_start: '内列上方', primary_end: '内列下方', secondary_start: '外列上方', secondary_end: '外列下方' }
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

  // 无 Flow 水印栏时，主控制面不渲染槽位编辑块，
  // 避免用户编辑一组不会写入任何 Region 的空转控件。
  if (!flowRegion) return null;

  return (
    <div className="v3-main-controls">
      <div className="v3-footer-bar">
        <div className="v3-footer-bar-header">
          <div className="v3-footer-bar-title">{isSideBar ? `${flowRegion.edge === 'left' ? '左' : '右'}侧水印栏` : '底部水印栏'}</div>
          <div className="v3-footer-bar-actions">
            <button
              className="v3-btn v3-btn-sm"
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
        <div className={`v3-footer-bar-rows v3-footer-bar-rows-${controls.flow_mode}`}>
          {rows.map(row => (
            <div key={row.id} className={`v3-footer-row v3-footer-row-${row.position}`}>
              <div className="v3-footer-row-label">{row.label}</div>
              <select
                className="v3-footer-row-size"
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
              <div className="v3-footer-row-chips">
                {row.chips.map((chip: FieldChip, idx: number) => (
                  <div key={`${row.id}-${idx}`} className="v3-field-chip">
                    <span>{getFieldLabel(chip.field_id)}</span>
                    <button
                      className="v3-chip-remove"
                      onClick={() => handleRemoveChip(row.id, idx)}
                      title="移除"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {addingFor === row.id ? (
                  <select
                    className="v3-chip-select"
                    autoFocus
                    value=""
                    onChange={(e) => handleAddChip(row.id, e.target.value as FieldId)}
                    onBlur={() => setAddingFor(null)}
                  >
                    <option value="" disabled>
                      选择字段...
                    </option>
                    {fieldOptionsV3
                      .filter((o: { id: FieldId; label: string }) => !row.chips.some((c: FieldChip) => c.field_id === o.id))
                      .map((o: { id: FieldId; label: string }) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                  </select>
                ) : (
                  <button className="v3-add-chip" onClick={() => setAddingFor(row.id)}>
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

export function V3LogoControls({
  controls,
  onChange,
  advancedContent,
}: {
  controls: MainControlConfig;
  onChange: (patch: Partial<MainControlConfig>) => void;
  advancedContent?: React.ReactNode;
}) {
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [builtinLogos, setBuiltinLogos] = useState<string[]>([]);

  useEffect(() => {
    void fetchLogosV3().then(setBuiltinLogos);
  }, []);

  const logoPath = controls.logo_path;
  const logoMode: 'auto' | 'builtin' | 'custom' =
    !logoPath ? 'auto' : logoPath.startsWith('builtin:') ? 'builtin' : 'custom';
  const currentBuiltin = logoMode === 'builtin' ? logoPath.split(':', 2)[1] : '';

  const handleLogoChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploadStatus('上传中...');
      void uploadResourceV3(file, 'logo')
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

  return (
    <div className="v3-right-section v3-logo-drawer">
      <div className="v3-right-section-title">Logo</div>
      <div className="v3-right-section-body">
        <div className="v3-form-row">
          <label>来源</label>
          <div className="v3-segmented-group">
            <button
              className={`v3-segment ${logoMode === 'auto' ? 'active' : ''}`}
              onClick={() => onChange({ logo_path: '' })}
            >
              自动
            </button>
            <button
              className={`v3-segment ${logoMode === 'builtin' ? 'active' : ''}`}
              disabled={builtinLogos.length === 0}
              onClick={() => {
                if (builtinLogos.length > 0) onChange({ logo_path: `builtin:${currentBuiltin || builtinLogos[0]}` });
              }}
            >
              内置
            </button>
            <button
              className={`v3-segment ${logoMode === 'custom' ? 'active' : ''}`}
              onClick={() => logoInputRef.current?.click()}
            >
              上传
            </button>
          </div>
          <input ref={logoInputRef} type="file" accept="image/*" className="v3-hidden-input" onChange={handleLogoChange} />
          {uploadStatus && <div className="v3-control-note">{uploadStatus}</div>}
        </div>
        {logoMode === 'builtin' && (
          <div className="v3-form-row">
            <label>品牌</label>
            <select
              value={currentBuiltin}
              onChange={(e) => onChange({ logo_path: `builtin:${e.target.value}` })}
            >
              {builtinLogos.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
        )}
        {(logoMode === 'builtin' || logoMode === 'auto') && (
          <div className="v3-form-row">
            <img
              src={logoMode === 'builtin' && currentBuiltin ? builtinLogoUrl(currentBuiltin) : DEFAULT_LOGO_PLACEHOLDER_URL}
              alt="logo 预览"
              style={{ maxHeight: 32, maxWidth: 120, objectFit: 'contain' }}
              onError={(e) => {
                e.currentTarget.src = DEFAULT_LOGO_PLACEHOLDER_URL;
              }}
            />
          </div>
        )}
        <div className="v3-form-row">
          <label>大小</label>
          <select
            value={controls.logo_size}
            onChange={(e) => onChange({ logo_size: e.target.value as SizeLevel })}
          >
            {(['small', 'medium', 'large'] as SizeLevel[]).map(s => (
              <option key={s} value={s}>
                {s === 'small' ? '小' : s === 'medium' ? '中' : '大'}
              </option>
            ))}
          </select>
        </div>
        <div className="v3-form-row">
          <label>位置</label>
          <div className="v3-segmented-group">
            {(Object.keys(LOGO_POSITION_LABELS) as LogoPosition[]).map(pos => (
              <button
                key={pos}
                className={`v3-segment ${controls.logo_position === pos ? 'active' : ''}`}
                onClick={() => onChange({ logo_position: pos })}
              >
                {LOGO_POSITION_LABELS[pos]}
              </button>
            ))}
          </div>
        </div>
        {advancedContent && (
          <>
            <button className="v3-section-advanced-toggle" onClick={() => setAdvancedOpen((value) => !value)}>
              <span>高级设置</span><span>{advancedOpen ? '收起' : '展开'}</span>
            </button>
            {advancedOpen && <div className="v3-category-advanced">{advancedContent}</div>}
          </>
        )}
      </div>
    </div>
  );
}

export function V3AppearanceControls({
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
    <div className="v3-right-section">
      <div className="v3-right-section-title">整体外观</div>
      <div className="v3-right-section-body">
        <div className="v3-form-row">
          <label>明暗方案</label>
          <div className="v3-segmented-group">
            {(['dark', 'light'] as ColorScheme[]).map(s => (
              <button
                key={s}
                className={`v3-segment ${controls.scheme === s ? 'active' : ''}`}
                onClick={() => onChange({ scheme: s })}
              >
                {s === 'dark' ? '深色水印' : '浅色水印'}
              </button>
            ))}
          </div>
        </div>
        <div className="v3-control-note">影响文字、水印条背景与边框；Logo 始终保留原始颜色和透明通道。</div>
        {advancedContent && (
          <>
            <button className="v3-section-advanced-toggle" onClick={() => setAdvancedOpen((value) => !value)}>
              <span>高级设置</span><span>{advancedOpen ? '收起' : '展开'}</span>
            </button>
            {advancedOpen && <div className="v3-category-advanced">{advancedContent}</div>}
          </>
        )}
      </div>
    </div>
  );
}

export function V3SignatureControls({
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
      void uploadResourceV3(file, 'signature')
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
    <div className="v3-right-section">
      <div className="v3-right-section-title">签名</div>
      <div className="v3-right-section-body">
        <div className="v3-form-row">
          <label>资源</label>
          <div className="v3-file-row">
            <button className="v3-btn v3-btn-sm" onClick={() => sigInputRef.current?.click()}>
              {controls.signature_path ? '更换' : '上传'}
            </button>
            {controls.signature_path && (
              <button className="v3-btn v3-btn-sm v3-btn-ghost" onClick={() => onChange({ signature_path: '' })}>
                清除
              </button>
            )}
            <input ref={sigInputRef} type="file" accept="image/*" className="v3-hidden-input" onChange={handleSignatureChange} />
          </div>
          {uploadStatus && <div className="v3-control-note">{uploadStatus}</div>}
        </div>
        {controls.signature_path && (
          <div className="v3-form-row">
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
            <button className="v3-section-advanced-toggle" onClick={() => setAdvancedOpen((value) => !value)}>
              <span>高级设置</span><span>{advancedOpen ? '收起' : '展开'}</span>
            </button>
            {advancedOpen && <div className="v3-category-advanced">{advancedContent}</div>}
          </>
        )}
      </div>
    </div>
  );
}

export function V3BorderControls({
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
    <div className="v3-right-section">
      <div className="v3-right-section-title">边框</div>
      <div className="v3-right-section-body">
        <label className="v3-form-row v3-checkbox-row">
          <input type="checkbox" checked={controls.border_enabled}
            onChange={(e) => onChange({ border_enabled: e.target.checked })} />
          <span className="text-sm">启用边框</span>
        </label>
        {controls.border_enabled && (
          <div className="v3-form-row">
            <label>宽度</label>
            <select value={controls.border_width_level}
              onChange={(e) => onChange({ border_width_level: e.target.value as SizeLevel })}>
              <option value="small">小</option>
              <option value="medium">中</option>
              <option value="large">大</option>
            </select>
          </div>
        )}
        {advancedContent && (
          <>
            <button className="v3-section-advanced-toggle" onClick={() => setAdvancedOpen((value) => !value)}>
              <span>高级设置</span><span>{advancedOpen ? '收起' : '展开'}</span>
            </button>
            {advancedOpen && <div className="v3-category-advanced">{advancedContent}</div>}
          </>
        )}
      </div>
    </div>
  );
}

export type { FieldChip, FieldId, FlowMode, LogoPosition, MainControlConfig, ColorScheme, SizeLevel };
