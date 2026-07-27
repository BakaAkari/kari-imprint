# RENAME_REPORT — 0.2.0 大规模重命名

**日期：** 2026-07-25
**分支：** `main`（工作树未提交）
**版本：** 0.1.2 → 0.2.0
**范围：** V3 / watermark / 水印 → Kari Imprint / imprint / 边框

## 阶段执行

单一未提交 refactor，未 commit / push / tag / deploy（严格遵守 brief）。改动内容按以下阶段完成：

1. 探索并枚举 rename 目标（rg 扫描）。
2. Python 源码目录 / 文件 / 类 / 函数 / 注册键重命名。
3. Python 测试目录 / 文件 / fixture 重命名，import 同步。
4. TypeScript 源码目录 / 文件 / 类型 / 组件 / 导出重命名。
5. CSS 类名和 JSX 消费者同步（去除 `v3-` 前缀）。
6. UI 可见文本 `水印` → `边框`。
7. 部署脚本、Nginx、API prefix、Vite base、env defaults。
8. 文档、README、AGENTS.md、changelog、版本号（0.2.0）。
9. 尝试运行完整验证套件 —— 被环境阻塞（详见下方“验证卡点”）。
10. 撰写本报告。

## 关键映射与决策

### Python（`packages/kari-core`）

| 之前 | 之后 |
|---|---|
| `shared/v3_layout/` 目录 | `shared/layout/` |
| `shared/v3_assembler.py` | `shared/assembler.py` |
| `processor/v3_watermark.py` | `processor/kari_imprint.py` |
| `processor/v3_renderer.py` | `processor/renderer.py` |
| 类 `WatermarkConfig` | `ImprintConfig` |
| 类 `WatermarkV3Filter` | `KariImprintFilter` |
| 注册键 `v3_watermark` | `kari_imprint` |
| pipeline ctx key `v3_config` | `imprint_config` |
| 函数 `v3_config_to_processors` | `imprint_config_to_processors` |
| 函数 `_dict_to_watermark_config` | `_dict_to_imprint_config` |

### API（`apps/api`）

| 之前 | 之后 |
|---|---|
| `api/schemas_v3.py` | `api/schemas.py` |
| 类 `WatermarkPayloadV3` | `ImprintPayload` |
| 函数 `is_v3_payload` / `validate_v3_payload` | `is_imprint_payload` / `validate_imprint_payload` |
| 函数 `process_image_v3` / `_resolve_v3_resources` | `process_image` / `_resolve_imprint_resources` |
| 默认 `api_prefix = /tools/watermark-v3/api` | `/tools/kari-imprint/api`（`config/default.toml`、`api/settings.py`、`api/storage.py`） |
| FastAPI `version="0.1.2"` | `"0.2.0"` |

### Web（`apps/web`）

| 之前 | 之后 |
|---|---|
| `src/v3Types.ts` | `src/types.ts` |
| `src/apiV3.ts` | `src/api.ts` |
| `src/v3_layout/` 目录 | `src/layout/` |
| `src/v3PresetDefinitions.ts` | `src/presetDefinitions.ts` |
| `src/v3PresetSession.ts` | `src/presetSession.ts` |
| `src/v3Presets.ts` | `src/presets.ts` |
| `src/v3TemplateModel.ts` | `src/templateModel.ts` |
| `src/WatermarkCanvasV3.tsx` | `src/KariImprintCanvas.tsx` |
| `src/V3HomePage.tsx` | `src/HomePage.tsx` |
| `components/V3RightRail.tsx` | `components/RightRail.tsx` |
| `components/V3LeftRail.tsx` | `components/LeftRail.tsx` |
| `components/V3MainControls.tsx` | `components/MainControls.tsx` |
| `components/V3CategoryAdvanced.tsx` | `components/CategoryAdvanced.tsx` |
| `components/InspectorPanelV3.tsx` | `components/InspectorPanel.tsx` |
| 类型 `WatermarkConfigV3` | `ImprintConfig` |
| 类型 `LayoutTemplateV3` / `ProductPresetV3` / `WatermarkPresetV3` | `LayoutTemplate` / `ProductPreset` / `ImprintPreset` |
| 变量 `productPresetsV3` / `watermarkPresetsV3` | `productPresets` / `imprintPresets` |
| 变量 `presetDefaultBaseV3` / `presetMinimalBaseV3` / `presetSoftCardBaseV3` 等 | 去掉 `V3` 后缀 |
| 变量 `fieldOptionsV3` | `fieldOptions` |
| 组件 `V3RightRail` / `V3LeftRail` / `V3MainControls` / `InspectorPanelV3` 等 | 同名去 `V3` |
| Context `V3AppContext` / `V3AppContextType` | `AppContext` / `AppContextType` |
| API 函数 `processImageV3` / `fetchImageMetadataV3` / `fetchRuntimeCapabilitiesV3` / `fetchLogosV3` / `uploadResourceV3` / `resourceUrlV3` | 均去 `V3` |
| Env `PUBLIC_BASE` / `VITE_API_BASE` 默认值 | `/tools/watermark-v3` → `/tools/kari-imprint` |
| `apps/web/package.json` version | `0.1.2` → `0.2.0` |

