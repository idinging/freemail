## API 接口

### 🔐 根管理员令牌（Root Admin Override）

当请求方携带与服务端环境变量 `JWT_TOKEN`完全一致的令牌时，将跳过会话 Cookie/JWT 校验，直接被识别为最高管理员（strictAdmin）

- 配置项：
  - `wrangler.toml` → `[vars]` → `JWT_TOKEN="你的超管令牌"`
- 令牌携带方式（任选其一）：
  - Header（标准）：`Authorization: Bearer <JWT_TOKEN>`
  - Header（自定义）：`X-Admin-Token: <JWT_TOKEN>`
  - Query：`?admin_token=<JWT_TOKEN>`

- 生效范围：
  - 所有受保护的后端接口：`/api/*`
  - 会话检查：`GET /api/session`
  - 收信回调：`POST /receive`
  - 管理页服务端访问判定（`/admin`/`/admin.html`）与未知路径的认证判断

- 行为说明：
  - 命中令牌后，鉴权载荷为：`{ role: 'admin', username: '__root__', userId: 0 }`
  - `strictAdmin` 判定对 `__root__` 为 true（与严格管理员等价）
  - 若未携带或不匹配，则回退到原有 Cookie/JWT 会话验证

- 使用示例：
  - cURL（Authorization 头）：
    ```bash
    curl -H "Authorization: Bearer <JWT_TOKEN>" https://your.domain/api/mailboxes
    ```
  - cURL（X-Admin-Token）：
    ```bash
    curl -H "X-Admin-Token: <JWT_TOKEN>" https://your.domain/api/domains
    ```
  - GET（Query）：
    ```
    GET /api/session?admin_token=<JWT_TOKEN>
    ```

- 风险与建议（务必阅读）：
  - 严格保密 `JWT_TOKEN`，并定期更换

### 🎲 邮箱管理
- `GET /api/generate` - 生成新的临时邮箱
  - 返回: `{ "email": "random@domain.com", "expires": timestamp }`
- `GET /api/mailboxes` - 获取历史邮箱列表
  - 参数: `limit`（页面大小）, `offset`（偏移量）
  - 返回: 邮箱列表数组
- `DELETE /api/mailbox/{address}` - 删除指定邮箱
  - 返回: `{ "success": true }`

### 📧 邮件操作
- `GET /api/emails?mailbox=email@domain.com` - 获取邮件列表
  - 返回: 邮件列表数组，包含发件人、主题、时间等信息
- `GET /api/email/{id}` - 获取邮件详情
  - 返回: 完整的邮件内容，包括HTML和纯文本
- `DELETE /api/email/{id}` - 删除单个邮件
  - 返回: `{ "success": true, "deleted": true, "message": "邮件已删除" }`
- `DELETE /api/emails?mailbox=email@domain.com` - 清空邮箱所有邮件
  - 返回: `{ "success": true, "deletedCount": 5, "previousCount": 5 }`

### 🔐 认证相关
- `POST /api/login` - 用户登录
  - 参数: `{ "username": "用户名", "password": "密码" }`
  - 返回: `{ success: true, role, can_send, mailbox_limit }` 并设置会话 Cookie
- `POST /api/logout` - 用户退出
  - 返回: `{ "success": true }`

### 🔧 系统接口
- `GET /api/domains` - 获取可用域名列表
  - 返回: 域名数组

### 👤 用户管理（管理后台）
- `GET /api/users` - 获取用户列表
  - 返回: 用户数组（含 id/username/role/mailbox_limit/can_send/mailbox_count/created_at）
- `GET /api/users/{userId}/mailboxes` - 获取指定用户的邮箱列表
  - 返回: 邮箱数组（address/created_at）
- `POST /api/users` - 创建用户
  - 参数: `{ username, password, role }`（role: `user` | `admin`）
  - 返回: `{ success: true }`
- `PATCH /api/users/{userId}` - 更新用户
  - 参数示例: `{ username?, password?, mailboxLimit?, can_send?, role? }`
  - 返回: `{ success: true }`
- `DELETE /api/users/{userId}` - 删除用户
  - 返回: `{ success: true }`
- `POST /api/users/assign` - 给用户分配邮箱
  - 参数: `{ username, address }`
  - 返回: `{ success: true }`