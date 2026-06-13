// src/panel-system.js — 新 UI 布局引擎 v4
// 设计：无顶栏 · 原地折叠成蛛网(带动画) · 交互栏左右两侧隐藏按钮 · 自由缩放 · 蛛网可拖拽
// v4: 侧栏收起时同步缩小 #jb-main 宽度+位移，确保中央交互栏尺寸/屏幕位置不变

// 涂鸦蛛网 SVG（折叠图标 / 折叠按钮共用）
var SPIDER_SVG = [
  '<svg viewBox="0 0 64 64" width="48" height="48" style="filter:url(#jb-comic-border);">',
  '<circle cx="32" cy="32" r="3.5" fill="#FF0055"/>',
  '<circle cx="32" cy="32" r="3.5" fill="none" stroke="#00E5FF" stroke-width="0.8" opacity="0.8"/>',
  '<line x1="32" y1="32" x2="8" y2="8"   stroke="#FF0055" stroke-width="1.6" opacity="0.75"/>',
  '<line x1="32" y1="32" x2="56" y2="8"  stroke="#FF0055" stroke-width="1.6" opacity="0.75"/>',
  '<line x1="32" y1="32" x2="8" y2="56"  stroke="#FF0055" stroke-width="1.6" opacity="0.75"/>',
  '<line x1="32" y1="32" x2="56" y2="56" stroke="#FF0055" stroke-width="1.6" opacity="0.75"/>',
  '<line x1="32" y1="32" x2="3" y2="32"  stroke="#FF0055" stroke-width="1.2" opacity="0.5"/>',
  '<line x1="32" y1="32" x2="61" y2="32" stroke="#FF0055" stroke-width="1.2" opacity="0.5"/>',
  '<line x1="32" y1="32" x2="32" y2="3"  stroke="#FF0055" stroke-width="1.2" opacity="0.5"/>',
  '<line x1="32" y1="32" x2="32" y2="61" stroke="#FF0055" stroke-width="1.2" opacity="0.5"/>',
  '<path d="M12,12 Q32,18 52,12" fill="none" stroke="#00E5FF" stroke-width="1" opacity="0.45"/>',
  '<path d="M12,52 Q32,46 52,52" fill="none" stroke="#00E5FF" stroke-width="1" opacity="0.45"/>',
  '<path d="M12,12 Q18,32 12,52" fill="none" stroke="#00E5FF" stroke-width="1" opacity="0.45"/>',
  '<path d="M52,12 Q46,32 52,52" fill="none" stroke="#00E5FF" stroke-width="1" opacity="0.45"/>',
  '<path d="M20,20 Q32,24 44,20" fill="none" stroke="#FF0055" stroke-width="0.9" opacity="0.35"/>',
  '<path d="M20,44 Q32,40 44,44" fill="none" stroke="#FF0055" stroke-width="0.9" opacity="0.35"/>',
  '</svg>'
].join('');

function _jb$(id) { return document.getElementById(id); }

