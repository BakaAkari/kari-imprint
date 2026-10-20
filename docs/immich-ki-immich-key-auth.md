# immich-ki：Immich 账户登录与 init 模式（设计稿 v3）

状态：2026-10-10 v3；v2 的"API key 即登录口令"按用户澄清废止——key 只用于关联，
日常登录使用 Immich 账户（邮箱+密码）。
关联：`docs/immich-ki-design.md`（§10.2 运行边界、§12/13 身份决策）。

## 1. 目标

- 完全移除 Pocket ID OIDC 登录（及已被取代的 M0 共享令牌登录），面板不再有第二种身份体系。
- **API Key 只用于关联**：首次部署，或配置目录缺少有效配置文件 / 有效 key 时进入
  **init 模式**，由用户输入 API Key 完成与 Immich 的绑定；该 key 是面板访问
  Immich 的服务端凭据，持久化在数据目录。
- **日常登录使用 Immich 账户**：用户在登录页输入 Immich 邮箱+密码，面板代向
  Immich `POST /api/auth/login` 验证，用返回的 access token 读取 `GET /api/users/me`
  确认身份后，签发面板自己的会话 cookie。密码即验即弃，不落盘、不入日志。
- 动机：passkey 因软件问题无法弹出导致登录不可用；单操作员面板不需要独立 IdP。

## 2. 凭据模型

- 存储：`KI_DATA_ROOT/config.json`，内容 `{"apiKey": "<key>", "ownerEmail": "<email>"}`
  （init 时由 `users/me` 得到属主邮箱）；原子写（同目录临时文件 + `os.replace`），
  权限 0600；与 SQLite、资源同目录备份策略。
- 启动解析（create_app 时确定，运行时只允许 0→1 次变化）：
  1. `config.json` 存在且含合法 key（非空字符串、≤256 字符）→ 正常模式。
  2. 否则环境变量 `IMMICH_API_KEY` 非空 → 视为旧部署迁移，立即写入
     `config.json`（ownerEmail 为空）并进入正常模式。
  3. 否则 → init 模式（upstream client 以空 key 创建，所有 Immich 调用被门控）。
- key 旋转 / 重新关联（v1 不提供在线轮换端点）：停止容器 → 删除 `config.json`
  （若用 env 迁移过，同时移除 env 中的 `IMMICH_API_KEY`）→ 启动进入 init 模式。

## 3. init 模式

- 门控：仅开放 `GET /api/health`、`GET /api/auth/session`、`POST /api/init`；
  其余 `/api/*` 返回 403 `init_required`。后台渲染/对账循环在 init 模式下暂停，
  避免空 key 上游错误终止后台线程。
- `POST /api/init` `{ "key": string }`：
  - 以该 key 调 Immich `GET /api/users/me`（10 秒超时独立短连接）。
    200 → 成功；401 → `invalid_key`；403 → `key_scope_insufficient`（scope 受限、
    读不了用户信息的 key 不能用于关联）；其余/网络错误 → `immich_unreachable` (502)。
  - 失败按客户端 IP 限流：5 次 / 5 分钟（仅计 401/403），超限 429。
  - 成功：原子写 `config.json`（0600，含 ownerEmail）→ 替换 upstream client 的
    `x-api-key` → 退出 init 模式 → 签发操作员会话（刚证明持有 key 的人直接登录）。
  - key 不落日志（成功后可记录 Immich 返回的 email）。

## 4. 登录（init 之后）

- `POST /api/auth/immich-login` `{ "email": string, "password": string }`：
  1. 面板以邮箱+密码调 Immich `POST /api/auth/login`（10 秒超时）。
     400/401 → `invalid_credentials`；429 → `login_rate_limited`；其余/网络错误 →
     `immich_unreachable` (502)。
  2. 用返回的 accessToken 调 `GET /api/users/me`（Bearer）取得 canonical 身份邮箱。
  3. `ownerEmail` 非空时，身份邮箱必须与其一致，否则 403 `forbidden_account`
     （key 绑定在哪个账户下，就只有那个账户能登录面板；env 迁移的部署 ownerEmail
     为空，不限制）。
- 验证通过后签发 8 小时单操作员会话（新登录吊销旧会话，HttpOnly/SameSite=strict，
  HTTPS 下 Secure）；失败按 IP 限流 5 次 / 5 分钟。密码与 accessToken 均不落盘、
  不入日志、不回显。
- `GET /api/auth/session` 返回 `{mode, initialized, authenticated}`；
  `mode` 为 `"init"` 或 `"immich_key"`。

## 5. 移除清单

- worker：`auth.py` OIDC 端点与 Authlib 依赖、`settings.py` 全部 oidc_* 与 token 字段、
  `app.py` `/api/login`、`cli.py --new-token`。
- web：Pocket ID 登录按钮、`auth_error` 回调提示、令牌输入表单。
- 部署：`KI_OIDC_*`、`KI_M0_TOKEN` 环境变量（NAS compose 中的失效行删除）。
- 依赖锁：`authlib` 从 `uv.lock` / `requirements.lock` /
  `requirements-linux-amd64.lock` 移除。

## 6. 安全边界（沿 v1/v2 约定）

- 浏览器永不接触服务端凭据；init 提交的 key 与登录提交的密码/accessToken 只存在于
  单次请求内存，不入日志（含访问日志与错误响应 detail）、不回显。
- 写操作 Origin 校验、body 上限、静态资源缓存策略不变；init 与 login 同属公开路径，
  但 Origin 校验对 POST 依然生效。
- 面板暴露公网时，Immich 账户登录是唯一入口；面板侧限流叠加 Immich 自身登录限流，
  防爆破。
- 现有 NAS 部署无缝迁移：env key 自动写入 `config.json`，用户改用 Immich 账户登录。

## 7. 验收

- pytest：init 门控（未初始化 403、后台暂停）、init 成功（写文件 0600、ownerEmail
  落盘、upstream 换 key、直接登录）、init 失败（401/403/502/限流）、env 迁移、
  登录成功（会话、单操作员吊销）、错误密码 401、属主限制 403、限流、
  日志不含密码、OIDC 旧端点 404。
- `tsc --noEmit && vite build` 通过；ruff、布局 parity、core/API 测试通过。
- NAS 实机：init 模式登录页输入 key 关联 → 退出 → 用 Immich 邮箱+密码登录成功；
  错误密码明确报错；非属主账户 403。
