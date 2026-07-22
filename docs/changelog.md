# Changelog / 开发变更记录

本文件记录当前 Web/V3 主线的重要变化。正式 Release notes 应以本文件、git diff 和实际验证结果为基础整理。

## Unreleased — V3 开发中

### Added

- Schema v3 Flow Layout 基础模型：Canonical Slot、单/双轨、轨道间距和方向策略。
- v1/v2 到 v3 的配置迁移层；API 输出只保留 canonical Flow 结构。
- `docs/flow-layout-architecture.md` 架构设计与分阶段验收标准。
- Footer / Side 独立 Flow 几何策略，并用共享 JSON Fixture 校验 TS/Python 布局输出一致。
- Region 级文字方向策略与 Slot 显式覆盖；Logo/签名使用独立资源方向，不再在切换侧栏时批量重写样式。
- 主控制面按 Region 动态显示底栏“单双排”或侧栏“内外单双列”，Inspector 拆分 Footer / Side 编辑器并使用方向化槽位文案。
- 预设迁移到 canonical slot；运行时布局引擎移除旧物理槽位和 `footer_mode` 依赖，仅 API schema 保留历史 payload 迁移入口。
- Logo/签名上传统一为服务端资源（`upload-resource` → opaque id），Canvas 预览通过 `GET /api/resources/{kind}/{id}` 读取，不再把 dataURL 写入配置。
- Logo 来源三态（自动按 EXIF / 内置品牌 / 上传）下沉到主控制面，内置品牌下拉 + 预览。
- Logo 位置左/中/右通过 `asset` 槽 `placement: start/center/end` 沿 Flow 主轴映射锚点；签名在 Canvas 绘制真实图像而非灰色占位。
- 无 Flow 水印栏的模板（如 side-edge 档案模板）不再渲染空转的槽位编辑块。
- 内置 Logo 改为通过 `/api/builtin-logos/{name}` 按 stem 安全解析，支持 png/jpg/jpeg/webp；无 assets 的干净环境降级为占位预览和禁用内置品牌，不再请求硬编码 `fujifilm.png`。

- V3 Region-Based Layout 架构：Region / Slot / Content 声明式配置。
- 前端布局引擎：`web_frontend/src/v3_layout/layoutEngine.ts`。
- 后端布局引擎：`shared/v3_layout/layout_engine.py`。
- 后端 V3 渲染处理器：`processor/v3_watermark.py`。
- V3 API schema：`web_api/schemas_v3.py`。
- V3 左侧 rail 工作台布局和预设 rail。
- V1 占位页：`deploy/legacy-watermark-placeholder/index.html`。
- 下一阶段设计入口：`design/v3-control-surface-guardrails.md`。

### Changed

- V3 主线从 Region-Based Layout 收敛为 Flow Layout：`primary-start` / `primary-end` / `secondary-start` / `secondary-end` / `asset` 成为底栏和侧栏共享槽位。

- 项目主线从 Web MVP/V1-V2 迁移到 V3。
- 线上 V3 固定入口：`/tools/watermark-v3/`。
- API prefix：`/tools/watermark-v3/api`。
- `/tools/watermark/` 改为“回炉重塑中”静态页。
- README、roadmap、部署文档和协作流程同步到 V3 当前状态。

### Removed

- V2 SPA route `/v2`。
- V2 静态入口 `/tools/watermark-v2/`。
- V1/V2 前端文件：`HomePage.tsx`、`WatermarkCanvas.tsx`、`api.ts`、`presets.ts`、`watermarkConfig.ts`、旧 Inspector/LeftRail/WatermarkBar 等。
- V1/V2 后端兼容模型：`web_api/schemas.py`、`shared/watermark_schema.py`、`shared/processor_assembler.py`。
- 旧 V1/V2 服务和 2189 端口对外路由。
- 过期 Web MVP / dev-stats 设计文档已归档至 `docs/archive/legacy-web-mvp/`。

### Security

- API 输出 schema v3 canonical 配置；旧 v1/v2 payload 仅通过显式迁移层读取，不再进入运行时布局引擎。
- V3 resource path 只接受不透明资源 ID。
- 禁止 NaN / Infinity 等非有限数值。
- 配置 JSON 大小限制为 64KB。
- 字体、资源、slot id、region id、anchor 等均加强枚举/格式校验。

### Verification

- `uv run ruff check .`
- `uv run pytest`
- `VITE_API_BASE=/tools/watermark-v3 npm run build`
- 线上 V1/V2/V3 路由和浏览器截图检查。

## 2.1.9 - 2026-06-24

桌面最终版。源码和历史文档保存在 `archive/desktop-v2` 分支，不再进入当前 Web/V3 主线。
