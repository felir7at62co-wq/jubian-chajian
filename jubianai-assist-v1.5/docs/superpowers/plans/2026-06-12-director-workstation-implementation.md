# AI 导演工作台 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 将 jubianai-assist Chrome 扩展改造为三栏自由面板的 AI 导演工作台

**Architecture:** 插件内全栈。manifest.json 声明 content_scripts 注入，background.js 做 API 代理，content_script 端用 vanilla JS 构建三栏自由面板系统。数据分三层：chrome.storage.local（文本）、IndexedDB（图片）、sessionStorage（会话历史）。Skill 系统以 JSON 文件格式存储 prompt 规则，LLM 调用走 background.js 的 ARK API 代理。

**Tech Stack:** Chrome Extension MV3, Vanilla JS, IndexedDB, ARK API, CSS Animation

---

## 文件结构

### 新建文件
| 文件 | 职责 |
|:----|:------|
| `src/comic-ui.js` | 蜘蛛侠风格 UI 组件：自由面板系统、拖拽/调大小、漫画边框/按钮/动画 |
| `src/skills.js` | Skill 系统：加载内置 skill、解析 .skill 文件、文件夹管理、增删改查 |
| `src/interaction.js` | 交互区：文档上传、LLM 对话、输出展示、复制/保存为 .txt |
| `src/assets.js` | 资产池：三标签页、拖拽上传、缩略图、文件夹、删除 |

### 修改文件
| 文件 | 改动 |
|:----|:------|
| `manifest.json` | 确认权限（storage + host_permissions），增加 web_accessible_resources 如需要 |
| `background.js` | 新增 skill 数据读写消息类型 |
| `src/state.js` | 新增状态：skillList、folders、assets (按分类)、代理配置 |
| `src/drawing.js` | 入口改为由 comic-ui 调用（不再依赖 renderPool 的 ✏️ 按钮） |
| `src/sidebar.js` | 删除（由新的三栏面板替代） |
| `src/features.js` | 删除（旧的自动匹配逻辑不再使用） |
| `content_style.css` | 完全重写为蜘蛛侠漫画风格 |

---

## 实施任务

### Task 1: 骨架搭建 — 自由面板系统

**Files:**
- Create: `src/comic-ui.js`
- Create: `src/panel-system.js`（面板引擎，独立于样式逻辑）
- Modify: `content_style.css`（骨架布局）
- Modify: `manifest.json`（注入脚本调整）
- Delete: `src/sidebar.js`

- [ ] **Step 1: 创建 panel-system.js — 面板引擎**

面板引擎核心功能：创建自由面板、拖拽移动、调整大小。

```javascript
// src/panel-system.js
// 自由面板引擎：一个面板 = { id, title, x, y, width, height, content, zIndex, folded }

class PanelSystem {
  constructor() {
    this.panels = [];
    this.nextZ = 100;
    this.loadState();
  }

  loadState() {
    chrome.storage.local.get('panelState', (res) => {
      if (res.panelState) {
        Object.assign(this, res.panelState);
      }
    });
  }

  saveState() {
    const state = { panels: this.panels.map(p => ({
      id: p.id, x: p.x, y: p.y, width: p.width, height: p.height, folded: p.folded
    }))};
    chrome.storage.local.set({ panelState: state });
  }

  createPanel({ id, title, x = 100, y = 80, width = 300, height = 400 }) {
    const panel = {
      id, title, x, y, width, height, folded: false,
      zIndex: ++this.nextZ,
      element: null
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
    panel.width = width; panel.height = height;
    if (panel.element) {
      panel.element.style.width = width + 'px';
      panel.element.style.height = height + 'px';
    }
    this.saveState();
  }

  toggleFold(panel) {
    panel.folded = !panel.folded;
    if (panel.element) {
      panel.element.classList.toggle('jb-panel-folded', panel.folded);
    }
    this.saveState();
  }

  removePanel(id) {
    const idx = this.panels.findIndex(p => p.id === id);
    if (idx === -1) return;
    this.panels[idx].element?.remove();
    this.panels.splice(idx, 1);
    this.saveState();
  }
}

// 全局实例
window.jbPanelSystem = new PanelSystem();
```

- [ ] **Step 2: 创建 comic-ui.js — 面板渲染 + 交互绑定**

```javascript
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
        <button class="jb-panel-fold-btn">−</button>
        <button class="jb-panel-close-btn">✕</button>
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
```

- [ ] **Step 3: 重写 content_style.css — 蜘蛛侠风格**

```css
/* content_style.css — 蜘蛛侠纵横宇宙风格 */

/* ============ 全局 ============ */
.jb-panel {
  position: fixed;
  background: #1A1A1A;
  color: #FFFFFF;
  font-family: 'Impact', 'Arial Black', sans-serif;
  font-size: 14px;
  border: 3px solid #FF0055;
  border-radius: 4px;
  box-shadow: 8px 8px 0 rgba(255, 0, 85, 0.3),
              inset 0 0 30px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 200px;
  min-height: 150px;
  /* 不规则边框模拟 — svg filter 手绘感 */
  filter: url(#jb-comic-border);
  transition: box-shadow 0.2s;
}
.jb-panel:hover {
  box-shadow: 8px 8px 0 rgba(255, 0, 85, 0.5),
              inset 0 0 30px rgba(0, 0, 0, 0.5);
}
.jb-panel-folded .jb-panel-body { display: none; }
.jb-panel-folded { height: auto !important; min-height: 0 !important; }

/* ============ 面板头部 ============ */
.jb-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: linear-gradient(135deg, #FF0055 0%, #CC0044 100%);
  cursor: grab;
  user-select: none;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}
.jb-panel-header::after {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: repeating-linear-gradient(
    90deg,
    transparent,
    transparent 20px,
    rgba(255,255,255,0.05) 20px,
    rgba(255,255,255,0.05) 21px
  );
  pointer-events: none;
}
.jb-panel-header:active { cursor: grabbing; }
.jb-panel-title {
  font-size: 15px;
  font-weight: 900;
  color: #FFFFFF;
  text-shadow: 2px 2px 0 #000, -1px -1px 0 #000;
  letter-spacing: 1px;
}
.jb-panel-actions {
  display: flex;
  gap: 4px;
}
.jb-panel-actions button {
  background: rgba(0,0,0,0.3);
  color: #fff;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 3px;
  padding: 2px 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: bold;
  transition: all 0.15s;
}
.jb-panel-actions button:hover {
  background: #FFEA00;
  color: #000;
  border-color: #FFEA00;
  /* glitch 抖动 */
  animation: jb-glitch 0.1s ease 2;
}

/* ============ 面板内容区 ============ */
.jb-panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  /* 网点背景 */
  background-image: radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 8px 8px;
}
.jb-panel-body::-webkit-scrollbar { width: 6px; }
.jb-panel-body::-webkit-scrollbar-track { background: #0D0D0D; }
.jb-panel-body::-webkit-scrollbar-thumb { background: #FF0055; border-radius: 3px; }

/* ============ 调整大小手柄 ============ */
.jb-panel-resize-handle {
  position: absolute;
  bottom: 0; right: 0;
  width: 20px; height: 20px;
  cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 50%, #FF0055 50%);
  opacity: 0.6;
}
.jb-panel-resize-handle:hover { opacity: 1; }

/* ============ 按钮风格 ============ */
.jb-btn {
  padding: 8px 16px;
  border: 2px solid #FF0055;
  background: transparent;
  color: #FF0055;
  font-family: 'Impact', 'Arial Black', sans-serif;
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 1px;
  transition: all 0.15s;
  position: relative;
  overflow: hidden;
}
.jb-btn:hover {
  background: #FF0055;
  color: #fff;
  animation: jb-glitch 0.1s ease 2;
}
.jb-btn-primary {
  background: #FF0055;
  color: #fff;
  border-color: #FF0055;
}
.jb-btn-primary:hover {
  background: #fff;
  color: #FF0055;
  border-color: #fff;
}
.jb-btn-success {
  background: #00FF66;
  color: #000;
  border-color: #00FF66;
}
.jb-btn-danger {
  background: transparent;
  color: #FF0055;
  border-color: #FF0055;
}
.jb-btn-danger:hover {
  background: #FF0055;
  color: #fff;
}

/* ============ SVG Filter (手绘边框) ============ */
/* 在插件初始化时注入到 body 中 */

/* ============ 动画 ============ */
@keyframes jb-glitch {
  0% { transform: translate(0, 0); }
  25% { transform: translate(-2px, 1px); }
  50% { transform: translate(2px, -1px); }
  75% { transform: translate(-1px, -2px); }
  100% { transform: translate(0, 0); }
}

@keyframes jb-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ============ Ben-Day 网点专用类 ============ */
.jb-dots {
  background-image: radial-gradient(circle, #FF0055 1px, transparent 1px);
  background-size: 4px 4px;
}

/* ============ 标签页 ============ */
.jb-tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 8px;
}
.jb-tab {
  padding: 6px 14px;
  background: #2A2A2A;
  color: #888;
  border: 1px solid #333;
  cursor: pointer;
  font-size: 13px;
  font-weight: bold;
  transition: all 0.15s;
}
.jb-tab:hover { background: #3A3A3A; color: #fff; }
.jb-tab.active {
  background: #FF0055;
  color: #fff;
  border-color: #FF0055;
  text-shadow: 1px 1px 0 #000;
}

/* ============ 资产项目 ============ */
.jb-asset-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: #2A2A2A;
  border: 1px solid #333;
  margin-bottom: 4px;
  cursor: grab;
  transition: border-color 0.15s;
}
.jb-asset-item:hover { border-color: #FF0055; }
.jb-asset-item .jb-asset-thumb {
  width: 40px; height: 40px;
  object-fit: cover;
  border: 1px solid #444;
}
.jb-asset-item .jb-asset-name {
  flex: 1;
  font-size: 12px;
  color: #ccc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.jb-asset-item .jb-asset-actions {
  display: flex;
  gap: 2px;
}
.jb-asset-item .jb-asset-actions button {
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  padding: 2px 4px;
  font-size: 14px;
}
.jb-asset-item .jb-asset-actions button:hover { color: #FF0055; }

/* ============ 拖拽区 ============ */
.jb-dropzone {
  border: 2px dashed #FF0055;
  padding: 20px;
  text-align: center;
  color: #888;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 8px;
}
.jb-dropzone:hover, .jb-dropzone.jb-dragover {
  background: rgba(255, 0, 85, 0.1);
  border-color: #FFEA00;
  color: #FFEA00;
}

/* ============ Skill 项目 ============ */
.jb-skill-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: #2A2A2A;
  border-left: 3px solid #00E5FF;
  margin-bottom: 3px;
  cursor: pointer;
  transition: all 0.15s;
}
.jb-skill-item:hover { border-left-color: #FFEA00; background: #333; }
.jb-skill-item.active {
  border-left-color: #FF0055;
  background: rgba(255, 0, 85, 0.15);
}
.jb-skill-item .jb-skill-name {
  flex: 1;
  font-size: 12px;
  color: #ccc;
}
.jb-skill-item .jb-skill-remove {
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  font-size: 12px;
  padding: 2px;
}
.jb-skill-item .jb-skill-remove:hover { color: #FF0055; }
```

- [ ] **Step 4: 在 content_script 注入点初始化面板系统**

在 sidebar.js 被删除后，需要一个新的入口脚本。修改 manifest.json 的 content_scripts，并创建入口：

