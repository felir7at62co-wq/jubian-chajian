# jubianai 图片匹配助手 v2.0 — LLM 智能分析 + 在线画图工具

## 概述

在现有 Chrome 扩展基础上增加两大功能模块：

1. **LLM 智能分析匹配** — 调用 ARK API 分析镜头脚本中的文本，自动提取需要配图的角色/场景/道具实体列表，辅助用户从图片池中匹配对应图片并插入 `@图片N` 标记
2. **在线画图工具** — 分层 Canvas 实现在线绘制角色站位图/走位图，完成后保存副本到图片池，可直接用于子任务上传

---

## 模块一：架构变更

### Background Service Worker

当前 `content_script.js` 的 fetch 受 CORS 限制无法直接调用 ARK API（`ark.cn-beijing.volces.com`）。新增 Manifest V3 Service Worker 作为 API 代理。

**新增文件：** `background.js`

职责：
- 监听 content script 的 `chrome.runtime.onMessage` 请求
- 转发 ARK API 调用（纯文本 + 视觉），规避 CORS
- 管理 API Key 的本地存储

**消息协议：**

| 类型 | 方向 | 载荷 | 返回 |
|------|------|------|------|
| `CALL_ARK_TEXT` | content → background | `{ model, messages, max_tokens }` | `{ ok, data/error }` |
| `CALL_ARK_VISION` | content → background | `{ model, messages, images: [base64,...] }` | `{ ok, data/error }` |
| `GET_API_KEY` | content → background | — | `{ key }` |
| `SAVE_API_KEY` | content → background | `{ key }` | `{ ok }` |

**manifest.json 变更：**
- 新增 `background: { service_worker: "background.js" }`
- `permissions` 增加 `"storage"`
- `host_permissions` 增加 `"https://ark.cn-beijing.volces.com/*"`

### API Key 管理

- 侧边栏底部新增 🔑 设置区域，`input type="password"`
- 保存到 `chrome.storage.local`，仅需设置一次跨会话保持
- content script 启动时自动读取已有 key
- 无 key 时分析按钮 disabled，提示用户输入

---

## 模块二：LLM 智能分析匹配

### 2.1 整体流程

每个子任务独立分析、独立展示、独立确认。

```
用户在某子任务卡片点击 "🤖 分析"
       │
       ▼
  读取该子任务的 textarea 内容
       │
       ▼
  发送到 ARK 文本 API → LLM 提取实体
  { characters: [...], scenes: [...], props: [...] }
       │
       ▼
  在子任务卡片内展开分析结果面板
  ├ 自动字符串匹配图片池（已有名称匹配引擎）
  └ 未匹配项显示 ⚠️ + ❓选图按钮
       │
       ▼
  [可选] 用户点击 "🖼️ 视觉识别增强"
  → 调用 ARK Vision API 分析未匹配的图片内容
  → 展示匹配建议
       │
       ▼
  用户勾选需要配图的实体 + 确认匹配关系
  → 点击 "✅ 确认插入"
  → 只处理已勾选的实体
  → 执行 scanAndReplaceForSubtask 插入 @图片N
  → 标记子任务为已匹配
```

### 2.2 LLM 实体提取

**API：** `https://ark.cn-beijing.volces.com/api/coding/v1/chat/completions`
**模型：** `doubao-seed-2.0-code`（与现有 vision-fallback 一致）
**类型：** 纯文本调用（非视觉），速度快成本低

**System Prompt：**
```
你是一个微短剧分镜脚本分析助手。分析以下脚本内容，提取所有需要配图的实体。

规则：
1. 角色：故事中出现的所有人物名称（包括昵称、别名、尊称），如"裴野""苏队长""璃儿"
2. 场景：故事发生的具体地点，如"村口""苏家院子""后山""火车站"
3. 道具：关键物品，如"窝窝头""欠条""龙骨水车""琥珀果酿"

注意：
- 排除通用词（"我们""他们""因为""所以"等）
- 排除指令性词语（"镜头""画面""风格"等分镜术语）
- 同一实体多个叫法时合并为同一名称

输出严格 JSON 格式：
{"characters":["名称1","名称2"],"scenes":["地点1","地点2"],"props":["物品1","物品2"]}
```

### 2.3 匹配审核 UI

提取结果展示在对应子任务卡片内，每项一行。支持跳过。

**三种状态：**

| 状态 | 含义 | 用户操作 | UI 表现 |
|------|------|---------|---------|
| ✅ 已匹配 | 有对应图片 | 自动或手动选图 | 绿色 + 显示图片名 |
| ⚠️ 未匹配（待处理） | 需要配图但未选 | 点击 ❓选图 从池中选 | 橙色 + 选图按钮 |
| ⛔ 已跳过 | 明确不需要配图 | 取消勾选 ☐ | 灰色删除线 |

**UI 示例：**

