# 重命名任务 Brief（一次性执行）

## 目标

把项目主功能从 "watermark / 水印" 全面重命名为 "边框 / Kari Imprint"（对外品牌），代码内所有 V3 后缀去掉，URL 改为 `/tools/kari-imprint/`。这是内部大规模机械+结构性重构，不是产品迁移；没有正在公开运营的版本，无需保留兼容性、旧 URL、旧 API prefix、旧模板 ID、旧 alias。

## 起点

- 分支：`main`
- 工作树：**干净**（进 stash 前已确认）
- 本地版本：`0.1.2`（apps/web/package.json、packages/kari-core/pyproject.toml、apps/api/pyproject.toml）
- 目标版本：**`0.2.0`**（打破性重命名，主/次版本递增）
- 目标提交：一个连贯的 refactor commit（或按阶段拆 3–4 个原子 commit，你可自行判断）
- **不 push、不 tag、不部署**——完成本地改动 + 全部自动化验证通过 + 更新 Changelog 后停止，等待卡林验收。

## 重命名规则

| 维度 | 之前 | 之后 |
|---|---|---|
| 仓库/包名 | `kari-imprint` | 不变 |
| 产品品牌 | Kari Imprint（不变） | Kari Imprint |
| 主功能中文 | 水印 / 水印工具 | 边框 / 边框工具 |
| 主功能英文 | Watermark / watermark tool | Kari Imprint / info-frame（作为技术词根） |
| URL 前缀 | `/tools/watermark-v3/` | `/tools/kari-imprint/` |
| API prefix | `/tools/watermark-v3/api` | `/tools/kari-imprint/api` |
| Vite base | `VITE_API_BASE=/tools/watermark-v3` | `VITE_API_BASE=/tools/kari-imprint` |
| 类名/文件名/目录 V3 后缀 | 全部保留 V3 | **全部去掉 V3** |

## 关键映射（举例，非穷举，请自行 rg 全项目）

### TypeScript
- `WatermarkCanvasV3.tsx` → `KariImprintCanvas.tsx`
- `apiV3.ts` → `api.ts`（若不冲突；否则 `imprintApi.ts`）
- `v3PresetDefinitions.ts` → `presetDefinitions.ts`
- `v3PresetSession.ts` → `presetSession.ts`
- `v3Presets.ts` → `presets.ts`
- `v3TemplateModel.ts` → `templateModel.ts`
- `v3Types.ts` → `types.ts`（如与已有 `types.ts` 冲突，用 `imprintTypes.ts`）
- `v3_layout/` 目录 → `layout/`
- `V3HomePage.tsx` → `HomePage.tsx`
- `V3RightRail.tsx` → `RightRail.tsx`
- `V3LeftRail.tsx` → `LeftRail.tsx`
- `V3MainControls.tsx` → `MainControls.tsx`
- `V3CategoryAdvanced.tsx` → `CategoryAdvanced.tsx`
- `InspectorPanelV3.tsx` → `InspectorPanel.tsx`
- 所有 `v3Xxx`、`V3Xxx` 标识符去掉 `v3/V3` 前缀，如与现存符号冲突再取消该项
- 类型/props/state 中的 `watermark*` → 语义合适的替代（`imprint`、`frame`、`overlay`）；用户可见字段用"边框"

### Python
- `v3_watermark.py` → `kari_imprint.py`（或 `imprint.py`）
- `v3_renderer.py` → `renderer.py`
- `v3_layout/` 目录 → `layout/`
- `v3_assembler.py` → `assembler.py`
- 测试目录 `test_v3_layout/` → `test_layout/`
- `test_v3_vertical_watermark.py` → `test_vertical_imprint.py`
- `test_v3_renderer.py`、`test_v3_schema_v2.py`、`test_v3_flow_fixtures.py` 相应去掉 v3
- 所有 `watermark_*`、`_watermark`、`WatermarkXxx` 标识符按语义改为 `imprint_*` 或 `frame_*`

### CSS
- `styles.css` 内所有 `.watermark-*` / `.v3-*` 类名 → 对应新命名
- **和 JSX 动态拼接的类名严格保持一致**（AGENTS.md 强制）

### 部署 / 配置
- `deploy/scripts/kari-imprint.nginx.conf`：`/tools/watermark-v3/` → `/tools/kari-imprint/`
- `deploy/scripts/deploy.sh`、`deploy-tencent.sh`、`start.sh`：所有路径同步
- `apps/api/config/default.toml`：`api_prefix`
- `apps/api/src/api/settings.py`：默认值
- `apps/api/src/api/storage.py`：`public_file_payload` 的默认 `api_prefix`
- `apps/web/src/env.ts`：`PUBLIC_BASE`、`API_PATH` 默认值
- `apps/api/tests/web_api/test_web_api.py`：`API_PREFIX` 常量

