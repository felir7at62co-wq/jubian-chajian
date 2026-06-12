// src/comic-ui.js
// 蜘蛛侠风格 UI 渲染函数

function renderPanel(panel, contentHTML) {
  const el = document.createElement('div');
  el.className = 'jb-panel';
  el.id = 'jb-panel-' + panel.id;
  el.style.left = panel.x + 'px';
  el.style.top = panel.y + 'px';
  el.style.width = panel.width + 'px';
  el.style.height = panel.height + 'px';
  el.style.zIndex = panel.zIndex;
  if (panel.folded) el.classList.add('jb-panel-folded');

  el.innerHTML = `
    <div class="jb-panel-header">
      <span class="jb-panel-title">${panel.title}</span>
      <div class="jb-panel-actions">
        <button class="jb-panel-fold-btn" title="折叠">−</button>
        <button class="jb-panel-close-btn" title="关闭">✕</button>
      </div>
    </div>
    <div class="jb-panel-body">${contentHTML}</div>
    <div class="jb-panel-resize-handle"></div>
  `;

  // 拖拽标题栏移动
  const header = el.querySelector('.jb-panel-header');
  header.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    jbPanelSystem.bringToFront(panel);
    const startX = e.clientX - panel.x;
    const startY = e.clientY - panel.y;
    function onMove(ev) {
      jbPanelSystem.movePanel(panel, ev.clientX - startX, ev.clientY - startY);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // 右下角调整大小
  const handle = el.querySelector('.jb-panel-resize-handle');
  handle.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    const startW = panel.width, startH = panel.height;
    const startX = e.clientX, startY = e.clientY;
    function onMove(ev) {
      jbPanelSystem.resizePanel(panel,
        Math.max(200, startW + ev.clientX - startX),
        Math.max(150, startH + ev.clientY - startY)
      );
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // 折叠按钮
  el.querySelector('.jb-panel-fold-btn').addEventListener('click', () => {
    jbPanelSystem.toggleFold(panel);
  });

  // 关闭按钮
  el.querySelector('.jb-panel-close-btn').addEventListener('click', () => {
    if (confirm('确定关闭这个面板？')) jbPanelSystem.removePanel(panel.id);
  });

  panel.element = el;
  document.body.appendChild(el);
  return el;
}
