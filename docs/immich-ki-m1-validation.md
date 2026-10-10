# Immich KI M1 第一批交付记录


> 口径说明：本仓库已由 immich-wm 更名为 immich-ki（Kari Imprint）；文中历史镜像标签 `kari-imprint/immich-ki:*` 为记录一致性改写，实际历史产物原名为 `kari-imprint/immich-wm:*`；文中 `.ki-tmp`、`KI_*` 环境变量等原名分别为 `.wm-tmp`、`WM_*`.
日期：2026-10-09。用户已确认手机 Immich 刷新后正常，并授权进入 M1。本次为**隔离预览版第一批**，不等同于完成 M1 全部生产门槛。

## 已交付

- 复用现有 InspectorPanel：底部/左右侧栏、单/双轨、文字字段和样式、画布边距/颜色/圆角，以及 Logo/签名上传。缺失槽位只补为禁用状态，避免改变旧配置的成品。编辑辅助函数复用现有 TS 实现，不复制布局引擎。
- 异步上传回写使用当前配置，切换照片后拒绝旧页面上传回调，避免串图或丢失其他编辑。
- 修复 Canvas 调用布局引擎时共享 margins 引用的问题：派生布局使用独立副本，不再把比例布局算出的像素边距写回用户配置。布局算法和共享 schema 不变。
- 生成后自动检查输出库中的精确路径并请求刷新。重试间隔从 5 秒退避至 5 分钟；SQLite 附加 sync_schedule 表保存时间、次数和脱敏错误。上游失败不会重渲成品，进程重启后继续计划。
- 不增加 Immich 管理权限；首次收编仍依赖 Immich 扫描。只把实际发出刷新请求记为 refresh_pending，不声称客户端缓存已经更新。
- 重开照片后读取最新持久任务；直接查看带 generation 参数的成品预览。服务端核对代次、状态和文件摘要，拒绝陈旧请求与外部改写；返回无 EXIF、最长边 1440 的 JPEG，Cache-Control 为 no-store。
- 渲染、元数据解码、成品预览共用串行锁，避免多个大图解码与渲染叠加内存。后台优先处理渲染队列，空闲时检查一个待入库任务。
- 小屏改为图库、预览、编辑器上下排列；保留手动重新检查入口。

## 验证

- core/API/worker 联合测试：498 passed、7 skipped。新测试覆盖跨重启退避、上游失败恢复、陈旧配置不刷新、旧代次/陌生文件拒绝预览、共享上传接口及任务恢复。
- Ruff、8 组布局 parity、原 Web tsc/build、伴侣 Web tsc/build、git diff --check 通过。
- `scripts/verify_immich_preview.py` 的四个浏览器回归通过，新增保存请求断言：预览不会把计算后的边距写回配置。
- 本地真实 FastAPI + 合成 Immich 适配器端到端验证：侧栏/双轨 → Logo 上传 → 保存渲染 → 自动刷新 → 查看成品；重新登录读取配置/任务，切图不串配置。
- 单独延迟上传响应验证：同一照片其他编辑保留；切换照片后旧上传响应不能覆盖新照片。
- 1600px 桌面和 390px 手机宽度截图检查通过，手机无横向溢出；浏览器运行异常为零。
- NAS 实际网页登录、图库、元数据与预览加载通过，画布 961×1062，浏览器异常为零，截图已检查。为避免 Tailscale 中继重复下载大字体，仅字体请求使用已核对 SHA-256 的本地副本；不声称慢链路字体体验已解决。
- 部署后源照片 SHA-256 不变，隔离输出库仍只有一个成品；资产 ID 与收藏保留。
- NAS 实际输出：generation 17、配置版本 15，自动进入 refresh_pending；成品预览 961×1062、无 EXIF，Logo 兼容上传/读取成功。本轮未调用手动同步接口完成此项。

## 部署与回退

