# 临时邮箱 Cloudflare Worker（模块化结构）

一个基于 Cloudflare Workers 和 D1 数据库的临时邮箱服务。

## 功能特性

- 🎲 随机生成临时邮箱地址
- 📧 实时接收和显示邮件
- 📱 响应式设计，支持移动端
- 🗑️ 邮件管理（查看、删除、清空）
- ⚡ 基于 Cloudflare 全球网络，速度快
- 💾 使用 D1 数据库存储，可靠稳定

## 部署步骤

### 1. 创建 D1 数据库

```bash
# 安装 Wrangler CLI
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 创建 D1 数据库
wrangler d1 create temp-mail-db
```

### 2. 配置 wrangler.toml（已改为模块化入口）

复制返回的数据库 ID，更新 `wrangler.toml` 文件：

```toml
main = "src/index.js"

[[d1_databases]]
binding = "TEMP_MAIL_DB"
database_name = "temp-mail-db"
database_id = "你的数据库ID"

[vars]
MAIL_DOMAIN = "你的域名.com"
```

### 3. GitHub 仓库与 Cloudflare 部署

1. 将 `mail/` 目录初始化为 Git 仓库并推送到 GitHub（或在根仓库中配置子目录部署）：
   - 创建新仓库（GitHub 上）
   - 本地在 `mail/` 目录执行：
     ```bash
     git init
     git remote add origin <your-github-repo-url>
     git add .
     git commit -m "init temp mail worker modular"
     git branch -M main
     git push -u origin main
     ```
2. 在 Cloudflare Dashboard 中：
   - Workers & Pages → Create application → Pages → Connect to Git
   - 选择你的 GitHub 仓库
   - Framework preset: None
   - Build command: 空（不需要构建）
   - Build output directory: `mail` 或直接在 Workers 里选择基于该仓库的 Worker 部署
   - 对于 Workers（非 Pages）：在 Workers → Create → 使用 Git 集成，指定入口 `src/index.js`
3. 在 Worker 设置中绑定 D1（`TEMP_MAIL_DB`）与环境变量 `MAIL_DOMAIN`
4. 在 Email Routing 中创建路由并指向该 Worker

### 4. 配置邮件路由（必需用于收取真实邮件）

如果需要接收真实邮件，需要在 Cloudflare 控制台配置邮件路由：

1. 进入域名的 Email Routing 设置
2. 添加 Catch-all 规则
3. 目标设置为 Worker: `temp-mail-worker`

### 5. 设置自定义域名（可选）

在 Worker 设置中添加自定义域名，或使用 workers.dev 子域名。

## 环境变量说明

| 变量名 | 说明 | 必需 |
|--------|------|------|
| TEMP_MAIL_DB | D1 数据库绑定 | 是 |
| MAIL_DOMAIN | 邮箱域名 | 是 |
| ADMIN_PASSWORD | 管理密码（预留） | 否 |

## API 接口

### 生成邮箱
- `GET /api/generate`
- 返回: `{ "email": "random@domain.com", "expires": timestamp }`

### 获取邮件列表
- `GET /api/emails?mailbox=email@domain.com`
- 返回: 邮件列表数组

### 获取邮件详情
- `GET /api/email/{id}`
- 返回: 邮件详细内容

### 删除邮件
- `DELETE /api/email/{id}`
- 返回: `{ "success": true }`

### 清空邮箱
- `DELETE /api/emails?mailbox=email@domain.com`
- 返回: `{ "success": true }`

## 使用说明

1. 访问部署的 Worker URL
2. 点击"生成新邮箱"获取临时邮箱地址
3. 使用该地址接收邮件
4. 邮件会自动显示在收件箱中
5. 点击邮件查看详细内容

## 注意事项

- 邮件数据存储在 D1 数据库中，请注意数据隐私
- 建议定期清理过期邮件
- D1 数据库有免费额度限制
- 邮件接收需要配置邮件路由

## 自定义配置

可以通过修改 Worker 代码来自定义：

- 邮箱地址生成规则
- 邮件保存时间
- 界面样式
- 功能扩展

## 故障排除

1. **邮件接收不到**：检查邮件路由配置
2. **数据库错误**：确认 D1 数据库绑定正确
3. **域名问题**：检查 MAIL_DOMAIN 环境变量

## 许可证

MIT License
