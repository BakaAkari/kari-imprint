# immich-ki 设计文档

面向 Immich 的修图式信息边框伴侣服务。本文档定义产品与集成方案；实现同时遵守 `AGENTS.md` 与一致性契约。
影响产品行为或集成契约的变更先更新本文档；尚未验证的外部行为不得作为保证。

状态：2026-10-09 评审修订稿；先按 §12 完成 M0 闭环验证，再进入 M1。M0 隔离容器已部署，单张真实 JPEG 的 NAS 收编、覆盖和关联保持闭环通过；追加故障恢复、图片兼容、性能与浏览器坐标验证已完成；已确认客户端缓存限制，手机端已由用户确认刷新后正常，进度见 `docs/immich-ki-m0-validation.md`。
关联：`docs/flow-layout-architecture.md`（Flow Layout 核心）、`docs/consistency-contract.md`（双语言一致性契约）。

## 1. 背景与现状（原设计记录，待 M0 复核）

以下硬件、文件数量与第三方实现信息沿用原设计记录；本轮已连接 NAS 验证 Immich v3.3.0、API 与实际挂载，并完成隔离部署。实际镜像 ID 和验证范围见 M0 记录；未重新核对的历史快照不作为自动部署依据。

### 1.1 NAS 实况

- Unraid（`Akari-NAS`），i5-12600KF + RTX A4000 16GB，Tailscale `100.121.167.1`，局域网 `192.168.50.55`。
- 容器由 Dockge 编排：`/mnt/user/appdata/dockge/stacks/<name>/compose.yaml`。
- 存在共享 docker 网络 `app-media-edit`，`immich-server` 与 `immich-edit` 均在其中。

### 1.2 Immich 实况（v3.3.0）

- 仅监听 `192.168.50.55:2283`（局域网，未暴露公网/Tailscale）。
- 两个外部库已建（挂载均为 `:rw`）：

| 库 | 容器路径 | 宿主路径 | 用途 |
|---|---|---|---|
| 原图库 | `/external/camera-data` | `/mnt/user/camera-data` | 存储与归档，**immich-ki 不读不写** |
| 成品库 | `/external/camera-exports` | `/mnt/user/camera-workspace/exports` | 调色导出成品，`YYYY/YYYY-MM/Photos\|Videos` 结构，**唯一处理源** |

- 成品库格式分布：1384 JPG + 1 JPEG + 7 PNG；**零 HEIC、零 RAW**；视频/音频 16 个由 worker 按 MIME 跳过。
- 资产总数 19569；Workflow 引擎可用（0 条已配置）；外部库排除在 integrity checksum 检查之外（v3.0 fix #29248）。

### 1.3 先例：immich-edit 0.6.3

`haavardnk/immich-edit` 以伴侣容器模式运行（端口 2284，同 `app-media-edit` 网络，
内网地址 `http://app-immich-server:2283/` 访问 Immich，GPU 渲染，非破坏式编辑）。
其数据模型（`edits` 表：`edits_json` + `schema_version` + `renderer_version` + `immich_checksum`）是本设计持久化层的直接参照。

## 2. 产品定义

### 2.1 目标

- 在 Immich **成品库**素材上叠加信息边框，产出进入**独立水印库**。
- 交互为**修图式**：逐图选入 → 调参 → 保存（配置随图持久化）→ 可随时改参重渲，同一成品原位更新。
- 复用 kari-core 渲染管线与 Flow Layout 引擎，与公开 Web 工具（`apps/api` + `apps/web`）核心同源演进。

### 2.2 非目标

- 不处理 RAW / HEIC / 视频（成品库无此需求；新格式出现再议）。
- 不修改 Immich 本体、不 fork、不注入 Immich UI。
- 不动原图库；不做批量自动出图（Workflow 自动化为远期可选项）。
- 第一阶段不做多用户；面板仅服务单一 Immich 账户。

### 2.3 术语