### 文档
- `README.md`（根 + `assets/README.md` + `deploy/README.md`）
- `AGENTS.md`（描述、约束、工作流命令）
- `docs/changelog.md`、`docs/roadmap.md`、`docs/consistency-contract.md`、`docs/development_workflow.md`、`docs/versioning.md`
- `design/v3-*.md`：文件名保留（历史设计文档），只改内文对当前功能的表述；不改 archive 目录
- `docs/archive/legacy-web-mvp/*`：**不动**（历史归档）
- `deploy/legacy-watermark-placeholder/`：**不动**（历史占位页目录名保留，内容不涉及）

### Changelog
在 `docs/changelog.md` 顶部新增 `0.2.0 - 2026-07-25` 段：
```
### Changed
- 全面重命名：产品主功能"水印"→"边框"，英文命名 watermark→Kari Imprint / info-frame。
- URL 从 /tools/watermark-v3/ 迁移到 /tools/kari-imprint/。
- 代码去掉 V3 后缀：所有类、文件、目录、变量、CSS 类名。
- 无兼容层，无旧 URL 重定向（尚未公开运营）。

### Verification
（Claude Code 补充实际执行的命令和结果）
```

### 版本号
同时更新为 `0.2.0`：
- `apps/web/package.json`
- `packages/kari-core/pyproject.toml`
- `apps/api/pyproject.toml`

## 强制约束（AGENTS.md）

- **TS 类型 ↔ Python 类型必须同步**
- **设计 token 在 `designTokens.ts` 和 `layout_engine.py`（新目录：`layout/layout_engine.py`）双端同步**
- **CSS 类名必须与 JSX 动态拼接一致**（一次搜到底：改后 `rg -n 'watermark|v3-' apps/web/src` 应只剩注释/文档引用；改类名后 `rg -n <新类名>` 双端都命中）
- **删除功能时全局 rg 清理残留**
- **布局引擎目录改名后，Golden Fixtures 路径同步；跑 `verify_flow_layout_parity.py`**

## 完整验证清单（提交前必跑，全部通过才算完成）

```bash
cd /Users/baka_akari/code/kari-imprint

# 1. Python lint
uv run ruff check .

# 2. Flow Layout parity（关键：TS/Python 同步）
uv run python scripts/verify_flow_layout_parity.py

# 3. Python 单元测试
cd packages/kari-core && uv run pytest
cd ../..
cd apps/api && uv run pytest
cd ../..

# 4. TypeScript 类型检查
cd apps/web && npx tsc -b --pretty false
cd ../..

# 5. Web 构建（新 base）
cd apps/web && VITE_API_BASE=/tools/kari-imprint npm run build
cd ../..

# 6. 空白/尾随检查
git diff --check

# 7. 完整搜索残留（应仅剩合理保留：archive、legacy 占位、changelog 历史条目）
rg -n -i 'watermark|水印' -g '!docs/archive' -g '!deploy/legacy-watermark-placeholder' -g '!docs/changelog.md' -g '!node_modules' -g '!.venv' -g '!dist' -g '!build'
rg -n '\bv3\b|V3|_v3_|/v3/' apps/ packages/ deploy/ -g '!node_modules' -g '!.venv' -g '!dist'
```

如残留出现：审视是否合理（如历史 changelog 条目、archive、外部依赖），不合理就继续清理。

## 完成后的输出

在项目根目录写 `RENAME_REPORT.md`：
- 阶段划分（如果分了 commit）
- 关键决策（命名冲突时怎么取舍）
- 全部验证命令的**真实输出摘要**（不要伪造）
- 已知遗留问题（如果有）
- 未提交、未 push——**留给卡林人工验证 UI/视觉后再决定 tag 和部署**

## 禁忌

- **不 commit push tag deploy**——本次只做本地代码改动 + 自动化验证 + 报告
- **不修改 archive 目录、legacy 占位目录**
- **不做产品逻辑修改**——纯重命名 + 目录重组
- **不引入新的 alias / 兼容层 / 重定向**——直接重命名到位
- **不删除现有 EXIF/logo/预设/布局逻辑**——只改名字
- **不使用 emoji**
- **验证失败不得声称完成**——每个测试都跑到真的绿

## 参考文件

- `AGENTS.md`：项目约束
- `docs/consistency-contract.md`：TS/Python 一致性契约
- `docs/development_workflow.md`：开发工作流
- `packages/kari-core/tests/scripts/export_flow_fixtures.py`：Fixtures 生成
- `scripts/verify_flow_layout_parity.py`：TS/Python parity 校验
