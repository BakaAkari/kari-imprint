# Changelog / 开发变更记录

本文件记录 Kari Imprint 主线的重要变化。正式 Release notes 应以本文件、git diff 和实际验证结果为基础整理。

## 0.2.0 - 2026-07-25

### Changed

- 全面重命名：产品主功能“水印”→“边框”，英文命名 watermark→Kari Imprint / info-frame。
- URL 从 `/tools/watermark-v3/` 迁移到 `/tools/kari-imprint/`；API prefix 同步为 `/tools/kari-imprint/api`。
- 代码去掉 V3 后缀：所有类、文件、目录、变量、CSS 类名。
  - Python：`v3_watermark.py` → `kari_imprint.py`、`v3_renderer.py` → `renderer.py`、`v3_assembler.py` → `assembler.py`、`shared/v3_layout/` → `shared/layout/`、`schemas_v3.py` → `schemas.py`、`WatermarkConfig` → `ImprintConfig`、`WatermarkV3Filter` → `KariImprintFilter`。
  - TypeScript：`v3Types.ts` → `types.ts`、`apiV3.ts` → `api.ts`、`v3_layout/` → `layout/`、`WatermarkCanvasV3.tsx` → `KariImprintCanvas.tsx`、`V3HomePage.tsx` → `HomePage.tsx`、`V3RightRail`/`V3LeftRail`/`V3MainControls`/`InspectorPanelV3` 等组件、`WatermarkConfigV3` → `ImprintConfig`、`processImageV3` → `processImage` 等。
  - CSS：所有 `.v3-*` 前缀去除；用户可见 UI 文本“水印” → “边框”。
- 处理器注册名从 `v3_watermark` 改为 `kari_imprint`；pipeline ctx key `v3_config` → `imprint_config`。
- 默认端口全面更新，避免与本地/系统常用端口冲突：
  - Web dev: `5173` → `21831`
  - API dev: `8000/8100` → `21830`（本地测试推荐）
  - API 生产（systemd + Caddy 反代）: `2189/2192` → `21832`
- deploy/ 目录整理：删除旧 nginx.conf / start.sh / stop.sh / deploy.sh / Caddyfile / kari-imprint-api.service / kari-imprint-web.service 等遗留文件，统一为 `deploy-tencent.sh` + `caddy-snippet.conf` + `kari-imprint.service`。
- 无兼容层，无旧 URL 重定向（尚未公开运营）。

### Verification

- `uv run ruff check .`：All checks passed
- `uv run python scripts/verify_flow_layout_parity.py`：Flow Layout parity passed: 4 fixtures
- `packages/kari-core` pytest：401 passed, 7 skipped（skipped 为归档 GUI 测试）
- `apps/api` pytest：73 passed
- `apps/web` `npx tsc -b`：无错误
- `apps/web` `VITE_API_BASE=/tools/kari-imprint npm run build`：`kari-imprint-web@0.2.0` 39 modules，dist 生成
- `git diff --check`：无空白/尾随错误

Claude Code 交付后由 Hermes 独立跑验证发现并修复的问题：

1. `apps/web/src/components/InspectorPanel.tsx`：本地 `uploadResource` 函数与 `import { uploadResource }` 同名冲突（TS 2339），本地函数改名为 `handleUpload`。
2. `apps/api/src/api/main.py`：Claude Code 将 legacy 检测错误码从 `legacy_config_removed` (410) 擅自改为 `invalid_config` (422)，恢复原语义并同步 message 到 Kari Imprint 命名。
3. `apps/web/src/styles.css` + `InspectorPanel.tsx`：遗漏的 `.inspector-v3` CSS 类名（5 处）+ JSX（1 处）改为 `.inspector-imprint`。

未做：commit / push / tag / deploy —— 等待卡林 UI/视觉验收后决定。

## 0.1.2 - 2026-07-24

### Added

- 空白预览新增真实相机与镜头组合的随机 EXIF 样例池；首次进入、刷新或重置时切换样例，实际照片只展示真实 EXIF。
- 侧栏 Flow 新增底栏四象限旋转映射，左右侧栏分别保持外/内列与上/下端点的物理语义。

### Changed

- Logo 小、中、大尺寸调整为水印区域高度的 `65%`、`78%`、`95%`。
- 产品预设名称调整为“聚焦”“简约”“圆润”，预设列表仅显示名称。
- 侧栏 Logo 上、中、下改为物理位置控制，并像底栏一样挤压对应文字可用空间。

### Fixed

- 修复左右侧栏文字超出画布、长文本未按 Slot 长度收缩的问题。
- 修复左右侧栏四象限、内外列和上下端点映射错误的问题。
- 修复旋转文字居中于上下半区，未对齐白色水印边框四角和上下端点的问题。
- 修复前端 Canvas 与 Python 导出在侧栏文字、Logo 占位和尺寸 token 上的不一致。

### Verification

- Flow Layout TS/Python parity：4 fixtures passed
- 侧栏布局与渲染相关测试：9 passed
- Logo token/API 相关测试：29 passed
- TypeScript 与 `git diff --check` 通过

## 0.1.1 - 2026-07-23

### Added

- 新增确定性的产品预设状态模型：首屏、刷新、重置和预设选择统一使用预设列表中的同一状态来源。
- 新增 `logo_enabled` 主控制参数，极简预设可默认关闭 Logo，用户仍可在主控制面重新开启。
- 新增前端/Python 共用的 V3 自动 Logo 契约 Fixture 与预设契约测试，覆盖品牌匹配、状态复现、覆盖隔离和布局防重叠。

### Changed

- 品牌底栏作为第一个产品预设直接成为网页默认状态，默认开启浅色边框。
- 边框控制移动到右侧栏顶部，边框色调合并到边框启用按钮下方。
- 自动 Logo 改为内置品牌注册表的整词匹配；未知品牌不再错误回退到 Fujifilm，前端预览与 PIL 导出保持一致。
- Logo 加载/缺失占位统一为无文字的中性虚线骨架，不再显示伪造的 `LOGO` 字体。

### Fixed

- 修复切换预设后 Slot / Region / Root overrides 泄漏到新预设的问题。
- 修复空路径自动 Logo 未参与 Flow Layout 占位，导致右侧文字与 Logo 重叠的问题。
- 修复预设参数隐式继承全局默认值、模板与主控制参数重复维护造成的状态漂移。
- 修复极简预设虽然宣称无 Logo，实际仍生成 Logo 元素并占用布局空间的问题。

### Verification

- `uv run ruff check .`
- `uv run python scripts/verify_flow_layout_parity.py`
- `packages/kari-core`: `398 passed, 7 skipped`
- `apps/api`: `73 passed`
- `apps/web`: preset contract、TypeScript、Vite production build 通过
- 本地开发环境页面、API health、预设切换和边框/Logo 控件验证通过

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
- 无 Flow 水印栏的模板不再渲染空转的槽位编辑块。
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
