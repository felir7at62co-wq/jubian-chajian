// src/main.js — 插件入口
(function() {
  'use strict';

  // 注入 SVG filter（手绘边框）
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
  svg.innerHTML = `<filter id="jb-comic-border">
    <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="3" result="noise"/>
    <feDisplacementMap in="SourceGraphic" in2="noise" scale="2" xChannelSelector="R" yChannelSelector="G"/>
  </filter>`;
  document.body.appendChild(svg);

  // 创建三个主面板
  const skillPanel = jbPanelSystem.createPanel({
    id: 'skills', title: '📂 Skill', x: 20, y: 60, width: 240, height: 400
  });
  const interactionPanel = jbPanelSystem.createPanel({
    id: 'interaction', title: '💬 交互', x: 280, y: 60, width: 500, height: 500
  });
  const assetPanel = jbPanelSystem.createPanel({
    id: 'assets', title: '🖼️ 资产池', x: 800, y: 60, width: 300, height: 400
  });

  renderPanel(skillPanel, '<div class="jb-empty">Skill 系统加载中...</div>');
  renderPanel(interactionPanel, '<div class="jb-empty">上传剧本开始工作</div>');
  renderPanel(assetPanel, '<div class="jb-empty">拖入图片到对应分类</div>');

  // 初始化各模块（用 typeof 检查函数存在性）
  if (typeof initSkills === 'function') initSkills();
  if (typeof initInteraction === 'function') initInteraction();
  if (typeof initAssets === 'function') initAssets();
})();
