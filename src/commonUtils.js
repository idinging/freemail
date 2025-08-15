export function generateRandomId(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const len = Math.max(4, Math.min(32, Number(length) || 8));
  for (let i = 0; i < len; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function extractEmail(emailString) {
  const match = emailString.match(/<(.+?)>/) || emailString.match(/([^\s<>]+@[^\s<>]+)/);
  return match ? match[1] : emailString;
}
// 将 D1 返回的 UTC 时间（YYYY-MM-DD HH:MM:SS）格式化为东八区显示
export function formatTs(ts){
  if (!ts) return '';
  try {
    // 统一转成 ISO 再追加 Z 标记为 UTC
    const iso = ts.includes('T') ? ts.replace(' ', 'T') : ts.replace(' ', 'T');
    const d = new Date(iso + 'Z');
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(d);
  } catch (_) { return ts; }
}

