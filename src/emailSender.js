// 发送邮件服务（Resend）——基于 fetch 的 Edge 兼容实现

function buildHeaders(apiKey){
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
}

function normalizeSendPayload(payload){
  const {
    from,
    to,
    subject,
    html,
    text,
    cc,
    bcc,
    replyTo,
    headers,
    attachments,
    scheduledAt
  } = payload || {};

  const body = {
    from,
    to: Array.isArray(to) ? to : (to ? [to] : []),
    subject,
    html,
    text,
  };
  // 支持自定义发件显示名：fromName + <from>
  // 仅当 fromName 非空白时才拼接，避免产生 ` <email>` 导致 Resend 校验失败
  if (payload && typeof payload.fromName === 'string' && from){
    const displayName = payload.fromName.trim();
    if (displayName) {
      body.from = `${displayName} <${from}>`;
    }
  }
  if (cc) body.cc = Array.isArray(cc) ? cc : [cc];
  if (bcc) body.bcc = Array.isArray(bcc) ? bcc : [bcc];
  if (replyTo) body.reply_to = replyTo;
  if (headers && typeof headers === 'object') body.headers = headers;
  if (attachments && Array.isArray(attachments)) body.attachments = attachments;
  if (scheduledAt) body.scheduled_at = scheduledAt; // 传入 ISO 字符串
  return body;
}

export async function sendEmailWithResend(apiKey, payload){
  const body = normalizeSendPayload(payload);
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify(body)
  });
  const data = await resp.json().catch(()=>({}));
  if (!resp.ok){
    const msg = data?.message || data?.error || resp.statusText || 'Resend send failed';
    throw new Error(msg);
  }
  return data; // { id: '...' }
}

export async function sendBatchWithResend(apiKey, payloads){
  const items = Array.isArray(payloads) ? payloads.map(normalizeSendPayload) : [];
  const resp = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify(items)
  });
  const data = await resp.json().catch(()=>({}));
  if (!resp.ok){
    const msg = data?.message || data?.error || resp.statusText || 'Resend batch send failed';
    throw new Error(msg);
  }
  return data; // 通常返回 [{id: '...'}, ...] 或 成功/失败结果数组
}

export async function getEmailFromResend(apiKey, id){
  const resp = await fetch(`https://api.resend.com/emails/${id}`, {
    method: 'GET',
    headers: buildHeaders(apiKey)
  });
  const data = await resp.json().catch(()=>({}));
  if (!resp.ok){
    const msg = data?.message || data?.error || resp.statusText || 'Resend get failed';
    throw new Error(msg);
  }
  return data;
}

export async function updateEmailInResend(apiKey, { id, scheduledAt }){
  const body = {};
  if (scheduledAt) body.scheduled_at = scheduledAt;
  const resp = await fetch(`https://api.resend.com/emails/${id}`, {
    method: 'PATCH',
    headers: buildHeaders(apiKey),
    body: JSON.stringify(body)
  });
  const data = await resp.json().catch(()=>({}));
  if (!resp.ok){
    const msg = data?.message || data?.error || resp.statusText || 'Resend update failed';
    throw new Error(msg);
  }
  return data;
}

export async function cancelEmailInResend(apiKey, id){
  const resp = await fetch(`https://api.resend.com/emails/${id}/cancel`, {
    method: 'POST',
    headers: buildHeaders(apiKey)
  });
  const data = await resp.json().catch(()=>({}));
  if (!resp.ok){
    const msg = data?.message || data?.error || resp.statusText || 'Resend cancel failed';
    throw new Error(msg);
  }
  return data;
}


