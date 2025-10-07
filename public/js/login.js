const username = document.getElementById('username');
const pwd = document.getElementById('pwd');
const btn = document.getElementById('login');
const err = document.getElementById('err');

let isSubmitting = false;

// ensureToastContainer 函数已由 toast-utils.js 统一提供

// showToast 函数已由 toast-utils.js 统一提供

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
    // 目标页：优先使用登录页上的 redirect 参数
    const target = (function(){
      try{ const u=new URL(location.href); const t=(u.searchParams.get('redirect')||'').trim(); return t || '/'; }catch(_){ return '/'; }
    })();
    
    // 等待登录请求完成，提高成功率
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password })
    });
    
    if (response.ok) {
      // 登录成功，直接跳转到目标页面，避免loading页面
      const result = await response.json();
      if (result.success) {
        // 根据用户角色智能跳转
        let finalTarget = target;
        if (result.role === 'mailbox') {
          // 邮箱用户跳转到专用页面
          finalTarget = '/html/mailbox.html';
        } else if (target === '/' && (result.role === 'admin' || result.role === 'guest')) {
          // 管理员和访客跳转到主页
          finalTarget = '/';
        }
        
        // 显示成功提示
        await showToast('登录成功，正在跳转...', 'success');
        // 延时确保toast显示和cookie设置生效
        setTimeout(() => {
          location.replace(finalTarget);
        }, 1200);
        return;
      }
    } else {
      // 登录失败，显示错误信息
      const errorText = await response.text();
      err.textContent = errorText || '登录失败';
      await showToast(errorText || '登录失败', 'warn');
      // 恢复按钮状态
      isSubmitting = false;
      btn.disabled = false;
      btn.textContent = original;
      return;
    }
    
    // 兜底：进入 loading 页面轮询
    if (window.AuthGuard && window.AuthGuard.goLoading){
      window.AuthGuard.goLoading(target, '正在登录…', { force: true });
    }else{
      location.replace('/templates/loading.html?redirect=' + encodeURIComponent(target) + '&status=' + encodeURIComponent('正在登录…') + '&force=1');
    }
    return;
  }catch(e){
    // 网络错误或其他异常，显示错误并进入 loading
    err.textContent = '网络错误，请重试';
    await showToast('网络连接失败，请检查网络后重试', 'warn');
    // 恢复按钮状态
    isSubmitting = false;
    btn.disabled = false;
    btn.textContent = original;
    // 仍然进入 loading 作为兜底
    location.replace('/templates/loading.html?status=' + encodeURIComponent('正在登录…') + '&force=1');
    return;
  }finally{
    // 确保按钮状态恢复（防止某些异常情况）
    if (isSubmitting) {
      isSubmitting = false;
      btn.disabled = false;
      btn.textContent = original;
    }
  }
}

btn.addEventListener('click', doLogin);
pwd.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
username.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