```javascript
// src/main.js — 插件入口
(function() {
  'use strict';

  // 注入 SVG filter（手绘边框）
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
  svg.innerHTML = `
    <filter id="jb-comic-border">
      <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="3" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="2" xChannelSelector="R" yChannelSelector="G"/>
    </filter>`;
  document.body.appendChild(svg);

  // 初始化面板系统
  // 加载顺序：state → panel-system → skills → interaction → assets → comic-ui
  // 三个主面板创建
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

  // 初始化各模块
  if (typeof initSkills === 'function') initSkills();
  if (typeof initInteraction === 'function') initInteraction();
  if (typeof initAssets === 'function') initAssets();
})();
```

- [ ] **Step 5: 更新 manifest.json**

```json
// manifest.json 中 content_scripts 部分改为：
{
  "matches": ["https://web.jubianai.net/*"],
  "js": [
    "src/state.js",
    "src/panel-system.js",
    "src/skills-init.js",
    "src/skills.js",
    "src/interaction.js",
    "src/assets.js",
    "src/drawing.js",
    "src/comic-ui.js",
    "src/main.js"
  ],
  "css": ["content_style.css"],
  "run_at": "document_idle"
}
```

同时保留 background.js 的引用：
```json
"background": { "service_worker": "background.js" }
```

- [ ] **Step 6: 更新 src/state.js**

```javascript
// src/state.js
let globalState = {
  skills: [],           // [{name, description, system_prompt, builtin: true, fileId}]
  skillFolders: [],     // [{name, children: ['skillId', ...]}]
  assets: {             // 按分类
    characters: [],     // [{id, name, dataURL (thumbnail), file (original)}]
    scenes: [],
    props: []
  },
  assetFolders: {       // 每个分类内的文件夹
    characters: [],
    scenes: [],
    props: []
  },
  models: [             // 模型配置（第一个为默认）
    { name: 'ARK 内置', url: 'https://ark.cn-beijing.volces.com/api/coding/v1/chat/completions', key: '', model: 'doubao-seed-2.0-code', builtin: true }
  ],
  currentSkillId: null,
  panelState: null
};
```

- [ ] **Step 7: Commit Task 1**

```bash
cd C:\Users\EDY\Desktop\jubianai-assist
git add src/panel-system.js src/comic-ui.js src/main.js src/state.js content_style.css manifest.json
git rm src/sidebar.js
git commit -m "feat: 自由面板系统骨架 + 蜘蛛侠风格 UI"
```

---

### Task 2: Skill 系统

**Files:**
- Create: `src/skills.js`
- Modify: `src/state.js`（已包含 skill 状态）
- Modify: `src/main.js`（调用 initSkills）
- Create: `src/skills-init.js`（内置 skill 数据，从原始 SKILL.md 提取压缩）

- [ ] **Step 1: 创建 skills-init.js — 内置 Skill 数据**

从四个 SKILL.md 中提取 name/description/system_prompt：

```javascript
// src/skills-init.js — 内置 Skill 数据
// 从原始 SKILL.md 提取，打包为 JSON 格式

const BUILTIN_SKILLS = [
  {
    id: 'script-analyzer',
    name: 'script-analyzer',
    description: '从剧本中提取角色、场景、道具信息，按指定格式输出资产提示词',
    builtin: true,
    version: '1.0',
    output_format: 'markdown',
    system_prompt: `你是一个剧本分析专家。收到剧本后，按以下三大模块逐一提取并输出。

模块一：角色提取 — 通读剧本，统计所有角色名出现次数，仅保留超过9次的角色。每个角色输出：=== [角色名] === 【基础信息】年龄、性别、人种（东亚人种中国人）、身份 【外形特征】脸型、眉型、眼型、鼻型、唇型、发型 【服装（前期）】外套、内搭、下装、鞋履、配饰 【服装（后期）】同上 【图像生成提示词】

模块二：场景提取 — 列出所有场景地点，仅保留出现超过1次的场景。每个场景输出：=== [场景名称] === 【拍摄参数】机位高度、焦距35mm、画幅16:9横屏 【场景类型】室内/室外、时段、季节 【空间布局】场景图左侧/正前方/右侧/空间尺寸/可信度 【视觉描述】空间氛围、光影质感、色调风格、环境情绪，不得出现人物 【光源】主光+辅光 【色调与材质】【风格】【图像生成提示词】

模块三：道具提取 — 提取反复出现或具有重要功能的道具。每个道具输出：=== [道具名] === 【基础信息】类型/材质/尺寸/颜色/出现场景/功能作用 【视觉特征】表面处理/标识/质感 【图像生成提示词】

三个模块以 --- 分隔输出。`
  },
  {
    id: 'shot-script-creator',
    name: 'shot-script-creator',
    description: '将剧本片段转化为竖屏分镜脚本，含景别、运镜、光线、动线',
    builtin: true,
    version: '4.2',
    output_format: 'markdown',
    system_prompt: `你是一个专业影视分镜导演。将指定剧本片段转化为竖屏9:16分镜脚本。

核心规则：
1. 一段剧本原文对应一个或多个镜头
2. 运镜必须写清相机路径：以[主体]为主体（面朝场景图[方位]），从场景图[起点]起，[运镜类型]至场景图[终点]
3. 中景动线要写清完整路径：从[起点]→经过[哪一侧]→到达[终点]，禁止只写"朝[方向]走去"
4. 光线按主光+辅光结构：主光→场景图[物体]的[光源名]从画面[方位]照入；辅光同理
5. 所有空间方位以场景参考图为坐标系（场景图左侧/正前方/右侧），禁用东南西北
6. 输出前核对：运镜路径是否完整、动线路径是否完整、主辅光逻辑是否清晰、朝向是否自洽

输出格式：
=== 第X场 — [地点] [时间] [内外] ===
风格 → [具象风格描述]

**1**
景别：[全景/中景/近景/特写/极致特写]
运镜：以[主体]为主体（面朝场景图[方位]），从场景图[起点]起，[运镜类型]至场景图[终点]
角度：[平视/仰拍/俯拍]
焦距：[35mm/50mm/85mm/24mm]
前景：[场景图元素在画面方位做前景虚化/遮挡]
中景：[场景图精确位置的角色+四层朝向+白描动作]
背景：[身后的环境参照物+焦外状态]
光线：主光→场景图[物体]的[光源名]从画面[方位]照入
      辅光→场景图[物体]的[光源名]从画面[方位]补入
