# Immich KI 相册导航与存储恢复

## 现场证据（2026-10-11）

- 源库枚举 1264 张照片：1258 JPEG、6 PNG；未发现离线或缺失文件，1 张超过 4 亿像素限制。各非空相册抽测缩略图和预览均返回 200。这些检查不等同于编辑器接口成功。
- 元数据读取使用 `/output/.ki-tmp/<uuid>`；线上该根目录不存在，`_metadata()` 创建子目录实际抛出 `FileNotFoundError`，被 API guard 转换为 `operation_failed`。
- 输出挂载目录属主 `99:100`，模式 `775`；worker 身份 `10001:10001`，没有输出写权限。`/imports/imprint`、`/output` 与宿主路径 inode 相同，排除了陈旧 bind mount。
- 在独立可写临时目录复测同一照片的元数据成功，证明文件可读与临时存储失败是不同环节。
- 线上 `/api/health` 为 `ok:false`，容器 unhealthy；原后台对任意异常永久停止，缺失暂存根目录会使维护扫描触发该路径。
- 目录时间戳晚于容器启动时间，说明运行期间状态发生变化；未找到足以归责于某个脚本或操作者的证据。
- 前端相册切换只更新 album/page，不清除 active；旧照片状态因此与新图库脱节。原轮询请求没有导航代际保护。

## 修复契约

1. 编辑元数据暂存使用专用 `/data/metadata-tmp`，不依赖输出目录可写。
2. 渲染暂存仍使用 `/output/.ki-tmp`，保持发布原子 rename 的同文件系统要求。
3. 暂存子目录按需恢复；不创建缺失的挂载根目录，不追踪符号链接。检测真实写权限，返回安全错误码而非内部路径。
4. 可恢复的存储/上游故障等待后重试；结构性故障仍停止并报告。永久遗失的发布快照只终止对应任务，不阻塞后续队列。
5. 相册/页码导航清除旧编辑上下文，确认未保存修改，取消旧请求并防止延迟响应回写；图库独立呈现加载、空结果与错误。
6. NAS 保持应用 UID/GID `10001:10001`，通过 `group_add: [100]` 遵循输出目录 `nobody:users` 共享约定；不递归 chown/chmod，不改变原片只读挂载。部署模板可用 `KI_OUTPUT_GID` 覆盖。

## 回滚与验证

线上变更前备份路径：`/mnt/user/appdata/app-immich-ki-m0-backups/storage-recovery-20261011`。
包含旧 Compose、凭据文件、SQLite 一致性备份及资源；SQLite `integrity_check` 返回 `ok`。
旧镜像为 `kari-imprint/immich-ki:m2-typography`，镜像 ID 记录于备份 `rollback.json`。

本地验证命令：

```sh
uv run pytest apps/immich-ki/worker/tests -q
uv run ruff check apps/immich-ki/worker
cd apps/immich-ki/web && npm run build
```

后端独立复验：54 passed。

## 部署与实测（2026-10-11）

镜像 `kari-imprint/immich-ki:m2-storage-recovery-20261011`（sha256:bf16959ffeef48b0fed577d21be3caafb3131d38fb86969131c26567d39594ec），
由 NAS `/mnt/user/appdata/app-immich-ki-m0-build/m3` 用 `Dockerfile.runtime` 原生构建（web 用本地 `dist`）。
Dockge 栈 `app-immich-ki-m0` 已重建；旧镜像 `m2-typography`（sha256:49c838847f50）保留可回退。

线上实测（全部为真实执行结果）：

- `GET /api/health` → `{"ok":true,"error":null}`；容器内 `id` = `10001(imprint)`，附加组含 `100(users)`。
- `/data/metadata-tmp` 与 `/output/.ki-tmp` 按需创建，身份 `imprint`。
- 编辑器加载路径：对真实照片调用服务元数据方法成功（11664×8750，10 个字段），临时目录用后为空。
- 渲染管线：对真实源照片执行 `immich_ki.render` 成功（JPEG 11664×9800），产物写到 `/data` 沙箱，未写入生产成品目录。
- 输出挂载：`/output/.ki-tmp` 内写入 + `os.replace` 原子改名成功，随后清理。
- 公网 `https://immt.baka-akari.icu:18443` 返回新前端包 `index-Bhh2rfTl.js`，健康检查同步为 `ok:true`。

本地验证：worker `54 passed`、kari-core `410 passed / 7 skipped`、api `73 passed`、`ruff check .` 通过、
`verify_flow_layout_parity.py` 通过、`apps/web` tsc 与 `apps/immich-ki/web` 构建通过。
浏览器回归 `scripts/verify_immich_album_navigation.py`：PASS（画布按原图尺寸、相册切换清空旧选中、旧轮询响应不回写、
未保存修改确认取消/接受、加载中被导航取消、空结果与错误区分）。

尚未验证：登录面板后的人工端到端验收（需要 Kari 的 Immich 账户登录），以及真实成品发布到 `finished/imprint`。

## 相册筛选 500（第二次修复，2026-10-11）

用户实测：选中任意相册都显示 `Error: operation_failed`，照片列表不更新。

根因：`app.py` 的 `/api/assets` 把查询参数声明为 `album: UUID`，FastAPI 传入的是 `uuid.UUID` 实例；`client.search()`
内部执行 `str(UUID(album))`，对 UUID 实例调用会抛 `AttributeError: 'UUID' object has no attribute 'replace'`，
被兜底中间件转成 500 `operation_failed`。**任何**相册筛选都会失败，与相册是否有照片无关
（`手机调色_OPPO-LR` 恰好是 0 张，容易误判为该相册的问题）。

为什么之前没发现：单测里的假 Immich 客户端用 `str(album)` 容忍 UUID 实例，掩盖了真实客户端的字符串契约；
我早期的线上抽查也传的是字符串。

HTTP 级对照（同一脚本 `scripts/verify_immich_album_filter_live.py`，在容器内跑，真实 Immich + 真实相册 ID）：

| 请求 | 修复前（m2-storage-recovery） | 修复后（m2-album-filter） |
| --- | --- | --- |
| `/api/assets` | 200（50 项） | 200（50 项） |
| `/api/assets?album=<空相册>` | **500 operation_failed** | 200（0 项） |
| `/api/assets?album=<有照片相册>` | **500 operation_failed** | 200（50 项） |
| `/api/assets?album=<不存在的 UUID>` | 500 | 502 immich_unavailable |
| `/api/assets?album=not-a-uuid` | 422 | 422 |

修复内容：`client.search()` 用 `str(UUID(str(album)))` 归一化；`/api/assets` 显式传 `str(album)`；
假客户端改为对非字符串 album id 直接报错，并新增 `test_client_search_sends_album_ids_as_strings`
锁定线上 wire 契约（把旧写法还原后该测试立即失败，已实测验证）。

同时为兜底中间件补了脱敏日志（方法 + 路由模板 + 异常类名，不含路径/密钥/EXIF），
因为静默 500 正是这次难以定位的原因。

线上镜像 `kari-imprint/immich-ki:m2-album-filter-20261011`（sha256:e54c30354d87），
`/api/health` → `ok:true`；上表"修复后"列即在线上容器内实测结果。

已知小遗留：不存在的相册 UUID 会返回 502 `immich_unavailable`（上游对未知相册报错），
提示语不精确；相册被删除后打开面板会看到该提示。如需可增加专用错误码与文案。