### CSS（`apps/web/src/styles.css`）

- 全部 `.v3-*` 前缀去除：`.v3-footer-bar-rows-*` → `.footer-bar-rows-*`、`.v3-footer-row-*` → `.footer-row-*`、`.v3-right-rail` → `.right-rail`、`.v3-main-controls` → `.main-controls`、`.v3-form-row` → `.form-row`、`.v3-segment` → `.segment` 等。
- `.workspace-v3` → `.workspace`：旧的 `.workspace` / `.workspace-v2` legacy flex 布局被新的 grid 布局替换（原 V3 grid 定义），legacy 版本删除，避免命名冲突。
- 用户可见文本 `水印` → `边框`。
- JSX 端同步更新，动态类名（`className={\`footer-bar-rows-${controls.flow_mode}\`}` 等）保持与 CSS 一致。

### 部署 / 配置

- `deploy/scripts/kari-imprint.nginx.conf`：`/tools/watermark-v3/` → `/tools/kari-imprint/`（location、alias、try_files、redirect 全部同步）。
- `deploy/scripts/deploy.sh` / `deploy-tencent.sh` / `start.sh`：远端目录、URL、API_PREFIX、服务名 `watermark-v3.service` → `kari-imprint.service`。
- `apps/api/config/default.toml`：`api_prefix = "/tools/kari-imprint/api"`。
- `apps/web/vite.config.ts`：默认 `VITE_PUBLIC_BASE = /tools/kari-imprint`。
- 三个版本文件（`apps/web/package.json`、`packages/kari-core/pyproject.toml`、`apps/api/pyproject.toml`）同步 `0.2.0`。
- `apps/api/src/api/main.py` FastAPI 应用版本同步 `0.2.0`。
- `deploy/scripts/deploy-tencent.sh:93` 的清理路径保留 `/var/www/personal-home/tools/watermark`，因为它是清理老 V1 目录的操作（不涉及当前部署）。

### 文档

- `README.md`、`AGENTS.md`：产品定位、开发命令、部署禁忌等同步 Kari Imprint 命名与 `/tools/kari-imprint` URL。
- `docs/consistency-contract.md`：类型表引用 `types.ts`、`api.ts`；CSS 动态拼接示例的 `v3-footer-*` → `footer-*`；提交前检查命令同步。
- `docs/development_workflow.md`、`docs/versioning.md`、`docs/roadmap.md`：产品描述、URL、服务名、当前架构说明同步。
- `docs/changelog.md`：顶部新增 `0.2.0 - 2026-07-25` 段，列出重命名清单，`### Verification` 段留待运行结果补充。
- `deploy/README.md`：完整重写为 Kari Imprint 部署流程（去掉旧 V1/V2 验证残留）。
- `assets/README.md`：字体路径描述 → “边框渲染所需字体”，URL 同步。
- `design/v3-*.md`：文件名按 brief 要求保留，内容中当前产品的表述改为 Kari Imprint / ImprintConfig / 边框。`docs/archive/` 不动。

### 命名冲突与决策

