# Region-Based Layout / 历史架构说明

状态：本文件的历史文件名保留（`v3-region-based-layout.md`），内容随 0.2.0 重命名同步为当前 Kari Imprint 架构描述。

当前主线是 **Flow Layout**：Region / Canonical Slot / Content。底栏与左右侧栏共享同一套 Flow 槽位和单/双轨布局模型，前端 Canvas 与后端 PIL 通过共享 JSON Fixture 保持一致。

## 当前核心模型

```text
ImprintConfig
  ├─ canvas
  ├─ defaults
  └─ regions[]
       ├─ footer-bar
       ├─ side-bar
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
- API 输出 canonical Flow 配置。

## 关键文件

| 层 | 文件 | 说明 |
|---|---|---|
| Config | `apps/web/src/types.ts` | 前端类型、预设与控制面映射 |
| Config | `apps/api/src/api/schemas.py` | API 严格校验 |
| Layout | `apps/web/src/layout/layoutEngine.ts` | 前端布局计算 |
| Layout | `packages/kari-core/src/kari_core/shared/layout/layout_engine.py` | 后端布局计算 |
| Parity | `packages/kari-core/tests/fixtures/flow_layout_cases.json` | TS/Python 共享布局 Fixture |
| Render | `apps/web/src/KariImprintCanvas.tsx` | Canvas 预览 |
| Render | `packages/kari-core/src/kari_core/processor/renderer.py` | PIL 输出 |
| API | `apps/api/src/api/main.py` / `apps/api/src/api/processing.py` | 上传、metadata、处理与下载 |
