# Immich KI — M1 第一批预览版

复用 kari-core 和现有 Canvas 的伴侣应用。当前能浏览源库、读取预览/EXIF、使用共享 Inspector 编辑底栏/左右侧栏、单/双轨、文字和资源、上传 Logo/签名、保存配置并生成独立成品。生成后自动检查入库并请求刷新，支持版本化成品预览。图库提供已出图状态角标与相册过滤（key 缺少 album.read 时过滤自动隐藏）。凭据为单一 Immich API Key（init 模式页面关联、配置文件持久化），另有已管理资产巡检、磁盘预检、资源 GC 和联合备份恢复；完整孤儿扫描、共享前端包边界与正式图库切换仍待验收。

## 本地运行

在仓库根执行 `uv sync --all-packages --dev`，再执行 `npm --prefix apps/immich-ki/web ci` 和 `npm --prefix apps/immich-ki/web run build`。

通过受保护环境注入以下变量，不把 key 写进代码或前端：

| 变量 | 用途 |
|---|---|
| `IMMICH_URL` | Immich 根 URL，不带 `/api`；远程使用可访问的 HTTPS 地址，同机容器使用 Docker 内网地址 |
| `IMMICH_API_KEY` | 可选。仅首次部署未使用 init 模式时作为初始 key，启动后自动迁移到数据目录配置文件；留空则面板进入 init 模式等待页面输入 |
| `KI_SOURCE_LIBRARY_ID` | 输入外部库 UUID |
| `KI_OUTPUT_LIBRARY_ID` | 输出库 UUID；方案A 归档模式下允许与源库相同（成品写入源树的 imprint 子目录） |
| `KI_IMPORTS_ROOT` | 本机只读源目录，默认 `/imports` |
| `KI_OUTPUT_ROOT` | 已创建的输出挂载目录，默认 `/output`；归档模式下指向源树内的 imprint 子目录 |
| `KI_DATA_ROOT` | 持久化目录，默认 `/data` |
| `KI_SOURCE_PREFIX` | Immich 内源目录，默认 `/external/camera-exports` |
| `KI_OUTPUT_PREFIX` | Immich 内输出目录，默认 `/external/camera-watermarked` |
| `KI_IMPRINT_DIR` | 成品在输出根下的文件夹名，默认 `Imprint`；留空表示输出根本身即 imprint 目录（归档模式）。重新生成原位覆盖同一路径，不追加文件 |
| `KI_WEB_ROOT` | 可选，覆盖静态网页构建目录 |

运行 `uv run immich-ki`，访问 `http://127.0.0.1:2285`。该入口默认只绑定本机。开发 Vite 页面在 2286，代理 API 到 2285。

只启动一个 worker。默认限制：输入/输出文件 256 MiB、输入 400MP、输出 460MP、资源 10 MiB/4MP、20 个待渲染任务、单次渲染子进程超时 900 秒。每次入库检查最多扫描 10 页；后台重试间隔从 5 秒退避到 5 分钟，计划写入 SQLite 并跨重启保留。首次入库仍依赖 Immich 的扫描，不使用管理员扫描权限。

`/output/.ki-tmp` 必须被 Immich 排除扫描；不支持不同设备之间复制替代原子发布。输入只接受库内 JPEG/PNG。NAS 策略把图片转换至 sRGB、透明像素合成到白底，保留拍摄 EXIF/GPS、更新方向/尺寸并丢弃旧缩略图/MakerNote 偏移。公开 Web 默认行为保持不变。归档模式（源库=输出库）下源树中 `KI_OUTPUT_PREFIX` 对应的子目录（如 `imprint/`）被保留为成品区，面板图库与 `source()` 都会排除该子目录，避免把成品再次当作源照片。

保存配置后立即使旧配置任务失去发布资格。配置与任务存 SQLite；源图和自定义资源按任务快照固定。进程锁防止重复消费；启动恢复中断任务、文件发布记录与入库重试。渲染与成品预览共用串行解码锁；源元数据使用独立锁、图片头读取和短期缓存，避免等待完整渲染。同步失败不重渲图片。`refresh_pending` 只表示 Immich 接受了刷新请求，仍需检查实际图库显示。

## 容器草案

仓库根构建：`docker build --platform linux/amd64 -f apps/immich-ki/Dockerfile -t kari-imprint/immich-ki:m1-preview .`。

Python 依赖由 worker/requirements.lock 约束；更新 uv.lock 后运行文件头记录的 uv export 命令同步约束。

使用 `deploy/dockge/immich-ki-m0.compose.yaml`，预先准备对应 UID/GID 可写的数据/输出目录。此 compose 不修改现有 Immich stack；须另行挂载隔离输出目录、建立测试外部库、配置扫描排除，再联调。

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

`uv run pytest apps/immich-ki/worker/tests`，以及 AGENTS.md 中的 core/API、Ruff、布局 parity 和前端构建检查。原图坐标浏览器回归：构建网页后运行 `uv run --with playwright python scripts/verify_immich_preview.py`。进度与未通过项记录在 `docs/immich-ki-m0-validation.md`。

