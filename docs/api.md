# API 接口文档

## 目录

- [认证与权限](#认证与权限)
- [认证相关](#认证相关)
- [邮箱管理](#邮箱管理)
- [邮箱设置](#邮箱设置)
- [邮件操作](#邮件操作)
- [邮件发送](#邮件发送)
- [用户管理](#用户管理)
- [系统接口](#系统接口)

---

## 认证与权限

### 🔐 根管理员令牌（Root Admin Override）

当请求方携带与服务端环境变量 `JWT_TOKEN` 完全一致的令牌时，将跳过会话 Cookie/JWT 校验，直接被识别为最高管理员（strictAdmin）。

**配置项：**
- `wrangler.toml` → `[vars]` → `JWT_TOKEN="你的超管令牌"`

**令牌携带方式（任选其一）：**
- Header（标准）：`Authorization: Bearer <JWT_TOKEN>`
- Header（自定义）：`X-Admin-Token: <JWT_TOKEN>`
- Query：`?admin_token=<JWT_TOKEN>`

**生效范围：**
- 所有受保护的后端接口：`/api/*`
- 会话检查：`GET /api/session`
- 收信回调：`POST /receive`
- 管理页服务端访问判定（`/admin`/`/admin.html`）与未知路径的认证判断

**行为说明：**
- 命中令牌后，鉴权载荷为：`{ role: 'admin', username: '__root__', userId: 0 }`
- `strictAdmin` 判定对 `__root__` 为 true（与严格管理员等价）
- 若未携带或不匹配，则回退到原有 Cookie/JWT 会话验证

**使用示例：**

```bash
# Authorization 头
curl -H "Authorization: Bearer <JWT_TOKEN>" https://your.domain/api/mailboxes

# X-Admin-Token 头
curl -H "X-Admin-Token: <JWT_TOKEN>" https://your.domain/api/domains

# Query 参数
curl "https://your.domain/api/session?admin_token=<JWT_TOKEN>"
```

**安全提示：** 严格保密 `JWT_TOKEN`，并定期更换。

### 用户角色

| 角色 | 说明 |
|------|------|
| `strictAdmin` | 最高管理员，完全系统访问权限 |
| `admin` | 管理员，用户管理和邮箱控制 |
| `user` | 普通用户，只能管理分配的邮箱 |
| `mailbox` | 邮箱用户，只能访问自己的单个邮箱 |
| `guest` | 访客，只读模拟数据 |

---

## 认证相关

### POST /api/login
用户登录

**请求参数：**
```json
{
  "username": "用户名或邮箱地址",
  "password": "密码"
}
```

**支持的登录方式：**
1. 管理员登录：使用 `ADMIN_NAME` / `ADMIN_PASSWORD` 环境变量
2. 访客登录：用户名 `guest`，密码为 `GUEST_PASSWORD` 环境变量
3. 普通用户登录：数据库 `users` 表中的用户
4. 邮箱登录：使用邮箱地址登录（需启用 `can_login`）

**返回示例：**
```json
{
  "success": true,
  "role": "admin",
  "can_send": 1,
  "mailbox_limit": 9999
}
```

### POST /api/logout
用户退出登录

**返回：**
```json
{ "success": true }
```

### GET /api/session
验证当前会话状态

**返回：**
```json
{
  "authenticated": true,
  "role": "admin",
  "username": "admin",
  "strictAdmin": true
}
```

---

## 邮箱管理

### GET /api/domains
获取可用域名列表

**返回：**
```json
["example.com", "mail.example.com"]
```

### GET /api/generate
随机生成新的临时邮箱

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `length` | number | 可选，随机字符串长度 |
| `domainIndex` | number | 可选，选择域名索引（默认 0） |

**返回：**
```json
{
  "email": "abc123@example.com",
  "expires": 1704067200000
}
```

### POST /api/create
自定义创建邮箱

**请求参数：**
```json
{
  "local": "myname",
  "domainIndex": 0
}
```

**返回：**
```json
{
  "email": "myname@example.com",
  "expires": 1704067200000
}
```

### GET /api/mailboxes
获取当前用户的邮箱列表

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `limit` | number | 分页大小（默认 100，最大 500） |
| `offset` | number | 偏移量 |
| `domain` | string | 按域名筛选 |
| `favorite` | boolean | 按收藏状态筛选 |
| `forward` | boolean | 按转发状态筛选 |

**返回：**
```json
[
  {
    "id": 1,
    "address": "test@example.com",
    "created_at": "2024-01-01 00:00:00",
    "is_pinned": 1,
    "password_is_default": 1,
    "can_login": 0,
    "forward_to": "backup@gmail.com",
    "is_favorite": 1
  }
]
```

### DELETE /api/mailboxes
删除指定邮箱

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `address` | string | 要删除的邮箱地址 |

**返回：**
```json
{ "success": true, "deleted": true }
```

### GET /api/user/quota
获取当前用户的邮箱配额

**返回（普通用户）：**
```json
{
  "limit": 10,
  "used": 3,
  "remaining": 7
}
```

**返回（管理员）：**
```json
{
  "limit": -1,
  "used": 150,
  "remaining": -1,
  "note": "管理员无邮箱数量限制"
}
```

### POST /api/mailboxes/pin
切换邮箱置顶状态

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `address` | string | 邮箱地址 |

**返回：**
```json
{ "success": true, "pinned": true }
```

### POST /api/mailboxes/reset-password
重置邮箱密码（仅 strictAdmin）

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `address` | string | 邮箱地址 |

**返回：**
```json
{ "success": true }
```

### POST /api/mailboxes/toggle-login
切换邮箱登录权限（仅 strictAdmin）

**请求参数：**
```json
{
  "address": "test@example.com",
  "can_login": true
}
```

**返回：**
```json
{ "success": true, "can_login": true }
```

### POST /api/mailboxes/change-password
修改邮箱密码（仅 strictAdmin）

**请求参数：**
```json
{
  "address": "test@example.com",
  "new_password": "newpassword123"
}
```

**返回：**
```json
{ "success": true }
```

### POST /api/mailboxes/batch-toggle-login
批量切换邮箱登录权限（仅 strictAdmin）

**请求参数：**
```json
{
  "addresses": ["test1@example.com", "test2@example.com"],
  "can_login": true
}
```

**返回：**
```json
{
  "success": true,
  "success_count": 2,
  "fail_count": 0,
  "total": 2,
  "results": [
    { "address": "test1@example.com", "success": true, "updated": true }
  ]
}
```

---

## 邮箱设置

### POST /api/mailbox/forward
设置邮箱转发地址

**请求参数：**
```json
{
  "mailbox_id": 1,
  "forward_to": "backup@gmail.com"
}
```

**返回：**
```json
{ "success": true }
```

### POST /api/mailbox/favorite
切换邮箱收藏状态

**请求参数：**
```json
{
  "mailbox_id": 1,
  "is_favorite": true
}
```

**返回：**
```json
{ "success": true }
```

### POST /api/mailboxes/batch-favorite
批量设置收藏（按 ID，仅 strictAdmin）

**请求参数：**
```json
{
  "mailbox_ids": [1, 2, 3],
  "is_favorite": true
}
```

### POST /api/mailboxes/batch-forward
批量设置转发（按 ID，仅 strictAdmin）

**请求参数：**
```json
{
  "mailbox_ids": [1, 2, 3],
  "forward_to": "backup@gmail.com"
}
```

### POST /api/mailboxes/batch-favorite-by-address
批量设置收藏（按地址，仅 strictAdmin）

**请求参数：**
```json
{
  "addresses": ["test1@example.com", "test2@example.com"],
  "is_favorite": true
}
```

### POST /api/mailboxes/batch-forward-by-address
批量设置转发（按地址，仅 strictAdmin）

**请求参数：**
```json
{
  "addresses": ["test1@example.com", "test2@example.com"],
  "forward_to": "backup@gmail.com"
}
```

### PUT /api/mailbox/password
邮箱用户修改自己的密码

**请求参数：**
```json
{
  "currentPassword": "oldpassword",
  "newPassword": "newpassword123"
}
```

**返回：**
```json
{ "success": true, "message": "密码修改成功" }
```

---

## 邮件操作

### GET /api/emails
获取邮件列表

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `mailbox` | string | 邮箱地址（必需） |
| `limit` | number | 返回数量（默认 20，最大 50） |

**返回：**
```json
[
  {
    "id": 1,
    "sender": "sender@example.com",
    "subject": "邮件主题",
    "received_at": "2024-01-01 12:00:00",
    "is_read": 0,
    "preview": "邮件内容预览...",
    "verification_code": "123456"
  }
]
```

### GET /api/emails/batch
批量获取邮件元数据

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `ids` | string | 逗号分隔的邮件 ID（最多 50 个） |

**返回：**
```json
[
  {
    "id": 1,
    "sender": "sender@example.com",
    "to_addrs": "recipient@example.com",
    "subject": "邮件主题",
    "verification_code": "123456",
    "preview": "预览...",
    "r2_bucket": "mail-eml",
    "r2_object_key": "2024/01/01/test@example.com/xxx.eml",
    "received_at": "2024-01-01 12:00:00",
    "is_read": 0
  }
]
```

### GET /api/email/:id
获取单封邮件详情

**返回：**
```json
{
  "id": 1,
  "sender": "sender@example.com",
  "to_addrs": "recipient@example.com",
  "subject": "邮件主题",
  "verification_code": "123456",
  "content": "纯文本内容",
  "html_content": "<p>HTML内容</p>",
  "received_at": "2024-01-01 12:00:00",
  "is_read": 1,
  "download": "/api/email/1/download"
}
```

### GET /api/email/:id/download
下载原始 EML 文件

**返回：** `message/rfc822` 格式的原始邮件文件

### DELETE /api/email/:id
删除单封邮件

**返回：**
```json
{
  "success": true,
  "deleted": true,
  "message": "邮件已删除"
}
```

### DELETE /api/emails
清空邮箱所有邮件

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `mailbox` | string | 邮箱地址（必需） |

**返回：**
```json
{
  "success": true,
  "deletedCount": 5
}
```

---

## 邮件发送

> 需要配置 `RESEND_API_KEY` 环境变量

### GET /api/sent
获取发件记录列表

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `from` | string | 发件人邮箱（必需） |
| `limit` | number | 返回数量（默认 20，最大 50） |

**返回：**
```json
[
  {
    "id": 1,
    "resend_id": "abc123",
    "recipients": "to@example.com",
    "subject": "邮件主题",
    "created_at": "2024-01-01 12:00:00",
    "status": "delivered"
  }
]
```

### GET /api/sent/:id
获取发件详情

**返回：**
```json
{
  "id": 1,
  "resend_id": "abc123",
  "from_addr": "from@example.com",
  "recipients": "to@example.com",
  "subject": "邮件主题",
  "html_content": "<p>内容</p>",
  "text_content": "内容",
  "status": "delivered",
  "scheduled_at": null,
  "created_at": "2024-01-01 12:00:00"
}
```

### DELETE /api/sent/:id
删除发件记录

**返回：**
```json
{ "success": true }
```

### POST /api/send
发送单封邮件

**请求参数：**
```json
{
  "from": "sender@example.com",
  "fromName": "发件人名称",
  "to": "recipient@example.com",
  "subject": "邮件主题",
  "html": "<p>HTML内容</p>",
  "text": "纯文本内容",
  "scheduledAt": "2024-01-02T12:00:00Z"
}
```

**返回：**
```json
{ "success": true, "id": "resend-id-xxx" }
```

### POST /api/send/batch
批量发送邮件

**请求参数：**
```json
[
  {
    "from": "sender@example.com",
    "to": "recipient1@example.com",
    "subject": "主题1",
    "html": "<p>内容1</p>"
  },
  {
    "from": "sender@example.com",
    "to": "recipient2@example.com",
    "subject": "主题2",
    "html": "<p>内容2</p>"
  }
]
```

**返回：**
```json
{
  "success": true,
  "result": [
    { "id": "resend-id-1" },
    { "id": "resend-id-2" }
  ]
}
```

### GET /api/send/:id
查询发送结果（从 Resend API）

### PATCH /api/send/:id
更新发送状态或定时时间

**请求参数：**
```json
{
  "status": "canceled",
  "scheduledAt": "2024-01-03T12:00:00Z"
}
```

### POST /api/send/:id/cancel
取消定时发送

**返回：**
```json
{ "success": true }
```

---

## 用户管理

> 以下接口需要 `strictAdmin` 权限

### GET /api/users
获取用户列表

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `limit` | number | 分页大小（默认 50，最大 100） |
| `offset` | number | 偏移量 |
| `sort` | string | 排序方式：`asc` 或 `desc`（默认 desc） |

**返回：**
```json
[
  {
    "id": 1,
    "username": "testuser",
    "role": "user",
    "mailbox_limit": 10,
    "can_send": 0,
    "mailbox_count": 3,
    "created_at": "2024-01-01 00:00:00"
  }
]
```

### POST /api/users
创建用户

**请求参数：**
```json
{
  "username": "newuser",
  "password": "password123",
  "role": "user",
  "mailboxLimit": 10
}
```

**返回：**
```json
{
  "id": 2,
  "username": "newuser",
  "role": "user",
  "mailbox_limit": 10,
  "can_send": 0,
  "created_at": "2024-01-01 00:00:00"
}
```

### PATCH /api/users/:id
更新用户信息

**请求参数：**
```json
{
  "username": "updatedname",
  "password": "newpassword",
  "mailboxLimit": 20,
  "can_send": 1,
  "role": "admin"
}
```

**返回：**
```json
{ "success": true }
```

### DELETE /api/users/:id
删除用户

**返回：**
```json
{ "success": true }
```

### GET /api/users/:id/mailboxes
获取指定用户的邮箱列表

**返回：**
```json
[
  {
    "address": "test@example.com",
    "created_at": "2024-01-01 00:00:00",
    "is_pinned": 0
  }
]
```

### POST /api/users/assign
给用户分配邮箱

**请求参数：**
```json
{
  "username": "testuser",
  "address": "newbox@example.com"
}
```

**返回：**
```json
{ "success": true }
```

### POST /api/users/unassign
取消用户的邮箱分配

**请求参数：**
```json
{
  "username": "testuser",
  "address": "oldbox@example.com"
}
```

**返回：**
```json
{ "success": true }
```

---

## 系统接口

### POST /receive
邮件接收回调（用于 Cloudflare Email Routing）

> 需要认证，通常由系统内部调用

---

## 错误响应

所有 API 在发生错误时返回以下格式：

```json
{
  "error": "错误信息描述"
}
```

**常见 HTTP 状态码：**
| 状态码 | 说明 |
|--------|------|
| 400 | 请求参数错误 |
| 401 | 未认证 |
| 403 | 权限不足（演示模式限制或角色限制） |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |
