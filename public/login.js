const pwd = document.getElementById('pwd');
const btn = document.getElementById('login');
const err = document.getElementById('err');

async function doLogin(){
  const password = (pwd.value || '').trim();
  if (!password){ err.textContent = '密码不能为空'; return; }
  err.textContent = ''; btn.disabled = true;
  try {
    const r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password }) });
    if (r.ok){
      // 登录成功后回到首页
      location.replace('/');
    } else {
      err.textContent = '密码错误';
    }
  } catch { err.textContent = '网络错误'; }
  finally { btn.disabled = false; pwd.value=''; }
}

btn.addEventListener('click', doLogin);
pwd.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

