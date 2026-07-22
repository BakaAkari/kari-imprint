# kari-imprint 一致性开发契约

本文档是项目的**最高优先级开发约束**，从一致性原理出发，系统定义 TS↔Python↔CSS↔API↔视觉渲染 五维一致性规则。

违反本契约的改动不得合并，即使测试通过。现有违反契约的代码视为技术债务，应在后续迭代中修复。

---

## 零、一致性原理

```
                    JSON Schema（唯一真相源）
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    TS 类型定义      Python 类型定义     API 校验模型
          │               │               │
          ▼               ▼               ▼
    前端布局引擎 ←─ Golden Fixtures ─→ 后端布局引擎
          │               │               │
          ▼               ▼               ▼
    Canvas 渲染        视觉回归对比      PIL 渲染
```

**核心原则：每层数据在 TS 和 Python 两侧必须有完全等价的类型、校验和测试。**

---

## 一、TS ↔ Python 类型一致性

### 1.1 共享接口定义

以下类型是**双语言共享接口**，任何一方的修改必须同时更新另一方：

| 接口 | TS 位置 | Python 位置 | 同步方式 |
|---|---|---|---|
| `RegionConfig` | `v3Types.ts` + `layoutEngine.ts` | `layout_engine.py` | 手动 + 审计 |
| `SlotConfig` | `v3Types.ts` + `layoutEngine.ts` | `layout_engine.py` | 手动 + 审计 |
| `StyleConfig` | `v3Types.ts` + `layoutEngine.ts` | `layout_engine.py` | 手动 + 审计 |
| `FlowLayoutConfig` | `v3Types.ts` + `layoutEngine.ts` | `layout_engine.py` | 手动 + 审计 |
| `LogoContent` | `v3Types.ts` + `layoutEngine.ts` | `layout_engine.py` | 手动 + 审计 |
| `SignatureContent` | `v3Types.ts` + `layoutEngine.ts` | `layout_engine.py` | 手动 + 审计 |
| `TextContent` | `v3Types.ts` + `layoutEngine.ts` | `layout_engine.py` | 手动 + 审计 |
| `BorderConfig` | `v3Types.ts` + `layoutEngine.ts` | `layout_engine.py` | 手动 + 审计 |
| `ComputedElement` | `layoutEngine.ts` | `layout_engine.py` | Golden Fixture |

### 1.2 类型重复问题

当前 `v3Types.ts` 和 `layoutEngine.ts` 各自定义了 `RegionConfig`、`SlotConfig`、`StyleConfig` 等接口，存在重复定义。**非布局引擎专用的类型应只存在于 `v3Types.ts`**，`layoutEngine.ts` 通过 import 引用。

**待修复**：将 `layoutEngine.ts` 中的 `RegionConfig`、`SlotConfig`、`StyleConfig`、`FlowLayoutConfig`、`LogoContent`、`SignatureContent`、`TextContent`、`BorderConfig` 改为从 `v3Types.ts` import。

### 1.3 字段命名规则

- JSON 序列化字段（通过 API 传输）：**统一使用 camelCase**。
- Python 数据类字段：使用 snake_case，但与 JSON 的映射必须通过显式 `alias` 或 `model_validator` 明确声明，不得依赖 Pydantic 默认的 `populate_by_name` 作为隐式契约。
- 禁止出现 JSON key 在 TS 是 camelCase 但在 Python 是不同命名字段且无显式映射的情况。

### 1.4 校验：枚举值必须一致

TS 的 union type 字面值必须与 Python 的 `Literal[...]` 完全一致。例如：

```
TS:  type FlowMode = 'single-track' | 'dual-track'
Python: mode: Literal["single-track", "dual-track"]
```

禁止出现 TS 允许某个枚举值但 Python 不识别，或反之。

---

## 二、设计 Token 单一真相源

### 2.1 当前状态

`designTokens.ts` 和 Python 的 `_FONT_SIZE_LEVEL_RATIOS`、`_LOGO_SIZE_LEVEL_RATIOS` 等常量是手动维护两份拷贝，由 `test_v3_design_tokens.py` 检测漂移。

### 2.2 规则

- 新增或修改 token 时，**必须同时更新 `designTokens.ts` 和 `layout_engine.py` 中对应的常量**。
- 提交前必须运行 `pytest packages/kari-core/tests/unit/test_v3_design_tokens.py` 通过。
- 未来方向：从单一 JSON/YAML 文件生成 TS 和 Python 常量，消除手动同步。

---

## 三、CSS ↔ JSX 类名耦合

### 3.1 刚性规则

当 JSX 通过模板字符串动态拼接 CSS 类名时：

```tsx
// JSX：动态拼接
className={`v3-footer-bar-rows-${controls.flow_mode}`}
// 生成: v3-footer-bar-rows-dual-track 或 v3-footer-bar-rows-single-track
```

CSS 必须使用**完全相同的 token** 作为类名后缀：

```css
/* 正确：使用与 flow_mode 值一致的类名 */
.v3-footer-bar-rows-dual-track { ... }
.v3-footer-bar-rows-single-track { ... }

/* 错误：独立发明新类名 */
.v3-footer-bar-rows-dual-row { ... }
```

### 3.2 grid-area 命名

CSS `grid-area` 名称必须与 JSX 传入的位置标识符一致：

```tsx
// JSX
className={`v3-footer-row v3-footer-row-${row.position}`}
// row.position = 'primary-start' → 生成 v3-footer-row-primary-start
```

```css
/* 正确 */
.v3-footer-row-primary-start { grid-area: primary-start; }

/* 错误 */
.v3-footer-row-primary-start { grid-area: top-left; }
```

### 3.3 自检命令

修改动态类名后，执行：

