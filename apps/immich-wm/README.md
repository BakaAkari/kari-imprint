# Immich WM — M1 第一批预览版

复用 kari-core 和现有 Canvas 的伴侣应用。当前能浏览源库、读取预览/EXIF、使用共享 Inspector 编辑底栏/左右侧栏、单/双轨、文字和资源、上传 Logo/签名、保存配置并生成独立成品。生成后自动检查入库并请求刷新，支持版本化成品预览。图库提供已出图状态角标与相册过滤（key 缺少 album.read 时过滤自动隐藏）。已接入 Pocket ID 登录、已管理资产巡检、磁盘预检、资源 GC 和联合备份恢复；完整孤儿扫描、共享前端包边界与正式图库切换仍待验收。

## 本地运行

在仓库根执行 `uv sync --all-packages --dev`，再执行 `npm --prefix apps/immich-wm/web ci` 和 `npm --prefix apps/immich-wm/web run build`。

通过受保护环境注入以下变量，不把 key 写进代码或前端：

| 变量 | 用途 |
|---|---|
| `IMMICH_URL` | Immich 根 URL，不带 `/api`；远程使用可访问的 HTTPS 地址，同机容器使用 Docker 内网地址 |
| `IMMICH_API_KEY` | asset.read / asset.view / job.create（完整相册功能另需 album.read） |
| `WM_SOURCE_LIBRARY_ID` | 唯一输入外部库 UUID |
| `WM_OUTPUT_LIBRARY_ID` | 独立测试输出外部库 UUID，必须与输入不同 |
| `WM_IMPORTS_ROOT` | 本机只读源目录，默认 `/imports` |
| `WM_OUTPUT_ROOT` | 已创建的输出挂载目录，默认 `/output` |
| `WM_DATA_ROOT` | 持久化目录，默认 `/data` |
| `WM_SOURCE_PREFIX` | Immich 内源目录，默认 `/external/camera-exports` |
| `WM_OUTPUT_PREFIX` | Immich 内输出目录，默认 `/external/camera-watermarked` |
| `WM_M0_TOKEN` | `uv run immich-wm --new-token` 生成的独立面板访问令牌 |
| `WM_WEB_ROOT` | 可选，覆盖静态网页构建目录 |

运行 `uv run immich-wm`，访问 `http://127.0.0.1:2285`。该入口默认只绑定本机。登录使用面板令牌，不使用 Immich key。开发 Vite 页面在 2286，代理 API 到 2285。

只启动一个 worker。默认限制：输入/输出文件 256 MiB、输入 160MP、输出 200MP、资源 10 MiB/4MP、20 个待渲染任务、单次渲染子进程超时 600 秒。每次入库检查最多扫描 10 页；后台重试间隔从 5 秒退避到 5 分钟，计划写入 SQLite 并跨重启保留。首次入库仍依赖 Immich 的扫描，不使用管理员扫描权限。

`/output/.wm-tmp` 必须被 Immich 排除扫描；不支持不同设备之间复制替代原子发布。输入只接受库内 JPEG/PNG。NAS 策略把图片转换至 sRGB、透明像素合成到白底，保留拍摄 EXIF/GPS、更新方向/尺寸并丢弃旧缩略图/MakerNote 偏移。公开 Web 默认行为保持不变。

保存配置后立即使旧配置任务失去发布资格。配置与任务存 SQLite；源图和自定义资源按任务快照固定。进程锁防止重复消费；启动恢复中断任务、文件发布记录与入库重试。渲染与成品预览共用串行解码锁；源元数据使用独立锁、图片头读取和短期缓存，避免等待完整渲染。同步失败不重渲图片。`refresh_pending` 只表示 Immich 接受了刷新请求，仍需检查实际图库显示。

## 容器草案

仓库根构建：`docker build --platform linux/amd64 -f apps/immich-wm/Dockerfile -t kari-imprint/immich-wm:m1-preview .`。

