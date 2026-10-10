# immich-wm：Immich API Key 唯一凭据与 init 模式（设计稿 v2）

状态：2026-10-10 v2，取代同日的 v1（v1 的"OIDC + key 备用登录"随 Pocket ID 移除而废止）。
关联：`docs/immich-wm-design.md`（§10.2 运行边界、§12/13 身份决策）。

## 1. 目标

- 完全移除 Pocket ID OIDC 登录（及已被取代的 M0 共享令牌登录），面板不再有第二种身份体系。
- Immich API Key 成为面板唯一凭据，并从环境变量升级为**容器配置目录中的持久化配置**：
  首次部署，或配置目录缺少有效配置文件 / 有效 key 时，进入 **init 模式**，由用户在
  页面输入 API Key 完成与 Immich 的关联。
- 动机：passkey 因软件问题无法弹出导致登录不可用；单操作员面板不需要独立 IdP。

## 2. 凭据模型

- 存储：`WM_DATA_ROOT/config.json`，内容 `{"apiKey": "<key>"}`；原子写
  （同目录临时文件 + `os.replace`），权限 0600；与现有 SQLite、资源同目录备份策略。
- 启动解析（create_app 时确定，运行时只允许 0→1 次变化）：
  1. `config.json` 存在且含合法 key（非空字符串、≤256 字符）→ 正常模式。
  2. 否则环境变量 `IMMICH_API_KEY` 非空 → 视为旧部署迁移，立即写入 `config.json`
     并进入正常模式。
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
  - 成功：原子写 `config.json`（0600）→ 替换 upstream client 的 `x-api-key` →
    退出 init 模式 → 签发操作员会话（刚证明持有 key 的人直接登录）。
  - key 不落日志（成功后可记录 Immich 返回的 email）。

## 4. 登录（init 之后）

- `POST /api/auth/immich-key` `{ "key": string }`：与服务端存储 key 做
  SHA-256 摘要常量时间比对。比对不经过 Immich，Immich 短暂离线也能登录。
- 成功后签发与此前一致的 8 小时单操作员会话（新登录吊销旧会话，
  HttpOnly/SameSite=strict，HTTPS 下 Secure）；失败限流同 init（5 次 / 5 分钟）。
- `GET /api/auth/session` 返回 `{mode, initialized, authenticated}`；
  `mode` 为 `"init"` 或 `"immich_key"`。

## 5. 移除清单

- worker：`auth.py` OIDC 端点与 Authlib 依赖、`settings.py` 全部 oidc_* 与 token 字段、
  `app.py` `/api/login`、`cli.py --new-token`。
- web：Pocket ID 登录按钮、`auth_error` 回调提示、令牌输入表单。
- 部署：`WM_OIDC_*`、`WM_M0_TOKEN` 环境变量（NAS compose 中的失效行删除）。
- 依赖锁：`authlib` 从 `uv.lock` / `requirements.lock` /
  `requirements-linux-amd64.lock` 移除。

## 6. 安全边界（沿 v1 约定）

- 浏览器永不接触 `IMMICH_API_KEY` env；init/登录提交的 key 只存在于单次请求内存，
  不入日志、不回显、不写入会话存储。
- 写操作 Origin 校验、body 上限、静态资源缓存策略不变；init 与 login 同属公开路径，
  但 Origin 校验对 POST 依然生效。
- 面板暴露公网时，登录页（key 即口令）是唯一入口；限流防爆破。
- 现有 NAS 部署无缝迁移：env key 自动写入 `config.json`，用户无感。

## 7. 验收

- pytest：init 门控（未初始化 403、后台暂停）、init 成功（写文件 0600、upstream
  换 key、直接登录）、init 失败（401/403/502/限流）、env 迁移、登录比对
  （错误 key 401、成功会话、单操作员吊销、限流、日志不含 key）、OIDC 移除后
  旧端点 404。
- `tsc --noEmit && vite build` 通过；ruff、布局 parity、core/API 测试通过。
- NAS 实机：重建容器后 env key 迁移路径验证（`/api/auth/session` 返回
  initialized=true）；删除 `config.json` 并移除 env key 后重启进入 init 模式
  （公网登录页显示初始化表单），输入 key 后完成关联并直接登录。
