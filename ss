下面给项目集成使用临时邮箱发送邮件的功能，使用RESEND提供的api，import { Resend } from 'resend';

const resend = new Resend('re_xxxxxxxxx');

await resend.emails.send({
  from: 'Acme <onboarding@resend.dev>',
  to: ['delivered@resend.dev'],
  subject: 'hello world',
  html: '<p>it works!</p>',
});import { Resend } from 'resend';

const resend = new Resend('re_xxxxxxxxx');

await resend.batch.send([
  {
    from: 'Acme <onboarding@resend.dev>',
    to: ['foo@gmail.com'],
    subject: 'hello world',
    html: '<h1>it works!</h1>',
  },
  {
    from: 'Acme <onboarding@resend.dev>',
    to: ['bar@outlook.com'],
    subject: 'world hello',
    html: '<p>it works!</p>',
  },
]);import { Resend } from 'resend';

const resend = new Resend('re_xxxxxxxxx');

resend.emails.get('4ef9a417-02e9-4d39-ad75-9611e0fcc33c');import { Resend } from 'resend';

const resend = new Resend('re_xxxxxxxxx');

const oneMinuteFromNow = new Date(Date.now() + 1000 * 60).toISOString();

resend.emails.update({
  id: '4ef9a417-02e9-4d39-ad75-9611e0fcc33c',
  scheduledAt: oneMinuteFromNow,
});import { Resend } from 'resend';

const resend = new Resend('re_xxxxxxxxx');

resend.emails.cancel('4ef9a417-02e9-4d39-ad75-9611e0fcc33c');     resend的tken配置在@wrangler.toml 里面了，要求