视觉重点：[最突出的视觉焦点]
台词/旁白：[角色名：台词]`
  },
  {
    id: 'reviewing-micro-drama',
    name: 'reviewing-micro-drama',
    description: '微短剧剧本内容安全审核与创作指导',
    builtin: true,
    version: '1.0',
    output_format: 'markdown',
    system_prompt: `你是一个微短剧剧本安全审核专家。对照平台规范对剧本进行逐项安全审核。

逐项检查以下内容：
1. 是否涉及政治敏感内容
2. 是否涉及色情低俗描写
3. 是否涉及暴力血腥过度
4. 是否涉及价值观导向问题
5. 角色设定是否有负面刻板印象
6. 台词是否有不当用语

每项输出：✅ 通过 / ⚠️ 注意 / ❌ 违规 + 整改建议
最后输出综合风险评级：低风险 / 中风险 / 高风险 + 整体建议`
  },
  {
    id: 'qiuzhi-skill-creator',
    name: 'qiuzhi-skill-creator',
    description: '引导创建自定义 skill，通过交互式问答生成 .skill 文件',
    builtin: true,
    version: '1.0',
    output_format: 'markdown',
    system_prompt: `你是一个 Skill 创建助手。引导用户创建一个自定义 skill。

逐步询问：
1. 这个 skill 做什么？（一句话描述）
2. 输入是什么？输出是什么？
3. 核心处理规则是什么？（一段详细 prompt）

收集完信息后，输出一个完整的 .skill 格式 JSON。`
  }
];
```

- [ ] **Step 2: 创建 skills.js — Skill 管理系统**

```javascript
// src/skills.js — Skill 管理系统
// 依赖：globalState (state.js), BUILTIN_SKILLS (skills-init.js), jbPanelSystem (panel-system.js)

function initSkills() {
  // 加载内置 skill
  if (!globalState.skills.length) {
    globalState.skills = BUILTIN_SKILLS.map(s => ({ ...s }));
  }

  // 从 chrome.storage.local 加载用户 skill
  chrome.storage.local.get('userSkills', (res) => {
    if (res.userSkills) {
      for (const us of res.userSkills) {
        if (!globalState.skills.find(s => s.id === us.id)) {
          globalState.skills.push(us);
        }
      }
    }
    renderSkillPanel();
  });
}

function renderSkillPanel() {
  const panel = jbPanelSystem.panels.find(p => p.id === 'skills');
  if (!panel) return;

  let html = `
    <div style="margin-bottom:8px;display:flex;gap:4px;">
      <button class="jb-btn jb-btn-primary" id="jb-upload-skill" style="flex:1;padding:6px;font-size:11px;">📂 上传 Skill</button>
      <button class="jb-btn" id="jb-new-folder" style="padding:6px;font-size:11px;">📁</button>
    </div>
    <input type="file" id="jb-skill-file-input" accept=".skill,.json" style="display:none">
    <div id="jb-skill-list">`;

  // 按文件夹分组
  const folders = globalState.skillFolders || [];
  const uncategorized = globalState.skills.filter(s => !folders.find(f => f.children.includes(s.id)));

  for (const f of folders) {
    html += `<div class="jb-skill-folder">
      <div class="jb-skill-folder-header" style="display:flex;align-items:center;gap:4px;padding:4px 0;color:#00E5FF;font-size:12px;cursor:pointer;">
        <span>📁 ${f.name}</span>
        <button class="jb-folder-remove-btn" data-folder="${f.name}" style="background:none;border:none;color:#666;cursor:pointer;font-size:10px;margin-left:auto;">✕</button>
      </div>`;
    for (const sid of f.children) {
      const s = globalState.skills.find(sk => sk.id === sid);
      if (s) html += renderSkillItem(s);
    }
    html += `</div>`;
  }

  for (const s of uncategorized) {
    html += renderSkillItem(s);
  }

  html += `</div>`;
  panel.element.querySelector('.jb-panel-body').innerHTML = html;
  bindSkillEvents();
}

function renderSkillItem(skill) {
  const active = globalState.currentSkillId === skill.id ? 'active' : '';
  return `<div class="jb-skill-item ${active}" data-skill-id="${skill.id}">
    <span class="jb-skill-name">${skill.builtin ? '📦' : '📄'} ${skill.name}</span>
    <span style="font-size:10px;color:#666;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${skill.description || ''}</span>
    ${skill.builtin ? '' : '<button class="jb-skill-remove" data-skill-id="' + skill.id + '">✕</button>'}
  </div>`;
}

function bindSkillEvents() {
  // 选择 skill
  document.querySelectorAll('.jb-skill-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.skillId;
      globalState.currentSkillId = id;
      document.querySelectorAll('.jb-skill-item').forEach(e => e.classList.remove('active'));
      el.classList.add('active');
      showToast('✅ 已选择 Skill: ' + (globalState.skills.find(s => s.id === id)?.name || id));
    });
  });

  // 删除用户 skill
  document.querySelectorAll('.jb-skill-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.skillId;
      if (!confirm('确定删除这个 Skill？')) return;
      const idx = globalState.skills.findIndex(s => s.id === id);
      if (idx > -1) globalState.skills.splice(idx, 1);
      saveUserSkills();
      renderSkillPanel();
    });
  });

  // 文件夹删除
  document.querySelectorAll('.jb-folder-remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = btn.dataset.folder;
      if (!confirm('确定删除文件夹「' + name + '」？')) return;
      globalState.skillFolders = globalState.skillFolders.filter(f => f.name !== name);
      saveUserSkills();
      renderSkillPanel();
    });
  });

  // 上传 skill
  document.getElementById('jb-upload-skill')?.addEventListener('click', () => {
    document.getElementById('jb-skill-file-input').click();
  });
  document.getElementById('jb-skill-file-input')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const skill = JSON.parse(ev.target.result);
        if (!skill.name || !skill.system_prompt) {
          showToast('❌ Skill 文件格式错误：需要 name 和 system_prompt');
          return;
        }
        skill.id = skill.name + '-' + Date.now();
        skill.builtin = false;
        globalState.skills.push(skill);
        saveUserSkills();
        renderSkillPanel();
        showToast('✅ 已加载 Skill: ' + skill.name);
      } catch (err) {
        showToast('❌ 文件解析失败：' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // 新建文件夹
  document.getElementById('jb-new-folder')?.addEventListener('click', () => {
    const name = prompt('输入文件夹名称：');
    if (!name) return;
    if (globalState.skillFolders.find(f => f.name === name)) {
      showToast('⚠️ 文件夹已存在');
      return;
    }
    globalState.skillFolders.push({ name, children: [] });
    saveUserSkills();
    renderSkillPanel();
  });
}

function saveUserSkills() {
  const userSkills = globalState.skills.filter(s => !s.builtin);
  chrome.storage.local.set({ userSkills });
}

function getCurrentSkill() {
  return globalState.skills.find(s => s.id === globalState.currentSkillId);
}
```