- 镜像：`kari-imprint/immich-ki:m1-preview`，ID `sha256:36d8abd1fc720a7931e4f1de67b5628d201ae678b0771a69bba0c4a3f0a7d563`。
- 沿用 M0 隔离 stack、库和挂载，仅重建水印容器，未重启 Immich 主服务；仍仅绑定 NAS loopback 2285，restart=no。
- 升级前 SQLite 与资源备份：`/mnt/user/appdata/app-immich-ki-m0/m1-preview-backup-20261009`。
- 升级前 compose：`/mnt/user/appdata/dockge/stacks/app-immich-ki-m0/compose.yaml.before-m1-preview-20261009`。
- 旧镜像 `kari-imprint/immich-ki:m0` 保留；新调度表为附加表、schema_version 仍为 1，旧版可忽略该表。回退时停止新版，再恢复旧 compose 并启动；若需还原数据，停止服务后联合恢复上述数据库及资源备份，先另存回退前数据。
- 本机访问通过现有 SSH 转发：`http://127.0.0.1:22849`。面板令牌保存在用户 key 目录的独立受保护文件，不在本记录或仓库中。

## 后续 M1 门槛

1. 正式共享口令 hash 登录、会话恢复/退出、鉴权配置替换当前随机令牌。
2. 定期全量对账、源删除/输出丢失/外部改写的最小孤儿提示；当前自动检查只覆盖待入库任务。
3. 磁盘余量预检、临时文件/未引用资源保留策略、可执行的联合备份与恢复流程。
4. 字体子集或压缩改善慢链路初次加载；内置品牌资源目录尚未提供。
5. 正式输出目录与生产运行策略切换前再次验收。目前继续保留隔离测试目录，不能把预览版直接宣称为正式 M1。

### 面板加载优化（2026-10-09）

- 本机 `127.0.0.1:22849` 是 NAS SSH 转发地址，非本机服务。实测隧道健康检查约 5.98 秒，NAS 容器内部约 0.02 秒；Tailscale ping 经 DERP(sfo) 约 385 毫秒，链路延迟存在波动。
- 静态构建资源启用一年 immutable 缓存（Vite 内容哈希文件名），字体缓存一天，HTML 每次验证；API 继续 no-store。启用 gzip，当前 JS 239.14 KB → 74.61 KB、CSS 35.69 KB → 7.34 KB（构建报告）。
- 字体增加 font-display:swap；原始 Noto 字体不变，首次照片预览仍可能下载大字体，不能将此改动视为已解决链路或首次字体传输问题。
- 新增静态缓存、压缩与 API 隐私缓存边界测试；worker 16 项通过，Ruff 通过，前端类型检查及构建通过，四组浏览器布局回归通过。
- 部署前保留镜像 `kari-imprint/immich-ki:before-panel-performance`，仅更新伴侣容器。
- 已部署镜像 `sha256:5dda9f18aa83522e96fddd5ad5b49b267c89e6e283e9b7de6e56eb15da5f8567`，隧道健康检查通过。真实 Chromium 无字体替换、无请求 mock：登录页冷打开 7.07 秒，再次打开 1.40 秒（包含 networkidle 等待）；JS 实际传输 74,635 bytes，CSS 7,754 bytes，第二次二者 transferSize 均为 0；无页面 JS 错误。此测量仅涵盖登录页，不代表照片/字体首次加载速度。

### Immich 公网 API 连通验证（2026-10-09）

- 用户提供 `https://immi.baka-akari.icu:18443`，本机直连、正常 TLS 校验：ping HTTP 200，约 0.22 秒；隔离测试资产读取 HTTP 200，约 0.07 秒；预览读取 HTTP 200，146205 bytes，约 0.06 秒。仅执行读取，没有改动资产。
- 后续本机访问 Immich API 使用此 HTTPS 地址，无需经过 Tailscale 的 Immich 转发端口。NAS 上伴侣容器继续通过 `http://app-immich-server:2283` 同机 Docker 网络访问 Immich。
- 此地址当前仅验证为 Immich 入口；伴侣面板仍位于 NAS 的 2285 端口，其本机 22849 SSH 隧道不会因此自动被替换。

### 面板公网入口（2026-10-09）