```bash
# 搜索 JSX 中的动态类名拼接
rg 'className=\{.*\$\{' apps/web/src --type tsx
# 对每个拼接变量，在 CSS 中搜索对应类名，确保完全一致
rg '拼接变量的每个可能值' apps/web/src/styles.css
```

### 3.4 浏览器验证

涉及 CSS Grid / Flexbox 布局的改动，**必须用浏览器截图验证**实际渲染效果。`tsc` 和 `Vite build` 不会检测类名不匹配导致的布局失效。

---

## 四、API Schema ↔ 前后端一致性

### 4.1 当前缺口

- 后端使用 Pydantic `StrictModel` 进行请求校验。
- 前端 `apiV3.ts` 手写 fetch 调用，无运行时类型校验。
- 没有自动生成的 OpenAPI schema。

### 4.2 规则

- API 的请求体和响应体类型必须与 Pydantic schema 保持一致。
- 新增 API 端点时，必须同步更新前端 `apiV3.ts` 中的类型标注。
- Pydantic schema 字段新增/删除/重命名时，**必须搜索前端所有引用并同步更新**。

### 4.3 未来方向

- 从 Pydantic schema 自动生成 OpenAPI spec。
- 从 OpenAPI spec 生成前端类型（如 openapi-typescript）。
- 前端请求加入运行时校验（如 zod）。

---

## 五、布局引擎双语言一致性

### 5.1 Golden Fixture 机制

`verify_flow_layout_parity.py` 通过 JSON fixture 验证 TS 和 Python 布局引擎输出相同。

当前 fixture 文件：`packages/kari-core/tests/fixtures/v3_flow_layout_cases.json`

### 5.2 规则

- 修改布局引擎逻辑时，**必须先在 fixtures JSON 中新增/更新对应的测试用例**。
- 修改后运行 `uv run python scripts/verify_flow_layout_parity.py` 并确保通过。
- 提交前 `ruff check .` 必须通过。

### 5.3 覆盖缺口

当前仅 3 个 fixture 用例，未覆盖：

- single-track 模式
- 不同图像宽高比（16:9 / 9:16 / 1:1 / 4:3）
- Logo placement 各位置
- 签名元素
- Border 渲染
- `track_order` 切换
- 空 slot / 单 slot 边界情况

**待补充**：上述场景的 fixture 用例。

---

## 六、视觉渲染一致性

### 6.1 原则

前端 Canvas 渲染用于预览，后端 PIL 渲染用于最终导出。两者必须在视觉上一致。

### 6.2 现状

当前仅通过 Golden Fixture 验证布局坐标，没有像素级视觉对比测试。

### 6.3 规则

- 修改字体渲染、颜色、透明通道、Logo/签名绘制等涉及视觉效果的代码时，必须手动验证前后端输出一致。
- 未来方向：建立像素级 screenshot diff 测试（如 Playwright + pytest-pixelmatch）。

---

## 七、命名与文件组织

### 7.1 禁止

- 两套不同命名体系映射同一个概念（已发生的例子：CSS `dual-row` vs JSX `dual-track`）。
- 同一类型接口在多个文件中独立定义且不一致。
- 死代码残留（如已删除的 `side-edge` 的注释、import、空函数）。

### 7.2 要求

- 枚举值和配置 key 在 TS / Python / CSS / JSON 中使用完全相同的字符串常量。
- 删除功能时，执行 `rg '关键词'` 全局搜索，清理所有引用（代码、测试、文档、注释）。

---

## 八、工具链强制检查

### 8.1 提交前必须通过

```bash
# Python
uv run ruff check .

# TS↔Python 布局一致性
uv run python scripts/verify_flow_layout_parity.py

# Python 测试
cd packages/kari-core && uv run pytest
cd apps/api && uv run pytest

# 设计 Token 一致性
cd packages/kari-core && uv run pytest tests/unit/test_v3_design_tokens.py

# TS 编译
cd apps/web && npx tsc -b --pretty false

# 前端构建
cd apps/web && VITE_API_BASE=/tools/watermark-v3 npm run build
```

### 8.2 白名单例外

纯文档修改可跳过 `tsc` 和 `build`，但必须检查文档引用、过期路径和当前架构一致性。

---

## 九、变更管理规则

### 9.1 影响面评估

修改共享类型、token、API schema、布局引擎、渲染管线中的任意一项时，**必须先回答**：

1. 对应的 TS / Python 双语言实现是否需要同步修改？
2. CSS 类名是否需要更新？
3. Golden Fixtures 是否需要扩展？
4. API schema 和前端请求类型是否需要对齐？
5. 文档和 changelog 是否需要更新？

### 9.2 禁止的变更模式

- 只改 TS 不改 Python（或反之）的类型定义。
- 只改 CSS 不改 JSX 类名拼接逻辑（或反之）。
- 删除代码后残留 import、注释、文档引用。
- 新增依赖但未更新 `pyproject.toml` 或 `package.json`。

---

## 十、审计清单

每轮迭代或较大改动后，执行以下对抗性检查：

```bash
# 1. 全局搜索残留引用
rg 'side-edge|top-left|bottom-left|top-right|bottom-right|left\right' apps packages --type-add 'code:*.{ts,tsx,py}'

# 2. 检查 CSS 类名和 JSX 拼接一致性
rg 'className=\{.*\$\{' apps/web/src --type tsx

# 3. 检查 TS/Python 枚举值对齐
rg 'type.*=.*\|.*\|' apps/web/src/v3Types.ts
rg 'Literal\[.*\|.*\]' packages/kari-core/src

# 4. 检查 dead import
rg '^import ' --no-filename packages/kari-core/tests apps/api/tests | sort | uniq -c | sort -rn | head -20 | rg '1 '
```