- [ ] **Step 3: 修改 src/main.js — 调用 initSkills**

```javascript
// 在 main.js 的初始化部分加入：
if (typeof initSkills === 'function') initSkills();
```

- [ ] **Step 4: 更新 manifest.json 注入脚本列表**

确保 manifest.json 的 content_scripts 包含 `src/skills-init.js` 和 `src/skills.js`。

- [ ] **Step 5: Commit Task 2**

```bash
git add src/skills.js src/skills-init.js src/main.js manifest.json
git commit -m "feat: Skill 系统 — 内置4个 skill + 用户上传/删除/文件夹管理"
```

---

### Task 3: 交互区 — 文档上传 + LLM 对话

**Files:**
- Create: `src/interaction.js`
- Modify: `src/main.js`（调用 initInteraction）
- Modify: `background.js`（确认消息协议）

- [ ] **Step 1: 创建 interaction.js**

```javascript
// src/interaction.js — 交互区：文档上传 + LLM 对话
// 依赖：globalState, jbPanelSystem, getCurrentSkill

function initInteraction() {
  // 加载已保存的自定义代理
  chrome.storage.local.get('userModels', (res) => {
    if (res.userModels) {
      for (const m of res.userModels) {
        if (!globalState.models.find(x => x.name === m.name)) {
          globalState.models.push(m);
        }
      }
    }
  });
  renderInteractionPanel();
  setupHistoryNav();
}

function renderInteractionPanel() {
  const panel = jbPanelSystem.panels.find(p => p.id === 'interaction');
  if (!panel) return;

  const html = `
    <div style="margin-bottom:8px;display:flex;gap:4px;flex-wrap:wrap;">
      <button class="jb-btn jb-btn-primary" id="jb-upload-doc" style="flex:1;padding:6px;font-size:11px;">📄 上传剧本</button>
      <select id="jb-model-selector" style="flex:1;padding:6px;background:#2A2A2A;color:#fff;border:1px solid #FF0055;font-size:11px;">
        ${globalState.models.map((m, i) => `<option value="${i}" ${i === 0 ? 'selected' : ''}>${m.name}</option>`).join('')}
      </select>
      <button class="jb-btn" id="jb-settings-btn" style="padding:6px;font-size:11px;">⚙️</button>
    </div>
    <input type="file" id="jb-doc-file-input" accept=".txt" style="display:none">
    <div id="jb-interaction-input" style="margin-bottom:8px;">
      <textarea id="jb-input-text" placeholder="粘贴剧本内容，或上传文件自动填入..." style="width:100%;height:100px;background:#0D0D0D;color:#fff;border:1px solid #333;padding:8px;font-size:13px;font-family:monospace;resize:vertical;box-sizing:border-box;"></textarea>
    </div>
    <div style="display:flex;gap:4px;margin-bottom:8px;">
      <button class="jb-btn jb-btn-success" id="jb-execute-btn" style="flex:2;padding:6px;font-size:12px;">▶ 执行</button>
      <button class="jb-btn" id="jb-copy-btn" style="flex:1;padding:6px;font-size:11px;">📋 复制</button>
      <button class="jb-btn" id="jb-save-txt-btn" style="flex:1;padding:6px;font-size:11px;">💾 保存 .txt</button>
    </div>
    <div id="jb-interaction-output" style="background:#0D0D0D;border:1px solid #333;padding:8px;min-height:150px;max-height:400px;overflow-y:auto;font-size:12px;line-height:1.6;white-space:pre-wrap;color:#ccc;font-family:monospace;">
      <div class="jb-empty">选择 Skill → 输入剧本 → 点击执行</div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:10px;color:#555;">
      <span>历史: <span id="jb-history-pos">0/0</span></span>
      <button id="jb-clear-output-btn" style="background:none;border:none;color:#555;cursor:pointer;font-size:10px;">清空</button>
    </div>
  `;

  panel.element.querySelector('.jb-panel-body').innerHTML = html;
  bindInteractionEvents();
}

function bindInteractionEvents() {
  // 上传文档
  document.getElementById('jb-upload-doc')?.addEventListener('click', () => {
    document.getElementById('jb-doc-file-input').click();
  });
  document.getElementById('jb-doc-file-input')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      document.getElementById('jb-input-text').value = ev.target.result;
      showToast('✅ 已加载文件: ' + file.name);
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // 执行
  document.getElementById('jb-execute-btn')?.addEventListener('click', executeSkill);

  // 复制
  document.getElementById('jb-copy-btn')?.addEventListener('click', () => {
    const output = document.getElementById('jb-interaction-output');
    navigator.clipboard.writeText(output.textContent)
      .then(() => showToast('✅ 已复制到剪贴板'))
      .catch(() => showToast('❌ 复制失败'));
  });

  // 保存为 .txt
  document.getElementById('jb-save-txt-btn')?.addEventListener('click', () => {
    const output = document.getElementById('jb-interaction-output');
    const content = output.textContent;
    const skill = getCurrentSkill();
    const name = `output-${skill?.name || 'unknown'}-${Date.now()}`;
    const skillFile = {
      id: name,
      name: name,
      description: '从交互区保存的输出',
      builtin: false,
      version: '1.0',
      output_format: 'text',
      system_prompt: content
    };
    globalState.skills.push(skillFile);
    saveUserSkills();
    renderSkillPanel();
    showToast('✅ 已保存到 Skill 栏: ' + name);
  });

  // 设置（API Key + 代理管理）
  document.getElementById('jb-settings-btn')?.addEventListener('click', showSettingsDialog);

  // 清空
  document.getElementById('jb-clear-output-btn')?.addEventListener('click', () => {
    document.getElementById('jb-interaction-output').innerHTML = '<div class="jb-empty">已清空</div>';
    globalState._interactionHistory = [];
    updateHistoryNav();
  });
}

async function executeSkill() {
  const skill = getCurrentSkill();
  if (!skill) { showToast('⚠️ 请先在左侧选择一个 Skill'); return; }
  const input = document.getElementById('jb-input-text').value.trim();
  if (!input) { showToast('⚠️ 请输入或上传剧本内容'); return; }

  // 读取模型选择器
  const modelIdx = parseInt(document.getElementById('jb-model-selector')?.value || '0');
  const modelCfg = globalState.models[modelIdx];
  if (!modelCfg) { showToast('⚠️ 未找到模型配置'); return; }

  const output = document.getElementById('jb-interaction-output');
  output.innerHTML = '<div style="text-align:center;padding:20px;color:#FF0055;">⏳ 正在执行...</div>';

  // 如果选中内置模型，用 background.js 的 GET_API_KEY；如果用户自定义代理，直接用配置里的 key
  const apiKey = modelCfg.builtin ? await getApiKeyFromStorage() : modelCfg.key;
  if (!apiKey) {
    output.innerHTML = '<div style="color:#FF0055;">⚠️ 请先配置 API Key（⚙️ 设置）</div>';
    return;
  }

  chrome.runtime.sendMessage({
    type: 'CALL_ARK',
    apiKey,
    url: modelCfg.url,
    messages: [
      { role: 'system', content: skill.system_prompt },
      { role: 'user', content: input }
    ],
    model: modelCfg.model || 'doubao-seed-2.0-code',
    maxTokens: 8192,
    temperature: 0.3,
    _noCache: false
  }, (res) => {
    if (!res || !res.ok) {
      output.innerHTML = `<div style="color:#FF0055;">❌ 执行失败：${res?.error || '未知错误'}</div>`;
      return;
    }
    const text = res.data.choices[0].message.content;
    output.textContent = text;

    // 存入历史
    if (!globalState._interactionHistory) globalState._interactionHistory = [];
    globalState._interactionHistory.push({ input, output: text, skill: skill.name, time: Date.now() });
    updateHistoryNav();
  });
}

function showSettingsDialog() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.8);z-index:1000010;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:#1A1A1A;border:2px solid #FF0055;border-radius:6px;width:450px;max-width:90vw;padding:20px;">
      <h3 style="color:#fff;margin:0 0 16px;font-size:16px;">⚙️ 设置</h3>
      <div style="margin-bottom:12px;">
        <label style="color:#888;font-size:12px;display:block;margin-bottom:4px;">内置模型 API Key</label>
        <input type="password" id="jb-settings-apikey" style="width:100%;padding:8px;background:#0D0D0D;color:#fff;border:1px solid #333;border-radius:4px;font-size:13px;box-sizing:border-box;">
      </div>
      <div style="margin-bottom:12px;">
        <label style="color:#888;font-size:12px;display:block;margin-bottom:4px;">自定义代理</label>
        <div id="jb-proxy-list" style="margin-bottom:6px;">
          ${globalState.models.filter(m => !m.builtin).map((m, i) =>
            `<div style="display:flex;gap:4px;margin-bottom:4px;align-items:center;">
              <input value="${m.url}" style="flex:2;padding:4px;background:#0D0D0D;color:#fff;border:1px solid #333;border-radius:3px;font-size:11px;" placeholder="URL">
              <input value="${m.name}" style="flex:1;padding:4px;background:#0D0D0D;color:#fff;border:1px solid #333;border-radius:3px;font-size:11px;" placeholder="名称">
              <button class="jb-proxy-remove" data-idx="${i}" style="background:none;border:none;color:#FF0055;cursor:pointer;">✕</button>
            </div>`).join('')}
        </div>
        <button id="jb-add-proxy" class="jb-btn" style="padding:4px 8px;font-size:11px;">+ 添加代理</button>
      </div>
      <div style="display:flex;gap:6px;justify-content:flex-end;">
        <button id="jb-settings-cancel" class="jb-btn" style="padding:6px 16px;font-size:12px;">取消</button>
        <button id="jb-settings-save" class="jb-btn jb-btn-primary" style="padding:6px 16px;font-size:12px;">保存</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // 加载当前 key
  chrome.runtime.sendMessage({ type: 'GET_API_KEY' }, (res) => {
    const input = overlay.querySelector('#jb-settings-apikey');
    if (res?.ok && res.key) input.value = res.key;
  });

  overlay.querySelector('#jb-settings-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#jb-add-proxy').addEventListener('click', () => {
    globalState.models.push({ name: '新代理', url: '', key: '', model: '', builtin: false });
    overlay.remove();
    showSettingsDialog();
  });
  overlay.querySelectorAll('.jb-proxy-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      globalState.models.splice(parseInt(btn.dataset.idx), 1);
      overlay.remove();
      showSettingsDialog();
    });
  });
  overlay.querySelector('#jb-settings-save').addEventListener('click', () => {
    const key = overlay.querySelector('#jb-settings-apikey').value;
    chrome.runtime.sendMessage({ type: 'SAVE_API_KEY', key });
    // 保存代理配置
    chrome.storage.local.set({ userModels: globalState.models.filter(m => !m.builtin) });
    // 更新交互区的模型选择器
    const sel = document.getElementById('jb-model-selector');
    if (sel) {
      sel.innerHTML = globalState.models.map((m, i) => `<option value="${i}">${m.name}</option>`).join('');
    }
    showToast('✅ 设置已保存');
    overlay.remove();
  });
}

function getApiKeyFromStorage() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_API_KEY' }, (res) => {
      resolve(res.ok ? res.key : '');
    });
  });
}

function setupHistoryNav() {
  globalState._historyIdx = -1;
  globalState._interactionHistory = [];
}

function updateHistoryNav() {
  const h = globalState._interactionHistory || [];
  const pos = document.getElementById('jb-history-pos');
  if (pos) pos.textContent = `${h.length}/${h.length}`;
}
```

