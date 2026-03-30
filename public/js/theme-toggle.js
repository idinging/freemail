/* =============================================
   主题切换脚本
   支持自动识别系统和手动切换
   ============================================= */

(function() {
  // 主题样式表映射
  const themeStylesheets = {
    'app': '/css/app_black.css',
    'login': '/css/login_black.css',
    'admin': '/css/admin_black.css',
    'mailbox': '/css/mailbox_black.css',
    'mailboxes': '/css/mailboxes_black.css',
    'app-mobile': '/css/app-mobile_black.css'
  };

  // 当前主题
  let currentTheme = 'light';

  // 获取用户保存的主题偏好
  function getSavedTheme() {
    try {
      return localStorage.getItem('freemail:theme');
    } catch (e) {
      return null;
    }
  }

  // 保存主题偏好
  function saveTheme(theme) {
    try {
      localStorage.setItem('freemail:theme', theme);
    } catch (e) {}
  }

  // 检测系统偏好
  function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // 确定应该使用的主题
  function getEffectiveTheme() {
    const saved = getSavedTheme();
    if (saved) {
      return saved;
    }
    return getSystemTheme();
  }

  // 应用主题（添加/移除 .dark 类）
  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  // 切换主题
  function setTheme(theme) {
    currentTheme = theme;
    saveTheme(theme);
    applyTheme(theme);
    updateThemeToggleButton(theme);
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  }

  // 更新切换按钮
  function updateThemeToggleButton(theme) {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;

    const icon = btn.querySelector('svg use');
    if (icon) {
      icon.setAttribute('href', '/icons/sprites.svg#icon-' + (theme === 'dark' ? 'sun' : 'moon'));
    }
    btn.setAttribute('aria-label', theme === 'dark' ? '切换到明亮模式' : '切换到暗黑模式');
    btn.title = theme === 'dark' ? '切换到明亮模式' : '切换到暗黑模式';
  }

  // 创建主题切换按钮
  function createThemeToggleButton() {
    const btn = document.createElement('button');
    btn.id = 'theme-toggle';
    btn.className = 'btn btn-ghost theme-toggle-btn';
    btn.setAttribute('aria-label', '切换主题');
    btn.title = currentTheme === 'dark' ? '切换到明亮模式' : '切换到暗黑模式';
    btn.innerHTML = `
      <span class="btn-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <use href="/icons/sprites.svg#icon-${currentTheme === 'dark' ? 'sun' : 'moon'}"/>
        </svg>
      </span>
    `;

    btn.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    };

    return btn;
  }

  // 添加切换按钮到页面
  function addThemeToggleToNav() {
    const navActions = document.querySelector('.nav-actions');
    if (!navActions) {
      // 稍后重试
      setTimeout(addThemeToggleToNav, 200);
      return;
    }

    if (document.getElementById('theme-toggle')) {
      updateThemeToggleButton(currentTheme);
      return;
    }

    const toggleBtn = createThemeToggleButton();
    navActions.appendChild(toggleBtn);
  }

  // 监听系统主题变化
  function watchSystemTheme() {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', function(e) {
      if (!getSavedTheme()) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    });
  }

  // 监听 localStorage 变化（多标签页同步）
  function watchStorageChanges() {
    window.addEventListener('storage', function(e) {
      if (e.key === 'freemail:theme' && e.newValue) {
        setTheme(e.newValue);
      }
    });
  }

  // 初始化
  function init() {
    // 获取主题
    const theme = getEffectiveTheme();
    currentTheme = theme;

    // 应用主题（添加 .dark 类）
    applyTheme(theme);

    // 设置切换按钮初始状态
    updateThemeToggleButton(theme);

    // 监听变化
    watchSystemTheme();
    watchStorageChanges();

    // 添加按钮
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        setTimeout(addThemeToggleToNav, 300);
      });
    } else {
      setTimeout(addThemeToggleToNav, 300);
    }
  }

  // 启动
  init();

  // 暴露全局方法
  window.freemailTheme = {
    setTheme: setTheme,
    getTheme: function() { return currentTheme; },
    toggle: function() { setTheme(currentTheme === 'dark' ? 'light' : 'dark'); }
  };
})();