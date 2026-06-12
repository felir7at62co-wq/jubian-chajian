# 图片顺序 & 手动上传修复 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Chrome 扩展中同一子任务内图片上传后顺序错乱的问题，并为未匹配图片提供手动指派到子任务的功能。

**Architecture:** 修改 `page_uploader.js` 增加清除+顺序上传流程；修改 `content_script.js` 增加未分配图片管理面板和上传逻辑；修改 `content_style.css` 增加新 UI 样式。

**Tech Stack:** Chrome Extension Manifest V3, vanilla JS, Element UI (目标页面组件)

---

## 文件结构

| 文件 | 职责 | 改动类型 |
|------|------|---------|
| `page_uploader.js` | 注入页面上下文的图片上传引擎，操作 el-upload DOM | 新增清除/顺序上传函数 + 修改消息处理 |
| `content_script.js` | 侧边栏 UI、全局池管理、子任务扫描匹配、上传协调 | 新增未分配图片面板 + 修改上传调用 |
| `content_style.css` | 侧边栏样式定义 | 新增未分配图片区域样式 |

无新增文件。

---

### Task 1: page_uploader.js — 新增清除与顺序上传函数

**Files:**
- Modify: `C:\Users\EDY\Desktop\jubianai-assist\page_uploader.js`

- [ ] **Step 1: 在 `uploadFilesToElUpload` 之后添加 `waitForEmpty` 辅助函数**

```js
function waitForEmpty(el, timeout) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (!el.querySelector('.el-upload-list__item')) return resolve(true);
      if (Date.now() - start > timeout) return resolve(false);
      setTimeout(check, 200);
    };
    check();
  });
}
```

- [ ] **Step 2: 添加 `clearElUpload` 函数**

```js
async function clearElUpload(uploadEl) {
  const list = uploadEl.querySelector('.el-upload-list');
  if (!list) return true;

  const items = list.querySelectorAll('.el-upload-list__item');
  if (!items.length) return true;

  for (const item of items) {
    const deleteBtn = item.querySelector('.el-icon-delete');
    if (!deleteBtn) continue;
    deleteBtn.click();
    await new Promise(r => setTimeout(r, 800));
  }

  await waitForEmpty(list, 5000);
  return true;
}
```

- [ ] **Step 3: 添加 `uploadSingleFileToElUpload` 函数**

```js
async function uploadSingleFileToElUpload(file, uploadEl) {
  const fileInput = uploadEl.querySelector('input[type="file"]');
  if (!fileInput) return false;

  const dt = new DataTransfer();
  dt.items.add(file);
  Object.defineProperty(fileInput, 'files', {
    value: dt.files,
    writable: false,
    configurable: true,
  });
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));

  await new Promise(r => setTimeout(r, 3000));
  return true;
}
```

- [ ] **Step 4: 添加 `uploadFilesSequentially` 函数**

```js
async function uploadFilesSequentially(files, uploadEl) {
  for (let i = 0; i < files.length; i++) {
    const ok = await uploadSingleFileToElUpload(files[i], uploadEl);
    if (!ok) return { success: false, failedAt: i };
  }
  return { success: true, failedAt: -1 };
}
```

---

### Task 2: page_uploader.js — 修改消息处理逻辑

**Files:**
- Modify: `C:\Users\EDY\Desktop\jubianai-assist\page_uploader.js:57-88`

- [ ] **Step 1: 替换原 `window.addEventListener('message', ...)` 逻辑**

将原有消息处理器替换为支持 `sequential` 模式的新版本：

```js
window.addEventListener('message', async function (e) {
  if (!e.data || e.data.type !== '__JB_UPLOAD') return;
  if (e.data.source === 'jb-assist-page') return;

  const { files, subtaskIdx, sequential } = e.data;
  const uploadEl = document.querySelector(`[data-jb-upload-idx="${subtaskIdx}"]`);
  let success = false;
  let error = null;

  try {
    if (!uploadEl) throw new Error(`未找到 [data-jb-upload-idx="${subtaskIdx}"]`);
    const el = uploadEl.classList.contains('el-upload')
      ? uploadEl
      : uploadEl.querySelector('.el-upload') || uploadEl;

    if (sequential) {
      await clearElUpload(el);
      const result = await uploadFilesSequentially(files, el);
      success = result.success;
      if (!result.success) error = `第 ${result.failedAt + 1} 张上传失败`;
    } else {
      success = await uploadFilesToElUpload(files, el);
    }
  } catch (err) {
    error = err.message || String(err);
  }

  window.postMessage({
    type: '__JB_UPLOAD_DONE',
    subtaskIdx,
    success,
    error,
    source: 'jb-assist-page',
  }, '*');
});
```

---

### Task 3: content_script.js — 修改 uploadImagesViaPageScript

**Files:**
- Modify: `C:\Users\EDY\Desktop\jubianai-assist\content_script.js:161-194`

