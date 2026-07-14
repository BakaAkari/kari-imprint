---
name: kari-imprint
description: "Kari Imprint - photography watermark tools: web, app, mini-program."
version: 1.0.0
---

# kari-imprint Agent 指南

## 项目定位

公开摄影水印工具，代码由 `aka-semi-utils` 迁移重命名。当前主线是 **V3 Region-Based Layout**：React/Vite 前端、FastAPI API、Python 图片处理核心。

旧桌面版本已当作历史资亦保留。

## 当前结构

- `web_frontend/`：V3 React/Vite UI（将来移入 `apps/web`）。
- `shared/v3_layout/`：后端布局引擎（将来移入 `packages/core-layout`）。
- `processor/`：图片、EXIF 与渲染管线（将来移入 `packages/core-render`）。
- `web_api/`：HTTP API、安全校验、上传和输出生命周期（将来移入 `apps/api`）。
- `core/`：通用 EXIF、字体、图片 I/O（将来移入 `packages/core-*`）。
- `deploy/`：部署配置。
- `tests/`：测试。

## 强制约束

- 用户文本不得进入 Jinja 或其他动态模板执行器。
- API 不得接受服务端路径；上传资源只能通过不透明 ID 引用。
- 所有公开参数必须严格校验类型、枚举、长度、范围和非有限数值。
- 图片处理必须限制上传大小、解码像素、并发和文件保留时间。
- 不向客户端返回内部路径、异常堆栈或敏感 EXIF 日志。

## 工作流

较大改动遵循：设计文档 → 用户确认 → 小步实现 → 自动验证 → 部署验证 → 提交/推送。

提交前执行：

```bash
uv run ruff check .
uv run pytest
cd web_frontend && VITE_API_BASE=/tools/watermark-v3 npm run build
```

提交信息使用 Conventional Commits。

## 迁移中

项目目前处于单一仓库状态，正在向 monorepo 重构：

```text
packages/
  core-schema/
  core-layout/        # TS + Python 双实现
  core-render/        # Python PIL 渲染管线
  core-exif/
apps/
  web/
  api/
  app-mobile/
  wechat-mini/
```

重构完成后，本文件会更新为新结构。
