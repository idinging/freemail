/**
 * 临时邮箱 Cloudflare Worker
 * 
 * 环境变量配置：
 * 1. D1 数据库绑定: TEMP_MAIL_DB
 * 2. 域名配置: MAIL_DOMAIN (例如: temp.example.com)
 * 3. 管理密码: ADMIN_PASSWORD (可选，用于管理界面)
 * 
 * 部署说明：
 * 1. 创建 D1 数据库
 * 2. 在 Worker 设置中绑定 D1 数据库为 TEMP_MAIL_DB
 * 3. 设置环境变量 MAIL_DOMAIN
 * 4. 配置邮件路由到此 Worker
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const DB = env.TEMP_MAIL_DB;
    const MAIL_DOMAIN = env.MAIL_DOMAIN || 'temp.example.com';
    
    // 初始化数据库表
    await initDatabase(DB);
    
    // 路由处理
    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, DB, MAIL_DOMAIN);
    }
    
    // 保持兼容：如果有外部服务以 HTTP 方式推送邮件，可用此端点
    if (request.method === 'POST' && url.pathname === '/receive') {
      return handleEmailReceive(request, DB);
    }
    
    // 返回前端界面
    return new Response(renderHtml(MAIL_DOMAIN), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  },

  // Email Routing → Worker 事件处理（无需额外后端即可接收邮件）
  async email(message, env, ctx) {
    const DB = env.TEMP_MAIL_DB;
    await initDatabase(DB);

    try {
      const headers = message.headers;
      const toHeader = headers.get('to') || headers.get('To') || '';
      const fromHeader = headers.get('from') || headers.get('From') || '';
      const subject = headers.get('subject') || headers.get('Subject') || '(无主题)';

      // Envelope 收件人（优先使用，以便根据本地域名前缀分流转发）
      let envelopeTo = '';
      try {
        const toValue = message.to;
        if (Array.isArray(toValue) && toValue.length > 0) {
          envelopeTo = typeof toValue[0] === 'string' ? toValue[0] : (toValue[0].address || '');
        } else if (typeof toValue === 'string') {
          envelopeTo = toValue;
        }
      } catch (_) {}

      const resolvedRecipient = (envelopeTo || toHeader || '').toString();
      const resolvedRecipientAddr = extractEmail(resolvedRecipient);
      const localPart = (resolvedRecipientAddr.split('@')[0] || '').toLowerCase();

      // 按本地部分前缀分发到指定 QQ 邮箱（需在 Cloudflare Email Routing 验证）
      try {
        if (localPart.startsWith('xms')) {
          ctx.waitUntil(message.forward('1815912130@qq.com'));
        } else if (localPart.startsWith('lz')) {
          ctx.waitUntil(message.forward('2106255667@qq.com'));
        } else {
          ctx.waitUntil(message.forward('2141083706@qq.com'));
        }
      } catch (e) {
        console.error('Forward error:', e);
      }

      // 读取原始邮件内容并做 MIME 正文解析（支持 base64 / quoted-printable）
      let textContent = '';
      let htmlContent = '';
      try {
        const rawText = await new Response(message.raw).text();
        const parsed = parseEmailBody(rawText);
        textContent = parsed.text || '';
        htmlContent = parsed.html || '';
      } catch (_) {
        textContent = '';
        htmlContent = '';
      }

      const mailbox = extractEmail(resolvedRecipient || toHeader);
      const sender = extractEmail(fromHeader);

      await DB.prepare(`
        INSERT INTO emails (mailbox, sender, subject, content, html_content)
        VALUES (?, ?, ?, ?, ?)
      `).bind(mailbox, sender, subject, textContent || htmlContent || '(无内容)', htmlContent || null).run();
    } catch (err) {
      // 不中断邮件流转，记录错误
      console.error('Email event handling error:', err);
    }
  }
};

// 初始化数据库表
async function initDatabase(db) {
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS emails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mailbox TEXT NOT NULL,
        sender TEXT NOT NULL,
        subject TEXT NOT NULL,
        content TEXT NOT NULL,
        html_content TEXT,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_read INTEGER DEFAULT 0
      );
      
      CREATE INDEX IF NOT EXISTS idx_mailbox ON emails(mailbox);
      CREATE INDEX IF NOT EXISTS idx_received_at ON emails(received_at DESC);
    `);
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// API 请求处理
async function handleApiRequest(request, db, mailDomain) {
  const url = new URL(request.url);
  const path = url.pathname;
  
  // 生成随机邮箱地址
  if (path === '/api/generate') {
    const randomId = generateRandomId();
    const email = `${randomId}@${mailDomain}`;
    return Response.json({ email, expires: Date.now() + 3600000 }); // 1小时过期
  }
  
  // 获取邮件列表
  if (path === '/api/emails') {
    const mailbox = url.searchParams.get('mailbox');
    if (!mailbox) {
      return new Response('Missing mailbox parameter', { status: 400 });
    }
    
    const { results } = await db.prepare(`
      SELECT id, sender, subject, received_at, is_read 
      FROM emails 
      WHERE mailbox = ? 
      ORDER BY received_at DESC 
      LIMIT 50
    `).bind(mailbox).all();
    
    return Response.json(results);
  }
  
  // 获取邮件详情
  if (path.startsWith('/api/email/')) {
    const emailId = path.split('/')[3];
    const { results } = await db.prepare(`
      SELECT * FROM emails WHERE id = ?
    `).bind(emailId).all();
    
    if (results.length === 0) {
      return new Response('Email not found', { status: 404 });
    }
    
    // 标记为已读
    await db.prepare(`
      UPDATE emails SET is_read = 1 WHERE id = ?
    `).bind(emailId).run();
    
    return Response.json(results[0]);
  }
  
  // 删除邮件
  if (request.method === 'DELETE' && path.startsWith('/api/email/')) {
    const emailId = path.split('/')[3];
    await db.prepare(`DELETE FROM emails WHERE id = ?`).bind(emailId).run();
    return Response.json({ success: true });
  }
  
  // 清空邮箱
  if (request.method === 'DELETE' && path === '/api/emails') {
    const mailbox = url.searchParams.get('mailbox');
    if (!mailbox) {
      return new Response('Missing mailbox parameter', { status: 400 });
    }
    
    await db.prepare(`DELETE FROM emails WHERE mailbox = ?`).bind(mailbox).run();
    return Response.json({ success: true });
  }
  
  return new Response('API endpoint not found', { status: 404 });
}

// 处理邮件接收
async function handleEmailReceive(request, db) {
  try {
    const emailData = await request.json();
    const { to, from, subject, text, html } = emailData;
    
    // 提取邮箱地址
    const mailbox = extractEmail(to);
    const sender = extractEmail(from);
    
    // 存储邮件
    await db.prepare(`
      INSERT INTO emails (mailbox, sender, subject, content, html_content)
      VALUES (?, ?, ?, ?, ?)
    `).bind(mailbox, sender, subject || '(无主题)', text || '', html || '').run();
    
    return Response.json({ success: true });
  } catch (error) {
    console.error('Email receive error:', error);
    return new Response('Error processing email', { status: 500 });
  }
}

// 生成随机邮箱ID
function generateRandomId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 提取邮箱地址
function extractEmail(emailString) {
  const match = emailString.match(/<(.+?)>/) || emailString.match(/([^\s<>]+@[^\s<>]+)/);
  return match ? match[1] : emailString;
}

// 从原始 MIME 文本中尽力提取正文（优先 HTML，其次文本）。该方法不依赖外部库，适合大多数常见邮件。
function parseEmailBody(raw) {
  if (!raw) return { text: '', html: '' };
  const { headers: topHeaders, body: topBody } = splitHeadersAndBody(raw);
  const ct = (topHeaders['content-type'] || '').toLowerCase();
  const boundary = getBoundary(ct);

  // 非 multipart，直接按单体解析
  if (!boundary) {
    const transferEnc = (topHeaders['content-transfer-encoding'] || '').toLowerCase();
    const decoded = decodeBody(topBody, transferEnc);
    const isHtml = ct.includes('text/html');
    const isText = ct.includes('text/plain') || !isHtml;
    return {
      text: isText ? decoded : '',
      html: isHtml ? decoded : ''
    };
  }

  // multipart，切分 part
  const parts = splitMultipart(topBody, boundary);
  let text = '';
  let html = '';
  for (const part of parts) {
    const { headers, body } = splitHeadersAndBody(part);
    const pct = (headers['content-type'] || '').toLowerCase();
    const penc = (headers['content-transfer-encoding'] || '').toLowerCase();
    const decoded = decodeBody(body, penc);
    if (!html && pct.includes('text/html')) {
      html = decoded;
    }
    if (!text && pct.includes('text/plain')) {
      text = decoded;
    }
    if (text && html) break;
  }
  // 兜底：若无 text/html，尝试从整体中抓取 HTML 标签
  if (!html) {
    const lower = raw.toLowerCase();
    const hs = lower.indexOf('<html');
    if (hs !== -1) {
      const he = lower.lastIndexOf('</html>');
      if (he !== -1) html = raw.slice(hs, he + 7);
    }
  }
  return { text, html };
}

function splitHeadersAndBody(input) {
  const idx = input.indexOf('\r\n\r\n');
  const idx2 = idx === -1 ? input.indexOf('\n\n') : idx;
  const sep = idx !== -1 ? 4 : (idx2 !== -1 ? 2 : -1);
  if (sep === -1) return { headers: {}, body: input };
  const rawHeaders = input.slice(0, (idx !== -1 ? idx : idx2));
  const body = input.slice((idx !== -1 ? idx : idx2) + sep);
  return { headers: parseHeaders(rawHeaders), body };
}

function parseHeaders(rawHeaders) {
  const headers = {};
  const lines = rawHeaders.split(/\r?\n/);
  let lastKey = '';
  for (const line of lines) {
    if (/^\s/.test(line) && lastKey) {
      headers[lastKey] += ' ' + line.trim();
      continue;
    }
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) {
      lastKey = m[1].toLowerCase();
      headers[lastKey] = m[2];
    }
  }
  return headers;
}

function getBoundary(contentType) {
  const m = contentType.match(/boundary=\"?([^\";\r\n]+)\"?/i);
  return m ? m[1] : '';
}

function splitMultipart(body, boundary) {
  const delim = '--' + boundary;
  const endDelim = delim + '--';
  const lines = body.split(/\r?\n/);
  const parts = [];
  let current = [];
  let inPart = false;
  for (const line of lines) {
    if (line === delim) {
      if (inPart && current.length) parts.push(current.join('\n'));
      current = [];
      inPart = true;
      continue;
    }
    if (line === endDelim) {
      if (inPart && current.length) parts.push(current.join('\n'));
      break;
    }
    if (inPart) current.push(line);
  }
  return parts;
}

function decodeBody(body, transferEncoding) {
  if (!body) return '';
  const enc = transferEncoding.trim();
  if (enc === 'base64') {
    const cleaned = body.replace(/\s+/g, '');
    try {
      const bin = atob(cleaned);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      try {
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      } catch (_) {
        return bin;
      }
    } catch (_) {
      return body;
    }
  }
  if (enc === 'quoted-printable') {
    return decodeQuotedPrintable(body);
  }
  // 其他或未声明编码，直接返回
  return body;
}

function decodeQuotedPrintable(input) {
  // 去除软换行 =\r\n 或 =\n
  let s = input.replace(/=\r?\n/g, '');
  // 替换 =XX 为对应字节
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '=' && i + 2 < s.length) {
      const hex = s.substring(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(ch.charCodeAt(0));
  }
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
  } catch (_) {
    return s;
  }
}

// 渲染前端HTML
function renderHtml(mailDomain) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>临时邮箱 - ${mailDomain}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh; color: #333;
    }
    .container { max-width: 1000px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin-bottom: 30px; color: white; }
    .header h1 { font-size: 2.5em; margin-bottom: 10px; }
    .card { 
      background: white; border-radius: 12px; padding: 25px; 
      box-shadow: 0 10px 30px rgba(0,0,0,0.1); margin-bottom: 20px;
    }
    .email-gen { text-align: center; }
    .email-display { 
      background: #f8f9fa; border: 2px dashed #dee2e6; 
      padding: 15px; border-radius: 8px; margin: 15px 0;
      font-family: monospace; font-size: 1.1em; word-break: break-all;
    }
    .btn { 
      background: #007bff; color: white; border: none; 
      padding: 12px 24px; border-radius: 6px; cursor: pointer;
      font-size: 1em; margin: 5px; transition: all 0.3s;
    }
    .btn:hover { background: #0056b3; transform: translateY(-2px); }
    .btn-danger { background: #dc3545; }
    .btn-danger:hover { background: #c82333; }
    .email-list { max-height: 400px; overflow-y: auto; }
    .email-item { 
      border-bottom: 1px solid #eee; padding: 15px 0; 
      cursor: pointer; transition: background 0.2s;
    }
    .email-item:hover { background: #f8f9fa; }
    .email-item.unread { font-weight: bold; }
    .email-meta { display: flex; justify-content: space-between; margin-bottom: 5px; }
    .email-subject { font-size: 1.1em; }
    .email-sender { color: #666; font-size: 0.9em; }
    .email-time { color: #999; font-size: 0.8em; }
    .modal { 
      display: none; position: fixed; top: 0; left: 0; 
      width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000;
    }
    .modal-content { 
      background: white; margin: 5% auto; padding: 20px; 
      border-radius: 8px; max-width: 800px; max-height: 80vh; overflow-y: auto;
    }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .close { font-size: 28px; cursor: pointer; }
    .loading { text-align: center; padding: 20px; color: #666; }
    .empty { text-align: center; padding: 40px; color: #999; }
    @media (max-width: 768px) {
      .container { padding: 10px; }
      .header h1 { font-size: 2em; }
      .card { padding: 15px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📧 临时邮箱</h1>
      <p>安全、快速、免费的临时邮箱服务</p>
    </div>
    
    <div class="card email-gen">
      <h2>生成临时邮箱</h2>
      <div id="current-email" class="email-display">点击下方按钮生成邮箱地址</div>
      <button class="btn" onclick="generateEmail()">🎲 生成新邮箱</button>
      <button class="btn" onclick="copyEmail()" id="copy-btn" style="display:none">📋 复制邮箱</button>
      <button class="btn btn-danger" onclick="clearEmails()" id="clear-btn" style="display:none">🗑️ 清空邮件</button>
    </div>
    
    <div class="card" id="email-section" style="display:none">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <h2>📬 收件箱</h2>
        <button class="btn" onclick="refreshEmails()">🔄 刷新</button>
      </div>
      <div id="email-list" class="email-list">
        <div class="loading">等待邮件中...</div>
      </div>
    </div>
  </div>
  
  <!-- 邮件详情模态框 -->
  <div id="email-modal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h3 id="modal-subject">邮件详情</h3>
        <span class="close" onclick="closeModal()">&times;</span>
      </div>
      <div id="modal-body"></div>
    </div>
  </div>

  <script>
    let currentMailbox = '';
    let refreshInterval;
    
    // 生成邮箱地址
    async function generateEmail() {
      try {
        const response = await fetch('/api/generate');
        const data = await response.json();
        currentMailbox = data.email;
        
        document.getElementById('current-email').textContent = currentMailbox;
        document.getElementById('copy-btn').style.display = 'inline-block';
        document.getElementById('clear-btn').style.display = 'inline-block';
        document.getElementById('email-section').style.display = 'block';
        
        // 开始刷新邮件
        refreshEmails();
        startAutoRefresh();
      } catch (error) {
        alert('生成邮箱失败，请重试');
      }
    }
    
    // 复制邮箱地址
    function copyEmail() {
      navigator.clipboard.writeText(currentMailbox).then(() => {
        const btn = document.getElementById('copy-btn');
        const originalText = btn.textContent;
        btn.textContent = '✅ 已复制';
        setTimeout(() => btn.textContent = originalText, 2000);
      });
    }
    
    // 刷新邮件列表
    async function refreshEmails() {
      if (!currentMailbox) return;
      
      try {
        const response = await fetch(\`/api/emails?mailbox=\${encodeURIComponent(currentMailbox)}\`);
        const emails = await response.json();
        
        const listEl = document.getElementById('email-list');
        if (emails.length === 0) {
          listEl.innerHTML = '<div class="empty">📭 暂无邮件</div>';
          return;
        }
        
        listEl.innerHTML = emails.map(email => \`
          <div class="email-item \${email.is_read ? '' : 'unread'}" onclick="showEmail(\${email.id})">
            <div class="email-meta">
              <span class="email-sender">来自: \${email.sender}</span>
              <span class="email-time">\${new Date(email.received_at).toLocaleString()}</span>
            </div>
            <div class="email-subject">\${email.subject}</div>
          </div>
        \`).join('');
      } catch (error) {
        console.error('刷新邮件失败:', error);
      }
    }
    
    // 显示邮件详情
    async function showEmail(emailId) {
      try {
        const response = await fetch(\`/api/email/\${emailId}\`);
        const email = await response.json();
        
        document.getElementById('modal-subject').textContent = email.subject;
        document.getElementById('modal-body').innerHTML = \`
          <p><strong>发件人:</strong> \${email.sender}</p>
          <p><strong>收件人:</strong> \${email.mailbox}</p>
          <p><strong>时间:</strong> \${new Date(email.received_at).toLocaleString()}</p>
          <hr style="margin: 15px 0;">
          <div style="white-space: pre-wrap;">\${email.html_content || email.content}</div>
        \`;
        
        document.getElementById('email-modal').style.display = 'block';
        refreshEmails(); // 刷新列表以更新已读状态
      } catch (error) {
        alert('加载邮件失败');
      }
    }
    
    // 关闭模态框
    function closeModal() {
      document.getElementById('email-modal').style.display = 'none';
    }
    
    // 清空邮件
    async function clearEmails() {
      if (!confirm('确定要清空所有邮件吗？')) return;
      
      try {
        await fetch(\`/api/emails?mailbox=\${encodeURIComponent(currentMailbox)}\`, {
          method: 'DELETE'
        });
        refreshEmails();
      } catch (error) {
        alert('清空邮件失败');
      }
    }
    
    // 自动刷新
    function startAutoRefresh() {
      if (refreshInterval) clearInterval(refreshInterval);
      refreshInterval = setInterval(refreshEmails, 10000); // 每10秒刷新
    }
    
    // 点击模态框外部关闭
    window.onclick = function(event) {
      const modal = document.getElementById('email-modal');
      if (event.target === modal) {
        closeModal();
      }
    }
  </script>
</body>
</html>`;
}