- 用户已配置 `https://immt.baka-akari.icu:18443/`。本机直接 HTTPS 验证首页 HTTP 200（约 0.056 秒）、健康接口 HTTP 200（约 0.101 秒，ok=true）。后续面板访问使用此入口，不经过 Tailscale/SSH 隧道。
- 本机受保护的面板凭据说明已更新为公网 URL，保留原令牌和 0600 权限。

### 公网反向代理登录来源修复（2026-10-09）

- 原来源校验将浏览器 HTTPS Origin 与代理后的 HTTP base URL 比较，导致公网登录返回 invalid_origin。新增 `KI_PUBLIC_ORIGIN` 精确配置，部署值为 `https://immt.baka-akari.icu:18443`，不信任任意转发头、不使用通配来源；HTTPS 公网入口的会话 Cookie 强制 Secure。
- 配置拒绝路径、查询、用户信息、非法端口等；测试覆盖 HTTP 代理后正确公网登录、错误/伪造来源拒绝、Secure Cookie。worker 24 项测试与 Ruff、diff 检查通过。
- 保留用户现有 NAS LAN 端口绑定和其他 compose 配置，新增公网来源变量；镜像回退标签 `before-public-origin`，compose 备份 `compose.yaml.before-public-origin-20261009`。
- 更新后真实 Chromium 直接访问公网域名验证：登录 200、已认证图库读取 200、Secure/HttpOnly/SameSite=Strict Cookie 均通过、外部恶意来源返回 403、页面无 JS 错误。验证不经过 Tailscale，不修改照片或生成任务。

### Pocket ID 接入（2026-10-09）

- 用户配置机密客户端、PKCE 和回调，明确允许组 `kari-imprint-admin`；凭据由本机指定文件读取，未输出密钥。NAS 对 issuer 公网发现接口连通验证通过。
- 后端 Authlib OIDC code + PKCE S256，校验签名、issuer、audience、有效期、nonce、state 和组。启用 OIDC 后关闭令牌登录；浏览器仅持随机会话 Cookie。登录事务五分钟、会话一小时，内存存储，重启失效，退出撤销当前面板会话。
- 自动测试 33 项通过，含真实 RSA 签名令牌正常流程及错误签名/issuer/audience/nonce/过期/group/state/浏览器绑定拒绝、回调重放拒绝、登出 CSRF 与失效验证；四组浏览器布局回归通过。未实现 Pocket ID 后台注销和权限撤销即时推送；组权限撤销最迟在会话到期生效。
- 保留 `before-oidc` 镜像和 `compose.yaml.before-oidc-20261009`；不更改 Immich 主服务和照片。
- 已部署并通过公网验证：health ok、session mode=oidc、未登录图库 401、旧令牌登录 404。真实浏览器跳转至 Pocket ID 的“登录到 Kari Imprint”授权确认页，申请个人资料与群组权限；仍待用户确认，尚未宣称真实用户回调及图库登录验收完成。
- 用户完成真实 Pocket ID 登录后，浏览器显示图库列表；刷新后仍显示图库，确认真实 OIDC 回调与会话恢复成功。点击“退出面板”后返回 Pocket ID 登录按钮，再立即刷新仍保持未登录。尝试在内置浏览器直接打开图库 API 被浏览器策略拦截，因此该项不作为真实浏览器 HTTP 状态验证；接口拒绝与会话撤销已有自动测试覆盖。

### 暗色主题与图库缩略图（2026-10-09）

- 登录页、导航、编辑器、表单与预览背景统一为暗色，保留照片配置本身的背景/边框颜色；图库改为缩略图卡片、文件名、选中高亮与失败占位，窄屏提供横向照片列表。
- 新增受现有身份与源图库校验保护的 `/api/assets/{id}/thumbnail`，请求 Immich `size=thumbnail`，限制响应 2 MiB，不在浏览器持久缓存照片，图片 lazy/async 加载。
- 前端类型检查与构建、worker 33 项测试、Ruff 通过；真实浏览器本地夹具检查暗色编辑器截图、双缩略图加载成功与点击选图。未将桌面截图当作手机视口验收。
- 更新前镜像标签 `before-dark-gallery` 保留用于回退。
- 已部署镜像 `sha256:d272227a549b157772d6fb4b17f56d5876f9ca40d8a68e2b20041f3bcf4b07dc`，公网健康检查通过，公网暗色登录页截图确认。NAS 实际 Immich 缩略图返回 image/webp、16398 bytes。公网图库视觉仍需重新登录后查看，本地图库视觉已通过。

