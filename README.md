# kari-imprint

Kari Imprint 是公开的摄影水印工具集，支持 Web、APP 和微信小程序。代码由 `aka-semi-utils` 迁移重命名，与旧仓库最终版本 `v0.9.0-final` 做了完整切割。

当前主线是 **V3 Flow Layout**：用声明式 Region / Canonical Slot / Content 配置生成水印，底栏与左右侧栏共享单/双轨排版模型，前端 Canvas 与后端 PIL 通过同一组 Golden Fixture 保持布局语义一致。

## 目录结构

```text
kari-imprint/
├── packages/
│   └── kari-core/          # Python 共享核心（core + shared + processor）
├── apps/
│   ├── api/                # FastAPI 后端
│   ├── web/                # React/Vite Web 前端
│   ├── app-mobile/         # 移动 APP（占位）
│   └── wechat-mini/        # 微信小程序（占位）
├── deploy/                 # 部署配置
├── design/                 # 架构与设计文档
└── docs/                   # 项目文档
```

## 本地开发

后端：

```bash
uv sync --all-packages --dev
uv run --package kari-imprint-api uvicorn apps.api.src.api.main:app --host 127.0.0.1 --port 2190 --reload
```

前端：

```bash
cd apps/web
npm ci
VITE_API_BASE=/tools/watermark-v3 npm run dev
```

## 验证

```bash
uv run ruff check .
uv run python scripts/verify_flow_layout_parity.py
cd packages/kari-core && uv run pytest
cd apps/api && uv run pytest
cd apps/web && VITE_API_BASE=/tools/watermark-v3 npm run build
```

## 安全模型

- 用户文本不得作为 Jinja 或其他动态模板执行。
- Logo / 签名只使用服务端签发的不透明资源 ID。
- API 严格校验类型、枚举、长度、范围和非有限数值。
- 图片处理必须限制上传大小、解码像素、并发和文件保留时间。
- 不向客户端返回内部路径、异常堆栈或敏感 EXIF 日志。

## 许可证

GPL-3.0，见 [`LICENSE`](LICENSE)。