- 源资产：成品库中的 Immich 资产（处理输入）。
- 水印资产：水印库中由 immich-ki 生成的 Immich 资产（处理输出）。
- 配置：一份完整 `ImprintConfig`（Flow Layout v3 canonical 结构）。

## 3. 仓库与分支策略

- 单一长期分支 `main`。immich-ki 是 monorepo 内的**新产品 app**，不是分支：

```text
apps/
  api/            # 产品 1：公开 Web 工具（保持现有行为）
  web/            # 产品 1 前端（允许最小共享模块抽取）
  immich-ki/      # 产品 2（新增）
    worker/       #   FastAPI + kari-core + sqlite
    web/          #   修图式编辑器（Vite/React）
deploy/dockge/    # NAS compose 草案
```

- 允许开**短期**脚手架分支，纪律：核心改动回 `main`，分支不长期存活、不平行演进。
- kari-core 提供共享元数据处理能力，由各产品显式选择策略；公开 Web 不因 NAS 需求改变默认元数据披露行为。前端共享模块抽取单独验证现有产品回归。

## 4. 总体架构

```text
浏览器 (局域网 :2285)
  │  面板 API（免 CORS、免暴露 Immich key）
  ▼
immich-ki-worker ──► Immich API (http://app-immich-server:2283, 内网)
  │  读源资产       asset.read / asset.view / album.read / job.create
  │  读字节（成品库只读挂载 /imports）
  │  触发派生刷新    POST /assets/jobs (regenerate-thumbnail / refresh-metadata)
  ▼
/mnt/user/camera-workspace/watermarked  (:rw)
  ▲
  └── Immich 外部库「水印库」扫描收编（定时扫描/文件监听）
```

设计要点：

- worker 是浏览器与 Immich 之间的唯一代理；浏览器永不直连 Immich、永不持有 Immich API key。
- 渲染完全复用 `packages/kari-core`（PIL，纯 CPU；M0 测量最大样本的耗时与峰值内存，不使用 GPU）。
- EXIF 直接解析源文件（挂读取），不走 Immich `exifInfo`，复用同一字段解析契约；视觉一致性由 M0 验证。
- 写库使用输出挂载内的临时目录和同文件系统原子替换；Immich 必须排除临时目录，详见 §5.4。

## 5. 数据流

### 5.1 首次出图

1. 面板通过 worker 浏览源库、相册和分页缩略图。worker 按配置的源库 ID 和规范化路径过滤；不把全图库或内部路径交给浏览器筛选。
2. 画布加载 Immich preview，原始尺寸与 EXIF 由 worker 提供经过筛选的字段；预览缩放不得改变布局的原图坐标语义。
3. `PUT /api/assets/{id}/config` 携带 `expected_revision`（首次为 0）；事务内比较当前版本、校验完整配置和资源引用，成功返回递增 `revision` 与 `config_hash`，冲突返回 409。
4. `POST /api/assets/{id}/render` 携带已保存的 `revision`。worker 验证它仍为当前版本，固定配置、资源、源文件和渲染器版本快照并入队，返回任务 ID；任务接口用于轮询。
5. worker 渲染到临时文件，验证结果后发布到镜像路径；数据库记录 `published`，再进入 `awaiting_import`。
6. 等待 Immich 定时扫描或已启用的监听收编。MVP key 不具有管理员扫描权限，因此不承诺即时入库。按输出库 ID + 精确规范化路径匹配资产，分页查找须有截止时间和退避；超时显示“等待入库”，保留成品并可重试。
7. 回填 `output_asset_id` 后刷新元数据和缩略图；记录 `refresh_pending`，确认目标版本可观察的完成条件后才标记 `ready`。HTTP 204 仅表示任务请求被接受，不表示已完成。

### 5.2 再调参（修图闭环）