- [ ] **Step 1: 用新版本替换原 `uploadImagesViaPageScript` 函数**

```js
function uploadImagesViaPageScript(files, subtaskIdx, sequential = true) {
  return new Promise((resolve) => {
    window.postMessage({
      type: '__JB_UPLOAD',
      files,
      subtaskIdx,
      sequential,
      source: 'jb-assist-content',
    }, '*');

    const handler = (e) => {
      if (e.data && e.data.type === '__JB_UPLOAD_DONE' &&
          e.data.subtaskIdx === subtaskIdx &&
          e.data.source === 'jb-assist-page') {
        window.removeEventListener('message', handler);
        resolve(e.data.success);
      }
    };
    window.addEventListener('message', handler);
    setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(false);
    }, 60000);
  });
}
```

关键变化：
- 新增 `sequential = true` 参数
- postMessage 中传递 `sequential` 字段
- 超时从 20000 改为 60000（顺序上传多张需要更长时间）

---

### Task 4: content_script.js — 新增未分配图片状态与更新逻辑

**Files:**
- Modify: `C:\Users\EDY\Desktop\jubianai-assist\content_script.js`

- [ ] **Step 1: 在全局状态区域（第 6-7 行附近）添加 `unassignedImages` 变量**

```js
let globalPool = []; // [{file: File, name: "小明"}]
let unassignedImages = []; // [{name, file}] — 全局池中未被任何子任务匹配的图片
```

- [ ] **Step 2: 在 `scanAllSubtasks` 函数末尾（`renderSubtasks()` 调用之前或之后）添加 `updateUnassignedImages()` 调用**

找到 `scanAllSubtasks` 中的 `renderSubtasks()` 调用行（约第 431 行），在其后添加：

```js
    renderSubtasks();
    updateUnassignedImages();
```

- [ ] **Step 3: 在 `removeFromPool` 和 `moveInPool` 函数中也添加 `updateUnassignedImages()` 调用**

在 `removeFromPool` 的 `scanAllSubtasks()` 之后：
```js
    scanAllSubtasks();
    updateUnassignedImages();
```

在 `moveInPool` 的 `scanAllSubtasks()` 之后：
```js
    scanAllSubtasks();
    updateUnassignedImages();
```

- [ ] **Step 4: 在 `renderSubtasks` 函数附近添加 `updateUnassignedImages` 和 `renderUnassignedImages` 函数**

```js
function updateUnassignedImages() {
  const allMatchedNames = new Set();
  for (const sd of subtaskData) {
    for (const m of sd.matchedImages) {
      allMatchedNames.add(m.name);
    }
  }
  unassignedImages = globalPool.filter(p => !allMatchedNames.has(p.name));
  renderUnassignedImages();
}

function renderUnassignedImages() {
  let container = document.getElementById('jb-unassigned-section');
  if (!container) {
    // 首次渲染 — 在 #jb-subtask-section 之后插入
    const ref = document.getElementById('jb-subtask-section');
    container = document.createElement('div');
    container.id = 'jb-unassigned-section';
    ref.parentNode.insertBefore(container, ref.nextSibling);
  }

  if (!unassignedImages.length) {
    container.innerHTML = '';
    return;
  }

  const subtaskOptions = subtaskData
    .map((sd, i) => `<option value="${i}">${sd.label}</option>`)
    .join('');

  container.innerHTML = `
    <div class="jb-section-title">❓ 未分配图片</div>
    <div class="jb-hint-text">这些图片未被任何子任务匹配。选择目标子任务后上传</div>
    <div id="jb-unassigned-list">
      ${unassignedImages.map(p => `
        <label class="jb-unassigned-item">
          <input type="checkbox" data-name="${escHtml(p.name)}">
          <span class="jb-filename">${escHtml(p.name)}</span>
        </label>
      `).join('')}
    </div>
    <select id="jb-unassigned-target" class="jb-unassigned-select">
      ${subtaskOptions}
    </select>
    <button id="jb-upload-unassigned-btn" class="jb-btn jb-btn-primary">上传选中图片到子任务</button>
  `;

  document.getElementById('jb-upload-unassigned-btn').addEventListener('click', async () => {
    const checked = container.querySelectorAll('#jb-unassigned-list input[type="checkbox"]:checked');
    const selectedNames = Array.from(checked).map(cb => cb.dataset.name);
    if (!selectedNames.length) {
      showToast('请先勾选要上传的图片');
      return;
    }
    const targetIdx = parseInt(document.getElementById('jb-unassigned-target').value, 10);
    await uploadUnassignedToSubtask(selectedNames, targetIdx);
  });
}
```

---

### Task 5: content_script.js — 新增 uploadUnassignedToSubtask 函数

**Files:**
- Modify: `C:\Users\EDY\Desktop\jubianai-assist\content_script.js`

- [ ] **Step 1: 在 `renderUnassignedImages` 附近添加 `uploadUnassignedToSubtask` 函数**

