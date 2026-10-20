# Immich KI 相册工作流（2026-10-11）

交互：**选相册 → 无限瀑布流浏览 → 点开单张才出现右侧参数面板 → 保存并生成 → 返回继续浏览**。
水印按需生成：只处理你打开并保存的照片，未处理的照片不复制、不补齐、不删除。

## 交互契约

| 区域 | 实现 | 行为 |
| --- | --- | --- |
| 左栏 `.album-list` | `main.tsx` | 每张相册卡显示缩略图、名称、张数；点击进入中间瀑布流 |
| 中间 `.gallery-scroll` | `gallery.tsx` `useGallery` | `IntersectionObserver` 观察 `.gallery-sentinel`，`nextPage` 存在即自动取下一页，**无翻页控件**；按 id 去重 |
| 编辑视图 | `main.tsx` `.photo-editor` + `.controls` | 仅在选中照片后渲染；`Escape` 或「← 返回相册」退出并恢复滚动位置（误差 ≤5px） |
| 脏数据保护 | `closeEditor` / `navigate` / `selectAsset` | 有未保存修改时 `confirm` 询问；放弃则丢弃 |

## 相册语义

- 名称以 `Imprint` 结尾（接口 `isResult`）= **成品相册**，左栏标记「成品 · 只读」且 `disabled`。
- 成品相册**不能**作为图源：`/api/assets?album=` 与 `POST /render` 的 `sourceAlbumId` 都会返回 422 `result_album_read_only`，避免对已加水印的成品二次加印。
- 普通相册 = 待处理图源。

## 配对规则

- 配对名 = `<源相册名> Imprint`（源相册名去尾部空白 + ` Imprint`）。
- 首次配对：按名查找；0 个则创建，1 个则复用，≥2 个报 `ambiguous_album_pair`（不猜）。
- 配对关系持久化在 `album_pairs(source_album_id PRIMARY KEY, result_album_id UNIQUE)`；同一源相册始终指向同一个成品相册，**不会累积新的后缀**。
- 任务来源记录在 `job_albums(job_id, source_album_id)`；旧任务无此记录时保持原行为（不配对）。
- 成品发布路径由源相对路径决定（`output_prefix + '/' + relative_path`），重复生成是 `os.replace` 覆盖同一文件 → Immich 同一 asset，**不产生副本**；同名但无法确认来源时由 `ambiguous_output` 拒绝。
- 成员加入使用 PUT（幂等），入库后读回校验；只有成品库中能找到唯一匹配时才写入配对相册。

## 已修缺陷（本批）

**`POST /api/assets/{id}/render` 带相册时必定 422 `invalid_request`。**
`Render` 继承 `StrictModel`（`extra="forbid", strict=True`），而字段声明为 `sourceAlbumId: UUID`；严格模式下字符串不会被强制转换为 `UUID`，而 JSON 请求体只可能是字符串。结果是新交互的「保存并生成」在真实环境必然失败。
修复：字段改为 `str | None`，用 `field_validator` 显式 `str(UUID(value))` 归一化，非法值仍是 422，同时与 Immich 线上「相册 id 用规范字符串」的契约一致（此前 UUID 对象/字符串漂移已造成过一次 500，见 `docs/immich-ki-storage-recovery.md`）。

## 线上相册实况（2026-10-11 读取）

共 16 个相册，其中 3 个成品相册，命名已符合 `<相册名> Imprint`：

- 成品：`2024 日本 Imprint`(167)、`2024 云南 Imprint`(63)、`2024 嵊泗 Imprint`(34)
- 图源：`成图库`(1276，整库总览)、`历史散片`(416)、`2024 WF`(133)、`2025 大阪`(128)、`2024 日本`(95)、`2025 香港`(58)、`2024 上海野生动物园`(52)、`专题_月亮`(50)、`2024 CJ`(45)、`2024 嵊泗`(34)、`猪咪`(6)、`2023 乌镇`(3)、`2026 青甘环线自驾`(2)

两点需要你判断，代码不做猜测也不会自动删除：

1. `2024 日本`(95) 与 `2024 日本 Imprint`(167) 数量不一致——成品相册比源相册多 72 张。可能来自历史手工维护或旧版工具，与当前配对逻辑无关（配对只增不删）。
2. `成图库` 是整库总览，用它作图源会新建 `成图库 Imprint`（只含你处理过的照片），与按目录同步出来的三个成品相册并存。

## 验证

- 仓库：ruff、flow layout parity 8 fixtures、`kari-core` 410 passed/7 skipped、`apps/api` 73 passed、immich-ki worker **59 passed**（新增成品相册只读、配对复用、照片不在相册、同名成品相册歧义 4 项）、两端 `tsc`/build、`git diff --check`。
- 浏览器（Playwright，全 mock，无真实照片/凭据）：
  - `scripts/verify_immich_editor_browser.py`：参数面板所有权、chip 级自定义文字、样式继承、停用签名保留、JSON 能被真实后端 schema 校验、桌面/手机截图无溢出。
  - `scripts/verify_immich_album_navigation.py`：成品相册只读、无限滚动自动取第 2 页且无翻页控件、按 id 去重、点开才出面板、`POST /render` 请求体断言 `sourceAlbumId`、脏数据保护、返回恢复滚动位置、切换相册丢弃迟到响应、空相册与权限降级文案、无 pageerror。
- 说明：滚动位置恢复的断言最初用硬编码偏移量（400px），而 Playwright 点击会自动把 tile 滚进视口使偏移变为 411px，导致失败——经实测确认**应用行为正确**，改为通过 DOM 派发点击并比对点击时的真实偏移量。

## 部署（2026-10-11）

- 镜像 `kari-imprint/immich-ki:m2-album-workflow-20261011-114943`，ID `sha256:fb2a371ff736f6252efcae1d8ec351c23eea4cece9091a813abd830adbdae456`（NAS 用 `Dockerfile.runtime` 原生构建，上下文 `/mnt/user/appdata/app-immich-ki-m0-build/album-20261011-114943`）。
- 备份 `/mnt/user/appdata/app-immich-ki-m0-backups/album-workflow-20261011-115005`（配置、resources、SQLite 完整副本，`integrity_check=ok`）；上一版镜像 `m2-editor-20261011-094119`（`sha256:9291d06a…`）保留可回滚；旧 compose 另存 `compose.yaml.bak-m2-editor`。
- 栈 `app-immich-ki-m0` 已切到新镜像，容器 `healthy`，`/api/health` = `ok:true,error:null`，公网 `https://immt.baka-akari.icu:18443` 返回的 `index.html` 与两个构建产物与本地 dist **逐字节一致**（`index-CQHx2SkR.js`、`index-Dp4JKgb0.css`）。
- 真实公网 Chromium：登录页邮箱/密码/「进入图库」可见，无页面或 console 错误。
- 容器内对线上 Immich 的只读实测：`is_result('2024 日本 Imprint')=True`、`is_result('2024 日本')=False`；按源相册 id 调 `search` 返回 6 项（第 1 页，共 95）——即此前必然 500 的路径现已正常；`Render(revision=1, sourceAlbumId=<真实相册 id>)` 通过校验，`sourceAlbumId='not-a-uuid'` 被拒绝（ValidationError → 422）。
- 未做：相册成员写入与成品发布的真实端到端（需你登录后在真实照片上验证）；本轮未 commit/push。
