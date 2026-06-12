// loader.js — 动态代码加载器（唯一的内容脚本入口）
// 运行时从 chrome.storage 获取最新代码并执行，支持热更新
(async function() {
  'use strict';

  try {
    // 从 background 获取代码（优先走 storage 缓存，失败时回退本地）
    const res = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'GET_CODE' }, resolve);
    });
    if (!res) return;

    // 注入 CSS（如果已存在则跳过）
    if (res.css && !document.getElementById('jb-dynamic-style')) {
      const style = document.createElement('style');
      style.id = 'jb-dynamic-style';
      style.textContent = res.css;
      document.documentElement.appendChild(style);
    }

    // 执行 JS（在 content script 的 isolated world 中运行，可访问 chrome API）
    if (res.js) {
      eval(res.js);
    }
  } catch (e) {
    console.error('[loader] 加载失败:', e);
  }
})();
