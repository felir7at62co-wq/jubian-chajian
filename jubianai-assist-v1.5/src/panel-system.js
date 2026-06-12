// src/panel-system.js
// 自由面板引擎：管理面板的创建、拖拽移动、调整大小、折叠、关闭

class PanelSystem {
  constructor() {
    this.panels = [];
    this.nextZ = 100;
    this.loadState();
  }

  loadState() {
    chrome.storage.local.get('panelState', (res) => {
      if (res.panelState) {
        for (const saved of res.panelState.panels) {
          const panel = this.panels.find(p => p.id === saved.id);
          if (panel) {
            panel.x = saved.x; panel.y = saved.y;
            panel.width = saved.width; panel.height = saved.height;
            panel.folded = saved.folded || false;
            if (panel.element) this.syncElement(panel);
          }
        }
      }
    });
  }

  saveState() {
    const state = { panels: this.panels.map(p => ({
      id: p.id, x: p.x, y: p.y, width: p.width, height: p.height, folded: p.folded
    }))};
    chrome.storage.local.set({ panelState: state });
  }

  syncElement(panel) {
    const el = panel.element;
    if (!el) return;
    el.style.left = panel.x + 'px';
    el.style.top = panel.y + 'px';
    el.style.width = panel.width + 'px';
    el.style.height = panel.height + 'px';
    el.style.zIndex = panel.zIndex;
    el.classList.toggle('jb-panel-folded', panel.folded);
  }

  createPanel({ id, title, x = 100, y = 80, width = 300, height = 400 }) {
    const panel = {
      id, title, x, y, width, height, folded: false,
      zIndex: ++this.nextZ, element: null
    };
    this.panels.push(panel);
    this.saveState();
    return panel;
  }

  bringToFront(panel) {
    panel.zIndex = ++this.nextZ;
    if (panel.element) panel.element.style.zIndex = panel.zIndex;
  }

  movePanel(panel, x, y) {
    panel.x = x; panel.y = y;
    if (panel.element) {
      panel.element.style.left = x + 'px';
      panel.element.style.top = y + 'px';
    }
    this.saveState();
  }

  resizePanel(panel, width, height) {
    panel.width = Math.max(200, width);
    panel.height = Math.max(150, height);
    if (panel.element) {
      panel.element.style.width = panel.width + 'px';
      panel.element.style.height = panel.height + 'px';
    }
    this.saveState();
  }

  toggleFold(panel) {
    panel.folded = !panel.folded;
    if (panel.element) panel.element.classList.toggle('jb-panel-folded', panel.folded);
    this.saveState();
  }

  removePanel(id) {
    const idx = this.panels.findIndex(p => p.id === id);
    if (idx === -1) return;
    if (this.panels[idx].element) this.panels[idx].element.remove();
    this.panels.splice(idx, 1);
    this.saveState();
  }
}

window.jbPanelSystem = new PanelSystem();
