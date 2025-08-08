export function generateRandomId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function extractEmail(emailString) {
  const match = emailString.match(/<(.+?)>/) || emailString.match(/([^\s<>]+@[^\s<>]+)/);
  return match ? match[1] : emailString;
}