Python 依赖由 worker/requirements.lock 约束；更新 uv.lock 后运行文件头记录的 uv export 命令同步约束。

使用 `deploy/dockge/immich-wm-m0.compose.yaml`，预先准备对应 UID/GID 可写的数据/输出目录。此 compose 不修改现有 Immich stack；须另行挂载隔离输出目录、建立测试外部库、配置扫描排除，再联调。

### Tailscale 慢链路回退

整镜像传输缓慢时，可从 Mac 传输源码、requirements.lock 和本地已构建的 `web/dist`，使用 `Dockerfile.runtime` 在 NAS 仅构建运行时层。其配套 `.dockerignore` 保留 dist，仍排除开发环境、测试和凭据。基础镜像钉住 digest，Debian 包使用清华镜像并保留 apt 签名校验。Python 运行时 wheel 也经清华镜像下载，使用 uv.lock 中的 SHA-256 强制校验。更新依赖后，在 Mac 执行 `uv run --with packaging python scripts/export_immich_runtime_wheels.py` 生成 `worker/requirements-linux-amd64.lock`，一并传输；目标固定为 CPython 3.13 / Linux amd64。

字体可从 notofonts/noto-cjk 的官方原始文件下载到构建目录，但必须逐个与 Mac 的 SHA-256 比对一致；本轮实际验证了 NotoSansCJKsc-Regular.otf 与 NotoSansCJKsc-Bold.otf。不得因为下载成功就省略校验。此流程不在 NAS clone 仓库，也不安装 pytest/ruff 等开发依赖。

## 当前限制

- M0 源码引用和 API 包依赖是临时适配，不是最终共享包边界。
- 已有自动收编检查与刷新请求；完整对账/孤儿界面尚未实现，保留手动重试入口。NAS v3.3.0 已验证单张 JPEG 原位覆盖后的资产 ID、收藏、相册与测试分享关联保持，详见验证记录。
- 自定义资源可通过共享编辑器上传；兼容 `POST /api/resources` 和编辑器的 `/api/upload-resource`，只返回不透明 ID。内置 Logo 目录暂不提供。
- 暂无预览/陈旧临时目录的定时 GC、磁盘余量检查、自动联合备份及日志审计。这些是 M1 上线门槛。
- M0 renderer_version 为显式固定版本；M1 需把字体、内置资源和构建版本纳入版本清单。
- 预览按原图坐标计算，再缩放绘制；已覆盖大图像素边距、比例底栏和旋转方向的浏览器回归。面板已接入共享 Inspector 的画布、样式和区域编辑。
- Immich 的缩略图有客户端缓存；刷新任务完成不保证已打开的客户端立即更新，浏览器可能需要强制刷新。手机端刷新后正常，已由用户确认。

## 检查

`uv run pytest apps/immich-wm/worker/tests`，以及 AGENTS.md 中的 core/API、Ruff、布局 parity 和前端构建检查。原图坐标浏览器回归：构建网页后运行 `uv run --with playwright python scripts/verify_immich_preview.py`。进度与未通过项记录在 `docs/immich-wm-m0-validation.md`。

## M1 第一批新增接口

- `GET /api/assets/{id}/job` 返回该照片最新持久任务，重开页面可恢复状态。
- `GET /api/assets/{id}/output?generation=N` 返回已发布成品的受限 JPEG 预览，去除 EXIF，使用 no-store。陈旧代次、未完成生成和外部改写输出均拒绝，不会把新图片放到旧 URL 下返回。
- `POST /api/upload-resource` 接受 file 和严格的 logo/signature kind，兼容现有编辑器；原 `/api/resources` 继续有效。

新 sync_schedule 表是可忽略的附加表，保留 schema 版本 1 及旧表结构。部署前备份 SQLite 和 resources；旧 M0 镜像仍能打开数据库，但没有自动轮询和新接口。隔离部署记录见 `docs/immich-wm-m1-validation.md`。