- [ ] **Step 2: 修改 main.js 调用 initInteraction**

```javascript
// 在 main.js 中加入
if (typeof initInteraction === 'function') initInteraction();
```

- [ ] **Step 3: Commit Task 3**

```bash
git add src/interaction.js src/main.js
git commit -m "feat: 交互区 — 文档上传 + LLM 对话 + 复制/保存"
```

---

### Task 4: 资产池 — 三栏 + 拖拽 + 缩略图 + 画图入口

**Files:**
- Create: `src/assets.js`
- Modify: `src/main.js`

- [ ] **Step 1: 创建 assets.js**

```javascript
// src/assets.js — 资产管理系统：三分类 + 拖拽上传 + 缩略图 + 画图入口

const ASSET_CATEGORIES = [
  { key: 'characters', icon: '👤', label: '角色' },
  { key: 'scenes', icon: '🏠', label: '场景' },
  { key: 'props', icon: '📦', label: '道具' }
];

let _currentAssetCategory = sessionStorage.getItem('jb_asset_category') || 'characters';
let _db = null; // IndexedDB 连接

function initAssets() {
  openAssetDB().then(() => {
    loadAssetsFromDB();
    renderAssetPanel();
  });
}

function openAssetDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('JBAssetsDB', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('thumbnails')) {
        db.createObjectStore('thumbnails', { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(); };
    req.onerror = () => reject(req.error);
  });
}

function loadAssetsFromDB() {
  // 从 IndexedDB 加载缩略图
  if (!_db) return;
  const tx = _db.transaction('thumbnails', 'readonly');
  const store = tx.objectStore('thumbnails');
  store.getAll().onsuccess = (e) => {
    for (const item of e.target.result) {
      const cat = item.category || 'characters';
      if (!globalState.assets[cat].find(a => a.id === item.id)) {
        globalState.assets[cat].push(item);
      }
    }
  };
}

function saveThumbnailToDB(id, category, dataURL, name) {
  if (!_db) return;
  const tx = _db.transaction('thumbnails', 'readwrite');
  const store = tx.objectStore('thumbnails');
  store.put({ id, category, dataURL, name, time: Date.now() });
}

function deleteThumbnailFromDB(id) {
  if (!_db) return;
  const tx = _db.transaction('thumbnails', 'readwrite');
  const store = tx.objectStore('thumbnails');
  store.delete(id);
}

function renderAssetPanel() {
  const panel = jbPanelSystem.panels.find(p => p.id === 'assets');
  if (!panel) return;

  const tabs = ASSET_CATEGORIES.map(c =>
    `<button class="jb-tab ${c.key === _currentAssetCategory ? 'active' : ''}" data-cat="${c.key}">${c.icon} ${c.label}</button>`
  ).join('');

  const currentCat = _currentAssetCategory;
  const items = globalState.assets[currentCat] || [];

  const itemList = items.map(item => `
    <div class="jb-asset-item" data-id="${item.id}" draggable="true">
      <img class="jb-asset-thumb" src="${item.dataURL}" alt="${item.name}">
      <span class="jb-asset-name">${item.name}</span>
      <div class="jb-asset-actions">
        <button class="jb-asset-draw-btn" data-id="${item.id}" title="画图">✏️</button>
        <button class="jb-asset-remove-btn" data-id="${item.id}" title="删除">✕</button>
      </div>
    </div>
  `).join('');

  const html = `
    <div class="jb-tabs">${tabs}</div>
    <div class="jb-dropzone" id="jb-asset-dropzone">${ASSET_CATEGORIES.find(c => c.key === currentCat)?.icon} 拖入图片到此处</div>
    <input type="file" id="jb-asset-file-input" multiple accept="image/*" style="display:none">
    <div id="jb-asset-list">${itemList.length ? itemList : '<div class="jb-empty">暂无图片</div>'}</div>
  `;

  panel.element.querySelector('.jb-panel-body').innerHTML = html;
  bindAssetEvents();
}

function bindAssetEvents() {
  // 标签页切换
  document.querySelectorAll('.jb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      _currentAssetCategory = tab.dataset.cat;
      sessionStorage.setItem('jb_asset_category', _currentAssetCategory);
      renderAssetPanel();
    });
  });

  // 拖拽上传
  const dz = document.getElementById('jb-asset-dropzone');
  const fi = document.getElementById('jb-asset-file-input');
  if (dz && fi) {
    dz.addEventListener('click', () => fi.click());
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('jb-dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('jb-dragover'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('jb-dragover');
      handleAssetFiles(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')));
    });
    fi.addEventListener('change', () => {
      handleAssetFiles(Array.from(fi.files).filter(f => f.type.startsWith('image/')));
      fi.value = '';
    });
  }

  // 删除
  document.querySelectorAll('.jb-asset-remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!confirm('确定删除？')) return;
      const cat = globalState.assets[_currentAssetCategory];
      const idx = cat.findIndex(a => a.id === id);
      if (idx > -1) cat.splice(idx, 1);
      deleteThumbnailFromDB(id);
      renderAssetPanel();
    });
  });

  // 画图入口
  document.querySelectorAll('.jb-asset-draw-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const cat = globalState.assets[_currentAssetCategory];
      const item = cat.find(a => a.id === id);
      if (item && typeof openDrawingTool === 'function') {
        openDrawingTool(item);
      } else {
        showToast('✏️ 画图工具就绪');
      }
    });
  });
}

function handleAssetFiles(files) {
  for (const file of files) {
    const name = file.name.replace(/\.[^.]+$/, '');
    const id = name + '-' + Date.now();
    const reader = new FileReader();
    reader.onload = (e) => {
      // 生成缩略图
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxW = 200;
        const scale = Math.min(1, maxW / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataURL = canvas.toDataURL('image/webp', 0.7);

        const asset = { id, name, dataURL, file, category: _currentAssetCategory };
        globalState.assets[_currentAssetCategory].push(asset);

        // 存入 IndexedDB
        saveThumbnailToDB(id, _currentAssetCategory, dataURL, name);
        renderAssetPanel();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }
}
```

