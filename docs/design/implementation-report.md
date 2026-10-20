# Kari Imprint 体验重构 — 实施报告

状态：已实施并本地验证，未部署。2026-10-12。

本报告对应 `docs/design/2026-10-11-imprint-experience.md`、
`docs/audits/2026-10-11-adversarial-review.md` 以及 `docs/design/review-blockers.md`
（含 fff2717 后补审）列出的全部修复项。范围是本 worktree（`feat/imprint-experience`），
未读取或打印任何密钥，未部署、未访问生产环境。

## 一、信息架构重构（前端编辑器）

原 `editor.tsx` 是逐项控件长表单，已整体替换为「样式 → 常用 → 精细」三层结构：

- **样式**：三张可视预设卡片（`StyleCard`）——经典信息框（双轨 + 机身镜头/参数 + 自动 Logo）、
  极简署名（单轨单行机身，无 Logo）、纯留白（无信息条，仅四边留白）。切换整份替换预设，可撤销；
  当前样式由配置结构推导（`detectStylePreset`），不向后端 schema 引入未支持字段。
- **常用**：信息条位置（底/左/右，按 `marginsForFrame` 同步三边 60px 留白）、留白大小、
  照片信息字段开关、品牌（自动/手动/关闭）、署名（开关 + 上传）。
- **精细**：仅显示当前选中对象实际支持的选项——选中文字显示其字号/字重/颜色/信息顺序，
  选中品牌显示 Logo 大小，选中署名显示署名大小，未选中显示全局默认；另有间距与背景色。
- **预览点选**：`KariImprintCanvas` 新增 `onElementClick`/`selectedElementId` 两个可选 prop，
  把布局元素 `id` 反查为选中对象（`selectionFromElementId`），点击文字/Logo 高亮对应控件；
  编辑态绘制虚线选中轮廓（不进入成品）。键盘用户通过「选择对象」具名按钮选中同一对象。
- **移动端**：右栏在窄屏退化为可滚动设置栏，`<600px` 单列不嵌套双滚动，保存栏始终可达；
  浏览器断言无横向溢出。

## 二、品牌自动/手动 UI

`BrandSection` 提供 自动 / 手动 / 关闭 三段切换：自动按 EXIF `make` 经
`resolveAutoLogoWithScheme` 识别并显示「已识别：xxx」；识别不明显示「无法识别，请手动选择」，
不猜品牌；手动列出 `/api/logos` 内置品牌；关闭则不预留 Logo 空间。手动选择只影响当前照片草稿。

## 三、草稿按用户隔离

`/api/auth/session` 现在返回 `identity`（面板 owner）。前端草稿 key 由
`ki-draft-<assetId>` 改为 `ki-draft-<identity>-<assetId>`，按认证用户 + 照片双重隔离，
不再是与设备绑定、跨账号可见的 asset-only 存储。仍不声称「已自动保存」。

## 四、后端可靠性（含 fff2717 后补审）

- `auth.py::validate_immich_key`：`users/me` 必须返回含非空字符串 `email` 的 dict，
  否则返回 `key_identity_invalid`（`{}`、数字 email、`[]`/`null`/非 JSON 一律拒绝），
  init 不再在空 owner 下发放 session。
- `owner.py::resolve_owner_from_key`（app 启动与登录路径共用）：email 必须为非空字符串才持久化；
  登录时若 owner 未解析，用服务 key 重新解析，Immich 恢复后无需重启即可登录（fail-closed 保持）。
- 守卫中间件新增 owner 检查：`panel.initialized` 但 `not panel.owner` 时返回 `owner_unbound`。
- `service.py::save`：相同配置的重复保存是 no-op，不递增 revision（否则会绕过按
  revision 去重的 enqueue 逻辑，等待态重复保存会重复出图）。
