# V3 Region-Based Layout / 历史架构说明

状态：已被 `docs/flow-layout-architecture.md` 取代。本文件只保留为 V3 演进背景，不再作为当前实现依据。

当前主线是 **V3 Flow Layout**：Region / Canonical Slot / Content。底栏与左右侧栏共享同一套 Flow 槽位和单/双轨布局模型，前端 Canvas 与后端 PIL 通过共享 JSON Fixture 保持一致。

## 当前核心模型

```text
WatermarkConfigV3
  ├─ canvas
  ├─ defaults
  └─ regions[]
       ├─ footer-bar
       ├─ side-bar
       ├─ side-edge
       └─ free
            └─ slots{}
                 └─ content + style
```

Flow Region 使用固定 canonical slots：

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
- `asset`：Logo 等资源槽。

## 当前原则

- Layout engine 只计算位置、尺寸、方向和顺序。
- Renderer 只按 `LayoutResult` 绘制，不再自行计算坐标。
- Canvas 与 PIL 使用统一坐标系：左上角为原点，X 向右，Y 向下。
- API 输出 schema v3 canonical Flow 配置；旧 v1/v2 payload 只在 schema 层显式迁移。
- 运行时布局引擎不再依赖旧物理槽位或 `footer_mode`。

## 关键文件

| 层 | 文件 | 说明 |
|---|---|---|
| Config | `apps/web/src/v3Types.ts` | 前端类型、预设与控制面映射 |
| Config | `apps/api/src/api/schemas_v3.py` | API 严格校验与旧 payload 迁移 |
| Layout | `apps/web/src/v3_layout/layoutEngine.ts` | 前端布局计算 |
| Layout | `packages/kari-core/src/kari_core/shared/v3_layout/layout_engine.py` | 后端布局计算 |
| Parity | `packages/kari-core/tests/fixtures/v3_flow_layout_cases.json` | TS/Python 共享布局 Fixture |
| Render | `apps/web/src/WatermarkCanvasV3.tsx` | Canvas 预览 |
| Render | `packages/kari-core/src/kari_core/processor/v3_renderer.py` | PIL 输出 |
| API | `apps/api/src/api/main.py` / `apps/api/src/api/processing.py` | 上传、metadata、处理与下载 |

## 已移除内容

V1/V2 的以下内容已从主线删除：

- 四角配置前端：`HomePage.tsx`、`WatermarkCanvas.tsx`、`InspectorPanel.tsx` 等。
- 旧 schema 和 assembler：`web_api/schemas.py`、`shared/watermark_schema.py`、`shared/processor_assembler.py`。
- V2 SPA route：`/v2`。
- 线上 `/tools/watermark-v2/`。
- V1 活跃 API 反代。

旧 `footer-bar` 物理槽位（如 `left-top`、`right-logo`）不再作为运行时结构使用；仅 schema 迁移层识别旧 payload 并转换为 canonical slots。
