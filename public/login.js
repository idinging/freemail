const username = document.getElementById('username');
const pwd = document.getElementById('pwd');
const btn = document.getElementById('login');
const err = document.getElementById('err');

let isSubmitting = false;

function ensureToastContainer(){
  let c = document.getElementById('toast');
  if (!c){
    c = document.createElement('div');
    c.id = 'toast';
    c.className = 'toast';
    document.body.appendChild(c);
  }
  return c;
}

async function showToast(message, type='info'){
  try{
    const res = await fetch('/templates/toast.html', { cache: 'no-cache' });
    const tpl = await res.text();
    const html = tpl.replace('{{type}}', String(type||'info')).replace('{{message}}', String(message||''));
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    const styleEl = wrap.querySelector('#toast-style');
    if (styleEl && !document.getElementById('toast-style')){
      document.head.appendChild(styleEl);
    }
    const toastEl = wrap.querySelector('.toast-item');
    if (toastEl){
      ensureToastContainer().appendChild(toastEl);
      setTimeout(()=>{ 
        toastEl.style.transition='opacity .3s'; 
        toastEl.style.opacity='0'; 
        setTimeout(()=>toastEl.remove(),300); 
      }, 2000);
    }
  }catch(_){
    const div = document.createElement('div');
    div.className = `toast-item ${type}`;
    div.textContent = message;
    ensureToastContainer().appendChild(div);
    setTimeout(()=>{ div.style.transition='opacity .3s'; div.style.opacity='0'; setTimeout(()=>div.remove(),300); }, 2000);
  }
}

async function doLogin(){
  if (isSubmitting) return;
  const user = (username.value || '').trim();
  const password = (pwd.value || '').trim();
  if (!user){ err.textContent = '用户名不能为空'; await showToast('用户名不能为空','warn'); return; }
  if (!password){ err.textContent = '密码不能为空'; await showToast('密码不能为空','warn'); return; }
  err.textContent = '';
  isSubmitting = true;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '正在登录…';

  try{
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password }),
      keepalive: true
    });
    if (r.ok){
      await showToast('登录成功','success');
      // 进入加载页做预取与跳转
      location.replace('/templates/loading.html?redirect=%2F&status=' + encodeURIComponent('正在检验会话'));
      return;
    }
    const msg = (await r.text()) || '用户名或密码错误';
    err.textContent = '登录失败：' + msg;
    await showToast('登录失败：' + msg, 'warn');
  }catch(e){
    err.textContent = '网络错误，请稍后重试';
    await showToast('网络错误，请稍后重试', 'warn');
  }finally{
    isSubmitting = false;
    btn.disabled = false;
    btn.textContent = original;
  }
}

btn.addEventListener('click', doLogin);
pwd.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
username.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

