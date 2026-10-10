# immich-wm：Immich API Key 备用登录（设计稿）

状态：2026-10-10 已实现并通过 worker pytest（含新增 5 个用例）与 immich-wm web 构建；NAS 实测部署验证待随下次发布进行。
关联：`docs/immich-wm-design.md`（§10.2 运行边界、§12/13 身份决策、M1 收尾实现约定）。

## 1. 背景与目标

面板当前身份方案为 Pocket ID OIDC（`kari-imprint-admin` 组限制）。实践中 Pocket ID 的
passkey 偶尔因系统/浏览器软件问题无法弹出，导致登录入口不可用。本设计为面板增加
**Immich API Key 登录**，作为与 OIDC 并列的常驻备用方式（等价于 Pocket ID 自身的
Alternative Sign In Methods 思路）。

- 用户粘贴自己的 Immich API Key，worker 向 Immich 验证其有效性，成功后签发与 OIDC
  完全等价的单操作员服务端会话。
- 单操作员语义不变：新登录吊销旧会话；不改 worker 自身访问 Immich 所用的服务端
  `IMMICH_API_KEY`（那是面板调用 Immich API 的凭据，与登录凭证相互独立）。

## 2. 登录流程

1. `GET /api/auth/session` 返回 `methods: ["oidc", "immich_key"]`（按实际配置），
   前端登录页据此渲染：OIDC 启用时显示 Pocket ID 登录按钮，下方常驻
   「使用 Immich API Key 登录」折叠入口；key 输入框为 password 类型。
2. `POST /api/auth/immich-key`，请求体 `{ "key": string }`：
   - worker 以该 key 作为 `x-api-key` 调用 Immich `GET /api/users/me`
     （独立短连接 client，10 秒超时，不复用面板的服务端 key 连接）。
   - `200` → 登录成功；从响应取 `email` 标注会话身份，用于审计与 UI 提示。
   - `401` → `invalid_key`（401）。
   - `403` → `key_scope_insufficient`（403），前端提示「该 key 权限不足，请在
     Immich 生成包含用户信息读取权限的 key（默认全权限 key 即可）」。Immich v2+
     支持 scope 限制的 key，无法读取 `/api/users/me` 的受限 key 不能用于登录——
     这是有意选择：必须能确认 key 背后的身份。
   - 网络错误 / 超时 / 5xx → `immich_unreachable`（502），不向上游错误细节透传。
3. 会话：复用现有内存 sessions 与 cookie 约定（HttpOnly、SameSite=strict、HTTPS 下
   Secure、8 小时、新登录 `sessions.clear()` 吊销旧会话）。`PUBLIC_AUTH_PATHS`
   增加 `/api/auth/immich-key`。
4. 该方式签发的会话与 OIDC 会话权限完全等价；面板为单操作员，不做角色区分。

## 3. 安全边界

- key 只存在于单次请求内存：不落盘、不进日志（含访问日志与错误响应 detail）、
  不回显、不写入会话存储；日志仅记录结果（`ok` / `invalid` / `unreachable`）
  与成功后的 Immich email。
- 登录端点限流：每客户端 IP 5 次失败 / 5 分钟，超限返回 429（`login_rate_limited`），
  内存计数器随失败记录时间戳滑动窗口实现，定期清理。
- 面板自身边界不变：浏览器侧依旧永不持有服务端 `IMMICH_API_KEY`；用户粘贴的登录
  key 验证后即丢弃，worker 后续代理 Immich 仍使用自己的服务端 key。
- key 被 Immich 侧吊销/删除后：已签发会话在 8 小时有效期内不强制失效（与 OIDC
  会话过期策略一致），登出或过期后再次登录时自然发现 key 失效。
- 默认常开，不引入新环境变量；如未来需要可再加开关，本设计不预留。

## 4. 实现范围

- worker：`auth.py` 新增 immich-key 端点与限流；`app.py` 公开路径白名单；
  session 响应增加 `methods`。
- web：登录页增加备用登录入口与错误提示；session 类型同步。
- 不改 OIDC/token 既有路径，不改面板对 Immich 的服务端调用。

## 5. 验收

- pytest：成功路径（200 + email 标注）、401、403、上游超时/5xx、限流触发与窗口
  恢复、日志不含 key、会话等价与旧会话吊销。
- `tsc -b` + `npm run build` 通过；真实 NAS 上验证 OIDC 与 key 登录并行可用，
  并复现「passkey 无法弹出」场景走 key 路径成功登录。
- 部署验证后更新 `docs/immich-wm-design.md` 的身份决策段落并指向本文档。
