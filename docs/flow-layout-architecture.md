# V3 Flow Layout Architecture

## 目标

把 `footer-bar` 与 `side-bar` 从两套物理方位逻辑收敛为同一套方向无关的 Flow Layout，同时保留各 Region 的独立几何策略。

核心原则：

- 内容配置不绑定左、右、上、下。
- Region 策略把逻辑槽位映射到实际几何位置。
- 单轨/双轨只改变轨道可见性，不删除隐藏轨道内容。
- Region 提供默认方向策略，Slot 可以显式覆盖。
- Logo / 签名方向与文字方向解耦。
- TypeScript 与 Python 对同一 Fixture 产生一致的 Layout JSON。

## Canonical Slot

Flow Region 使用固定逻辑槽位：

```text
primary-start
primary-end
secondary-start
secondary-end
asset
```

含义：

- `primary`：靠近照片的主轨道。
- `secondary`：远离照片的次轨道。
- `start/end`：沿主轴的起点和终点。
- `asset`：Logo 等资源槽，可跨轨道。

## Flow Layout

```json
{
  "mode": "single-track | dual-track",
  "main_alignment": "start | center | end | space-between",
  "cross_alignment": "start | center | end",
  "track_order": "photo-outward | outward-photo",
  "track_gap": { "mode": "pixel | short_edge_ratio", "value": 8 },
  "item_gap": { "mode": "pixel | short_edge_ratio", "value": 8 },
  "track_ratios": [0.6, 0.4]
}
```

默认映射：

- `footer-bar`：主轴从左到右，轨道从照片向下。
- `side-bar/right`：主轴从上到下，primary 在左、secondary 在右。
- `side-bar/left`：主轴从上到下，primary 在右、secondary 在左。

## 方向解析

Region 级文字策略：

```text
auto
horizontal
rotate-with-edge
rotate-cw
rotate-ccw
vertical-glyphs
```

优先级：

```text
Slot style.text_direction
→ Region text_orientation
→ Region 类型默认值
```

默认值：

- footer-bar：`horizontal`
- side-bar/right：`rotate-cw`
- side-bar/left：`rotate-ccw`

资源方向独立：

```text
upright
follow-flow
rotate-cw
rotate-ccw
```

Logo 与签名默认 `upright`。

## Schema 迁移

Schema v3 读取旧 v1/v2 配置并迁移：

```text
left-top     → primary-start
right-top    → primary-end
left-bottom  → secondary-start
right-bottom → secondary-end
left-logo / center / right-logo → asset

footer_mode=single-row → layout.mode=single-track
footer_mode=dual-row   → layout.mode=dual-track
```

兼容期规则：读取旧结构，内部与输出只使用 v3 canonical 结构。

## 布局策略

布局引擎按 Region 类型分派：

```text
FooterBarLayoutStrategy
SideBarLayoutStrategy
FreeLayoutStrategy
```

Flow Region 共用：

- canonical slot 解析；
- 轨道分配；
- start/end 主轴锚点；
- 方向解析；
- Asset placement。

Region 策略只负责：

- Region bounds；
- 主轴方向；
- 轨道物理顺序；
- 对应的锚点和尺寸基准。

## 实施状态

已完成：

- Schema v3、Flow 类型、Canonical Slot 和 v1/v2 兼容迁移。
- Footer / Side 独立 Flow 策略。
- TS / Python 共享 JSON Fixture 一致性校验。
- Region 默认文字方向、Slot 显式覆盖和资源独立方向。
- Footer / Side 控制面拆分与单/双轨交互关联。
- 预设迁移到 canonical slot；运行时布局引擎已移除旧物理槽位和 `footer_mode` 依赖。

保留边界：API schema 层仍保留历史 payload 迁移入口，用于读取旧配置；迁移后的内部结构和输出均为 schema v3 canonical Flow Layout。

## 阶段记录

1. Schema v3、Flow 类型、Canonical Slot、兼容迁移。
2. TS/Python Flow 策略与 Golden Fixtures。
3. 文字和资源方向解析，清理切换时批量改写。
4. Footer / Side 独立控制面和编辑器。
5. 预设迁移、旧字段删除、全量回归和文档收口。

## 验收

- 单轨/双轨切换不丢内容。
- 左右侧栏切换保持 primary=靠照片。
- 显式 Slot 方向不会被 Region 覆盖。
- Logo 默认保持正向。
- 无对象插入顺序依赖。
- TS/Python Layout JSON 一致。
- 前端预览与 PIL 导出一致。
- API 只输出 schema v3 canonical 配置。
