# 相册统一样式（Album Look）与交互 v3

状态：已确认方向（2026-10-20，用户选择：服务端统一样式 + 例外；改动后标为过期、确认后批量重生成；草稿存服务端；手机端底部页签 + 横向样式条）。
依据：同类产品调研（Lightroom Sync/Copy、Apple 照片拷贝编辑、VSCO Recipes、Darkroom 批量、OneLine/小米水印、Immich 选中栏与上传面板）与当前界面的任务走查。

## 1. 心智模型

- 每个源相册有一份 **统一样式**（look）。
- 相册里的每张照片只有两种状态：
  - **跟随**：成品 = 统一样式。统一样式改了，它跟着变。
  - **例外**：只记录与统一样式的差异（patch）。统一样式改了，例外照片只更新自己没改过的部分。
- 署名等“单张绑定”内容不进入统一样式的传播（例外里改的署名保留）。
- 统一样式改动后，已生成成品但与新结果不一致的照片标为 **过期**；用户确认后批量重新生成，不自动改 Immich 里的成品。
- 草稿（未保存的修改）存服务端，跨设备可见；草稿不写入 Immich。

照片状态（单一状态机，用于角标/筛选/托盘）：

| 状态 | 含义 |
|---|---|
| 未生成 | 相册里还没有成品（跟随统一样式，等待生成） |
| 草稿 | 有服务端草稿（未保存的修改） |
| 处理中 | 排队 / 渲染 / 写入 / 等待 Immich 收录 |
| 已完成 | 成品已在 Immich 确认，且与当前统一样式（+例外）一致 |
| 过期 | 已有成品，但统一样式或例外改动后与当前结果不一致 |
| 失败 | 最近一次生成失败（显示原因，可重试） |

“例外”是独立于上表的标记（角标“已调整”）。

## 2. 存储（worker SQLite，user_version 1 → 2，向前迁移）

- `album_looks(album_id PK, revision INT, config TEXT, hash TEXT, updated TEXT)`。
- `asset_looks(asset_id PK → assets.id, album_id TEXT NOT NULL, patch TEXT NULL)`：patch 为 NULL ⇒ 跟随；非 NULL ⇒ 例外差异。
- `drafts(asset_id PK, config TEXT, updated TEXT)`（面板单一 owner，无需再按账户分）。
- `render_batches(asset_id PK, album_id TEXT, created TEXT)`：批量生成的待入队列表，由后台按队列余量逐个入队（避免 `queue_full`）。
- 现有 `assets/configs/jobs` 不变：`configs` 仍保存“已解析、已保存”的完整配置及其 revision，渲染流水线不受影响。

## 3. 差异（patch）语义 — 仅 Python 实现（`immich_ki/look.py`）

- `diff(base, target) -> patch`，`apply(base, patch) -> (config, dropped_paths)`。
- 对象逐键递归；仅 target 有的键 → 整棵子树写入；仅 base 有的键 → 删除标记 `{"$delete": true}`；两边都是对象 → 递归；其余按值比较（数组整体当作值）。
- `regions` 数组按 `id` 视为映射（保持 base 中的顺序，新增 region 追加在末尾）。
- apply 时父级在 base 中不存在的路径 → 跳过并记入 `dropped_paths`（例如统一样式变成“纯留白”后例外对信息条的修改）。
- apply 结果必须通过 `Service.validate`；不通过时退回统一样式本身并返回 `conflict: true`。
- `overrides`：patch 的叶子路径列表（`/` 分隔，regions 用 id，如 `regions/footer/slots/primary-start/style/color`、`canvas/margins`），供前端判定哪些分区“已调整”。

## 4. API（新增 / 变更）

所有 album id 为 UUID；结果相册不可作为来源（沿用 `result_album_read_only`）。

- `GET /api/albums/{album}/look` → `{revision, config|null}`。
- `PUT /api/albums/{album}/look` `{expectedRevision, config}` → `{revision, config, impact}`；
  `impact = {follow, exceptions, stale}`（保存后，本相册已绑定照片中跟随数、例外数、因此变为过期的数量）。
- `GET /api/albums/{album}/summary` → `{total, counts: {none, draft, busy, done, stale, failed}, exceptions, look: {revision}|null}`；
  遍历相册中全部可处理照片（与图库同一 `processable` 规则），短缓存（≤10 s）。
