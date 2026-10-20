# Immich KI M2 归档模式部署记录（2026-10-10）

## 本批内容

1. **口径更名**：`immich-wm` → `immich-ki`（Kari Imprint），包名 `immich_wm` → `immich_ki`，环境变量 `WM_*` → `KI_*`，SQLite `immich-wm.db` → `immich-ki.db`（启动时自动迁移旧文件名），临时目录 `.wm-tmp` → `.ki-tmp`，会话 cookie `wm_session` → `ki_session`。
2. **方案A 归档模式**：源库与输出库允许为同一 Immich 外部库；`KI_IMPRINT_DIR` 允许留空，表示输出挂载根本身即 imprint 目录；输出挂载可位于 imports 树内部（仅允许 output ⊂ imports 这一种交叠）；新增 `Settings.reserved_output` 计算源树中保留的成品子目录，`service.source()` 与图库接口排除该子目录，防止把成品再次当作源照片；同前缀且 imprint 留空（会覆盖源文件）启动即拒绝。
3. **部署形态**：成品直写 `/mnt/user/camera-data/finished/imprint`，`KI_SOURCE_PREFIX=/external/camera-data/finished`，`KI_OUTPUT_PREFIX=/external/camera-data/finished/imprint`，源/输出库 UUID 均为成品库 `dea6ba5c-4f57-4bb6-84f8-1612d272445c`。

## 部署事实

- 镜像：`kari-imprint/immich-ki:m2-archive`（sha256:d9356452ce9c），NAS 侧 Dockerfile.runtime 原生构建（m2 构建目录 `/mnt/user/appdata/app-immich-ki-m0-build/m2`，fonts/logos 逐文件 SHA-256 与仓库比对一致）。
- 栈：`app-immich-wm-m0` → `app-immich-ki-m0`（dockge stacks 目录与容器名同步更名）；数据目录 `app-immich-wm-m0` → `app-immich-ki-m0`，旧库文件由启动迁移逻辑更名为 `immich-ki.db`，`config.json`、resources、历史备份保留。
- 旧 `.env` 中废弃的 `WM_M0_TOKEN`、OIDC 变量已清除；端口仍绑定 `192.168.50.55:2285`，公网经 caddy `https://immt.baka-akari.icu:18443`。
- 成品库扫描排除规则经 API 增加 `**/.ki-tmp/**`。
- `immich_album_sync.py` 重写为支持包含/排除前缀的配对：`成品库` 相册排除 `finished/imprint/`，新增 `Imprint` 相册（相册同步每 30 分钟幂等补齐，脚本备份为 `immich_album_sync.py.bak-m2`）。
- 首次手动运行：原图库 33328 / 成品库 1368（已排除 imprint）/ Imprint 0；Imprint 相册已创建（此前已存在同名相册，含 1 个历史成员，只增策略保留）。
- NAS 契约文件 `README-camera-data.md` 已更新 imprint 目录与更名说明。

## 验证

- 仓库检查：ruff 通过、flow layout parity 通过、kari-core 410 passed / api 73 passed / immich-ki worker 47 passed（含 3 个新增归档模式测试）、web tsc + build 通过。
- 容器 `healthy`，`/api/health` 返回 `{"ok":true,"initialized":true}`。
- 旧 watermarked-m0 中的历史成品未迁移（重构后源相对路径已变化，无法可靠对应），旧 M0 测试库资产保留原状；worker 数据库中重构前保存的任务/配置由维护巡检标记异常，待用户在面板复核。

## 待用户验收

- 面板登录后图库是否正常列出成品库照片（imprint 子目录已隐藏）、对一张照片完成 保存配置 → 生成 → 成品出现在 `finished/imprint/<原相对路径>` 与 Immich `Imprint` 相册。
- 手机端 Immich 刷新确认相册显示。

> 口径说明：M0/M1 历史部署的镜像标签实际原名为 `kari-imprint/immich-wm:*`，环境变量原名 `WM_*`。