- `service.py::_refresh_complete`：确认完成不仅要求 `assets/:id` 可达，还校验返回资产的
  `libraryId` 与 `originalPath` 匹配预期输出；`refresh_pending → done` 在写入前事务内重查
  revision/generation，过期任务改为 superseded 而非误报 done。
- `fingerprint.py`：`renderer_version` 现在含渲染管线源码指纹（`-impl-<sha16>-logos-<hash>`），
  布局/压缩实现变更会改变 renderer 标识，跨部署恢复的 `renderer_changed` 检测不再有盲区。
- `app.py::/api/assets/{id}/output` 增加 `variant=full` 分支，按字节返回成品文件
  （`Content-Disposition: attachment`）；`variant=preview` 仍为有界预览。下载不再误导性地
  给出降采样图。

## 五、前端行为收口

- `main.tsx` 轮询状态加入 `refresh_pending`，`等待确认` 会自行收敛到「已保存」。
- 下载按钮改用 `variant=full`。
- Ctrl+Z 在输入框内不再 `preventDefault`，保留原生撤销；Ctrl+S 仅非输入态触发保存。
- 照片卡片标注保持 未制作/有成品/有草稿/处理失败，不含 REV/GEN/job ID。

## 六、已执行的检查

| 检查 | 结果 |
| --- | --- |
| `ruff check .` | 通过 |
| `pytest packages/kari-core/tests apps/api/tests apps/immich-ki/worker/tests` | 559 passed, 7 skipped |
| `scripts/verify_flow_layout_parity.py` | 通过（8 fixtures） |
| `apps/immich-ki/web` `tsc --noEmit` + `vite build` | 通过 |
| `apps/web` `tsc -b` + `VITE_API_BASE=/tools/kari-imprint npm run build` | 通过 |
| `node scripts/verify_immich_editor_state.cjs` | 通过 |
| `scripts/verify_immich_editor_browser.py`（Playwright + 截图） | 通过 |
| `scripts/verify_immich_album_navigation.py`（Playwright） | 通过 |
| `git diff --check` | 通过 |

浏览器截图产物：`artifacts/immich-editor/desktop.png`、`mobile.png`、`save-payloads.json`。

## 七、关键行为验证（新增用例）

- `test_validate_immich_key_rejects_malformed_identity`：`{}`/`[]`/数字/空串 email 一律
  `key_identity_invalid`。
- `test_resolve_owner_from_key_requires_string_email`：非字符串 email 不持久化、不绑定 owner。
- `test_owner_recovers_at_runtime_without_restart`：启动时 owner 解析失败，Immich 恢复后下次登录
  即恢复，无需重启。
- `test_repeated_identical_save_and_render_deduplicates`：相同配置重复保存不递增 revision、
  不新增 generation，端到端幂等。
- `test_sync_requires_output_asset_identity_match`：输出资产解析到错误 library/path 时不判完成。
- `test_sync_done_reechecks_currency_after_confirmation`：确认网络返回后若已有新 revision 落库，
  任务 superseded 而非 done。
- `test_renderer_version_includes_implementation_fingerprint`：renderer 标识含源码指纹。

## 八、剩余风险 / 未完成项

1. 真实 Immich/NAS 端到端（真实 API 只读契约、真实生成、回滚路径）仍未在真实环境验证，留待
   部署阶段；浏览器脚本仍依赖已构建的 `apps/immich-ki/web/dist` 与 mock。
2. `refresh_pending → done` 的完成信号是「输出资产可发现 + 身份匹配 + 在结果相册中」，
   是对「收录完成」的可靠近似，不等价于 Immich 元数据/缩略图刷新完成。
3. 品牌自动识别基于内置品牌注册表 token 匹配；未知品牌会提示手动选择，不做猜测兜底。
4. 草稿持久化仍为本机 localStorage（按用户 + 照片隔离），无跨设备同步；不声称自动保存。
5. 首期未加入「全局默认样式编辑器」，避免「改本图还是改全部」歧义。