- 每次用户请求渲染生成新的发布代次 `generation`。只有与最新目标代次一致的任务可发布；旧任务标记 `superseded`，不得覆盖新结果。
- 配置 A → B → A 必须能重新生成 A；源字节、资源内容或渲染器版本变化，也必须生成新结果。历史成功任务不阻止重新渲染。
- 覆盖同路径是产品目标，**资产 ID、相册、分享、收藏关联保持已在 v3.3.0 单张 JPEG 的 A/B/A 验证中通过，仍需覆盖更多样本及客户端缓存场景后形成生产保证**。不以删除再上传作为隐式回退。
- 覆盖后刷新元数据（含新增边框导致的尺寸变化）和缩略图。依赖顺序、扫描是否必要、浏览器/Immich 缓存失效方式必须在目标版本验证并记录。
- 实测 v3.3.0 缩略图可被浏览器缓存一天；服务端重建与 ETag 更新不等于已打开客户端自动刷新。M0 明确提示重新加载/强制刷新，M1 面板输出预览使用版本化 URL；手机端已由用户确认刷新后正常。
- 如果原位更新不能满足关联保持要求，M0 判定该方案未通过，先修订产品行为，不带着已知不一致进入 M1。

### 5.3 路径与输入边界

```text
源:  /imports/2026/2026-10/Photos/DSCF1234.jpg
输出: /output/Imprint/2026/2026-10/Photos/DSCF1234.jpg
临时: /output/.ki-tmp/<job-id>/result.jpg
```

- 成品统一发布到输出库内的 Imprint 文件夹（`KI_IMPRINT_DIR`，默认 `Imprint`），路径由 `output_relative()` 单点推导；
- 保持相对目录、名称和 JPEG/PNG 格式；编码器与后缀一致，PNG 的透明度处理须显式定义并测试。
- API 只接受不透明资产 ID。worker 从 Immich 获取 `originalPath`，按完整路径组件匹配源前缀，再映射到只读 `/imports`。禁止字符串前缀误匹配、`..` 越界和符号链接逃逸；实际打开文件时也必须保证根目录约束，不能仅做一次字符串校验。
- 输出路径完全由 worker 推导；输出父目录也执行边界与符号链接检查。拒绝已有路径被其他源资产占用，不覆盖无法确认归属的文件。
- 镜像路径只能重建文件对应关系，**不能恢复配置、Logo/签名或历史版本**。源文件重命名、移动或资产 ID 重建进入人工确认的对账状态，不自动迁移或删除旧输出。

### 5.4 文件发布与崩溃恢复

- 临时文件放在 `/output/.ki-tmp`，Immich 水印库须配置该目录的扫描排除规则，并在 M0 实测规则有效。不得使用 `/data` 或容器 `/tmp` 后假定可原子移动。
- 在实际 NAS 挂载上验证临时文件与目标可原子替换；遇到跨设备错误立即失败，禁止退化为向最终路径逐字节复制。
- 编码完成后校验可解码、格式、尺寸和元数据，刷新文件写入，持久化发布意图（代次、目标路径、输出摘要），再执行原子替换并同步目标目录，最后确认数据库发布状态。
- 发布前重新检查源文件指纹和最新目标代次；文件替换与更新发布记录期间对同一资产加锁，保存/入队更新目标状态也使用此锁，防止检查后被新任务抢先。
- 数据库和文件系统不构成一个事务。启动时依据发布意图与目标文件摘要恢复：替换已成功则补记状态；未成功则重试；摘要不符则报告冲突，不盲目覆盖。
- 临时目录在任务完成后清理；启动清理不属于活动任务且超过保留期限的残留。持久成品不自动过期。

## 6. 持久化、任务与恢复

以下为逻辑模型；实现使用有版本的 SQLite migrations、外键与事务，并对枚举和范围建立约束。

