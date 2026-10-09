# Immich WM M0 验证记录

日期：2026-10-09。状态：**已部署 NAS 隔离 M0 容器；单张真实 JPEG 的收编、原位覆盖和关联保持闭环通过。追加故障恢复、图片兼容、性能和浏览器验证已完成；缓存限制与手机端待验证边界见下文。**

## 本轮已验证

- 经 Tailscale SSH 读取运行容器与 `/api/server/version`：目标为 Immich v3.3.0；`app-media-edit` 网络存在。初次检查时只有原图、成品与内部数据挂载；本轮随后增加了隔离水印输出挂载。
- 使用用户指定文件中的 API key，经仅绑定本机的 SSH 转发，验证 `POST /api/search/metadata`、`GET /api/assets/{id}` 和 preview 读取。key 未写入仓库、前端、构建参数或日志。
- [v3.3.0 官方 OpenAPI](https://github.com/immich-app/immich/blob/v3.3.0/open-api/immich-openapi-specs.json) 确认：搜索支持 `libraryId` 与 `originalPath`；预览为 `GET /assets/{id}/thumbnail?size=preview`，权限 `asset.view`；`POST /assets/jobs` 权限为 `job.create`。
- 从成品库只读复制一张实际 JPEG（521784 字节）到本地隔离 imports；该本地验证阶段未修改原图和 NAS 配置；后续部署变更见下文。通过真实上游资产查询，先后按底边距 100 → 200 → 100 生成，三次均进入 `awaiting_import`，本地样本单次渲染约 0.35 秒。该数据不代表大图/生产性能。
- Chromium 实际登录、加载图库、读取实际 Immich preview 与源 EXIF、复用 Canvas、保存并生成，最终显示“已出图，等待 Immich 收编”，无浏览器运行异常。已查看截图确认照片与底栏确实绘制；并修复截图发现的 runtimeCaps 缺失导致空画布问题。
- 修复动态 sRGB ICC 创建时间导致跨进程相同配置文件摘要漂移；输出 profile 头部时间固定。

## 自动检查

- kari-core：410 passed，7 skipped（归档 GUI 测试）。
- 现有 API：73 passed。
- 新 worker：11 passed。覆盖 A/B/A、源变化、渲染器版本变化、保存冲突、旧任务失效、替换后数据库未确认恢复、拒绝未知输出覆盖、刷新只标记 pending、路径逃逸/符号链接、登录/Origin/严格参数、资源重启与数据库备份、正确 preview 端点与响应大小限制。
- 新元数据用例纳入 core：JPEG/PNG 的方向、拍摄标签和尺寸往返；透明 PNG 白底；像素上限；无效 ICC 拒绝。
- Ruff、8 组 Flow Layout parity、原 Web tsc/build、新 M0 Web tsc/build、diff 格式检查通过。
- 本轮修复后联合运行 core/API/worker：494 passed、7 skipped。FastAPI TestClient 的 Starlette/httpx 弃用提示与原有 slow 标记警告不影响测试。

## 容器验证

- linux/amd64 镜像构建成功，镜像 ID：`sha256:abd68dd131f360c3f9d4c885b95f8c80373bfbdef1e13268c6dbba4def6f3dc0`。
- 基础镜像使用 ECR Public 的 Docker Official Images 镜像路径；依赖约束从 uv.lock 导出为 worker/requirements.lock，产品镜像未上传任何 registry。
- 在本机 OrbStack 运行，验证 UID/GID 为 10001，健康接口与静态页面 HTTP 200；使用只读挂载的实际源图，配置保存 200、渲染入队 202、成品进入 awaiting_import。
- 隔离 compose 已通过变量替换后的语法检查。该检查及本机 amd64 仿真运行不等于 NAS 部署验收。
- 用户已确认立即联调；已备份 Immich compose 并仅重建 immich-server 增加 `/external/camera-watermarked-m0`，重启后 ping 与容器健康检查通过。
- 原 compose 备份：`/mnt/user/appdata/dockge/stacks/app-immich/compose.yaml.before-wm-m0-20261009-181629`。
- 新建独立测试库 `61b4507b-e0e4-481e-b49d-ea74ce2b9806`；排除 `**/.wm-tmp/**`、`**/._*`。worker 使用独立四 scope key，管理员 key 仅用于联调设置，不进入 worker。

## NAS 实测结果

- 通过 Tailscale SSH 部署。整镜像传输过慢，改用本地构建前端并传输源码，NAS 仅构建运行时层；无服务器 Git clone、无开发依赖安装。PyPI wheel 使用 uv.lock 固定摘要，镜像下载也强制 SHA-256 校验；两份 Noto CJK 字体与 Mac 摘要一致。
- 修复后 NAS 镜像 ID：`sha256:5aa491a79b68658f1e965df848df89431e8e6b2bf46047445937558cf0caac85`。运行 UID/GID 10001；`/imports` 为只读挂载，`/output` 与 `/data` 可写；运行时 `pip check` 通过。宿主内核不支持 swap 限额，内存限制生效但不限制 swap。
- 隔离库首次收编成品资产 `971c1cfe-3ee9-4963-a22a-e869864070e7`。底边距 100 → 200 → 100，预览与资产尺寸从 961×1062 → 961×1162 → 961×1062。恢复 A 后解码 RGB 像素摘要与首次 A 一致。
- 覆盖后资产 UUID 不变；收藏、测试相册、测试分享均仍引用该资产。测试分享已 DELETE 撤销（204），测试相册和成品保留供检查。相册成员通过 search/metadata 的 albumIds 验证；v3.3 的相册详情不直接返回 assets。
- 验证的是重新请求预览后的像素和尺寸更新；未声称所有已打开的 Immich 浏览器/手机客户端缓存都会自动失效。worker 继续保留 `refresh_pending`，不把请求受理伪装成刷新完成。
- `.wm-tmp` 中放置有效 PNG 探针后扫描，未收编；后续测试库仅一个成品资产。实际源文件测试前后 SHA-256 相同。
- 真实签名渲染发现自由区域比例偏移产生小数坐标，Pillow paste 拒绝。修复为最终栅格绘制时取整，保留布局结果的小数精度，新增回归测试；没有修改布局算法/共享类型。
- 自定义透明 PNG 签名上传、持久化、渲染成功。NAS 网页 Chromium 登录、图库选择、EXIF 底栏和签名预览通过，画布 961×1062，浏览器运行错误为零；截图人工检查通过。
- SQLite backup 加资源目录复制，恢复到独立临时数据/输出目录，用恢复的配置版本 7 与资源重新生成成功。演练备份保留在 `/mnt/user/appdata/app-immich-wm-m0/m0-verification-backup`；临时恢复目录已清理。演练脚本需显式关闭 SQLite 连接后删除目录，避免 NAS 文件系统暂存未关闭文件。
- worker 容器重启后，配置版本及资源摘要保持一致，健康接口正常。此项验证正常重启，不等于渲染中强杀演练。
- 服务在 NAS 仅绑定 `127.0.0.1:2285`，compose 为 `restart: "no"`，属于隔离测试部署。凭据在 NAS stack 的受保护 `.env` 中，不进入仓库或镜像。

## 追加自动验收（2026-10-09）

结构化数据：`docs/immich-wm-m0-acceptance.json`。本轮没有重启 Immich 主服务，没有改动源照片；故障容器均已移除，测试素材与输出位于专用 acceptance 目录及被排除的 `.wm-tmp/acceptance` 中。

### 真实强杀与恢复

使用当前产品镜像和 Service，在相同 NAS 文件系统创建独立容器、SQLite 与输出目录。测试容器无网络，资产查询使用固定合成样本；真实渲染和文件发布均使用产品代码。测试钩子仅暂停在指定位置，随后从 Docker 发送 SIGKILL；钩子和暂停不进入产品代码。

| 中断位置 | 强杀前成品 | 重启结果 |
|---|---|---|
| 已解码、渲染过程中 | 旧成品完整 | running → queued，第二次尝试出图成功 |
| 原子替换前，发布意图已提交 | 旧成品完整 | 从 publishing 恢复发布，无重复渲染 |
| 已原子替换、数据库尚未提交 | 新成品完整 | 校验摘要后确认发布，无重复渲染 |

三项均恢复为 awaiting_import，最终文件通过解码/尺寸及摘要检查。等待收编阶段的正常重启和带资源备份恢复已在前轮通过；这不等同于断电或磁盘硬件故障模拟。

### 图片、性能与浏览器一致性

NAS 2 CPU / 2 GiB 容器运行合成色块样本，无 EXIF JPEG、EXIF Orientation=6、Display P3 PNG、半透明 PNG 全部通过：方向归一为 1，尺寸标签与最终画布一致，输出 sRGB，透明像素合成白底。四色中心采样与独立预期转换的最大通道误差为 0。

| 样本 | 渲染秒数 | 渲染子进程峰值 RSS |
|---|---:|---:|
| 12MP JPEG | 0.58 | 233.8 MiB |
| 24MP JPEG | 0.72 | 416.4 MiB |
| 48MP JPEG | 0.99 | 783.1 MiB |
| 60MP JPEG | 1.19 | 966.3 MiB |
| 60MP P3 + alpha，四边各 600px | 3.45 | 1480.6 MiB |

60,010,000 像素样本在解码前拒绝，未产生输出。全部容器未触发 OOM。RSS 为渲染子进程读数，不是整个服务/宿主峰值；单次合成样本不代表高噪点实拍照片、所有配置或并发元数据读取的最坏值。建议继续保持单渲染 worker、2 GiB 内存和 60MP 上限，不据此提高并发或限额；M1 还需限制元数据解码并发与磁盘余量。

Chromium 使用实际 M0 构建和 Canvas、替换 API 以供应同一组合成素材，完成四类图片及自定义 Logo 的预览/后端像素对比与截图检查。各 RGB 通道平均误差均小于 0.24/255（包括栅格化及 JPEG 差异），无浏览器异常。此项隔离验证前后端绘制，不宣称四类素材都经过真实 Immich 导入与预览生成。

追加大图验证发现并修复：以 1440×960 thumbnail 预览 6000×4000 原图时，100px 底边距曾生成 1440×1060 预览，而成品 6000×4100 应缩放至 1440×984。M0 现在使用已归一方向的源图尺寸计算布局，再缩放画布绘制；共享 Canvas 新增可选原图尺寸参数，现有 Web 未传入时保持原路径。像素边距、比例底栏、竖向原图及小图四项浏览器回归通过。布局算法、设计 token、API schema 均未改变。

可重复检查：先构建 M0 Web，再运行 `uv run --with playwright python scripts/verify_immich_preview.py`。该脚本只使用合成图片和模拟 API，不访问 NAS。

### 连续覆盖与缓存限制

同一真实成品连续六次覆盖，底边距为 101/103/107/109/113/100：全部保持资产 ID 和收藏；用旧 ETag 条件请求，每次都返回 200、新 ETag 和新尺寸，实际可见延迟约 0.52–0.54 秒。恢复配置后，预览文件字节摘要与初始值一致。另一次浏览器缓存测试修改后也恢复了原配置。

**不能保证已打开的 Immich 客户端立即显示新图。** 实测缩略图响应为 `private, max-age=86400, no-transform, stale-while-revalidate=2592000, stale-if-error=2592000`。真实 Chromium 对同一 URL 的默认 fetch 仍命中旧缓存；显式 `cache: reload` 获取新图及新 ETag。这验证的是浏览器 HTTP 缓存，不等于完成 Immich SPA 所有页面切换/自动更新行为的验收。

M0 刷新提示已补充“仍显示旧图时重新加载，浏览器可强制刷新”。不删除重建资产来绕过缓存，不伪报客户端已更新。M1 必须将服务端刷新完成与客户端展示更新分开表达，面板自己的输出预览使用版本化 URL。测试未在 Immich 数据库直接修改记录或更改其缓存策略。

### 本轮回归与部署

- core/API/worker：494 passed、7 skipped；Ruff 与 8 组布局 parity 通过。
- 原 Web tsc/build、M0 Web tsc/build、4 项新增浏览器回归通过。
- 修复已更新到 NAS，最终镜像 ID：`sha256:fe9c368ab586c2876202d1352d83a800651637615e2564f7fd7c323446f75bda`。部署后健康、重新出图、发布/同步、配置/资源持久性和源图摘要检查通过；隔离测试库仍只有原先一个成品，临时素材未入库。
- 最终部署网页的首次截图等待远程 CJK 字体超时（字体端点已返回 200，Tailscale 使用中继）；容器与本地字体 SHA-256 一致。替换为本地字体的复核又遇到页面加载超时，因此本次未完成最终 NAS 网页截图；同一构建的本地浏览器视觉回归及 NAS API 出图验收已通过。慢链路端到端网页体验仍待复测，M1 应采用字体子集/压缩和适当缓存。
- 旧镜像保留为 `kari-imprint/immich-wm:m0-before-preview-coordinates-20261009`，无需重启 Immich 主服务即可回退水印前端。

## 尚未覆盖及后续门槛

1. 用户于 2026-10-09 确认手机端测试成功，刷新后即可看到更新；普通网页 SPA 自动更新路径亦不能用 HTTP 强制重载结果替代。
2. 更多真实广色域/RAW 导出照片经 Immich 导入后的整链路表现，以及高噪点大图、长时间运行和磁盘不足场景仍需持续验证。
3. M1 仍需元数据解码并发限制、磁盘余量/临时文件清理、自动对账、联合备份、正式鉴权和完整编辑界面；当前保持 M0 隔离部署。

本轮足以继续 M1 的实现工作，但不把已知缓存边界或未覆盖场景包装成生产保证。

用户补充验收：手机 Immich 刷新后正常显示更新，已授权继续 M1。此结果来自用户实机反馈。