### 照片读取状态修复（2026-10-09）

- 实际查看用户页面时照片已完成读取，未复现永久卡死。代码确认 Promise.all 等待配置/任务/EXIF/预览，没有超时；空 bitmap 会触发共享 Canvas 的“上传照片后替换”网站占位，误导 Immich 用户。
- 伴侣在数据齐全前显示当前照片缩略图和读取状态，不挂载网站示例画布；增加 30 秒请求中止、失败重试按钮以及 effect 清理时的旧响应失效保护。未声称已解决所有后端读取耗时。
- 前端类型检查与构建通过；本地实际浏览器选图、正常画布截图检查通过。

### M1 运维、内置资源与读取优化（2026-10-09）

- 容器内置 26 个经视觉筛选的 Logo 资源，清单 SHA-256 校验通过；修复源资源权限导致非 root 用户不可读的问题。编辑器设备 Logo 选择、实际预览与生成的 Fujifilm 成品经本地浏览器截图和图片查看验证。
- 预览图片到达后先展示，不再等待全部配置/元数据；元数据使用图片头和方向读取、独立锁、64 项五分钟缓存，EXIF 子进程超时 15 秒。NAS 同一测试照片首次元数据读取 0.1474 秒、再次 0.0089 秒；这是服务端测量，不代表完整页面加载时间。
- 增加已管理资产巡检及维护提示、空间预检、过期临时文件与未引用资源 GC、一致性数据库与资源备份及离线恢复。巡检不修改照片，不涵盖完整孤儿目录扫描；备份不包含照片及部署密钥，也不等同于异地备份。
- NAS 使用临时隔离数据目录完成实际生成、备份、恢复、重新生成；原图摘要不变，未修改生产配置或既有成品。修复 SQLite 备份/恢复连接未及时关闭导致 Unraid 临时目录清理失败的问题后，整轮脚本退出码 0。
- 本地全套 Python 验证 522 passed / 7 skipped，Flow Layout 八组一致性通过；两个前端类型检查和构建通过，Ruff 通过。最终连接关闭修复后 worker 39 项再次通过。
- 部署镜像 `sha256:86a7dfdfced8d44c4febfee9556b3143613a4506b10fd04011170a58e58eef84`，公网健康检查 `ok=true`。保留回退标签 `kari-imprint/immich-ki:before-m1-maintenance` 和升级前数据/资源备份。仅重建伴侣容器，保留用户现有 LAN 端口绑定与 Pocket ID 配置，未重启 Immich。
- 此记录覆盖前述“后续 M1 门槛”中的认证、资源包及基础运维项；正式共享前端包边界、完整孤儿扫描、生产图库/存储策略切换仍未完成。容器重启会使原面板登录会话失效。

### 图库状态角标与相册过滤（2026-10-09）

