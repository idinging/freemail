# Freemail - Temporary Email Service

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/idinging/freemail)

🇬🇧 English | 🌐 [中文](README.md)

An open-source **temporary email service** built on Cloudflare Workers + D1 + R2, featuring a decoupled frontend and backend, RESTful API support, and full functionality including email receiving, sending, forwarding, and user management.

**Current version: V5.3.1** - New Cyberpersons sending channel with automatic Resend / SendFlare / Cyberpersons routing based on sender domain.

`This email service supports automatic mailbox creation upon receiving emails. Forwarding target email addresses must be verified in Cloudflare Email Addresses.`

📖 **[One-Click Deployment Guide](docs/yijianbushu.md)** | 🤖 **[GitHub Actions Deployment Guide](docs/action-deployment.md)** | 📬 **[Resend Sending Config](docs/resend.md)** | 🚀 **[SendFlare Sending Config](docs/sendflare.md)** | ☁️ **[Cyberpersons Sending Config](docs/cyberpersons.md)** | 🧩 **[Provider Adapter](docs/provider-adapter.md)** | 📚 **[API Docs](docs/api.md)**

## 📸 Project Showcase

### Demo: https://freemail.cq.de5.net

### Demo Account: guest
### Demo Password: guest

### Screenshots

| Home | All Mailboxes |
|------|---------------|
| ![Home](./pic/light/shouye.png) | ![All Mailboxes](./pic/light/suoyouyouxiang.png) |

| User Management | Single Mailbox Login |
|-----------------|---------------------|
| ![User Management](./pic/light/yonghuguanli.png) | ![Single Mailbox Login](./pic/dange邮箱登录.png) |

[Light Mode Showcase](docs/zhanshi-light.md) | [Dark Mode Showcase](docs/zhanshi-dark.md)

## Features

| Category | Features |
|----------|----------|
| 📧 **Mailbox Management** | Random temporary email generation · Multi-domain support · Pin/favorite · History · Mailbox search |
| 💌 **Email Features** | Real-time receiving · Auto-refresh · Smart verification code extraction · HTML/plain text · Email forwarding |
| ✉️ **Sending Support** | Multi-channel sending (Resend / SendFlare / Cyberpersons) · Automatic domain-based routing · Multi-domain keys · Batch sending · Sending history |
| ⚡ **Tech Stack** | Cloudflare Workers · D1 Database · R2 Storage · Email Routing |

## Version History

| Version | Key Updates |
|---------|-------------|
| **V5.3.1** | New Cyberpersons (CyberPanel Email Delivery) sending channel · Three-tier routing (SendFlare → Resend → Cyberpersons) · Cyberpersons API adaptation (single-string recipient, independent from_name, message_id extraction) |
| **V5.3.0** | Sending module abstracted to `src/email/providers/` · New SendFlare channel (based on `sendflare-sdk-ts`) · Automatic Resend / SendFlare routing by sender domain · `sent_emails` table adds `provider` field |
| **V5.2.0** | Introduced postal-mime for improved email parsing · Fixed Chinese character garbled text in some clients |
| **V5.1.0** | Mailbox alias normalization support extended with `.`, `+`, `-` separators |
| **V1.0~v4.0** | Mailbox generation · Email receiving · Verification code extraction · User management admin panel · R2 EML storage |

## Deployment Configuration

### Quick Start

1. **One-Click Deploy**: Click the button above and follow the [Deployment Guide](docs/yijianbushu.md)
2. **Configure Email Routing** (required for receiving): Domain → Email Routing → Catch-all → Bind Worker
3. **Configure Sending** (optional): Refer to [Resend Guide](docs/resend.md), [SendFlare Guide](docs/sendflare.md), or [Cyberpersons Guide](docs/cyberpersons.md). All three can be enabled simultaneously.

> When deploying via Git integration, manually configure environment variables in Workers → Settings → Variables.

### Local Development

Local development is suitable for debugging the frontend, admin API, and sending logic. Real email receiving still depends on Cloudflare Email Routing, so deployment to Cloudflare Workers is required for full verification.

1. **Install Dependencies**

```bash
npm install
```

2. **Configure Local Variables**

Modify `[vars]`, D1, and R2 bindings in `wrangler.toml` as needed. At minimum, set:

```toml
ADMIN_NAME = "admin"
ADMIN_PASSWORD = "your_admin_password"
JWT_TOKEN = "your_random_jwt_secret"
MAIL_DOMAIN = "example.com"
```

3. **Initialize Local D1 Database**

```bash
npx wrangler d1 execute maill_free_db --local --file=./d1-init.sql
```

If you changed `database_name` in `wrangler.toml`, replace `maill_free_db` with your database name.

4. **Start Local Development Server**

```bash
npx wrangler dev
```

After starting, access the local URL output by Wrangler. Default admin account is `admin`, password is `ADMIN_PASSWORD`.

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| TEMP_MAIL_DB | D1 database binding | Yes |
| MAIL_EML | R2 storage bucket binding | Yes |
| MAIL_DOMAIN | Email domain(s), comma-separated for multiple | Yes |
| ADMIN_PASSWORD | Admin password | Yes |
| ADMIN_NAME | Admin username (default `admin`) | No |
| JWT_TOKEN | JWT signing secret | Yes |
| RESEND_API_KEY | Resend sending key, supports multi-domain config | No |
| SENDFLARE_API_KEY | SendFlare sending key, same format as Resend | No |
| CYBERPERSONS_API_KEY | Cyberpersons sending key, same format as Resend | No |
| FORWARD_RULES | Email forwarding rules | No |