```
├ 👤 角色 ─────────────────────────┤
│ ☑ 裴野   → ✅ [图片1] 裴野.jpg  │
│ ☑ 苏璃   → ⚠️ ❓选图            │
│ ☐ 赵大旺 → ⛔ 已跳过             │ ← 用户取消勾选
│ ☑ 苏队长 → ⚠️ ❓选图            │
├ 🏠 场景 ─────────────────────────┤
│ ☑ 村口   → ⚠️ ❓选图            │
│ ☐ 苏家院子→ ⛔ 已跳过            │ ← 不需要配场景图
├ 📦 道具 ─────────────────────────┤
│ ☑ 欠条   → ✅ [图片5] 欠条.png   │
│ ☐ 龙骨水车→ ⛔ 已跳过            │
├ ─── ─── ─── ─── ─── ─── ── ┤
│ [🖼️ 视觉识别未匹配项]  [✅ 确认插入] │
```

交互规则：
- 所有实体默认 **已勾选**（☑）
- 用户取消 ☐ → 该项标记 "⛔ 已跳过"，变灰
- 已跳过的项不参与后续任何 @图片N 插入
- 勾选状态可随时切换，不影响已选择的图片
- 确认插入时只处理 **已勾选且有匹配图片** 的项

### 2.4 视觉识别增强（可选）

用户点击 "🖼️ 视觉识别"：

1. 收集该子任务未匹配的实体名 + 图片池中未分配的图片
2. 图片缩小至 2048px 以内以 base64 编码
3. 分批（每批 3-5 张）发送到 ARK Vision API
4. API 返回每张图片内容类型判断
5. 交叉匹配后展示建议

**Vision Prompt：**
```
你是一个图片内容识别专家。分析以下图片，按 JSON 格式输出每张图片的内容：

{"images": [
  {"index": 0, "type": "人物/场景/道具", "content_name": "名称",
   "description": "20字内描述", "confidence": "high/medium/low"}
]}
```

### 2.5 确认插入

- 确认后遍历该子任务的实体列表
- 跳过 ☐ 未勾选的项
- 已勾选且有匹配图片的 → 执行 `scanAndReplaceForSubtask`（复用现有引擎）
- 同一子任务内同一实体出现多次 → 每处都插入 `@图片N`
- 已确认的子任务标记状态 `✅ 已插入`
- 用户可点击 "↩️ 撤销" 恢复（复用现有 undo 逻辑）

---

## 模块三：在线画图工具

### 3.1 分层 Canvas 架构

三层 Canvas 覆盖层，参考专业绘图工具设计：

```
┌──────────────────────┐
│  绘制层 (用户画的内容)  │  ← 支持撤销/重做
├──────────────────────┤
│  临时层 (实时绘制预览)  │  ← 当前笔触/形状/拖拽预览
├──────────────────────┤
│  底层 (原始图片)       │  ← 只读，永不修改
└──────────────────────┘
```

- **底层**：原图通过 `drawImage` 绘制，仅加载一次，不参与任何修改
- **临时层**：mousemove 期间实时显示当前正在绘制的笔触/形状/marquee，mouseup 后清空此层
- **绘制层**：存储所有已完成的绘制内容，每次完成一笔操作保存 ImageData 快照用于撤销

### 3.2 进入与退出

- 全局图片池每张图片右侧新增 ✏️ 按钮
- 点击弹出全屏覆盖层（z-index 高于现有预览覆盖层）
- 覆盖层包含：顶部工具栏 + 中央 Canvas + 底部状态栏
- ✕ 或 ← 返回关闭画板，不保存（如有未保存内容提示确认）

### 3.3 工具栏

顶部工具栏布局（从左到右）：

```
[← 返回]  站位图绘制 - {图片名}                    [保存副本 ▼]

🖊️ ✏️ ○ □ ➡️ A 🧹  |  ↩️ ➡️  |  ■ 粗细: ─●─  |  🔴🔵🟢🟡⚪⚫
```

| 工具 | 快捷键 | 操作方式 | 绘制层实现 |
|------|--------|---------|-----------|
| 🖊️ 自由画笔 | P | 按下拖拽，释放完成 | `beginPath()` + `lineTo()` + `stroke()` |
| ✏️ 细线笔 | L | 同上，线宽 50% | 同自由画笔，brushSize × 0.5 |
| ○ 圆形 | O | 点击圆心→拖拽定半径→释放 | `arc(x, y, r, 0, 2π)` + `stroke()` |
| □ 矩形 | R | 点击起点→拖拽定对角→释放 | `strokeRect()` |
| ➡️ 箭头 | A | 点击起点→拖拽到终点→释放 | 线段 + `triangleTo()` 箭头 |
| A 文字 | T | 点击位置→弹出输入框→确认 | `fillText()` |
| 🧹 橡皮擦 | E | 按下涂抹擦除绘图层 | `globalCompositeOperation = 'destination-out'` |

