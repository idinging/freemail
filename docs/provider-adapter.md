# 发件渠道适配文档

本文说明如何为 Freemail 接入新的发件服务商。当前发件模块已经抽象到 `src/email/providers/`，业务路由会根据发件人域名自动选择渠道。

## 目录结构

```text
src/email/providers/
├── shared.js              # 共用工具：配置解析、域名匹配、payload 标准化
├── index.js               # 统一分发器：resolveProvider / sendEmailAuto / sendBatchAuto
├── resend/index.js        # Resend 渠道
├── sendflare/index.js     # SendFlare 渠道
└── cyberpersons/index.js  # Cyberpersons 渠道
```

新增渠道时，业务接口通常不需要改动。前端仍提交统一的发件 payload，后端按发件人域名和环境变量配置自动路由。

## 适配步骤

下面以 `yourprovider` 为例。

### 1. 新建 provider 模块

新建 `src/email/providers/yourprovider/index.js`，至少实现两个函数：

```js
import { normalizeSendPayload } from '../shared.js';

export async function sendEmailWithYourprovider(apiKey, payload) {
  const normalized = normalizeSendPayload(payload);

  // 调用你的发件服务商 API。
  // 返回值需要归一成 { id, raw }，id 可为空。
  return {
    id: null,
    raw: {}
  };
}

export async function sendBatchWithYourprovider(apiKey, payloads) {
  return Promise.all(
    payloads.map((payload) => sendEmailWithYourprovider(apiKey, payload))
  );
}
```

建议保持与现有渠道一致的入参语义：

- `payload.from`：发件人地址，可带发件人名称。
- `payload.to`：收件人列表或单个收件人。
- `payload.subject`：标题。
- `payload.html` / `payload.text`：邮件内容。

### 2. 在统一分发器注册

编辑 `src/email/providers/index.js`：

```js
import * as yourproviderProvider from './yourprovider/index.js';

export const yourprovider = yourproviderProvider;
```

然后在 `resolveProvider` 中增加 `yourproviderApiKey`，并加入域名匹配和单密钥兜底逻辑：

```js
export function resolveProvider(fromEmail, {
  resendApiKey = '',
  sendflareApiKey = '',
  cyberpersonsApiKey = '',
  yourproviderApiKey = ''
} = {}) {
  // 键值对 / JSON 命中优先
  if (yourproviderApiKey && !isSingleKey(yourproviderApiKey)) {
    const key = selectKeyForDomain(fromEmail, yourproviderApiKey);
    if (key) return { provider: 'yourprovider', apiKey: key };
  }

  // 单密钥兜底
  if (yourproviderApiKey && isSingleKey(yourproviderApiKey)) {
    return { provider: 'yourprovider', apiKey: yourproviderApiKey };
  }
}
```

最后在 `sendEmailAuto` 和 `sendBatchAuto` 中增加分支，调用你的 provider：

```js
if (provider === 'yourprovider') {
  const result = await yourproviderProvider.sendEmailWithYourprovider(apiKey, payload);
  return { provider, id: result.id || null, raw: result.raw };
}
```

批量发送分支也需要返回与入参顺序对齐的数组：

```js
out[item.idx] = {
  provider: 'yourprovider',
  id: r.id || null,
  raw: r.raw
};
```

### 3. 下传环境变量

编辑 `src/routes/api.js`，在发件接口使用的 `baseOpts` 中加入：

```js
yourproviderApiKey: c.env.YOURPROVIDER_API_KEY || ''
```

再在 `wrangler.toml` 的 `[vars]` 中增加示例变量：

```toml
YOURPROVIDER_API_KEY = ""
```

如果需要在 README 展示，也同步把变量加入环境变量表。

### 4. 写入发件记录

`sent_emails.provider` 字段已经存在，发件接口会记录 provider 名称。新增渠道时只需要确保 `sendEmailAuto` / `sendBatchAuto` 返回：

```js
{
  provider: 'yourprovider',
  id: 'service-message-id',
  raw: {}
}
```

如果服务商没有 message id，可以返回 `id: null`。

## API Key 配置格式

建议新渠道复用现有三种配置格式，便于多域名自动路由。

```bash
# 单密钥，作为所有发件域名的兜底
YOURPROVIDER_API_KEY="key_xxxxxxxxxxxxx"

# 键值对格式，推荐用于多域名
YOURPROVIDER_API_KEY="domain1.com=key1,domain2.com=key2"

# JSON 格式
YOURPROVIDER_API_KEY='{"domain1.com":"key1","domain2.com":"key2"}'
```

域名匹配请使用 `selectKeyForDomain(fromEmail, config)`，不要在 provider 内部重复解析环境变量。

## 适配注意事项

- provider 模块只负责调用第三方发件 API，不要写业务权限、用户校验或数据库逻辑。
- 优先用 `normalizeSendPayload` 统一 `from`、`to`、`html`、`text` 等字段。
- 第三方 API 的完整响应用 `raw` 返回，方便排查问题。
- 如果服务商不支持发件查询等能力，需要在对应 API 分支中返回明确错误。
- 不要在日志或错误信息中输出完整 API Key。

## 验证清单

1. 单密钥配置可以发送邮件。
2. 键值对配置可以按发件人域名命中正确渠道。
3. JSON 配置可以按发件人域名命中正确渠道。
4. 未命中域名时返回清晰错误。
5. 批量发送返回顺序与请求顺序一致。
6. `sent_emails.provider` 记录的是新增渠道名称。
7. 不支持的渠道能力有明确错误提示。