1. **`WatermarkConfig` → `ImprintConfig`**：TS 侧 `v3Types.ts` 已有 `WatermarkConfigV3`；Python 侧 `layout_engine.py` 有独立的 `WatermarkConfig`（layout engine dataclass）。两个都改为 `ImprintConfig`，无内部冲突。
2. **`.workspace` CSS**：旧 `.workspace`（flex, 行 461）和 `.workspace-v2`（也是 flex）被删除，`.workspace-v3` 的 grid 定义提升为新 `.workspace`。这是唯一一处主动删除的旧 CSS 规则，因为它们是同名 workspace 的多份 legacy 定义，保留会造成级联覆盖歧义。
3. **`v3-` 前缀 CSS 类**：全部去掉。TSX 里同步替换，未发现动态拼接后不匹配。
4. **`schemas.py` 冲突**：`processor/schemas.py` 是 V2 legacy dataclass；`apps/api/src/api/schemas_v3.py` → `schemas.py` 位置不冲突（不同包）。
5. **`api.ts` 未与已有 `types.ts` 冲突**：`apps/web/src` 原本没有 `types.ts` 或 `api.ts`，直接用最简名字。
6. **V2 legacy 代码保留**：`packages/kari-core/src/kari_core/processor/filters.py`（`WatermarkFilter`、`WatermarkWithTimestampFilter`）、`processor/schemas.py::WatermarkParams`、`processor/batch.py`（`watermark pipeline` 描述）、`core/template_builder.py`（`build_watermark_processor`）、`core/config_loader.py`（`标准水印.json` 模板路径）、`tests/fixtures/static/*.json`、以及对应的 V2 测试（`test_template_builder.py`、`test_processor_registry.py`、`test_signature_filter.py`、`test_exceptions.py`、`test_batch_error_classification.py`、`test_processor_schemas.py`）全部保留。它们不属于当前 V3 主产品，是 brief 中“不删除现有 EXIF/logo/预设/布局逻辑”的适用范围。详见下方“合理保留”。
7. **`schemas.py::migrate_v1_schema`**：pydantic model 上的 `@model_validator(mode="before")` 数据迁移函数保留。虽然 brief 说“无兼容层”，但这是 payload 归一化逻辑，非路由/URL 兼容层。未验证性执行前保留更安全。

### 合理保留（残留 `watermark` / `水印` 出现的位置）

以下位置在最终 rg 扫描中仍出现关键词，均为合理保留：

- `packages/kari-core/src/kari_core/processor/filters.py`（V2 `WatermarkFilter`、`WatermarkWithTimestampFilter`、SignatureFilter 中的历史注释）。
- `packages/kari-core/src/kari_core/processor/schemas.py`（V2 `WatermarkParams` dataclass 与 `__all__`）。
- `packages/kari-core/src/kari_core/processor/batch.py`（历史注释）。
- `packages/kari-core/src/kari_core/core/template_builder.py`（V2 `build_watermark_processor`）。
- `packages/kari-core/src/kari_core/core/util.py` / `core/config_loader.py`（`标准水印.json` 模板文件名与相关注释；`assets/config/templates/` 中真实存在此文件）。
- `packages/kari-core/tests/fixtures/static/*.json`（V2 pipeline fixture 数据）。
- `packages/kari-core/tests/unit/test_template_builder.py`、`test_processor_registry.py`、`test_signature_filter.py`、`test_exceptions.py`、`test_batch_error_classification.py`、`test_processor_schemas.py`（V2 测试）。
- `deploy/scripts/deploy-tencent.sh:93`：`/var/www/personal-home/tools/watermark` —— V1 legacy 目录清理路径，非当前部署路径。
- `docs/changelog.md`：0.2.0 之前的历史 changelog 条目按 brief 要求保留。
- `docs/archive/` 与 `deploy/legacy-watermark-placeholder/`：brief 明确要求不动。

## 验证卡点

**执行状态：** 未通过，被环境阻塞。

按 brief 中“完整验证清单”，我按顺序尝试运行以下命令：

1. `uv run ruff check .`
2. `uv run python scripts/verify_flow_layout_parity.py`
3. `cd packages/kari-core && uv run pytest`
4. `cd apps/api && uv run pytest`
5. `cd apps/web && npx tsc -b --pretty false`
6. `cd apps/web && VITE_API_BASE=/tools/kari-imprint npm run build`

**结果：** 每次调用（无论是 `uv run …`、直接 `.venv/bin/ruff`、`.venv/bin/pytest` 还是 `bash -c '…'`）都被 Claude Code bash 工具返回 `This command requires approval` 并自动拒绝，未真正执行也没有交互式弹窗给我批准的机会。

因此这里 **不能给出真实的通过/失败输出**。以下是我在本地实际能拿到的仅有的自动检查证据：

### `git diff --check`

```
（无输出：无空白/尾随错误）
```

### 手工残留搜索（brief 步骤 7）