**颜色预设（6 色）：**
| 颜色 | 色值 | 用途场景 |
|------|------|---------|
| 🔴 红 | `#FF0000` | 主角走位、重点标注 |
| 🔵 蓝 | `#0066FF` | 配角走位、路线指示 |
| 🟢 绿 | `#00CC00` | 场景元素、安全区域 |
| 🟡 黄 | `#FFCC00` | 注意/警示区域 |
| ⚪ 白 | `#FFFFFF` | 暗色背景上的标注 |
| ⚫ 黑 | `#000000` | 亮色背景上的标注 |

**粗细控制：** 滑块 1px~20px，实时预览粗细

### 3.4 撤销/重做

```javascript
let undoStack = [];  // ImageData[]，最大 30
let redoStack = [];  // ImageData[]，最大 30

function saveState() {
  undoStack.push(ctx.getImageData(0, 0, canvasW, canvasH));
  if (undoStack.length > 30) undoStack.shift();
  redoStack = [];  // 新操作清空重做栈
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(ctx.getImageData(0, 0, canvasW, canvasH));
  ctx.putImageData(undoStack.pop(), 0, 0);
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(ctx.getImageData(0, 0, canvasW, canvasH));
  ctx.putImageData(redoStack.pop(), 0, 0);
}
```

触发时机：每次鼠标释放（mouseup）且绘制层有实际更改时调用 `saveState()`

### 3.5 保存副本

```javascript
async function saveAnnotatedCopy() {
  // 1. 合成底层 + 绘制层到临时 Canvas
  const merged = document.createElement('canvas');
  merged.width = baseCanvas.naturalWidth;
  merged.height = baseCanvas.naturalHeight;
  const mctx = merged.getContext('2d');
  mctx.drawImage(baseCanvas, 0, 0);             // 原图（原始分辨率）
  mctx.drawImage(drawCanvas, 0, 0);              // 绘制标注

  // 2. 导出为 Blob
  const blob = await new Promise(r => merged.toBlob(r, 'image/png'));

  // 3. 创建 File 添加到全局池
  const baseName = currentImage.name.replace(/\.[^.]+$/, '');
  const newFile = new File([blob], `${baseName}_站位图.png`, { type: 'image/png' });
  globalPool.push({ file: newFile, name: `${baseName}_站位图` });

  // 4. 刷新 UI
  renderPool();
  scanAllSubtasks();
  showToast('✅ 已保存站位图副本');
}
```

### 3.6 Canvas 尺寸与缩放策略

| 场景 | 分辨率 | 方式 |
|------|--------|------|
| 显示 | CSS 缩放适配屏幕 | 保持宽高比，最大高度 80vh |
| 绘制 | 原始分辨率全尺寸 | Canvas 实际尺寸 = 图片分辨率 |
| 保存 | 原始分辨率 | 导出 PNG，保留所有细节 |
| 超大图 (>4096px) | 缩放到 4096px | 减少内存占用 |

---

## 模块四：UI/UX 布局变更

### 4.1 可拖拽侧边栏宽度

- 侧边栏左侧边缘增加拖拽手柄（视觉：竖线 `⋮`，cursor: `ew-resize`）
- 拖动范围 280px ~ 700px
- 宽度保存在 `chrome.storage.local`，刷新页面保留

### 4.2 三模式切换

侧边栏头部增加模式切换按钮组：

| 模式 | 触发 | 效果 |
|------|------|------|
| 📋 标准 | 默认 | 侧边栏全宽显示（使用保存的宽度） |
| 🔍 展开 | 点击 | 临时增宽到 600px+，适合查看分析结果/画图 |
| 📌 最小化 | 点击 | 侧边栏 `translateX(100%)` 隐藏，只留一个浮动按钮 |

- 浮动按钮固定在右侧边缘中间，点击切回标准模式
- 当前模式保存在 `chrome.storage.local`

### 4.3 可折叠区域

所有主要区域头部增加折叠图标：

```
📷 全局角色池 [⏷]
   内容...

📋 子任务列表 [⏷]
   内容...

❓ 未分配图片 [⏷]
   内容...

🔑 API 设置 [⏷]
   内容...
```

- ⏷ = 展开状态，点击折叠 = 内容隐藏 + 图标变 ⏴
- 折叠状态保存在 `chrome.storage.local`
- 默认展开：全局角色池 + 子任务列表

### 4.4 侧边栏整体布局