- [ ] **Step 2: 修改 src/drawing.js — 兼容新入口**

修改 openDrawingTool 函数签名，使其可以从资产项直接调用：

```javascript
// drawing.js 中 openDrawingTool 函数修改：
// 旧：function openDrawingTool(poolIdx) { ... }
// 新：
function openDrawingTool(assetItem) {
  // assetItem = { id, name, dataURL, file }
  // 如果没有 file（从 IndexedDB 加载的缩略图），需要 reconstruct
  if (!assetItem.file) {
    // 从 dataURL 重建 File 对象
    fetch(assetItem.dataURL)
      .then(r => r.blob())
      .then(blob => {
        const file = new File([blob], assetItem.name + '.png', { type: 'image/png' });
        launchDrawingOverlay({ name: assetItem.name, file });
      });
    return;
  }
  launchDrawingOverlay({ name: assetItem.name, file: assetItem.file });
}

function launchDrawingOverlay(poolItem) {
  // 将原有 openDrawingTool 的 body 移到这里
  // ...（保留现有 drawing.js 的所有绘制逻辑不变，只改入口）
}
```

- [ ] **Step 3: Commit Task 4**

```bash
git add src/assets.js src/drawing.js src/main.js
git commit -m "feat: 资产池 — 三栏分类 + 拖拽上传 + 缩略图 IndexedDB + 画图入口"
```