<details>
<summary><strong>RESEND_API_KEY / SENDFLARE_API_KEY / CYBERPERSONS_API_KEY Configuration Format</strong></summary>

All three channels support the same three configuration formats:

```bash
# Single key (wildcard for all sending domains)
RESEND_API_KEY="re_xxxxxxxxxxxxxxxxxxxxxxxx"
SENDFLARE_API_KEY="live_xxxxxxxxxxxxxxxxxxxxxxxx"
CYBERPERSONS_API_KEY="sk_lera_xxxxxxxxxxxxxxxxxxxxxxxx"

# Key-value pairs (recommended, for multi-domain independent billing / limits)
RESEND_API_KEY="domain1.com=re_key1,domain2.com=re_key2"
SENDFLARE_API_KEY="domain3.com=live_key3"
CYBERPERSONS_API_KEY="domain4.com=sk_live_key4"

# JSON format
RESEND_API_KEY='{"domain1.com":"re_key1","domain2.com":"re_key2"}'
```

**Channel Routing Rules** (when all three channels are configured):

1. SendFlare key-value/JSON matches sender domain → Use SendFlare
2. Resend key-value/JSON matches → Use Resend
3. Cyberpersons key-value/JSON matches → Use Cyberpersons
4. SendFlare single key fallback → Use SendFlare
5. Resend single key fallback → Use Resend
6. Cyberpersons single key fallback → Use Cyberpersons
7. None matched → Error: "No sending API Key found for the domain"

Note: SendFlare and Cyberpersons do not currently support sending query, modifying `scheduled_at`, or canceling scheduled emails. Related API endpoints will return 400 "SendFlare / Cyberpersons channel does not support this operation" for emails sent via these channels.
</details>

<details>
<summary><strong>How to Add a New Sending Channel</strong></summary>

The sending module has been abstracted to `src/email/providers/`. Adding a new channel usually requires no changes to the frontend or business routes. See [Provider Adapter Docs](docs/provider-adapter.md) for adaptation steps.
</details>

<details>
<summary><strong>FORWARD_RULES Configuration Format</strong></summary>

Rules are matched by prefix, with `*` as the catch-all rule.

⚠️ **Important**: Forwarding target email addresses must be verified in the Cloudflare console before use:
1. Go to Cloudflare Console → Domain → Email → Email Routing
2. Switch to "Destination Addresses" tab
3. Click "Add Destination Address" and enter the forwarding target
4. Go to the target mailbox and click the confirmation link in the verification email

![Forwarding Target Address Verification](pic/resend/zhuanfa.png)

```bash
# Key-value format
FORWARD_RULES="vip=a@example.com,news=b@example.com,*=fallback@example.com"

# JSON format
FORWARD_RULES='[{"prefix":"vip","email":"a@example.com"},{"prefix":"*","email":"fallback@example.com"}]'

# Disable forwarding
FORWARD_RULES="" or "disabled" or "none"
```
</details>

## Troubleshooting

<details>
<summary><strong>Common Issues</strong></summary>

1. **Emails not being received**: Check Email Routing configuration, MX records, and MAIL_DOMAIN variable
2. **Database connection errors**: Confirm D1 binding is `TEMP_MAIL_DB` and check database_id
3. **Login issues**: Verify ADMIN_PASSWORD and JWT_TOKEN are set, clear browser cache
4. **UI display issues**: Check static resource paths and browser console errors
</details>

<details>
<summary><strong>Debugging Tips</strong></summary>

```bash
# Local debugging
wrangler dev

# Check database
wrangler d1 execute TEMP_MAIL_DB --command "SELECT * FROM mailboxes LIMIT 10"
```
</details>

## Notes

- **Static Asset Cache**: After updates, Purge Everything in the Cloudflare console and force-refresh the browser
- **R2/D1 Costs**: Free quota limits apply; regularly clean up expired emails
- **Security**: Always change the default `ADMIN_PASSWORD` and `JWT_TOKEN` in production

## Automatic Deployment

This project supports automatic deployment to Cloudflare Workers via GitHub Actions. See the [Automatic Deployment Guide](docs/action-deployment.md) for details.

## Contributors

Thanks to [sarsanta](https://github.com/sarsanta) for contributing the GitHub Actions automatic deployment feature!

Thanks to [oxygen](https://github.com/daimiaopeng) for contributing the privilege escalation vulnerability fix.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=idinging/freemail&type=Date)](https://www.star-history.com/#idinging/freemail&Date)

## Contact

- WeChat: `iYear1213`

## Buy me a coffee

If you find this project useful, consider supporting with a donation:

<p align="left">
  <img src="pic/alipay.jpg" alt="Alipay QR" height="400" />
  <img src="pic/weichat.jpg" alt="WeChat QR" height="400" />
</p>

## License

Apache-2.0 license