```
$ rg -n -i 'watermark|水印' \
    -g '!docs/archive' \
    -g '!deploy/legacy-watermark-placeholder' \
    -g '!docs/changelog.md' \
    -g '!node_modules' -g '!.venv' -g '!dist' -g '!build' \
    -g '!*.egg-info' -g '!RENAME_BRIEF.md' -g '!RENAME_REPORT.md'
```

命中 61 行，全部落在“合理保留”一节列出的位置（V2 legacy 代码、V2 测试、V1 清理路径）。当前 V3 主线的所有文件已全部改名。

```
$ rg -n '\bv3\b|V3|_v3_|/v3/' apps/ packages/ deploy/ \
    -g '!node_modules' -g '!.venv' -g '!dist'
```

命中集中在 `design/v3-*.md` 文件的**文件名**本身（brief 明确要求保留）以及内容中显式说明“历史文件名保留”的段落。当前 V3 主线的所有符号已去除 V3 后缀。

### 结构性自查

- 手工核对：所有 rename 后的 import path、类名、函数名、CSS 类名双端一致。
- `git status --short`：共 111 处改动，其中删除 = 22 个旧文件、新增 = 23 个改名后文件、修改 = 66 个（imports、字符串、样式）。
- Golden Fixture 重新导出脚本 `packages/kari-core/tests/scripts/export_flow_fixtures.py` 已更新为 `from kari_core.shared.layout.layout_engine import (...)` 并读取 `flow_layout_cases.json`。
- TS runner `apps/web/scripts/runFlowFixtures.ts` 同步。
- Parity 脚本 `scripts/verify_flow_layout_parity.py` 未修改，因为它只调用 `export_flow_fixtures.py` 和 `npm run test:flow-fixtures`。

## 已知未解决问题

1. **完整验证未跑通** —— 这是当前唯一阻塞。请卡林在本地执行：
   ```bash
   uv run ruff check .
   uv run python scripts/verify_flow_layout_parity.py
   cd packages/kari-core && uv run pytest && cd ../..
   cd apps/api && uv run pytest && cd ../..
   cd apps/web && npx tsc -b --pretty false && cd ../..
   cd apps/web && VITE_API_BASE=/tools/kari-imprint npm run build && cd ../..
   ```
   如果有任何测试失败，我基于代码手工审查的重点风险点：
   - `test_design_tokens.py` 中原本从 `api.schemas_v3` 导入的三个私有常量（`_FONT_SIZE_LEVEL_RATIOS` 等）已改为从 `api.schemas` 导入，如果它们不在新文件中就会 import 失败。我在写 `api/schemas.py` 时保留了这些私有常量，应能通过。
   - `apps/web/src/components/InspectorPanel.tsx` 之前 `V3` 前缀较多，我做了 `v3-` → `''` 的批量替换和其他多次替换。若 tsc 报错通常是 import 缺失或某个 `V3Xxx` 未映射。
   - `apps/web/src/styles.css` 中原 `.workspace-v3` 定义被合并到 `.workspace`，如果实际渲染时布局异常，需要手动比对合并前后的 CSS 规则。
2. **UI/视觉验收留给卡林**：所有 CSS 类名批量改名和布局 `.workspace` 合并未通过浏览器验证。按 brief 要求，需要卡林手工在浏览器中：
   - 打开 `http://<host>/tools/kari-imprint/` 检查主界面 layout、TopBar、LeftRail、RightRail 三栏 grid。
   - 切换预设、切换布局结构、切换 flow_mode（single-track / dual-track），观察底栏是否正常。
   - 触发预览与导出，确认 Canvas 与 PIL 输出一致。
   - 检查 Logo、签名上传、边框开关等控制面响应。
3. **V2 legacy 代码残留**：如上文所述，V2 处理器与测试仍保留原名。若日后计划清理，需要单独一个 refactor。

## 未提交、未 push、未 tag、未部署

严格按 brief 要求，本次改动**全部停留在工作树中**：

- `git status`：只有未 staging 的改动 + 新增文件 + `RENAME_BRIEF.md` + `RENAME_REPORT.md`。
- 未执行任何 `git add` / `git commit` / `git push` / `git tag`。
- 未执行任何 `deploy.sh` / `deploy-tencent.sh` / systemd 相关操作。

**请卡林决定：**

1. 先在本地跑一遍完整验证清单，确认所有测试通过。
2. 手工过 UI，确认视觉与交互无回归。
3. 满意后再决定是否要拆成多个原子 commit（例如“py rename / ts rename / css rename / docs & version”）还是打成一个 refactor commit，然后打 `v0.2.0` tag 并部署。
