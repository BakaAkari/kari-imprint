# Stash Rebase 任务 Brief

## 背景

之前一轮做过大规模重命名重构（V3/watermark → Kari Imprint/imprint），提交在工作树里未 commit。
但**在做重命名之前**，工作树有 18 个未提交的 UI 迭代改动被我 stash 存起来（`stash@{0}`）。
现在需要把 stash 里的改动**合并**到当前重命名后的工作树上。

## 关键状态

- 当前工作树：**重命名已完成**（所有 V3/watermark 类名/文件名/目录名已改为 imprint/无V3后缀），无 commit
- Stash 内容：`stash@{0}: WIP: logo blank area investigation (pre-rename stash 2026-07-25)`
- Stash 里引用**旧名字**（`WatermarkConfigV3`、`v3_layout/`、`WatermarkCanvasV3`、`v3PresetDefinitions` 等）
- 直接 `git stash pop` 会大量冲突（旧路径已不存在，旧符号已改名）

## 备份

- `/tmp/kari-imprint-stash-backup.patch` — stash 完整 patch 副本
- `/tmp/kari-imprint-rename-current.patch` — 当前重命名后 diff 副本

## 你的任务

**将 stash 里的所有改动应用到当前重命名后的工作树，同时按新名字映射符号和路径。不要 pop stash，通过读 patch 手工分析并 apply。**

## 路径映射表

| 旧路径（stash 中） | 新路径（当前工作树） |
|---|---|
| `apps/api/src/api/main.py` | 同（路径不变，需合并改动） |
| `apps/web/scripts/verifyPresetContract.mts` | 同 |
| `apps/web/src/V3HomePage.tsx` | `apps/web/src/HomePage.tsx` |
| `apps/web/src/WatermarkCanvasV3.tsx` | `apps/web/src/KariImprintCanvas.tsx` |
| `apps/web/src/apiV3.ts` | `apps/web/src/api.ts` |
| `apps/web/src/autoLogo.ts` | 同 |
| `apps/web/src/components/InspectorPanelV3.tsx` | `apps/web/src/components/InspectorPanel.tsx` |
| `apps/web/src/components/V3CategoryAdvanced.tsx` | `apps/web/src/components/CategoryAdvanced.tsx` |
| `apps/web/src/components/V3MainControls.tsx` | `apps/web/src/components/MainControls.tsx` |
| `apps/web/src/components/V3RightRail.tsx` | `apps/web/src/components/RightRail.tsx` |
| `apps/web/src/designTokens.ts` | 同 |
| `apps/web/src/styles.css` | 同 |
| `apps/web/src/v3PresetDefinitions.ts` | `apps/web/src/presetDefinitions.ts` |
| `apps/web/src/v3Types.ts` | `apps/web/src/types.ts` |
| `apps/web/src/v3_layout/layoutEngine.ts` | `apps/web/src/layout/layoutEngine.ts` |
| `packages/kari-core/src/kari_core/processor/v3_renderer.py` | `packages/kari-core/src/kari_core/processor/renderer.py` |
| `packages/kari-core/src/kari_core/shared/v3_layout/layout_engine.py` | `packages/kari-core/src/kari_core/shared/layout/layout_engine.py` |
| `packages/kari-core/tests/test_v3_layout/test_layout_engine.py` | `packages/kari-core/tests/test_layout/test_layout_engine.py` |

## 符号映射表（在 stash 改动中出现，需要重命名后再合并）

Python:
- `WatermarkConfig` → `ImprintConfig`
- `WatermarkV3Filter` → `KariImprintFilter`
- `v3_watermark` (注册名) → `kari_imprint`
- `v3_config` (ctx key) → `imprint_config`
- `v3_config_to_processors` → `imprint_config_to_processors`
- `_dict_to_watermark_config` → `_dict_to_imprint_config`
- 模块 import：`from kari_core.processor.v3_renderer` → `from kari_core.processor.renderer`
- 模块 import：`from kari_core.processor.v3_watermark` → `from kari_core.processor.kari_imprint`
- 模块 import：`from kari_core.shared.v3_layout.layout_engine` → `from kari_core.shared.layout.layout_engine`
- 模块 import：`from kari_core.shared.v3_assembler` → `from kari_core.shared.assembler`
- `process_image_v3` / `_resolve_v3_resources` → `process_image` / `_resolve_imprint_resources`
- `WatermarkPayloadV3` → `ImprintPayload`
- `is_v3_payload` / `validate_v3_payload` → `is_imprint_payload` / `validate_imprint_payload`
- `from api.schemas_v3` → `from api.schemas`

