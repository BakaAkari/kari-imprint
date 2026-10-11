# Kari Imprint 体验重构 — 实施报告

状态：已实施并本地验证，未部署。2026-10-12。

本报告对应 `docs/design/2026-10-11-imprint-experience.md` 与
`docs/audits/2026-10-11-adversarial-review.md` 中列出的修复项。范围是本 worktree
（`feat/imprint-experience`），未提交、未推送、未部署，未读取或打印任何密钥。

## 一、已改动文件

### 后端（可靠性 P0/P1）
- `apps/immich-ki/worker/src/immich_ki/client.py`
  - 新增 `ImmichClient.me()`（`users/me`，服务 API key 身份）。
  - 新增 `ImmichClient.album_membership(asset_id)`：用真实 `GET /albums?assetId=` 契约
    取代不存在的 `album().assets` 数组。
  - `add_to_album` 的写后读回改为真实成员查询。
- `apps/immich-ki/worker/src/immich_ki/albums.py`
  - `source()` 的相册成员校验改用 `album_membership`，不再伪造 `album.assets`。
- `apps/immich-ki/worker/src/immich_ki/auth.py`
  - `immich_login` 身份约束改为 fail-closed：owner 为空时一律拒绝（`owner_unbound`），
    不再把“第一个成功登录者”当作 owner。
  - 新增 `POST /api/auth/logout`：删除服务端 session 并清除 cookie。
- `apps/immich-ki/worker/src/immich_ki/app.py`
  - `_resolve_owner_from_key`：启动时用服务 key 的 `users/me` 解析并持久化 owner；
    Immich 不可达时保持 owner 空并 fail-closed。
  - `PUBLIC_VALUE_ERRORS` 增加 `too_many_frames`。
- `apps/immich-ki/worker/src/immich_ki/service.py`
  - `validate()` 在面板边界强制单信息条（`too_many_frames`），不破坏共享 schema 客户端。
  - `_sync()` 增加 `refresh_pending → done` 完成闭环：完成要求输出资产可发现
    （`assets/:id`）且存在于配对结果相册（`albums?assetId=`）；`done` 状态重复 sync 幂等。
  - `reconcile_next()` 现在同时处理 `awaiting_import` 与 `refresh_pending`。
  - 引入 `UUID` 导入。

### 布局引擎（TS + Python 双实现）
- `packages/kari-core/src/kari_core/shared/layout/layout_engine.py`
- `apps/web/src/layout/layoutEngine.ts`
  - 修复 logo 预留空间 parity：边沿 logo 的 reserve 统一为
    `logoDim + dividerW + 2*itemGap`（之前 Python 覆盖成 1 个 itemGap）。
  - 竖向（左/右侧栏）分隔线加入 logo gap，横向/竖向统一“分隔线到图形 == 图形到外侧内容边界”
    的对称安全区。
  - 竖向 logo 边界同样按 itemGap 内缩，与横向一致。
  - 侧栏 `track_order` 变为可操作：`photo-outward` = 主轨在外侧，`outward-photo` = 主轨贴照片。

### 前端编辑器
- `apps/immich-ki/web/src/defaults.ts`：默认三边 60px 留白（`marginsForFrame`），
  信息条所在侧为 0（由条自身厚度管理）。
- `apps/immich-ki/web/src/main.tsx`：预览为主；去掉 REV/GEN 术语；撤销/重做/重置；
  明确输出目的地与状态；本机按照片隔离草稿；输入框聚焦时方向键不切图；
  “保存草稿并离开 / 放弃修改 / 继续编辑”三态离开弹窗；主按钮“保存到 Immich”，本地下载为次操作。
- `apps/immich-ki/web/src/editor.tsx`：移除无效的 `main_alignment`/`cross_alignment` 滑块并说明；
  信息条缺失时提供“添加信息条”恢复入口；切换信息条位置时按 `marginsForFrame` 自适应三边留白。
- `apps/immich-ki/web/src/gallery.tsx`：照片卡片标注改为 未制作/有成品/有草稿/处理失败，不含 REV/GEN/job ID。
- `apps/immich-ki/web/src/api.ts`：新增 `owner_unbound`、`too_many_frames` 文案。
- `apps/immich-ki/web/src/style.css`：新增状态栏/撤销条/目的地/离开弹窗/下载按钮样式，移动端无横向溢出。

