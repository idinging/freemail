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

当请求方携带与服务端环境变量 `JWT_TOKEN`（别名 `JWT_SECRET`）完全一致的令牌时，将跳过会话 Cookie/JWT 校验，直接被识别为最高管理员（strictAdmin）。

**配置项：**
- `wrangler.toml` → `[vars]` → `JWT_TOKEN="你的超管令牌"`

**令牌携带方式（任选其一）：**
- Header（标准）：`Authorization: Bearer <JWT_TOKEN>`
- Header（自定义）：`X-Admin-Token: <JWT_TOKEN>`

> 注意：**不支持** `?admin_token=` 查询参数方式。

**生效范围：**
- 所有受保护的后端接口：`/api/*`
- 会话检查：`GET /api/session`
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
1. 管理员登录：使用 `ADMIN_NAME` / `ADMIN_PASSWORD`（别名 `ADMIN_PASS`）环境变量
2. 访客登录：用户名 `guest`，密码为 `GUEST_PASSWORD` 环境变量
3. 普通用户登录：数据库 `users` 表中的用户
4. 邮箱登录：使用邮箱地址登录（需启用 `can_login`）

**返回示例（管理员）：**
```json
{
  "success": true,
  "role": "admin",
  "can_send": 1,
  "mailbox_limit": 9999
}
```

**返回示例（访客）：**
```json
{
  "success": true,
  "role": "guest"
}
```

**返回示例（普通用户）：**
```json
{
  "success": true,
  "role": "user",
  "can_send": 0,
  "mailbox_limit": 10
}
```

**返回示例（邮箱用户）：**
```json
{
  "success": true,
  "role": "mailbox",
  "mailbox": "test@example.com",
  "can_send": 0,
  "mailbox_limit": 1
}
```

**限速：** 60 秒内最多 10 次请求。

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
  "strictAdmin": true,
  "mailboxAddress": "test@example.com"
}
```

> `mailboxAddress` 字段仅在 `role` 为 `mailbox` 时返回。

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

> 已登录用户调用时会自动将邮箱分配给当前用户。

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

> 已登录用户调用时会自动将邮箱分配给当前用户。

### GET /api/mailboxes
获取邮箱列表

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `limit` | number | 分页大小（默认 100，最大 500） |
| `offset` | number | 偏移量 |
| `page` | number | 页码（与 `limit`/`offset` 互斥，使用 `page`/`size` 分页） |
| `size` | number | 每页数量（默认 20，最大 500） |
| `domain` | string | 按域名筛选 |
| `favorite` | string | 按收藏状态筛选（`true`/`1`/`favorite` 或 `false`/`0`/`not-favorite`） |
| `forward` | string | 按转发状态筛选（`true`/`1`/`has-forward` 或 `false`/`0`/`no-forward`） |
| `login` | string | 按登录权限筛选（`true`/`1`/`allowed` 或 `false`/`0`/`denied`） |
| `q` | string | 模糊搜索邮箱地址 |

**返回：**
```json
{
  "list": [
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
  ],
  "total": 42
}
```

> 严格管理员可以看到所有邮箱；普通用户只能看到自己关联的邮箱。

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

> 管理员可删除自己关联的邮箱；严格管理员可删除任意邮箱。删除时会同时清除该邮箱下的所有邮件。

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

### GET /api/mailbox/info
获取单个邮箱详细信息

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `address` | string | 邮箱地址（必需） |

**返回：**
```json
{
  "id": 1,
  "address": "test@example.com",
  "is_favorite": true,
  "forward_to": "backup@gmail.com",
  "can_login": false
}
```

### POST /api/mailboxes/pin
切换邮箱置顶状态

**参数：**
| 参数 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `address` | string | Query 或 Body | 邮箱地址 |

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

> 重置后将 `password_hash` 设为 `NULL`，登录时回退到以邮箱地址作为密码。

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

> 新密码长度至少 6 位。

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

> 若某个邮箱地址不存在，会自动创建该邮箱记录。单次最多处理 100 个邮箱。

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

> 新密码长度至少 6 位。若当前密码尚未设置（为 `NULL`），则以邮箱地址作为当前密码进行验证。

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

> 邮箱用户（`role: mailbox`）只能查看最近 24 小时内的邮件。

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

> 访问时会自动将 `is_read` 标记为已读。正文优先从 R2 存储的原始 EML 文件解析。

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

> 同时删除 R2 存储中的原始 EML 文件。

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

> 同时清空 R2 存储中的原始 EML 文件。

---

## 邮件发送

> 需配置 `RESEND_API_KEY` 或 `SENDFLARE_API_KEY` 或 `CYBERPERSONS_API_KEY` 环境变量，至少配置一个。

### GET /api/sent
获取发件记录列表

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `from` | string | 发件人邮箱（必需，也支持 `mailbox` 参数名） |
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
    "status": "delivered",
    "provider": "resend"
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
  "created_at": "2024-01-01 12:00:00",
  "provider": "resend"
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
{ "success": true, "id": "resend-id-xxx", "provider": "resend" }
```