| 实体 | 必需字段与职责 |
|---|---|
| `asset_state` | 源资产 ID、源库 ID、相对路径、当前配置 revision、目标 generation、已发布 generation、输出资产 ID、输出摘要、发布/同步状态、时间戳 |
| `config_revision` | `(asset_id, revision)`、不可变 canonical 配置 JSON、schema_version、config_hash、资源引用；保留任务仍引用的版本 |
| `resource` | 不透明 ID、内容 SHA-256、MIME、大小、尺寸、持久存储相对位置、创建时间；内容不可变 |
| `render_job` | 任务 ID、资产 ID、generation、配置 revision/快照、源 SHA-256、资源摘要清单、renderer_version、render_key、阶段、attempts、时间戳、可公开错误码 |
| `publication` | 任务 ID、generation、临时/目标相对位置、输出摘要、发布意图与完成标记，支持文件/数据库故障恢复 |

### 6.1 版本与去重

- `config_hash` 为严格校验后 canonical JSON 的 SHA-256；明确字段默认值、键排序与数值序列化规则，不接受 NaN/Infinity。
- `render_key` 覆盖配置、源字节 SHA-256、资源摘要、渲染器版本和编码/元数据策略。文件大小/mtime 仅用于变化初筛，不作为内容一致性的唯一证据。
- 源文件先读取为受限的任务快照，渲染使用该快照；读取期间检查变动，发布前重新验证当前源。外部程序不受 worker 锁约束，后续变动由对账标记 `stale`，不宣称跨进程原子一致。
- 只对当前目标代次的活动任务合并重复请求。已完成/失败/被替代任务不受永久唯一键限制；同 key 的失败任务允许有界重试。
- 发布资格同时检查当前配置 revision 与目标 generation。保存新配置使旧配置任务失去发布资格；只有显式渲染请求才创建任务。

### 6.2 队列和同步状态

- MVP 单 worker、串行渲染；禁止多个进程同时消费同一数据库。任务阶段为 `queued → running → published → awaiting_import → refresh_pending → done`，另有 `failed`、`superseded`。
- 渲染与 Immich 同步分开重试：同步失败不重新编码成品。网络错误有超时、退避和最大重试次数；最终错误可由用户重试。
- 重启后恢复未完成发布，再恢复中断任务和待入库/刷新任务。启动及定期对账属于 M1 必需能力；M2 才扩展完整报告界面。
- 仅在成功查询且确认源资产不存在时标记 `orphan`；网络失败、认证失败或挂载丢失不能推断删除。孤儿默认保留，不级联删除文件。

### 6.3 Logo/签名与备份

- 自定义资源保存到 `/data/resources`，通过不透明 ID 引用，不复用公开 Web 的临时上传有效期。入队固定内容摘要；缺失资源返回明确错误，不静默换成默认 Logo。
- 内置字体、Logo 和布局 token 的版本计入 renderer_version；已引用的自定义资源禁止原地修改。清理仅删除未被配置或活动任务引用、且超过保留期限的资源。
- SQLite 使用一致性备份接口，并连同资源、部署配置和必要版本清单备份；密钥单独保护。恢复演练必须验证自定义资源、配置与重渲。
- `/mnt/user/...` 本身不能证明数据落在 array 而非 cache；部署时核实 Unraid share 存储策略和本地文件系统锁语义。磁盘位置不能替代备份。

## 7. kari-core 元数据与色彩策略

已核对当前 `packages/kari-core/src/kari_core/processor/core.py` 的 `save_output()`：显式保存参数只有 quality/subsampling，未显式保留 EXIF/ICC。改造必须作为共享能力实现，而非 worker 私有补丁。

- 显式区分产品策略：NAS 输出保留拍摄 EXIF（包括源文件已有 GPS）；公开 Web 保持当前元数据默认行为。保留/去除策略及其版本计入 render_key。
- 在读取源文件时独立保存元数据上下文，不依赖中间合成图的 `img.info` 自动传递。
- 像素转正后移除或归一 Orientation 为 1；更新输出尺寸相关标签，清理旧内嵌缩略图及不再匹配像素的字段。覆盖 JPEG/PNG、无 EXIF、损坏 EXIF、旋转图等测试。
- ICC 必须描述实际输出像素。M0 首选验证统一转换为 sRGB 后合成并写入对应 profile 的方案；不得只复制源 ICC 到已转换色彩空间的像素。无 profile 时采用明确的 sRGB 假设，异常 profile 报告明确错误。
- 验证拍摄日期、相机/镜头、曝光参数、GPS 策略、方向、输出尺寸及色彩，而非只检查 EXIF/ICC 字节存在。用 sRGB 与广色域样本比较预览和输出。
- M0 闭环需要最小元数据实现；M1 前完成共享接口、回归测试与一致性检查。不得用改变公开 Web 默认行为来简化联调。

## 8. Immich 集成契约

### 8.1 API key 权限（候选最小集，M0 核验）

| scope | 用途 |
|---|---|
| `asset.read` | 资产列表/元数据/`originalPath` |
| `asset.view` | 面板缩略图 |
| `album.read` | 相册过滤 |
| `job.create` | 重渲染后 `POST /assets/jobs` 刷新派生品 |

明确**不授予**：`asset.upload` / `asset.delete` / `asset.update` / 任何 admin 权限。
key 只存在于 worker 容器环境变量，不出现在前端与镜像层。

### 8.2 待重新核验的端点契约

已核对 [v3.3.0 官方 OpenAPI](https://github.com/immich-app/immich/blob/v3.3.0/open-api/immich-openapi-specs.json) 的搜索、资产读取、预览与 jobs 权限。目标实例已验证搜索/资产读取/预览、jobs 与隔离库扫描闭环；M1 第一批继续使用原四 scope key。

- `POST /assets/jobs`，body `{name: AssetJobName, assetIds: [...]}`，204；`AssetJobName ∈ {refresh-faces, refresh-metadata, regenerate-thumbnail, transcode-video}`；服务端要求 `Permission.JobCreate`（`job.create`）。
- 缩略图/预览/原图：`GET /assets/{id}/thumbnail?size=thumbnail|preview` 与 `GET /assets/{id}/original`（v3.3.0 没有独立 `/preview` 路由）。
- 资产枚举：优先使用目标版本支持的源库过滤；否则 worker 分页枚举并过滤，浏览器仅收到授权源库的结果与稳定分页游标。输出查找限定输出库并精确匹配路径。
- 原设计记录外部库排除在 checksum 检查外，须核验目标版本；这不能推出覆盖后的元数据、缓存和关联均正确。
- 官方外部库文档说明外部文件变更需要扫描：[External Libraries](https://docs.immich.app/features/libraries/)。具体扫描、jobs 调用及关联保持行为以目标版本闭环测试为准。

### 8.3 版本策略

- 目标版本沿用原记录 v3.3.x；M0 确认实际版本后钉住精确 tag/digest，不自动跟随浮动版本；Immich client 独立模块（`apps/immich-ki/worker/src/immich_ki/client.py`），集中所有端点调用。
- Immich 升级流程：先跑集成验证（选图→渲染→刷新闭环），再切正式。
- v3.0 已发生过第三方 API 破坏性变更，升级默认视为有风险操作。

## 9. 前端架构（apps/immich-ki/web）

### 9.1 复用原则

- **单份共享实现**：以最小范围抽取 Canvas、布局引擎、类型/token 和可复用 Inspector/Rail 到共享模块；两个 app 通过数据源适配层接入。禁止复制出长期独立维护的布局引擎。M0 可用薄适配验证，M1 固化包边界，不借机全面重构。
- 适配层负责资产加载、预览/元数据、资源解析、配置读写、渲染状态；编辑器不直接依赖 Immich API。
- **不重做外壳**：面板保持 kari-imprint 现有视觉与布局，只把「拖放上传区」替换为「Immich 图库面板」。不需要模仿 immich-edit 的界面。

### 9.2 新增组件

- `AssetPicker`：缩略图网格 + 相册过滤 + 分页 + 已出图状态角标（读 worker 状态接口）。
- 状态模型：从单会话升级为「资产 → 配置会话」映射，含脏标记与渲染状态轮询。这是本设计**最大的前端重构点**，必须验证切图脏状态提示、保存冲突、快速切图时丢弃过期请求、任务状态与当前图片隔离。

### 9.3 两级加载

画布优先用 Immich `preview`（实际尺寸由实例配置决定），渲染用 worker 的原图快照。若方向/色彩与原图不一致，worker 用同一元数据/色彩管线生成受限尺寸预览并缓存，以源指纹作缓存版本；浏览器始终不下载原图用于预览。

## 10. 部署

- **构建**：GitHub Actions → GHCR（`ghcr.io/<owner>/immich-ki:<tag>`），tag 钉版本；与现有 monorepo CI 合并考虑。
- **运行**：Dockge stack（`deploy/dockge/compose.yaml` 草案），绑定 `192.168.50.55:2285`，加入 `app-media-edit` 网络。
- **开发迭代**：本地 `docker build` + `docker save | ssh docker load`，不走 registry。
- 不走 Docker Hub。
- M0 网络回退：若 Tailscale 中继使整镜像传输不可用，可由 Mac 打包代码和已构建网页后传入 NAS，仅构建运行时层；使用相同基础镜像 digest 与 requirements.lock，不拉取 Git 仓库、不安装开发依赖。字体下载必须与本地 SHA-256 一致，否则停止或改为从 Mac 传输。记录回退镜像 ID 和实际验收结果。

### 10.1 compose 要点（草案，环境变量为拟定接口）

```yaml
services:
  immich-ki:
    image: ghcr.io/<owner>/immich-ki:0.1.0
    container_name: app-immich-ki
    ports: ["192.168.50.55:2285:2285"]
    environment:
      IMMICH_URL: http://app-immich-server:2283
      IMMICH_API_KEY: ${IMMICH_API_KEY}        # M0 核验后的最小权限 key
      KI_PASSWORD_HASH: ${KI_PASSWORD_HASH}  # 必填，缺失则拒绝启动
      KI_RESOURCE_ROOT: /data/resources
      KI_TEMP_ROOT: /output/.ki-tmp
      KI_SOURCE_LIBRARY_ID: ${KI_SOURCE_LIBRARY_ID}
      KI_OUTPUT_LIBRARY_ID: ${KI_OUTPUT_LIBRARY_ID}
      KI_DB_PATH: /data/immich-ki.db
      KI_IMPORTS_ROOT: /imports
      KI_OUTPUT_ROOT: /output
      KI_SOURCE_PREFIX: /external/camera-exports
      KI_OUTPUT_PREFIX: /external/camera-watermarked
      RENDER_MAX_CONCURRENCY: "1"
    volumes:
      - /mnt/user/camera-workspace/exports:/imports:ro
      - /mnt/user/camera-workspace/watermarked:/output:rw
      - /mnt/user/appdata/app-immich-ki:/data
    restart: unless-stopped
    networks: [media-edit]
networks:
  media-edit: {external: true, name: app-media-edit}
```

配套一次性 Immich 侧改动（实施时执行，需用户在场）：

1. Immich compose 增加 `- /mnt/user/camera-workspace/watermarked:/external/camera-watermarked:rw` 并重启。
2. Immich 管理端新建外部库「水印库」，import path `/external/camera-watermarked`，设置并验证 `.ki-tmp` 排除规则，开启定时扫描。
3. 核实运行用户 UID/GID、读写权限、SQLite 所在 share 策略和备份位置。原图库挂载权限调整不属于本次部署的隐式附带操作。

### 10.2 MVP 运行边界

- 面板采用共享口令登录、服务端会话、HttpOnly/SameSite cookie、登录限流与写操作 CSRF/Origin 校验。局域网绑定不替代鉴权；经 HTTPS 反向代理访问时启用 Secure cookie。API key 不进入前端、镜像或日志。
- 静态资源与 API 同源服务。仅代理固定 Immich 上游和允许端点，不接受任意 URL；向浏览器返回裁剪后的模型，不暴露 originalPath、内部路径、异常堆栈或完整 EXIF 日志。
- 上线前必须配置并验证文件字节、解码像素、输出像素/边长、资源上传大小、队列长度、执行超时、临时文件/预览缓存期限和磁盘余量限制。M0 测量后确定默认值；缺失限制不得发布 M1。
- 容器使用非 root 用户，限制内存/CPU，具备存活与就绪检查；缺配置、挂载不可用或数据库无法迁移时不接收渲染任务。启动清理与关闭均不得误删成品。
- Mac 本地构建必须指定 NAS 目标架构；镜像包含运行时字体、内置资源、ExifTool 等实际依赖，禁止依赖宿主开发环境。
- 部署验收包括健康检查和端到端生成/覆盖测试；旧镜像及数据库迁移回退方案需可用，不直接把测试产物覆盖到已有正式成品。

## 11. 风险登记

| 风险 | 等级 | 验证与缓解 |
|---|---|---|
| 同路径覆盖破坏关联或缓存不刷新 | 高 | M0 实例闭环；失败先改产品契约 |
| 旧任务覆盖新结果、A/B/A 无法重渲 | 高 | 不可变快照、revision/generation、发布互斥、故障测试 |
| 原子替换跨设备、扫描半成品 | 高 | 同挂载临时目录、扫描排除、NAS 实测；禁止复制回退 |
| 崩溃造成文件与数据库状态不一致 | 高 | 持久发布意图、摘要核对、幂等恢复 |
| EXIF/方向/色彩错误或公开 Web 元数据行为变化 | 高 | 产品策略隔离、共享色彩管线、样本矩阵与回归 |
| 配置或自定义资源丢失 | 中 | 联合备份与恢复演练；路径不能恢复配置 |
| Immich 版本/权限与原记录不符 | 中 | 精确版本核验、client 隔离、升级闭环 |
| 前端共享抽取与会话串图 | 中 | 最小适配边界、快速切图/保存冲突测试 |

## 12. 里程碑与验收

### M0：验证完整闭环（不预先承诺小时级完成）

在隔离的测试输出目录/外部库中完成，不覆盖正式成品。先确认实例版本、权限、挂载和扫描配置，保存脱敏证据。

1. 从成品库选图 → preview 进入现有 Canvas → 保存配置 → 通过 kari-core 渲染 → Immich 扫描收编。
2. 修改边框并覆盖 → 元数据/缩略图刷新 → 检查资产 ID、相册、收藏和测试分享关联，以及尺寸和缓存；记录完整可复现调用顺序。
3. 样本至少包含普通 JPEG、带方向 JPEG、PNG、无 EXIF、广色域图片及自定义 Logo/签名，比较预览与输出。
4. 验证 A → B → A、同配置源文件变更、渲染器版本变更、连续保存/渲染和快速切图；旧任务不得覆盖新目标。
5. 在渲染中、文件替换后但数据库确认前、等待收编时重启；验证恢复、重试和无半成品入库。完成一次配置与资源备份恢复。
6. 记录耗时、内存、入库延迟与资源限制建议；核验拒绝路径越界、非源库资产和过大图片。

交付：最小验证实现、测试记录、精确 API 契约和通过/失败清单。通过后更新本文状态；关键行为未通过时先修订方案，不将试验性行为当作生产保证。

M0 实现边界：允许用随机访问令牌兑换单操作员 HttpOnly 会话、手动触发收编检查；worker 暂时依赖现有 API 包的配置校验器，前端直接引用现有 Canvas/类型源码，避免复制。M1 再抽共享包、接入完整面板、口令 hash 登录和自动对账。M0 明确显示 `refresh_pending`，不会把 jobs 请求成功伪报为刷新完成。

### M1：可部署 MVP

- 完成共享元数据能力、编辑器适配与旧 Web 回归、AssetPicker、鉴权、配置/资源持久化、串行队列、原子发布、入库/刷新状态与重试。
- 启动与定期对账、最小孤儿提示、备份恢复、限制与健康检查必须具备。
- 按 `AGENTS.md` 运行 Ruff、布局 parity、core/API 测试、前端 tsc/build 和 diff 检查；新增 worker/shared 包纳入对应检查。布局与视觉改动须浏览器截图验证。
- 在实际 NAS 验证容器架构、权限、重启持久化与完整首次出图/再调参闭环，再部署正式使用。

### M2 / M3

- **M2**：完整对账/孤儿报告界面、批量重渲、可选自动标签（届时核验所需权限，不预先扩大 key 权限）。
- **M3**：可选 Workflow webhook 自动触发、多用户与身份集成；以实际可用认证方式另行设计，不假设 Immich 提供可直接复用的 OAuth 登录服务。

## 13. 本轮默认决策与后续选择

- M1 使用共享口令和服务端会话，鉴权是交付条件。
- 输出目录默认 `watermarked`；精确输出库 ID 由部署配置指定。
- 标签功能放 M2；源删除默认保留输出。
- M0 已在 v3.3.0 验证四 scope key、扫描/刷新顺序、单路径关联保持、预览色彩与 60MP/2GiB 限制；手机端刷新正常已由用户确认。缓存和测试样本覆盖边界见验证记录。

## M1 第一批实施边界（2026-10-09）

用户已确认手机端刷新正常，并授权进入下一步。本批复用 InspectorPanel 的高级编辑及资源上传，增加安全的配置补全适配、版本化成品查看，以及持久化退避的自动入库检查/刷新请求。首次扫描仍交给 Immich，不增加管理员 scope；刷新请求受理后保留 refresh_pending，不伪报客户端缓存已更新。旧令牌鉴权和隔离目录暂保留，正式共享口令、全量对账/孤儿提示、备份/GC 等仍是后续 M1 交付门槛。

## M1 收尾实现约定（2026-10-09）

用户授权继续完成 M1。身份方案以已上线 Pocket ID OIDC 与 `kari-imprint-admin` 限制替代早期共享口令设计；保留一小时会话上限，后台注销推送独立验收。（身份方案后续已由 2026-10-10 决策取代，见下文。）

本批补齐现有 Logo 包（仅原项目公共品牌资源，不包含 custom）、目录/预览接口与资源指纹；照片先显示预览，再补齐配置/EXIF，元数据不做全图解码且缓存按文件身份失效。运维部分增加已管理资产的启动/周期检查与只读异常提示、磁盘余量门槛、仅回收过期未引用自定义资源/非活动临时目录，以及数据库+资源的可校验备份。任何对账异常均不自动删除或覆盖原图/成品。还原必须停服务、在空数据目录执行并先校验摘要，不自动替换正在运行的数据目录。

## Immich 账户登录与 init 模式（2026-10-10）

身份方案改为：**API Key 只用于关联面板与 Immich**（服务端凭据，持久化在数据目录
`config.json`，原子写、0600，含 key 属主邮箱）；**日常登录使用 Immich 账户**
（邮箱+密码，经 Immich `POST /api/auth/login` 验证后签发面板自己的 8 小时会话
cookie，密码即验即弃）。完全移除 Pocket ID OIDC（及 M0 共享令牌登录）。数据目录
无有效配置且环境变量无 key 时进入 init 模式：仅开放健康检查、会话查询与
`/api/init`，初始化表单输入 key 经 `GET /api/users/me` 验证后落盘并直接登录；
旧部署的 `IMMICH_API_KEY` 环境变量启动时自动迁移。key 绑定账户与登录身份
不一致时拒绝（403 `forbidden_account`）。更换 key = 停容器、删 `config.json`、
重启重新 init。动机是 passkey 因软件问题无法弹出导致登录不可用，单操作员面板
不需要独立 IdP。设计、边界与验收清单见 `docs/immich-ki-immich-key-auth.md`（v3）。
