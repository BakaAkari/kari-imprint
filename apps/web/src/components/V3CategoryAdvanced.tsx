import type {
  RegionConfig,
  RootOverrides,
  SlotOverride,
  StyleConfig,
  WatermarkConfigV3,
} from '../v3Types';

type Props = {
  config: WatermarkConfigV3;
  onRegionOverride: (regionId: string, patch: Partial<RegionConfig>) => void;
  onRootOverride: (patch: Partial<RootOverrides>) => void;
  onSlotOverride: (key: string, override: SlotOverride) => void;
};

function slotKey(regionId: string, slotId: string) {
  return `${regionId}:${slotId}`;
}

export function LogoAdvancedV3({ config, onSlotOverride }: Props) {
  const logoSlots = config.regions.flatMap((region) =>
    Object.entries(region.slots ?? {})
      .filter(([slotId]) => slotId.includes('logo'))
      .map(([slotId, slot]) => ({ region, slotId, slot })),
  );
  return (
    <div className="v3-category-editor">
      {logoSlots.map(({ region, slotId, slot }) => (
        <div className="v3-advanced-item" key={slotKey(region.id, slotId)}>
          <label className="v3-form-row v3-checkbox-row">
            <span className="text-sm">{region.id} / {slotId}</span>
            <input type="checkbox" checked={slot.enabled}
              onChange={(e) => onSlotOverride(slotKey(region.id, slotId), { enabled: e.target.checked })} />
          </label>
          {slot.enabled && slot.content && 'path' in slot.content && !('invert_mono' in slot.content) && (
            <label className="v3-form-row">
              <span className="text-sm">精确大小比例</span>
              <input type="number" min={0.01} max={1} step={0.01}
                value={slot.content.size_ratio ?? ''}
                placeholder={slot.content.size_level ?? 'medium'}
                onChange={(e) => onSlotOverride(slotKey(region.id, slotId), {
                  content: { ...slot.content, size_level: null, size_ratio: parseFloat(e.target.value) || 0.6 },
                } as SlotOverride)} />
            </label>
          )}
        </div>
      ))}
    </div>
  );
}

export function AppearanceAdvancedV3({ config, onRootOverride }: Props) {
  const margins = config.canvas.margins;
  const updateCanvas = (patch: Partial<WatermarkConfigV3['canvas']>) => onRootOverride({ canvas: patch });
  const updateDefaults = (patch: Partial<StyleConfig>) => onRootOverride({ defaults: patch });
  const labels = { top: '上边距', right: '右边距', bottom: '下边距', left: '左边距' } as const;
  return (
    <div className="v3-category-editor">
      <div className="v3-advanced-grid">
        {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
          <label className="small-label" key={side}>{labels[side]}
            <input type="number" min={0} max={500} value={margins[side]}
              onChange={(e) => updateCanvas({ margins: { ...margins, [side]: Number(e.target.value) } })} />
          </label>
        ))}
      </div>
      <label className="v3-form-row"><span className="text-sm">背景色</span>
        <input type="color" value={config.canvas.background} onChange={(e) => updateCanvas({ background: e.target.value })} />
      </label>
      <label className="v3-form-row"><span className="text-sm">圆角半径</span>
        <input type="number" min={0} max={160} step={2} value={config.canvas.border_radius}
          onChange={(e) => updateCanvas({ border_radius: Number(e.target.value) })} />
      </label>
      <label className="v3-form-row"><span className="text-sm">默认字号比例</span>
        <input type="number" min={0} max={0.5} step={0.005} value={config.defaults.font_size_ratio ?? ''}
          onChange={(e) => updateDefaults({ font_size: null, font_size_level: null, font_size_ratio: parseFloat(e.target.value) || 0 })} />
      </label>
      <label className="v3-form-row"><span className="text-sm">默认文字颜色</span>
        <input type="color" value={config.defaults.color} onChange={(e) => updateDefaults({ color: e.target.value })} />
      </label>
    </div>
  );
}