// ─── 主布局管理器 ──────────────────────────────────
var JB = {
  expanded: true,
  leftOpen: true,
  rightOpen: true,
  MIN_W: 520,
  MIN_H: 360,
  SIDE_W: 220,        // 必须与 CSS .jb-side 宽度一致
  _animTimer: null,

  init: function() {
    // 防重复调用（hot-update SPA 竞态可能导致同一文档注入两次）
    if (document.getElementById('jb-root')) return;
    if (document.getElementById('jb-comic-border')) return;

    // 注入 SVG 涂鸦边框 filter
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
    svg.innerHTML = '<filter id="jb-comic-border">' +
      '<feTurbulence type="turbulence" baseFrequency="0.018" numOctaves="3" result="noise"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="noise" scale="2" xChannelSelector="R" yChannelSelector="G"/>' +
    '</filter>';
    document.body.appendChild(svg);

    this.root = this._createDOM();
    document.body.appendChild(this.root);
    this._bindEvents();
  },

  // ── 创建 DOM ──
  _createDOM: function() {
    var root = document.createElement('div');
    root.id = 'jb-root';

    var main = document.createElement('div');
    main.id = 'jb-main';
    main.innerHTML =
      '<div id="jb-dragbar" title="按住拖动">' +
        '<span class="jb-grip"></span>' +
        '<span id="jb-dragbar-label">AI DIRECTOR</span>' +
        '<button id="jb-collapse-btn" title="收起为蛛网">' + SPIDER_SVG + '</button>' +
      '</div>' +
      '<div id="jb-body">' +
        '<div id="jb-left" class="jb-side"><div id="jb-skills-body" class="jb-side-body"></div></div>' +
        '<div id="jb-center">' +
          '<button class="jb-edge-btn" id="jb-toggle-left" title="收起/展开 Skill 栏">◀</button>' +
          '<div id="jb-center-body"></div>' +
          '<button class="jb-edge-btn jb-edge-right" id="jb-toggle-right" title="收起/展开 资产栏">▶</button>' +
        '</div>' +
        '<div id="jb-right" class="jb-side"><div id="jb-assets-body" class="jb-side-body"></div></div>' +
      '</div>' +
      '<div id="jb-resize" title="拖动缩放"></div>';

    var spider = document.createElement('div');
    spider.id = 'jb-spider';
    spider.title = '展开工作台（可拖动）';
    spider.innerHTML = SPIDER_SVG;
    spider.style.display = 'none';

    root.appendChild(main);
    root.appendChild(spider);
    return root;
  },

  // ── 事件绑定 ──
  _bindEvents: function() {
    var self = this;

    _jb$('jb-toggle-left').onclick = function() { self._toggleSide('left'); };
    _jb$('jb-toggle-right').onclick = function() { self._toggleSide('right'); };

    _jb$('jb-collapse-btn').onclick = function(e) { e.stopPropagation(); self.collapse(); };

    this._bindDrag();
    this._bindSpiderDrag();
    this._bindResize();
  },

  // ── 侧栏开合（核心：同步缩小 #jb-main 保持中心不动）──
  _toggleSide: function(side) {
    var self = this;
    var main = _jb$('jb-main');
    var sideEl = _jb$('jb-' + side);
    var btn = _jb$('jb-toggle-' + side);
    var isLeft = (side === 'left');

    var wasOpen = isLeft ? self.leftOpen : self.rightOpen;
    if (isLeft) self.leftOpen = !wasOpen; else self.rightOpen = !wasOpen;

    var nowOpen = !wasOpen;
    // 更新按钮文字与高亮
    btn.textContent = nowOpen ? (isLeft ? '◀' : '▶') : (isLeft ? '▶' : '◀');
    btn.classList.toggle('jb-edge-on', !nowOpen);

    // 切换侧栏 CSS（触发侧栏自身 width transition）
    sideEl.classList.toggle('jb-closed', !nowOpen);

    // 计算 #jb-main 尺寸/位置调整量
    var curW = main.offsetWidth;
    var curL = main.offsetLeft;
    var delta = wasOpen ? -self.SIDE_W : self.SIDE_W; // 收起→负, 展开→正
    var newW = Math.max(self.MIN_W, curW + delta);

    // 启用同步过渡
    main.classList.add('jb-animating');
    main.style.width = newW + 'px';

    if (isLeft) {
      // 左栏收起时 #jb-main 右移 SIDE_W，保证中心栏屏幕位置不动
      main.style.left = Math.max(0, curL - delta) + 'px';
    }

    clearTimeout(self._animTimer);
    self._animTimer = setTimeout(function() {
      main.classList.remove('jb-animating');
    }, 320);
  },

  // 主容器拖拽（拖拽条）
  _bindDrag: function() {
    var bar = _jb$('jb-dragbar');
    bar.onmousedown = function(e) {
      if (e.target.closest('button')) return;
      var main = _jb$('jb-main');
      var sx = e.clientX - main.offsetLeft, sy = e.clientY - main.offsetTop;
      bar.classList.add('jb-grabbing');
      function mv(ev) {
        main.style.left = Math.max(0, ev.clientX - sx) + 'px';
        main.style.top = Math.max(0, ev.clientY - sy) + 'px';
      }
      function up() {
        bar.classList.remove('jb-grabbing');
        document.removeEventListener('mousemove', mv);
        document.removeEventListener('mouseup', up);
      }
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
    };
  },

  // 蛛网拖拽（拖动 vs 点击判定）
  _bindSpiderDrag: function() {
    var self = this, spider = _jb$('jb-spider');
    spider.onmousedown = function(e) {
      e.preventDefault();
      var sx = e.clientX - spider.offsetLeft, sy = e.clientY - spider.offsetTop;
      var moved = false, dx0 = e.clientX, dy0 = e.clientY;
      function mv(ev) {
        if (Math.abs(ev.clientX - dx0) + Math.abs(ev.clientY - dy0) > 4) moved = true;
        spider.style.left = (ev.clientX - sx) + 'px';
        spider.style.top = (ev.clientY - sy) + 'px';
        spider.style.right = 'auto'; spider.style.bottom = 'auto';
      }
      function up() {
        document.removeEventListener('mousemove', mv);
        document.removeEventListener('mouseup', up);
        if (!moved) self.expand();
      }
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
    };
  },

  // 右下角缩放
  _bindResize: function() {
    var self = this, h = _jb$('jb-resize');
    h.onmousedown = function(e) {
      e.preventDefault(); e.stopPropagation();
      var main = _jb$('jb-main');
      // 立即清除侧栏过渡（防止 CSS transition 与 JS resize 打架）
      main.classList.remove('jb-animating');
      clearTimeout(self._animTimer);
      var sw = main.offsetWidth, sh = main.offsetHeight, sx = e.clientX, sy = e.clientY;
      // 按当前侧栏状态动态计算最小宽度
      var effMinW = self.MIN_W;
      if (!self.leftOpen) effMinW -= self.SIDE_W;
      if (!self.rightOpen) effMinW -= self.SIDE_W;
      function mv(ev) {
        main.style.width = Math.max(effMinW, sw + (ev.clientX - sx)) + 'px';
        main.style.height = Math.max(self.MIN_H, sh + (ev.clientY - sy)) + 'px';
      }
      function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
    };
  },

  // ── 原地折叠为蛛网（带动画）──
  collapse: function() {
    var self = this, main = _jb$('jb-main'), spider = _jb$('jb-spider');
    var r = main.getBoundingClientRect();
    main.style.transformOrigin = 'top left';
    main.classList.add('jb-collapsing');
    setTimeout(function() {
      main.style.display = 'none';
      main.classList.remove('jb-collapsing');
      spider.style.left = r.left + 'px';
      spider.style.top = r.top + 'px';
      spider.style.right = 'auto'; spider.style.bottom = 'auto';
      spider.style.display = 'flex';
      spider.classList.add('jb-pop');
      setTimeout(function() { spider.classList.remove('jb-pop'); }, 350);
      self.expanded = false;
    }, 260);
  },

  expand: function() {
    var main = _jb$('jb-main'), spider = _jb$('jb-spider');
    if (spider.style.left) {
      main.style.left = Math.max(0, parseInt(spider.style.left, 10)) + 'px';
      main.style.top = Math.max(0, parseInt(spider.style.top, 10)) + 'px';
    }
    spider.style.display = 'none';
    main.style.display = 'flex';
    main.style.transformOrigin = 'top left';
    main.classList.add('jb-expanding');
    setTimeout(function() { main.classList.remove('jb-expanding'); }, 280);
    this.expanded = true;
  },

  // ── 渲染帮助 ──
  getBody: function(id) {
    return _jb$(id + '-body') || _jb$('jb-' + id + '-body');
  }
};

window.JB = JB;