```
┌──────────────────────────────┐
│ 🖼️ 图片匹配助手  📋🔍📌  ✕  │ ← 头部（模式切换）
├──────────────────────────────┤
│ 📷 全局角色池              ⏷ │
│ [拖拽区域]                    │
│ [图片1] [✏️][✕]              │ ← 图片列表(新增编辑按钮)
│ [图片2] [✏️][✕]              │
│ ...                          │
├──────────────────────────────┤
│ 📋 子任务列表              ⏷ │
│ ┌─ 子任务 1 ──────────────┐ │
│ │ 🤖 分析 | ✅ 确认 | ↩️撤销 │ │ ← 操作按钮行
│ │ 📝 分析结果...            │ │ ← 分析后展开
│ │ ☑ 裴野 → ✅ [图片1]     │ │
│ │ ☑ 苏璃 → ⚠️ ❓选图      │ │
│ │ ☐ 赵大旺 → ⛔ 已跳过     │ │
│ │ [🖼️ 视觉识别]            │ │
│ │ 🖼️ 图片顺序[⬍拖拽]      │ │ ← 已有
│ └──────────────────────────┘ │
│ ┌─ 子任务 2 ──────────────┐ │
│ │ ...                       │ │
│ └──────────────────────────┘ │
├──────────────────────────────┤
│ ❓ 未分配图片              ⏷ │
│ [内容...]                     │
├──────────────────────────────┤
│ 🔑 API 设置               ⏷ │
│ [••••••••••••] [保存]      │ │
├──────────────────────────────┤
│ [🔄 刷新页面结构]             │
└──────────────────────────────┘
```

---

## 模块五：文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `manifest.json` | 修改 | 增加 background service worker、storage permission、ARK host_permission |
| `background.js` | **新建** | Service Worker，三种消息处理：ARK 文本/视觉 API 转发 + API Key 管理 |
| `content_script.js` | 修改 | 新增 API Key 管理 UI、LLM 分析逻辑、匹配审核面板、Canvas 绘图工具、UI 灵活布局 |
| `content_style.css` | 修改 | 新增拖拽手柄、模式切换、分析结果卡片、画图工具栏、颜色选择器、折叠区域等样式 |
| `page_uploader.js` | 不改 | 无影响 |

---

## 模块六：实施顺序

| 阶段 | 内容 | 依赖 | 估算 |
|------|------|------|------|
| P1 | 基础设施：manifest 修改 + background.js + API Key 管理 UI + chrome.storage | 无 | 小 |
| P2 | LLM 文本实体提取 + 匹配审核 UI（含跳过） | P1 | 中 |
| P3 | 视觉识别增强：Vision API 调用 + 图片 base64 + 分批处理 + 匹配建议展示 | P2 | 中 |
| P4 | 分层 Canvas 画图工具：三层 Canvas、工具栏、绘制逻辑、撤销栈 | — | 大 |
| P5 | UI 灵活度：可拖拽宽度、三模式切换、折叠区域、状态持久化 | — | 小 |
| P6 | 集成测试与打磨：边缘情况、错误处理、loading 状态、暗黑模式兼容 | P1-P5 | 中 |

---

## 模块七：风险与边界情况

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| ARK API 响应慢 | 中 | 用户体验下降 | loading 动画 + 分批并行 + 60s 超时 + toast 提示 |
| 图片过大 base64 超限制 | 中 | API 调用失败 | 前端 resize 至 2048px + 0.8 质量压缩 |
| 用户未设 API Key | 低 | 功能不可用 | 按钮 disabled + tooltip 提示"请先设置 API Key" |
| Canvas 大图内存溢出 | 低 | 浏览器卡顿 | 4096px 上限 + ImageData 栈限制 30 步 |
| 多子任务同时分析 | 低 | 混乱 | 每次只允许一个分析进行，其他按钮 disabled |
| @图片N 与实际上传顺序不一致 | 中 | 匹配错位 | 确认插入时重新扫描 localNum，确保与实际顺序对齐 |

---

## 附录：现有代码复用对照

| 现有功能 | 位置 | v2.0 复用方式 |
|---------|------|-------------|
| 字符串匹配引擎 `scanAndReplaceForSubtask` | `content_script.js:82-141` | 确认插入阶段直接复用 |
| 子任务 textarea 检测 `findSubtasks` | `content_script.js:13-53` | 分析前获取脚本内容 |
| 图片池管理 `addToPool/removeFromPool/renderPool` | `content_script.js:278-345` | 画图保存后刷新池 |
| 子任务渲染 `renderSubtasks` | `content_script.js:439-575` | 扩展卡片内容，增加分析面板 |
| Toast 通知 `showToast` | `content_script.js:883-890` | 复用 |
| 预览覆盖层 `previewOne` | `content_script.js:840-877` | 参考其覆盖层开发画图覆盖层 |
| 上传机制 `uploadImagesViaPageScript` | `content_script.js:162-196` | 不需修改 |
| postMessage 通信 | `content_script.js + page_uploader.js` | 不需修改 |
| ARK API 调用 | `vision-fallback/scripts/vision_api.py` | 参考其 URL/模型/格式，在 JS 中重实现 |