公网反向代理部署时设置 `WM_PUBLIC_ORIGIN=https://面板域名:端口`（不带末尾斜杠或路径）。来源校验使用此精确地址，HTTPS 入口的会话 Cookie 强制 Secure；无需信任任意客户端提供的转发头。变更后重新创建伴侣容器。

### Pocket ID 登录

设置以下服务端环境变量，并保留 `WM_PUBLIC_ORIGIN`：

- `WM_OIDC_ISSUER`：HTTPS issuer 根地址，无末尾斜杠。
- `WM_OIDC_CLIENT_ID` / `WM_OIDC_CLIENT_SECRET`：机密客户端凭据，仅保存在 NAS 受保护的环境文件。
- `WM_OIDC_ALLOWED_GROUP`：允许访问照片及生成接口的管理员组，当前为 `kari-imprint-admin`。

回调地址为 `${WM_PUBLIC_ORIGIN}/api/auth/oidc/callback`。使用 Authlib 校验 OIDC 身份令牌、state、nonce 和 PKCE S256，登录事务保存在服务端，五分钟后失效、仅可使用一次。启用 OIDC 后旧 `/api/login` 令牌入口关闭。业务写请求必须携带正确 Origin。

会话为服务端内存中的随机不透明 ID，Secure/HttpOnly/SameSite=Strict Cookie，有效期一小时；支持多设备及页面刷新，服务重启后需重新登录。退出面板立即撤销当前面板会话，不退出 Pocket ID 或其他应用。未实现后台通道注销；移出用户组不立即撤销已建立的面板会话，最多保留到一小时有效期结束，紧急撤销全部会话可重启伴侣容器。当前组内用户均拥有同一隔离图库的操作权限，不提供多租户隔离。

默认关闭应用 HTTP access log，避免记录 OIDC 回调 code；反向代理也应避免记录回调查询参数。不要将 Client Secret 放进前端环境变量或仓库。服务启动时，缺失部分 OIDC 配置会直接报错，不降级到令牌登录。

### M1 运维与资源包

- 内置 Logo 为原项目资源中经人工查看筛选的 26 个 Logo 资源，清单和 SHA-256 见 `logo-manifest.json`；剔除了旧采集脚本误存的建筑/人物照片。资源放在 `assets/logos`，构建前运行 `uv run python scripts/verify_immich_assets.py`。镜像内包含文件；资源字节摘要进入渲染版本，升级后不会复用旧渲染键。品牌商标归各权利人所有。
- 每五秒检查一个已管理资产（单资产最短间隔十分钟），启动后重新检查。维护区显示异常数量，检查不会自动删除、迁移或覆盖源照片与成品。这里只检查已保存配置的资产，不是完整的孤儿目录扫描。
- 默认保留至少 512 MiB 可用空间（`WM_MIN_FREE_BYTES`）；入队额外预留三倍输入上限空间，上传和备份也检查余量。输出最长边限制 32768 像素。
- 每小时清理超过一天且不属于活动任务的临时目录，以及超过一天、未被任何历史配置引用的上传资源。历史成品不自动过期；备份不自动删除。
- 面板“维护与备份”可创建 `/data/backups/<backupId>`：包含一致性 SQLite 快照、自定义资源及文件摘要、库 ID、前缀和渲染版本。备份不含原图、成品、密钥和任务临时快照，请独立保护照片、compose 与 `.env`，并将备份复制到其他存储位置。
- 离线恢复：`immich-wm --restore-backup /data/backups/<backupId> /new-data`。目标必须不存在；先校验摘要、数据库和资源引用，再创建数据目录。进行中的旧任务标为 `restored_requires_review`，不会重放发布。停止原服务后，核对 manifest 中库 ID/前缀/镜像版本，再切换数据挂载并手动重新生成；不要直接覆盖正在运行的数据库。
- 会话仍为一小时内存会话；Pocket ID 后台注销推送尚未实现。完整共享前端包边界和正式图库迁移尚未验收，不应把本批称为所有 M1 门槛已关闭。
