# Immich KI 右侧编辑器：单一入口与无损配置

## 决策

移除“快速字段选择 + 完整高级字段编辑”双重投影，改为同一个配置的分区编辑。所有区域均显示，不只处理第一个 flow。四个 canonical 文字位置都有独立入口；侧栏使用起点/终点标签，避免左、右侧方向反转造成错误描述。单轨模式保留次轨配置并提示不显示。

- 默认文字样式：唯一编辑 `config.defaults`；字号按真实 pixel / level / ratio / auto 模式显示，不把预设模式伪装成比例。
- 字体：唯一选择器，用户修改时同时设置 `font_family` 和 `bold`，避免预览和 Python 成品字重来源不同。加载不自动改旧值。
- 每个区域：位置、布局、间距、内边距仅一个入口。
- 每个内容位置：启用、顺序字段列表、Logo / 签名仅一个入口。局部文字样式显式“跟随默认 / 独立设置”，关闭覆盖写回 `null`。
- 自定义文字：在实际位置添加 `custom_text` 字段，文字保存在该 chip；不会改写另一个 chip 或强行添加至 primary-start。
- 共享自定义文字：保留旧 `config.custom_text` 回退语义。局部空文本按现有渲染器回退到共享文本；若不希望显示该字段，应删除该 chip。没有 chip 时不自动显示。
- 画布：独立折叠区，无重复入口。

## 持久化

`editableConfig()` 与 `serializeEditorConfig()` 都是无损深拷贝，不猜测“空结构是否由编辑器生成”。不删除停用签名、空且带样式的槽、重复 chip 或顺序；不自动补区域。缺少的标准槽仅以虚拟控件展示，用户启用才写入。新增边框/签名由显式按钮触发。

此前 serializer 删除 disabled free region 内 sig1 的逻辑会丢失用户已有资源，已删除。此前“0.01..0.5 与 API 一致”的断言不准确：API 比例接受 0..0.5，现控件按实际 schema 约束。

共享 Web 的 InspectorPanel 保留自身默认样式入口；Immich 仅复用导出的 ContentEditor，不嵌套整个 Inspector。默认 `showStyle=true` 保持共享 Web 行为。

## 代码边界

- `editor-state.ts`：无副作用的配置克隆、区域切换/新增、槽更新与标签。
- `editor.tsx`：Editor 组合、RegionPanel、TextStyle；没有自定义 quick-fields 归一化。
- 共享 `ContentEditor`：字段列表及资源上传；共享行为向后兼容。
- `main.tsx`：导航与请求仍由原逻辑管理，保存调用无损 serializer。

## 验收

- `node scripts/verify_immich_editor_state.cjs`：精确 roundtrip、停用资源、空样式槽、重复/有序 chips、共享文字、继承恢复、缺失槽与无区域。
- `uv run --with playwright python scripts/verify_immich_editor_browser.py`：真实构建 UI + mock HTTP；捕获实际 PUT payload 并交给真实 Python schema；覆盖无改动保存、custom chip、共享回退、局部样式复位、side/single-track、显式添加、桌面/手机截图与溢出。
- `uv run --with playwright python scripts/verify_immich_album_navigation.py`：原有异步导航、取消和 dirty 守卫回归。
- Immich Web build、共享 Web TypeScript 检查、diff whitespace 检查。

截图与保存 payload 在 `artifacts/immich-editor/`（测试数据，不含生产照片/凭据）。生产部署验收由部署记录补充，不以 mocked 测试替代。

## 已部署验收（2026-10-11）

- 镜像 `kari-imprint/immich-ki:m2-editor-20261011-094119`，ID `sha256:9291d06abf399a0e6f03cf2abdf385a11ea13b80a0bb26a3b7613062f24135ba`。
- 基于核验过 ID 的旧 `m2-album-filter-20261011` 镜像，仅 COPY 已验收 dist 至 `/app/web`；后端、数据库 schema 和挂载未变。
- NAS 备份 `/mnt/user/appdata/app-immich-ki-m0-backups/editor-20261011-094119`：Compose、环境文件、配置、资源、SQLite 在线一致性备份（integrity_check=ok）、旧镜像 ID。旧镜像保留。
- 容器 healthy；公网 `/api/health` 返回 `ok:true,error:null`；首页及 JS/CSS 与本地包逐字节一致。
- 真实公网 Chromium 检查：Immich 邮箱、密码和进入图库按钮可见，无页面脚本错误。
- 编辑器浏览器保存回归使用 mock API，实际 PUT payload 由真实 Python schema 校验；不能等同生产照片生成。账户登录后的真实编辑与成品发布由 Kari 实测。
- 本轮未 commit/push，未修改历史遗留的 immich-wm 删除。
