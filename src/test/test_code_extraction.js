/**
 * 验证码提取测试（前端兜底 + 后端写库两条链路）
 *
 * 背景：验证码有两份提取逻辑，后端 extractVerificationCode 的结果会写库，
 * 前端 extractCode 只是兜底，且调用处是 `e.verification_code || extractCode(...)`，
 * 所以两条链路都要覆盖，否则只修一处不生效。
 *
 * 运行：node src/test/test_code_extraction.js
 */

const { extractVerificationCode } = await import(new URL('../../src/email/parser.js', import.meta.url).href);
const { extractCode } = await import(new URL('../../public/js/modules/app/ui-helpers.js', import.meta.url).href);

const FRONTEND_CASES = [
  // 误报：邮箱地址 / URL 里的数字串
  { label: '邮箱地址里的 6 位数字', text: '发件人 xxx888888@example.com 正文无验证码', expected: '' },
  { label: 'URL 里的 6 位数字', text: 'https://example.com/o/123456', expected: '' },
  { label: '邮箱 + 真验证码同时存在', text: 'From xxx888888@example.com 您的验证码是 611407', expected: '611407' },

  // 回归保护：逐位分隔写法不能被截断
  { label: '逐位空格 6 位', text: '您的验证码为 8 8 2 9 1 3', expected: '882913' },
  { label: '逐位横杠 6 位', text: '验证码 8-8-2-9-1-3', expected: '882913' },
  { label: '逐位空格 8 位', text: '验证码 1 2 3 4 5 6 7 8', expected: '12345678' },
  { label: '逐位空格 4 位', text: '验证码 1 2 3 4', expected: '1234' },

  // 分组写法
  { label: '分组 3-3 横杠', text: 'Verification code: 123-456', expected: '123456' },
  { label: '分组 3 3 空格', text: 'code 123 456', expected: '123456' },
  { label: '分组 2-2-2 空格', text: 'code 45 82 91', expected: '458291' },

  // 常规场景
  { label: '中文验证码', text: '您的验证码是：123456', expected: '123456' },
  { label: '英文 login code', text: 'Your login code is 908172', expected: '908172' },
  { label: 'HTML 标签包裹', text: '<p>您的验证码是</p><span>611407</span>', expected: '611407' },
  { label: '字母数字混合', text: '验证码 A1B2C3', expected: 'A1B2C3' },
  { label: '空文本', text: '', expected: '' },
];

const BACKEND_CASES = [
  // 误报：转发邮件头部里的发件人地址 + 正文任意关键词
  {
    label: '转发头 From 地址 + Subject 含 Security',
    input: { subject: '', text: 'Forwarded message\nFrom: xxx888888@example.com\nSubject: Security alert for your account\n\nHello' },
    expected: '',
  },
  {
    label: 'From 地址 + encoded',
    input: { subject: '', text: 'From: xxx888888@example.com\nThis message is encoded in UTF-8' },
    expected: '',
  },
  {
    label: 'From 地址 + 中文「验证码」',
    input: { subject: '', text: 'From: xxx888888@example.com\n请勿泄露验证码给他人' },
    expected: '',
  },
  {
    label: 'From 地址 + Date 头 + login（日期不得当码）',
    input: { subject: '', text: 'From: xxx888888@example.com\nDate: 2026-10-29\n\nPlease login to continue' },
    expected: '',
  },
  {
    label: '正文含 URL 数字串',
    input: { subject: '', text: 'Verification link https://example.com/v/123456 expired' },
    expected: '',
  },

  // 常规场景
  { label: '中文验证码', input: { subject: '验证码', text: '您的验证码是 611407，5分钟内有效' }, expected: '611407' },
  { label: '英文 login code', input: { subject: '', text: 'Your login code is 908172' }, expected: '908172' },
  { label: '主题里的验证码', input: { subject: 'Your code 739513 expires soon', text: 'Hello' }, expected: '739513' },
  { label: '空邮件', input: { subject: '', text: '' }, expected: '' },
  {
    label: '转发邮件中同时含地址与真验证码',
    input: { subject: '', text: 'From: xxx888888@example.com\nSubject: Security alert\n\n您的验证码是 611407' },
    expected: '611407',
  },
];

let passed = 0;
let failed = 0;

function report(label, expected, actual) {
  if (expected === actual) {
    passed++;
    console.log(`✓ PASS  ${label}`);
  } else {
    failed++;
    console.log(`✗ FAIL  ${label}`);
    console.log(`        预期: ${JSON.stringify(expected)} | 实际: ${JSON.stringify(actual)}`);
  }
}

console.log('=== 前端 extractCode（public/js/modules/app/ui-helpers.js）===\n');
for (const c of FRONTEND_CASES) {
  report(c.label, c.expected, extractCode(c.text));
}

console.log('\n=== 后端 extractVerificationCode（src/email/parser.js）===\n');
for (const c of BACKEND_CASES) {
  report(c.label, c.expected, extractVerificationCode(c.input));
}

console.log(`\n总计: ${passed} 通过, ${failed} 失败, ${passed + failed} 测试`);
if (failed > 0) process.exitCode = 1;