```js
async function uploadUnassignedToSubtask(selectedNames, subtaskIdx) {
  const sd = subtaskData[subtaskIdx];
  if (!sd) {
    showToast('无效的子任务');
    return;
  }

  const filesToUpload = selectedNames
    .map(name => globalPool.find(p => p.name === name))
    .filter(Boolean)
    .map(p => p.file);

  if (!filesToUpload.length) {
    showToast('未找到对应的图片文件');
    return;
  }

  showToast(`📤 正在上传 ${filesToUpload.length} 张图片到 ${sd.label}...`);

  // 上传到子任务（使用 sequential 模式，会清除已有图片后按序上传）
  const ok = await uploadImagesViaPageScript(filesToUpload, subtaskIdx);
  if (!ok) {
    showToast(`⚠️ ${sd.label} 图片上传可能未成功，请检查`);
    return;
  }

  // 更新 matchedImages（新图片追加到末尾，但不清除已有匹配）
  for (const name of selectedNames) {
    const poolItem = globalPool.find(p => p.name === name);
    if (poolItem && !sd.matchedImages.some(m => m.name === name)) {
      sd.matchedImages.push({ name: poolItem.name, file: poolItem.file });
    }
  }

  // 重新扫描以为新图片生成 @图片N 标记
  const { matches, text } = scanAndReplaceForSubtask(sd.ta.value, sd.matchedImages);
  sd.matches = matches;
  sd.processedText = text;

  // 写回文本框
  sd.ta.value = sd.processedText;
  sd.ta.dispatchEvent(new Event('input', { bubbles: true }));
  sd.ta.dispatchEvent(new Event('change', { bubbles: true }));

  showToast(`✅ ${sd.label}：已上传 ${filesToUpload.length} 张图片并更新 @图片N 引用`);
  updateUnassignedImages();
  renderSubtasks();
}
```

---

### Task 6: content_style.css — 新增未分配图片区域样式

**Files:**
- Modify: `C:\Users\EDY\Desktop\jubianai-assist\content_style.css`

- [ ] **Step 1: 在文件末尾添加未分配图片相关的样式**

```css
/* 未分配图片区域 */
#jb-unassigned-section {
  margin-top: 8px;
}
#jb-unassigned-list {
  max-height: 180px;
  overflow-y: auto;
  margin: 6px 0;
  padding: 4px 6px;
  background: #fafafa;
  border: 1px solid #eee;
  border-radius: 6px;
}
.jb-unassigned-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px;
  font-size: 13px;
  cursor: pointer;
  border-radius: 4px;
}
.jb-unassigned-item:hover {
  background: #e3f2fd;
}
.jb-unassigned-item input[type="checkbox"] {
  margin: 0;
}
.jb-unassigned-select {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #ddd;
  border-radius: 5px;
  font-size: 13px;
  background: #fff;
  margin-bottom: 4px;
}
```

---

### Task 7: 自检验证

**Files:** 无文件修改

- [ ] **Step 1: Spec 覆盖检查**

| Spec 要求 | 对应 Task |
|-----------|----------|
| clearElUpload 清除已有图片 | Task 1 Step 2 |
| waitForEmpty DOM 等待 | Task 1 Step 1 |
| uploadSingleFileToElUpload 单文件上传 | Task 1 Step 3 |
| uploadFilesSequentially 顺序串联 | Task 1 Step 4 |
| 消息处理器支持 sequential 模式 | Task 2 Step 1 |
| uploadImagesViaPageScript 改参数+超时 | Task 3 Step 1 |
| unassignedImages 状态变量 | Task 4 Step 1 |
| updateUnassignedImages 更新逻辑 | Task 4 Step 4 |
| scanAllSubtasks 中触发更新 | Task 4 Step 2 |
| removeFromPool / moveInPool 触发更新 | Task 4 Step 3 |
| renderUnassignedImages UI | Task 4 Step 4 |
| uploadUnassignedToSubtask 逻辑 | Task 5 Step 1 |
| 未分配图片样式 | Task 6 Step 1 |

- [ ] **Step 2: 类型/名称一致性检查**

检查所有函数名在 Task 间引用一致：
- `clearElUpload` — Task 1 定义，Task 2 调用
- `waitForEmpty` — Task 1 定义，Task 1 内部调用
- `uploadSingleFileToElUpload` — Task 1 定义，Task 1 内部调用
- `uploadFilesSequentially` — Task 1 定义，Task 2 调用
- `updateUnassignedImages` — Task 4 定义，Task 4/5 调用
- `renderUnassignedImages` — Task 4 定义，Task 4 内部调用
- `uploadUnassignedToSubtask` — Task 5 定义，Task 4/5 调用

全部一致。✅

- [ ] **Step 3: 无占位符检查**

检查计划中没有 TBD、TODO、"implement later" 等占位符。✅
