---
name: kari-imprint
description: "Kari Imprint - photography watermark tools: web, app, mini-program."
version: 1.0.0
---

# kari-imprint Agent 指南

## 项目定位

公开摄影水印工具集，代码由 `aka-semi-utils` 迁移重命名。当前主线是 **V3 Region-Based Layout**。

## Monorepo 结构

```text
packages/
  kari-core/            # Python 共享核心：core + shared + processor
apps/
  api/                  # FastAPI 后端
  web/                  # React/Vite Web 前端
  app-mobile/           # 移动 APP（占位）
  wechat-mini/          # 微信小程序（占位）
deploy/                 # 部署配置
```

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
cd packages/kari-core && uv run pytest
cd apps/api && uv run pytest
cd apps/web && VITE_API_BASE=/tools/watermark-v3 npm run build
```

提交信息使用 Conventional Commits。

## 轨迹

长期方向是把 `kari-core` 进一步拆分为：

```text
packages/
  core-schema/
  core-layout/          # TS + Python 双实现
  core-render/          # Python PIL 渲染管线
  core-exif/
```