- `GET /api/assets?album=…`：每项 `status` 新增 `state`（上表之一）、`exception: bool`、`draft: bool`；保留旧字段 `configured/job/published`。
- `GET /api/assets/{id}/config?album=…` →
  `{revision, saved: config|null, look: {revision, config}|null, mode: 'follow'|'exception'|'standalone', overrides: [...], resolved: config|null, draft: config|null, stale: bool, conflict: bool}`；
  `resolved` = apply(当前统一样式, patch)；无统一样式且有旧配置时 `mode='standalone'`（旧数据兼容，等同例外，基准为空）。
- `PUT /api/assets/{id}/config` `{expectedRevision, config, album}`：
  有统一样式时计算 patch（空 ⇒ 跟随），绑定 `asset_looks`，保存 `config` 为新 revision（相同则不递增），清除草稿；
  返回同 GET 的结构。相册还没有统一样式时返回 `look_required`（前端先建统一样式）。
- `POST /api/assets/{id}/follow` `{album, expectedRevision}` → patch 置空，保存解析后的配置；返回同 GET。
- `PUT /api/assets/{id}/draft` `{config, album}`（schema 校验）/ `DELETE /api/assets/{id}/draft`。
- `POST /api/albums/{album}/render` `{scope: 'pending'|'stale'|'failed'|'all'|'ids', assetIds?: [...]}` →
  对目标照片：解析配置 → 保存（如有变化）→ 加入 `render_batches`；有草稿的照片跳过（草稿需用户先保存）；
  返回 `{queued, skipped: {upToDate, drafts, errors: [{assetId, error}]}}`。
- `GET /api/albums/{album}/activity` → `{jobs: [{assetId, id, state, error, generation, updated}], waiting}`：
  本相册未结束的任务 + 最近 15 分钟内结束的任务 + 批量待入队数。前端托盘只轮询这一个接口（替代逐个 `/jobs/{id}`）。

## 5. 交互（immich-ki web）

- **图库头部**：统一样式卡（当前统一样式在代表照片上的实时缩略）+「编辑统一样式」；统计条（未生成 / 草稿 / 处理中 / 已完成 / 过期 / 失败，可点击筛选）；
  主操作按状态给出一个最该做的事：「生成 N 张」「重新生成 N 张过期」「重试 N 张失败」。选中照片时出现与 Immich 一致的选中栏：生成所选 / 恢复统一 / 取消。
- **编辑统一样式模式**：编辑器顶部色条“正在编辑「相册」统一样式 · 影响 N 张（M 张例外保留各自调整）”；预览在代表照片间切换；保存后显示影响与「生成过期的 N 张」。
- **单张检查模式**：右栏顶部显示“跟随统一样式”或“例外 · 已调整 N 项 · 全部恢复统一”；各分区若与统一样式不同显示「↺ 恢复统一」。
  改任何参数即自动成为草稿，保存后若有差异即为例外。Enter = 保存并下一张；`\` 或长按 = 看原图。
- **任务托盘**（右下角，可收起）：计数 + 每张状态 + 失败原因 + 重试；刷新页面后从 activity 恢复。
- **手机**：上方预览（左右滑切换照片、长按看原图），横向样式条，底部页签「样式 / 版式 / 信息 / 外观」，主按钮常驻底部。
- **键盘**：胶片条使用单一 Tab 停靠点（方向键在条内移动）；返回图库时焦点回到刚编辑的照片；图库方向键移动、Enter 打开、`e` 编辑统一样式；j/k = 上一张/下一张。

## 6. 本轮一并修复（任务走查发现）

- 轮询 effect 依赖导致请求互相取消、角标卡在“处理中”（改为相册 activity 单请求轮询）。
- “保存并下一张”产生假草稿（陈旧闭包）。
- 批量粘贴整体覆盖单张设置（由统一样式 + 例外取代）。
- 等待收录的提示比实际多停约 10 秒（activity 轮询节奏）；“首次保存即提示将更新已有成品”；“保存 0 份草稿”；筛选缺“处理中”；
  相册不跨会话记住；失败无原因 / 无重试；样式卡过小、选中态过亮；“文字”分区默认展开导致右栏过长。

## 7. 验收

worker 单测（diff/apply 往返、例外在统一样式变化后的解析、过期判定、批量入队不超队列上限、迁移 v1→v2 保留旧配置为 standalone）；
前端状态脚本与 Playwright 走查 T1–T5 重跑；AGENTS.md 全部检查。部署验证由 NAS agent 执行。