export function SignatureAdvancedV3({ config, onRegionOverride, onSlotOverride }: Props) {
  const regions = config.regions.filter((region) => region.type === 'free');
  return (
    <div className="v3-category-editor">
      {regions.map((region) => (
        <div className="v3-advanced-item" key={region.id}>
          <div className="v3-advanced-item-title">{region.id}</div>
          <label className="v3-form-row"><span className="text-sm">锚点</span>
            <select value={region.anchor ?? 'bottom-right'}
              onChange={(e) => onRegionOverride(region.id, { anchor: e.target.value as RegionConfig['anchor'] })}>
              {['top-left','top-center','top-right','middle-left','middle-center','middle-right','bottom-left','bottom-center','bottom-right'].map((anchor) =>
                <option key={anchor} value={anchor}>{anchor}</option>)}
            </select>
          </label>
          <div className="v3-advanced-grid">
            <label className="small-label">X 偏移<input type="number" step={0.01} value={region.offset_x ?? 0}
              onChange={(e) => onRegionOverride(region.id, { offset_x: parseFloat(e.target.value) || 0 })} /></label>
            <label className="small-label">Y 偏移<input type="number" step={0.01} value={region.offset_y ?? 0}
              onChange={(e) => onRegionOverride(region.id, { offset_y: parseFloat(e.target.value) || 0 })} /></label>
          </div>
          {Object.entries(region.slots ?? {}).map(([slotId, slot]) => (
            <label className="v3-form-row v3-checkbox-row" key={slotId}>
              <span className="text-sm">{slotId}</span>
              <input type="checkbox" checked={slot.enabled}
                onChange={(e) => onSlotOverride(slotKey(region.id, slotId), { enabled: e.target.checked })} />
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

export function BorderAdvancedV3({ config, onRootOverride }: Props) {
  const border = config.canvas.border;
  return (
    <div className="v3-category-editor">
      <label className="v3-form-row"><span className="text-sm">边框颜色</span>
        <input type="color" value={border.color}
          onChange={(e) => onRootOverride({ canvas: { border: { ...border, color: e.target.value } } })} />
      </label>
    </div>
  );
}

export function LayoutAdvancedV3({ config, onRegionOverride, onSlotOverride }: Props) {
  return (
    <div className="v3-category-editor">
      {config.regions.map((region) => (
        <div className="v3-advanced-item" key={region.id}>
          <label className="v3-form-row v3-checkbox-row">
            <span className="text-sm">{region.id} / {region.type}</span>
            <input type="checkbox" checked={region.enabled}
              onChange={(e) => onRegionOverride(region.id, { enabled: e.target.checked })} />
          </label>
          {(region.type === 'footer-bar' || region.type === 'side-bar') && (
            <label className="v3-form-row"><span className="text-sm">区域类型</span>
              <select value={region.type}
                onChange={(e) => {
                  const type = e.target.value as RegionConfig['type'];
                  const edge = region.edge ?? 'right';
                  onRegionOverride(region.id, {
                    type,
                    height: type === 'footer-bar' ? (region.height ?? 0.09) : undefined,
                    edge: type === 'side-bar' ? edge : region.edge,
                    width: type === 'side-bar' ? (region.width ?? { mode: 'short_edge_ratio', value: 0.12 }) : region.width,
                  });
                }}>
                <option value="footer-bar">底部水印</option>
                <option value="side-bar">侧边水印</option>
              </select>
            </label>
          )}
          {region.type === 'footer-bar' && (
            <label className="v3-form-row"><span className="text-sm">高度比例</span>
              <input type="number" min={0.02} max={0.5} step={0.01} value={region.height ?? 0.09}
                onChange={(e) => onRegionOverride(region.id, { height: parseFloat(e.target.value) || 0.09 })} />
            </label>
          )}
          {(region.type === 'side-edge' || region.type === 'side-bar') && (
            <label className="v3-form-row"><span className="text-sm">边缘</span>
              <select value={region.edge ?? 'right'}
                onChange={(e) => {
                  const edge = e.target.value as 'left' | 'right';
                  onRegionOverride(region.id, { edge });
                }}>
                <option value="left">左侧</option><option value="right">右侧</option>
              </select>
            </label>
          )}
        </div>
      ))}
    </div>
  );
}

export type { Props as V3CategoryAdvancedProps };
