(function(){
  // 预取首页关键数据并写入 sessionStorage，供首屏直接复用
  async function prefetchHomeData(){
    try{
      const save = (key, data) => {
        try{ sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); }catch(_){ }
      };
      const controller = new AbortController();
      const timeout = setTimeout(()=>controller.abort(), 8000);
      const opts = { method: 'GET', headers: { 'Cache-Control': 'no-cache' }, keepalive: true, signal: controller.signal };
      const mailboxes = fetch('/api/mailboxes?limit=10&offset=0', opts).then(r => r.ok ? r.json() : []).then(data => save('mf:prefetch:mailboxes', Array.isArray(data) ? data : [] )).catch(()=>{});
      const quota = fetch('/api/user/quota', opts).then(r => r.ok ? r.json() : null).then(data => { if (data) save('mf:prefetch:quota', data); }).catch(()=>{});
      const domains = fetch('/api/domains', opts).then(r => r.ok ? r.json() : []).then(list => { if (Array.isArray(list) && list.length) save('mf:prefetch:domains', list); }).catch(()=>{});
      // 不阻塞太久：最多等待 1500ms 即跳转，其余继续后台完成（keepalive）
      await Promise.race([
        Promise.all([mailboxes, quota, domains]),
        new Promise(res => setTimeout(res, 1500))
      ]);
      clearTimeout(timeout);
    }catch(_){ }
  }
  function getRedirectTarget(){
    try{ const u = new URL(location.href); return u.searchParams.get('redirect') || '/'; }catch(_){ return '/'; }
  }
  function hasRedirectParam(){
    try{ const u = new URL(location.href); return !!u.searchParams.get('redirect'); }catch(_){ return false; }
  }
  function pollAuth(maxWaitMs = 9000, intervalMs = 600){
    const target = getRedirectTarget();
    const shouldWait = hasRedirectParam();
    const start = Date.now();
    (async function attempt(){
      try{
        const response = await fetch('/api/session', { method: 'GET', headers: { 'Cache-Control': 'no-cache' } });
        if (response.ok){
          try{ sessionStorage.setItem('auth_checked', 'true'); }catch(_){ }
          // 登录确认后立刻预取首页数据
          try{ await prefetchHomeData(); }catch(_){ }
          return void window.location.replace(target);
        }
        // 未通过：若目标为 /admin.html 则保持在 loading 等待，不跳登录，避免泄露 admin
        if (target === '/admin.html'){
          if ((Date.now() - start) < maxWaitMs){ setTimeout(attempt, intervalMs); return; }
          return void window.location.replace('/login.html');
        }
      }catch(_){ }
      if (shouldWait && (Date.now() - start) < maxWaitMs){
        setTimeout(attempt, intervalMs);
        return;
      }
      // 默认回登录页
      window.location.replace('/login.html');
    })();
  }

  window.RouteGuard = {
    pollAuth,
    goLoading: function(target, statusText){
      try{
        const params = new URLSearchParams();
        if (target) params.set('redirect', target);
        if (statusText) params.set('status', statusText);
        const q = params.toString();
        location.replace('/templates/loading.html' + (q ? ('?' + q) : ''));
      }catch(_){ location.replace('/templates/loading.html'); }
    }
  };

  // autorun for loading page
  if (document.currentScript && document.currentScript.dataset.autorun === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ pollAuth(9000, 600); });
  }
})();