---

### Task 5: background.js 扩展 — 新增消息类型 + 支持自定义代理 URL

**Files:**
- Modify: `background.js`

- [ ] **Step 1: 修改 handleArkApi 支持动态 url**

在 background.js 中找到 handleArkApi 函数，在解构参数时增加 `url` 参数，并将 ARK_API_URL 替换为传入的 url：

```javascript
// 修改前：
async function handleArkApi(request, sendResponse) {
  const { messages, model = DEFAULT_MODEL, maxTokens = 4096, temperature = 0.1 } = request;

  // 修改后：
async function handleArkApi(request, sendResponse) {
  const { messages, model = DEFAULT_MODEL, maxTokens = 4096, temperature = 0.1, url } = request;
  const API_URL = url || ARK_API_URL;

  // 将函数体内部所有 ARK_API_URL 替换为 API_URL
  // 共两处：初始 fetch 和 重试 fetch
```

- [ ] **Step 2: 在 background.js 中新增 LOAD_MODELS 消息类型**

```javascript
// 在 switch 中增加：
case 'LOAD_MODELS':
  chrome.storage.local.get('userModels', (result) => {
    sendResponse({ ok: true, models: result.userModels || [] });
  });
  return true;
```

- [ ] **Step 3: 在 background.js 中新增 skill 数据读写消息**

```javascript
// 在 chrome.runtime.onMessage.addListener 的 switch 中增加：
case 'GET_SKILL_DATA':
  chrome.storage.local.get('userSkills', (result) => {
    sendResponse({ ok: true, skills: result.userSkills || [] });
  });
  return true;

case 'SAVE_SKILL_DATA':
  chrome.storage.local.set({ userSkills: request.skills }, () => {
    sendResponse({ ok: true });
  });
  return true;
```

- [ ] **Step 3: Commit Task 5**

```bash
git add background.js
git commit -m "feat: background.js 新增 skill 数据读写消息 + 支持自定义代理 URL"
```

---

### Task 6: 数据持久化 + 存储限额策略

- [ ] **Step 1: 实现存储限额检查**

在 assets.js 中，每次保存缩略图前检查 IndexedDB 存储使用量：
- 遍历所有已存缩略图，如果总数超过 500 张，删除最早的未使用图片
- 记录每张图片的最后使用时间

- [ ] **Step 2: 实现面板状态持久化**

panel-system.js 中 saveState 已经保存面板位置。添加加载逻辑：在初始化时从 chrome.storage.local 读取并恢复面板位置。

- [ ] **Step 3: Commit Task 6**

```bash
git add src/panel-system.js src/assets.js
git commit -m "feat: 数据持久化 + 存储限额策略"
```

---

## 实施顺序总结

| 顺序 | Task | 文件数 | 关键产出 |
|:----:|:----|:------:|:---------|
| 1 | 骨架 + 蜘蛛侠UI | 6新建+3修改 | 自由面板系统、漫画风格 |
| 2 | Skill 系统 | 2新建+2修改 | 4内置skill、上传/删除/文件夹 |
| 3 | 交互区 | 1新建+2修改 | 文档上传、LLM对话、复制/保存 |
| 4 | 资产池 | 1新建+2修改 | 三栏分类、拖拽、缩略图、画图入口 |
| 5 | background.js扩展 | 1修改 | skill数据读写消息 |
| 6 | 数据持久化 | 2修改 | 存储限额、面板状态恢复 |