### 测试与验证脚本
- `apps/immich-ki/worker/tests/test_worker.py`：`FakeImmich` 改为真实契约
  （`album` 无 `assets`，新增 `me()`/`album_membership()`，成员用集合建模）；
  更新 env-key 迁移、sync 完成、reconcile 完成、相册成员、单框、logout、owner fail-closed、
  真实成员契约等用例。
- `packages/kari-core/tests/test_layout/test_layout_engine.py`：新增对称安全区几何断言、
  侧栏 track_order 翻转断言。
- `scripts/verify_immich_editor_state.cjs`：修正过时的“footer-new”断言为单框规则。
- `scripts/verify_immich_album_navigation.py`：适配新 UI（“保存到 Immich”、“正在生成”、
  三态离开弹窗、草稿恢复路径）。
- `scripts/verify_immich_editor_browser.py`：适配“独立设置”与“添加信息条”。

## 二、已执行的检查

| 检查 | 结果 |
| --- | --- |
| `ruff check .` | 通过 |
| `pytest packages/kari-core/tests apps/api/tests apps/immich-ki/worker/tests` | 551 passed, 7 skipped |
| `scripts/verify_flow_layout_parity.py` | 通过（8 fixtures） |
| `apps/web` `tsc -b` | 通过 |
| `apps/web` `VITE_API_BASE=/tools/kari-imprint npm run build` | 通过 |
| `apps/immich-ki/web` `npm run build`（含 tsc） | 通过 |
| `node scripts/verify_immich_editor_state.cjs` | 通过 |
| `scripts/verify_immich_editor_browser.py`（Playwright + 截图） | 通过 |
| `scripts/verify_immich_album_navigation.py`（Playwright） | 通过 |
| `git diff --check` | 通过 |

浏览器截图产物：`artifacts/immich-editor/desktop.png`、`mobile.png`、
`save-payloads.json`（由编辑器浏览器脚本生成）。

## 三、关键行为验证

- 真实相册成员契约：`test_client_membership_uses_albums_by_asset_query` 验证
  `GET /albums?assetId=` 与 `add_to_album` 写后读回；不再伪造 `album.assets`。
- 归属身份来自服务 key：`test_env_key_migrates_into_config_file` 验证 env key 迁移时
  owner 绑定到 `users/me`；`test_login_fails_closed_when_owner_unresolved` 验证 owner
  未解析时拒绝登录。
- 幂等与完成闭环：`test_sync_reaches_done_only_after_ingestion_and_membership`、
  `test_sync_done_requires_result_album_membership`、`test_reconcile_retries_survive_restart_and_refresh_once`
  验证 `awaiting_import → refresh_pending → done` 不重复出图、不重复请求刷新。
- Logo 对称安全区：`TestLogoSymmetricSafeArea` 对下/左/右三方向做几何断言（非肉眼）。
- 单信息条：`test_render_rejects_second_frame_region` 验证不静默破坏旧配置。

## 四、剩余风险 / 未完成项

1. **编辑器信息架构为局部落地**：已实现预览为主、撤销/重做/重置、草稿隔离、目的地与状态、
   去除 REV/GEN、移动端、去掉无效对齐控件；但“样式/常用/精细”三层预设卡片、点击预览文字定位
   高亮、品牌自动识别 UI 尚未实现，仍是逐项控件布局。
2. **`main_alignment`/`cross_alignment` 已从 UI 移除**（引擎固定为两端对齐/居中），
   schema 字段保留以兼容旧配置；若未来需要，需在双端引擎真正实现后才可重新暴露。
3. **`renderer_version` 仍固定**（`m0-photo-srgb-v1`，仅追加 logo hash），布局/压缩实现
   变更不会改变 renderer_version，跨部署恢复的 `renderer_changed` 检测仍有盲区（审计 P1 未收口）。
4. **`refresh_pending → done` 完成信号**为“输出资产可发现 + 在结果相册中”，是对“收录完成”的
   可靠近似，但不等价于 Immich 元数据/缩略图刷新完成；未引入 exifInfo 存在性作为额外判据。
5. **草稿持久化为本机 localStorage**，按 asset 隔离（面板单操作者，用户维度隐含）；未声称“已自动保存”，
   无跨设备同步。
6. 浏览器脚本依赖已构建的 `apps/immich-ki/web/dist`；未在真实 NAS/Immich 上跑端到端
   （真实 API 只读契约、真实生成、回滚路径）——留待部署阶段验证。
