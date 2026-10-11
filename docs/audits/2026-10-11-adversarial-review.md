# Kari Imprint 对抗性审计（2026-10-11）

范围：当前 feat/logo-real-aspect-ratio 的 Immich KI、共享布局/渲染、API schema、认证、发布/恢复、前端状态、测试与此前部署记录。线上仅查询身份绑定布尔值、任务统计；相册接口证据来自同会话前一轮只读实测。未执行线上照片写入、故障注入或跨账号登录。不是无缺陷证明，也不是完整渗透测试。未修改产品代码、未提交或部署。

## 实测门禁

- `uv run --no-sync pytest -q packages/kari-core/tests apps/api/tests apps/immich-ki/worker/tests`：542 passed, 7 skipped，2 warnings。
- `uv run --no-sync python scripts/verify_flow_layout_parity.py`（允许 IPC）：失败 `TS/Python Flow Layout fixture outputs differ`。
- editor browser：失败于启动前 editor-state 的过时断言，期望添加 footer-new；现在禁止第二层边框。
- album navigation browser：运行到 scrollTop === 400 等待超时；不足以直接认定产品滚动恢复故障，需要排除视口/可滚动高度假设。
- Ruff（worker/core/API src）通过，diff check 通过。
- 布局参数变异实测：footer 和 side-right 的 main_alignment/cross_alignment 均不改变输出；side-right 的 track_order 也不改变输出，footer 的 track_order 会改变。
- 线上 owner_bound=False；任务 awaiting_import=1、failed=2、refresh_pending=18。统计不是各任务原因证明。

## 执行链

选择相册 → search/metadata → 照片配置/元数据/预览 → 本地草稿 → PUT config（revision递增）→ POST render（相册归属校验）→ 源文件与资源快照 → 子进程渲染 → checksum/代次校验 → 原子发布 → 等待外部扫描 → 查询输出资产 → 配对相册 → 添加成员 → 请求元数据与缩略图刷新。

## Findings

### P0 条件性越权：owner 空值放行所有有效 Immich 登录账号
`auth.py: immich_login` 的身份约束为 `if panel.owner and identity != panel.owner`。`keyconfig.resolve_panel_config` 从 env 迁移时允许 owner 为空。线上配置确实为空。后续所有操作仍使用固定服务 API key，而非登录用户授权范围。若存在第二个可登录 Immich 用户，即存在越权进入面板的路径；并非匿名绕过，也未尝试利用。

### P1 相册成员校验与真实 API 不匹配（两处）
`albums.py:source` 与 `client.py:add_to_album` 都读取 album.assets。实测当前 Immich 相册详情无 assets 字段，即使显式 withoutAssets=false 也无成员；assetCount 正常。前者误拒绝生成，后者成功添加后仍可能报告失败。GET albums?assetId 的只读实测能正确返回所属相册。测试 FakeImmich 提供了实际接口没有的字段，掩盖问题。

### P1 TS/Python 几何不一致
TS edge reserve 最终为 logoDim + dividerW + 2*itemGap；Python 随后覆盖为 logo_dim + divider_w + item_gap。前端与成品文字区域不同；parity 已真实失败。

### P1 Logo 对称留白修复未完成
水平模式 logo 向内缩 itemGap，外侧空白实际为 padding + itemGap，而分隔线侧仅 itemGap，仍非等距。竖向 divider 仍按 inner.y + logoDim 或末端镜像计算，没有加入 logo gap；不能声称侧栏已修复。需以真实可见图形边界与区域边界分别验收，不能只看截图似乎改善。

### P1 UI 对齐控件无效
main_alignment/cross_alignment 是 schema 字段和 UI 控件，但当前 flow 算法不读取它们；side-bar track_order 也未控制列排序。参数变异证明输出不变。

### P1 退出入口无后端实现
main.tsx 调用 POST /auth/logout；worker 全源无该路由。正常 session 无法通过该按钮主动撤销；实际网络响应需在认证测试中补证，不能把未认证 401 当作退出成功。

### P1 成品同步无完成闭环
_sync 仅写 refresh_pending；自动 reconcile 只处理 awaiting_import，前端轮询也不含 refresh_pending；未见写入 done 的路径。请求刷新成功不等于完成。线上18条 refresh_pending 与该设计一致，不能证明每条上游刷新失败。

### P1 渲染版本标识不随实现变化
settings.renderer_version 仍固定 m0-photo-srgb-v1，Service 只追加 logo hash。相同 logo 的布局/压缩代码变化不会改变 renderer_version；跨部署恢复任务无法靠现有 renderer_changed 检测实现变化。

### P2 单边框规则只在新增 UI 层
addRegion 禁止第二个 frame，但后端仍接受多 region，已有多层配置原样加载。禁止新增不等于整个系统满足单层规则。空 regions 时 UI 仍提示添加边框但按钮已移除，无局部恢复入口（全局重置可恢复但会替换其他草稿）。

### P2 默认/继承呈现不诚实
editor.tsx padding 未设置显示8，实际引擎按条带厚度14%等动态计算；text_direction=null 显示横向，真实语义为跟随区域；新默认四侧margin仍全0，60边距未交付。字号默认/局部继承编辑需区分用户值与派生值。

### P2 多相册输出策略需要明确
同一照片不同相册共用asset配置与成品路径，而job仅记录当次源相册；后续修改会影响所有引用同一输出资产的相册。这符合单资产单输出模型，但不能承诺每个相册有独立水印版本。

### 验证与交付缺口
- 352 tests 是 core/unit 目录，不是352个布局测试；布局测试位于tests/test_layout。
- 浏览器 mock render 请求仍使用 sourceAlbumId='trip'，真实后端UUID校验拒绝该值；浏览器通过不证明真实渲染契约。
- editor browser 前置状态断言过时；导航测试硬编码滚动值，本轮失败。
- 67d96eb 实际只改 main.tsx/style.css 的重置与保存栏，不是承诺的信息架构重构；editor.tsx 未被该提交重构。
- 此前品牌研究无成功检索证据，不能把设计意见称为有来源的竞品研究。
- 部署记录中曾在线 cp SQLite 文件且未用一致性备份API；不能宣称备份经过可恢复验证。最新部署仅备份compose，未演练数据恢复。

## 修复顺序

先补身份绑定与真实相册契约，再修双端布局与几何断言，接着修状态闭环/退出/单边框规则，最后完成面板信息架构和真实浏览器验收。发布门禁应包括真实API只读契约、schema-valid浏览器payload、双端parity和目标平台隔离出图；不能以health=true替代业务验收。
