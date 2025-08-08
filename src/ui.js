export function renderHtml(mailDomain) {
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
    
    async function generateEmail() {
      try {
        const response = await fetch('/api/generate');
        const data = await response.json();
        currentMailbox = data.email;
        
        document.getElementById('current-email').textContent = currentMailbox;
        document.getElementById('copy-btn').style.display = 'inline-block';
        document.getElementById('clear-btn').style.display = 'inline-block';
        document.getElementById('email-section').style.display = 'block';
        
        refreshEmails();
        startAutoRefresh();
      } catch (error) {
        alert('生成邮箱失败，请重试');
      }
    }
    
    function copyEmail() {
      navigator.clipboard.writeText(currentMailbox).then(() => {
        const btn = document.getElementById('copy-btn');
        const originalText = btn.textContent;
        btn.textContent = '✅ 已复制';
        setTimeout(() => btn.textContent = originalText, 2000);
      });
    }
    
    async function refreshEmails() {
      if (!currentMailbox) return;
      try {
        const response = await fetch(`/api/emails?mailbox=${encodeURIComponent(currentMailbox)}`);
        const emails = await response.json();
        const listEl = document.getElementById('email-list');
        if (emails.length === 0) {
          listEl.innerHTML = '<div class="empty">📭 暂无邮件</div>';
          return;
        }
        listEl.innerHTML = emails.map(email => `
          <div class="email-item ${email.is_read ? '' : 'unread'}" onclick="showEmail(${email.id})">
            <div class="email-meta">
              <span class="email-sender">来自: ${email.sender}</span>
              <span class="email-time">${new Date(email.received_at).toLocaleString()}</span>
            </div>
            <div class="email-subject">${email.subject}</div>
          </div>
        `).join('');
      } catch (error) {
        console.error('刷新邮件失败:', error);
      }
    }
    
    async function showEmail(emailId) {
      try {
        const response = await fetch(`/api/email/${emailId}`);
        const email = await response.json();
        document.getElementById('modal-subject').textContent = email.subject;
        document.getElementById('modal-body').innerHTML = `
          <p><strong>发件人:</strong> ${email.sender}</p>
          <p><strong>收件人:</strong> ${email.mailbox}</p>
          <p><strong>时间:</strong> ${new Date(email.received_at).toLocaleString()}</p>
          <hr style="margin: 15px 0;">
          <div style="white-space: pre-wrap;">${email.html_content || email.content}</div>
        `;
        document.getElementById('email-modal').style.display = 'block';
        refreshEmails();
      } catch (error) {
        alert('加载邮件失败');
      }
    }
    
    function closeModal() {
      document.getElementById('email-modal').style.display = 'none';
    }
    
    async function clearEmails() {
      if (!confirm('确定要清空所有邮件吗？')) return;
      try {
        await fetch(`/api/emails?mailbox=${encodeURIComponent(currentMailbox)}`, { method: 'DELETE' });
        refreshEmails();
      } catch (error) {
        alert('清空邮件失败');
      }
    }
    
    function startAutoRefresh() {
      if (refreshInterval) clearInterval(refreshInterval);
      refreshInterval = setInterval(refreshEmails, 10000);
    }
    
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