> `provider` 值为 `resend`、`sendflare` 或 `cyberpersons`。发件人必须是当前用户绑定的邮箱（严格管理员除外）。

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
    { "id": "resend-id-1", "provider": "resend" },
    { "id": "resend-id-2", "provider": "resend" }
  ]
}
```

### GET /api/send/:id
查询发送结果（从外部发件平台 API）

> 按路径中的 ID 作为 `resend_id` 查询外部平台。SendFlare 和 Cyberpersons 渠道暂不支持此操作。

### PATCH /api/send/:id
更新发送状态或定时时间

**请求参数：**
```json
{
  "status": "canceled",
  "scheduledAt": "2024-01-03T12:00:00Z"
}
```

> SendFlare 和 Cyberpersons 渠道暂不支持此操作。

### POST /api/send/:id/cancel
取消定时发送

**返回：**
```json
{ "success": true }
```

> SendFlare 和 Cyberpersons 渠道暂不支持此操作。

---

## 用户管理

> 以下接口需要 `strictAdmin` 权限

### GET /api/users
获取用户列表

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `page` | number | 页码，从 1 开始（与 `limit`/`offset` 互斥，提供 `page` 或 `size` 时启用 `page`/`size` 分页） |
| `size` | number | 每页数量（默认 50，范围 1-100） |
| `limit` | number | 分页大小（默认 50，范围 1-100；仅在未提供 `page`/`size` 时生效） |
| `offset` | number | 偏移量（默认 0） |
| `sort` | string | 排序方式：`asc` 或 `desc`（默认 desc） |

> 两种分页风格二选一：只要请求带有 `page` 或 `size`，即按 `page`/`size` 解析（`offset = (page - 1) * size`）；否则回退到 `limit`/`offset`。非数字参数会回退到默认值。

**返回：**
```json
{
  "list": [
    {
      "id": 1,
      "username": "testuser",
      "role": "user",
      "mailbox_limit": 10,
      "can_send": 0,
      "mailbox_count": 3,
      "created_at": "2024-01-01 00:00:00"
    }
  ],
  "total": 100,
  "total_mailboxes": 530,
  "admin_count": 5,
  "active_count": 12
}
```

**返回字段说明：**
| 字段 | 类型 | 说明 |
|------|------|------|
| `list` | array | 当前页用户列表，每项的 `mailbox_count` 为该用户已分配的邮箱数 |
| `total` | number | 用户总数（全局，非当前页） |
| `total_mailboxes` | number | 系统邮箱总数（全局，含未分配给任何用户的邮箱） |
| `admin_count` | number | 管理员总数（全局） |
| `active_count` | number | 可发件用户总数（全局） |

> 演示（guest）模式返回相同结构，其中统计字段基于内置的 mock 数据计算。

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

**权限：** 严格管理员或用户本人可访问。

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
| 429 | 请求过于频繁 |
| 500 | 服务器内部错误 |