- `GET /api/assets` 每项附带 `status`（已保存配置、最新任务状态、已发布成品），不暴露路径与配置内容；`GET /api/albums` 列出相册，key 缺少 album.read 返回 `available:false`，面板隐藏过滤并在后端保留 502 透传。
- 新增按相册过滤（search `albumIds`，UUID 严格校验，非法值 422）；面板切相册重置分页，卡片显示处理中/待入库/已请求刷新/失败/已出图/已保存角标，存在活动任务时每 5 秒刷新当前页角标。
- worker 41 项测试通过（新增角标数据、相册过滤透传、403 优雅降级用例）；Ruff、core/API 测试、8 组布局 parity、两端 tsc/build、git diff --check 通过；四组浏览器回归通过并新增角标与相册选择断言。尚未在 NAS 实机部署本批改动。
- 已部署：镜像 `kari-imprint/immich-ki:m1-gallery`（NAS 侧 Dockerfile.runtime 原生构建，sha256:fd41daba7d44）。升级前数据备份 `/mnt/user/appdata/app-immich-ki-m0/before-gallery-albums-20261009`、compose 备份 `compose.yaml.before-gallery-albums-20261009`、回退标签 `before-gallery-albums`（原 m1-preview 86a7dfdfced8）。仅重建伴侣容器，未重启 Immich。
- 部署后：公网 health ok=true、session mode=oidc、未登录 /api/assets 与 /api/albums 均 401；公网页面加载新构建 JS（index-DqECAaPv.js）；容器 running healthy、启动日志无异常。真实浏览器 OIDC 登录后的角标与相册过滤视觉确认仍待用户验收。

### 粗野主义 UI 重铸（2026-10-10）

- 视觉语言重铸：全直角、发丝线网格划分（无卡片/阴影/渐变）、近黑底 + 纯白 + 信号红单点缀、等宽字体状态行（`文件名 — REV n — GEN n — 状态`）、区块编号标题（01·图库 / 02·参数）。保存按钮反白主操作，悬停反色。
- 信息分级：默认只露核心控件（Logo/边框位置/轨道/高度/自定义文字），Inspector 高级参数收进「高级参数 · ADVANCED」折叠层，维护与备份收进「系统」折叠层。
- 修复字体误报：删除"预览字体未加载完成"常驻假消息，字体就绪后静默重绘；修复选中卡片整卡反色吞掉文件名的问题。
- 验证：worker 41 项、Ruff、两端 tsc/build、四组浏览器布局回归通过；桌面/手机截图检查无 JS 错误。代码已提交推送（feat/logo-real-aspect-ratio 分支，5d5d770）。
- 已部署：镜像 `kari-imprint/immich-ki:m1-brutalist`；回退标签 `before-brutalist-ui`、compose 备份 `compose.yaml.before-brutalist-ui-20261010`。公网 health ok、新静态资源生效。真实浏览器视觉与手机端待用户实测。

### 输入限制提升与大文件实测（2026-10-10）

- 诊断：源库 1353 张中 231 张超过旧 60MP/100MB 限制（113 张 50-100MP、112 张 100-150MP、3 张约 280MP、2 张约 388MP、1 张 671MP PNG），此前统一报 invalid_input_or_asset。错误码已细化为可读原因并映射中文。
- 限制提升：文件 256MB、输入 400MP、输出 460MP、输出边长 56000、渲染超时 900s、容器内存 10G（压测时 NAS 可用 39G）。仅 671MP 扫描图（DSCF7263.png）仍在范围外。
- 实测 DSCF5627-Pano.jpg（53204×7284，3.886 亿像素）端到端渲染：约 45 秒内完成，采样内存峰值约 4.5GiB / 10GiB；成品 53204×7304 JPEG、方向归一、ICC 保留，任务进入 awaiting_import。worker 43 项测试、Ruff、前端构建通过。
- 已提交推送（5b81e5a、59c98ee）并部署 m1-brutalist；compose mem_limit 10g。压测期间短暂停止伴侣容器，结束后已恢复 healthy。

### Imprint 成品目录（2026-10-10）

- 成品统一发布到输出库内 `Imprint/` 文件夹（`KI_IMPRINT_DIR` 可配），路径由 `paths.output_relative()` 单点推导，publish/预览/哈希/入库匹配/巡检全部走该函数；重新生成原位覆盖同一路径，不追加文件。非法 imprint 名（点开头、`..`、含分隔符、`.ki-tmp`）启动即拒绝。
- worker 50 项测试通过（新增前缀推导与校验用例）；已提交推送（aaca30e）并部署。存量 3 个成品已移入 `Imprint/` 相同相对路径，数据库内容哈希全部匹配；Immich 下次扫描自动清理旧路径资产。公网 health ok。
