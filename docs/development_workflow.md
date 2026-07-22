# Development Workflow / 协作开发流程

本文件固化 V3 水印工具的需求、设计、实现、验证、部署和提交流程。

**一致性与安全约束详见 `docs/consistency-contract.md`，本文件引用其核心规则。**

## 核心流程

```text
需求/方向 → 查阅当前文档 → 更新 roadmap/设计文档 → 用户确认 → 小步实现 → 自动验证 → 线上验证 → 用户手动测试 → 文档同步 → commit/push
```

## 角色分工

### 用户负责

- 提供真实需求、使用场景、优先级和审美方向。
- 审阅并确认 roadmap、阶段设计和验收标准。
- 对线上 GUI 做真实图片测试。
- 反馈 bug、体验问题和期望调整。

### Agent 负责

- 先检查当前 repo 状态和相关文档。
- 将需求整理为目标、范围、非目标、风险、验收标准。
- 在文档对齐前，不做大范围 GUI/架构改动。
- 小步修改代码并运行真实验证。
- 部署后检查页面、API、服务、路由和截图。
- 提交前检查 diff、测试结果、隐私路径和旧版本残留。

## 变更类型与要求

### 文档-only

- 可不跑完整测试。
- 必须检查文档引用、过期路径和当前架构一致性。

### 前端 UI

至少运行：

```bash
cd apps/web && VITE_API_BASE=/tools/watermark-v3 npm run build
```

涉及 CSS Grid/Flexbox 的布局改动必须用浏览器截图验证。

### 后端 / 配置 / 处理管线

至少运行：

```bash
uv run ruff check .
uv run pytest
```

### 部署

必须验证：

```bash
curl -sS https://baka-akari.zone/tools/watermark-v3/api/health
curl -sS -o /dev/null -w '%{http_code}\n' https://baka-akari.zone/tools/watermark-v3/
```

并检查旧入口（期望 V1 API `410`，V2 `404`，V3 `/v2` `404`）。

## 实现原则

### 一致性（详见 `docs/consistency-contract.md`）

- TS 类型 ↔ Python 类型必须同步修改。
- 设计 token 在 `designTokens.ts` 和 `layout_engine.py` 两端同时更新。
- CSS 类名必须与 JSX 动态拼接的 token 完全一致。
- 布局引擎修改后必须更新 Golden Fixtures 并运行 `verify_flow_layout_parity.py`。
- API schema 变更必须搜索前端所有引用并同步更新。
- 删除功能时必须 `rg '关键词'` 全局搜索清理所有残留。

### 安全与架构

- V3 只接受 Region / Slot / Content 配置。
- 不恢复 V1/V2 四角配置模型。
- 不把用户文本送入 Jinja 或动态模板执行器。
- 上传资源只能用服务端不透明 ID。
- 普通用户 UI 走模板驱动，高级结构编辑默认收起。
- 大范围控制面改造前先更新 `design/v3-control-surface-guardrails.md`。

## 提交前检查

```bash
# 完整检查
uv run ruff check .
uv run python scripts/verify_flow_layout_parity.py
cd packages/kari-core && uv run pytest
cd apps/api && uv run pytest
cd apps/web && npx tsc -b --pretty false
cd apps/web && VITE_API_BASE=/tools/watermark-v3 npm run build
git diff --check

# 残留引用搜索（功能删除后必做）
rg '<已删除关键词>' apps packages --type-add 'code:*.{ts,tsx,py}' --glob '!**/__pycache__/**'

# CSS-JSX 类名一致性检查
rg 'className=\{.*\$\{' apps/web/src --type tsx
```

提交信息使用 Conventional Commits。

## 文档组织

- `README.md`：当前项目入口。
- `docs/roadmap.md`：当前路线图。
- `docs/consistency-contract.md`：**最高优先级一致性开发契约**。
- `docs/development_workflow.md`：本文件。
- `design/v3-region-based-layout.md`：当前 V3 架构说明。
- `design/v3-control-surface-guardrails.md`：控制面设计（下一阶段）。
- `deploy/README.md`：线上部署和验证。
- `docs/archive/`：历史设计，仅作背景，不作为当前待办。