## M1 第一批新增接口

- `GET /api/assets/{id}/job` 返回该照片最新持久任务，重开页面可恢复状态。
- `GET /api/assets/{id}/output?generation=N` 返回已发布成品的受限 JPEG 预览，去除 EXIF，使用 no-store。陈旧代次、未完成生成和外部改写输出均拒绝，不会把新图片放到旧 URL 下返回。
- `POST /api/upload-resource` 接受 file 和严格的 logo/signature kind，兼容现有编辑器；原 `/api/resources` 继续有效。

新 sync_schedule 表是可忽略的附加表，保留 schema 版本 1 及旧表结构。部署前备份 SQLite 和 resources；旧 M0 镜像仍能打开数据库，但没有自动轮询和新接口。隔离部署记录见 `docs/immich-ki-m1-validation.md`。

公网反向代理部署时设置 `KI_PUBLIC_ORIGIN=https://面板域名:端口`（不带末尾斜杠或路径）。来源校验使用此精确地址，HTTPS 入口的会话 Cookie 强制 Secure；无需信任任意客户端提供的转发头。变更后重新创建伴侣容器。

### API Key 关联（init 模式）与 Immich 账户登录

面板凭据分两层：**API Key 只负责把面板绑定到 Immich**（服务端凭据，保存在 `KI_DATA_ROOT/config.json`，原子写入、0600，备份数据目录时即备份该配置）；**日常登录使用 Immich 账户**（邮箱+密码）。

- **首次部署 / 配置缺失**：数据目录没有有效的 `config.json` 且环境变量 `IMMICH_API_KEY` 为空时，面板进入 init 模式——除健康检查和初始化接口外所有 API 返回 `init_required`，登录页显示初始化表单。输入 key 后面板调用 Immich `GET /api/users/me` 验证（无效 key、scope 不足、Immich 不可达分别明确报错，每 IP 限流 5 次失败 / 5 分钟），验证通过即写入配置文件（含 key 属主邮箱）、替换上游凭据并直接建立操作员会话。
- **旧部署迁移**：已用 `IMMICH_API_KEY` 环境变量部署的实例启动时自动把该 key 写入配置文件，无需手动操作。
- **日常登录**：初始化之后，浏览器会话过期或重启后，在登录页输入 **Immich 账户的邮箱和密码**——面板代向 Immich `POST /api/auth/login` 验证，并用返回的 token 读取用户信息确认身份（key 绑定在哪个账户下，就只有那个 Immich 账户能登录）。密码即验即弃：不落盘、不入日志、不回显。Immich 短暂离线时无法登录（面板本身也依赖 Immich）。
- **更换 key**：停止容器 → 删除数据目录 `config.json`（若环境变量里还留有 `IMMICH_API_KEY` 需一并移除）→ 启动重新进入 init 模式。
- 会话为服务端内存随机不透明 ID，Secure/HttpOnly/SameSite=Strict Cookie，有效期八小时；新登录吊销旧会话；服务重启后需重新登录，紧急撤销全部会话可重启容器。

### M1 运维与资源包

- 内置 Logo 为原项目资源中经人工查看筛选的 26 个 Logo 资源，清单和 SHA-256 见 `logo-manifest.json`；剔除了旧采集脚本误存的建筑/人物照片。资源放在 `assets/logos`，构建前运行 `uv run python scripts/verify_immich_assets.py`。镜像内包含文件；资源字节摘要进入渲染版本，升级后不会复用旧渲染键。品牌商标归各权利人所有。
- 每五秒检查一个已管理资产（单资产最短间隔十分钟），启动后重新检查。维护区显示异常数量，检查不会自动删除、迁移或覆盖源照片与成品。这里只检查已保存配置的资产，不是完整的孤儿目录扫描。
- 默认保留至少 512 MiB 可用空间（`KI_MIN_FREE_BYTES`）；入队额外预留三倍输入上限空间，上传和备份也检查余量。输出最长边限制 56000 像素。
- 每小时清理超过一天且不属于活动任务的临时目录，以及超过一天、未被任何历史配置引用的上传资源。历史成品不自动过期；备份不自动删除。
- 面板“维护与备份”可创建 `/data/backups/<backupId>`：包含一致性 SQLite 快照、自定义资源及文件摘要、库 ID、前缀和渲染版本。备份不含原图、成品、密钥和任务临时快照，请独立保护照片、compose 与 `.env`，并将备份复制到其他存储位置。
- 离线恢复：`immich-ki --restore-backup /data/backups/<backupId> /new-data`。目标必须不存在；先校验摘要、数据库和资源引用，再创建数据目录。进行中的旧任务标为 `restored_requires_review`，不会重放发布。停止原服务后，核对 manifest 中库 ID/前缀/镜像版本，再切换数据挂载并手动重新生成；不要直接覆盖正在运行的数据库。
- 会话仍为八小时内存会话；API Key 在线轮换端点尚未实现（删除配置文件重启即重新 init）。完整共享前端包边界和正式图库迁移尚未验收，不应把本批称为所有 M1 门槛已关闭。
