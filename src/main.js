// src/main.js — 插件入口
(function() {
  'use strict';

  // 初始化新 UI 布局
  JB.init();

  // 初始化各模块
  if (typeof initSkills === 'function') initSkills();
  if (typeof initInteraction === 'function') initInteraction();
  if (typeof initAssets === 'function') initAssets();
})();