TypeScript:
- `WatermarkConfigV3` → `ImprintConfig`
- `LayoutTemplateV3` → `LayoutTemplate`
- `ProductPresetV3` → `ProductPreset`
- `WatermarkPresetV3` → `ImprintPreset`
- `productPresetsV3` → `productPresets`
- `watermarkPresetsV3` → `imprintPresets`
- `fieldOptionsV3` → `fieldOptions`
- `presetDefaultBaseV3`, `presetMinimalBaseV3`, `presetSoftCardBaseV3` (等 V3 后缀 base) → 去掉 V3 后缀
- 组件 `V3RightRail` / `V3LeftRail` / `V3MainControls` / `InspectorPanelV3` / `V3CategoryAdvanced` / `V3HomePage` → 去掉 V3 前缀（`RightRail` / `LeftRail` / `MainControls` / `InspectorPanel` / `CategoryAdvanced` / `HomePage`）
- Context `V3AppContext` / `V3AppContextType` → `AppContext` / `AppContextType`
- `processImageV3` / `fetchImageMetadataV3` / `fetchRuntimeCapabilitiesV3` / `fetchLogosV3` / `uploadResourceV3` / `resourceUrlV3` → 均去 V3
- import：`from './v3Types'` → `from './types'`
- import：`from './apiV3'` → `from './api'`
- import：`from './v3PresetDefinitions'` → `from './presetDefinitions'`
- import：`from './v3PresetSession'` → `from './presetSession'`
- import：`from './v3Presets'` → `from './presets'`
- import：`from './v3TemplateModel'` → `from './templateModel'`
- import：`from './v3_layout/...'` → `from './layout/...'`
- import：`from './WatermarkCanvasV3'` → `from './KariImprintCanvas'`
- import：`from './V3HomePage'` → `from './HomePage'`
- import：`from './components/V3RightRail'` etc → 对应新名字

CSS 类名（styles.css）:
- 所有 `.v3-*` 前缀 → 去掉 `v3-`（如 `.v3-footer-bar-rows-*` → `.footer-bar-rows-*`）
- `.inspector-v3` → `.inspector-imprint`
- `.workspace-v3` 已被合并到 `.workspace`

## 冲突场景处理

如果 stash 改动的行**与当前重命名后的行冲突**：
- 保留 stash 里的**逻辑意图**（用户 UI 迭代）
- 但用**当前重命名后的符号/路径**

例如，stash 里有：
```
import { WatermarkConfigV3 } from './v3Types';
```
当前重命名后已经是：
```
import { ImprintConfig } from './types';
```
Stash 里如果新增使用 `WatermarkConfigV3` 的地方，应该改为使用 `ImprintConfig`（相同类型不同名字）。

## 执行方法

1. 先读 `/tmp/kari-imprint-stash-backup.patch` 全文理解 stash 里做了什么
2. 逐个文件读 patch chunk 分析改动意图
3. 打开对应的新路径文件，把 stash 里的改动**语义等价**地应用上去
4. 每个文件用 Read + Edit 精细操作，不要用 patch/apply 命令
5. 每处理完一个大文件（如 V3RightRail.tsx → RightRail.tsx 有 266 行改动），跑一次 `npx tsc -b --pretty false` 快速检查该文件的语法/类型
6. 全部完成后跑完整验证：
   ```bash
   cd /Users/baka_akari/code/kari-imprint
   uv run ruff check .
   uv run python scripts/verify_flow_layout_parity.py
   cd packages/kari-core && uv run pytest
   cd apps/api && uv run pytest
   cd apps/web && npx tsc -b --pretty false
   cd apps/web && VITE_API_BASE=/tools/kari-imprint npm run build
   ```

## 完成后

在项目根写 `STASH_REBASE_REPORT.md` 记录：
- 每个文件的改动摘要
- 冲突处理决策
- 6 项验证命令的真实输出摘要
- 如果有 stash 改动无法合并的（比如引用了完全被删掉的旧 CSS 类），列出来

## 禁忌

- **不 commit, push, tag, deploy**
- **不 pop stash**（保持 stash 完好作为 fallback）
- **不用 patch/apply/git apply**——所有改动手工用 Edit
- **不使用 emoji**
- **不修改 archive、legacy 目录**
- **验证失败不得声称完成**

## Stash 内容概览（18 个文件）

- `apps/api/src/api/main.py` (+88/-变化) — logo 变体支持（`_parse_logo_stem`、`_find_logo_file`、`list_logos` 返回结构变化、`get_builtin_logo` 加 variant/dark 参数）
- `apps/web/scripts/verifyPresetContract.mts` (+7)
- `apps/web/src/V3HomePage.tsx` (+2)
- `apps/web/src/WatermarkCanvasV3.tsx` (+140/-变化)
- `apps/web/src/apiV3.ts` (+14)
- `apps/web/src/autoLogo.ts` (+85)
- `apps/web/src/components/InspectorPanelV3.tsx` (+7)
- `apps/web/src/components/V3CategoryAdvanced.tsx` (-12)
- `apps/web/src/components/V3MainControls.tsx` (+165)
- `apps/web/src/components/V3RightRail.tsx` (+266) — 最大改动
- `apps/web/src/designTokens.ts` (+1)
- `apps/web/src/styles.css` (+118)
- `apps/web/src/v3PresetDefinitions.ts` (+22)
- `apps/web/src/v3Types.ts` (+20)
- `apps/web/src/v3_layout/layoutEngine.ts` (+58)
- `packages/kari-core/src/kari_core/processor/v3_renderer.py` (+110)
- `packages/kari-core/src/kari_core/shared/v3_layout/layout_engine.py` (+64)
- `packages/kari-core/tests/test_v3_layout/test_layout_engine.py` (+5)

现在开始。
