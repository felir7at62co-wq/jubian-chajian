# jubianai 图片匹配助手 — 图片顺序 & 手动上传修复设计

## 问题概述

### 问题 1：上传后图片顺序错乱
插件侧边栏中图片顺序正确，但上传到 web 页面后，子任务内多张图片的顺序乱序（如 1→2→3 变成 3→1→2）。

**根因：** `page_uploader.js` 通过 `DataTransfer` 一次性将多个文件注入 el-upload 的 `<input>` 并触发 `change`。Element UI 的 el-upload 组件收到后并发发起上传请求。服务端处理完成顺序不确定，而 el-upload 按完成顺序展示图片，导致 UI 顺序与插件中的 `matchedImages` 顺序不一致。

### 问题 2：手动上传后图片关联不正确
插件 uploadImagesViaPageScript 上传完成后，用户发现缺少某角色，通过网页 UI 手动补传图片，但新上传的图片显示为插件已匹配的图片，而非独立新增的图片。

**根因：** `page_uploader.js` 使用 `Object.defineProperty` 设置 `<input>.files` 绕过了 Vue 的响应式系统，el-upload 的 `fileList` 内部状态进入不一致状态。之后用户通过网页 UI 手动上传时，el-upload 的响应式数据已乱，新文件无法正确注册。

---

## 方案：删除重排 + 顺序上传 + 未分配图片面板

### 整体流程

```mermaid
flowchart TD
    A[用户拖入图片到全局池] --> B[scanAllSubtasks]
    B --> C[显示子任务+匹配结果]
    C --> D[用户点击"上传图片 + 应用"]
    D --> E[清除该子任务已有图片]
    E --> F[按 matchedImages 顺序逐张上传]
    F --> G[写 @图片N 到文本框]
    G --> H[刷新侧边栏状态]

    C --> I[检查未匹配图片]
    I --> J[显示"未分配图片"面板]
    J --> K[用户选子任务+图片]
    K --> L[插件代为上传+写入 @图片N]
```

---

## 详细设计

### 一、page_uploader.js 修改

#### 1.1 新增：`clearElUpload(uploadEl)`

遍历 el-upload-list 中的删除按钮，逐个点击删除现有图片。

```js
async function clearElUpload(uploadEl) {
  const list = uploadEl.querySelector('.el-upload-list');
  if (!list) return true; // 没有已上传图片，视为成功

  const items = list.querySelectorAll('.el-upload-list__item');
  if (!items.length) return true;

  for (const item of items) {
    const deleteBtn = item.querySelector('.el-icon-delete');
    if (!deleteBtn) continue;
    deleteBtn.click();
    // 等待删除完成
    await new Promise(r => setTimeout(r, 800));
  }

  // 确认 DOM 中已清空
  await waitForEmpty(list, 5000);
  return true;
}

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

#### 1.2 新增：`uploadSingleFileToElUpload(file, uploadEl)`

每次只处理一个文件，完成后才返回。

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

  // 等待 3 秒让 el-upload 处理完成
  await new Promise(r => setTimeout(r, 3000));
  return true;
}
```

#### 1.3 新增：`uploadFilesSequentially(files, uploadEl)`

串联调用单文件上传，每张完成后才传下一张。

```js
async function uploadFilesSequentially(files, uploadEl) {
  for (let i = 0; i < files.length; i++) {
    const ok = await uploadSingleFileToElUpload(files[i], uploadEl);
    if (!ok) return { success: false, failedAt: i };
  }
  return { success: true, failedAt: -1 };
}
```

#### 1.4 修改：消息处理逻辑

原 `__JB_UPLOAD` 消息处理改为三步流程：清除 → 顺序上传 → 响应。

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
      // 新流程：清除已有图片，然后按序上传
      await clearElUpload(el);
      const result = await uploadFilesSequentially(files, el);
      success = result.success;
      if (!result.success) error = `第 ${result.failedAt + 1} 张上传失败`;
    } else {
      // 兼容旧流程（暂留）
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

### 二、content_script.js 修改

#### 2.1 修改 `uploadImagesViaPageScript`

增加 `sequential: true` 参数，指示 page_uploader 使用新流程。

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
    }, 60000); // 超时延长到 60 秒（多张图片顺序上传需要更长时间）
  });
}
```

#### 2.2 新增：未分配图片管理

**新增状态：**

```js
// 全局池中未被任何子任务匹配到的图片
let unassignedImages = []; // [{name, file}]
```

**扫描后更新未分配图片：**

每次 `scanAllSubtasks()` 后，计算全局池中有哪些图片未被任何子任务匹配。

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
```

**侧边栏新增渲染：**

在 "子任务列表" 下方插入 "未分配图片" 区域：

```js
function renderUnassignedImages() {
  // 找到或创建"未分配图片"容器
  // 显示未分配图片列表 + 子任务选择下拉框 + [上传] 按钮
  // 用户选择一个或多个未分配图片→选择目标子任务→点击上传
}
```

具体渲染内容：

```
<div class="jb-section-title">❓ 未分配图片</div>
<div class="jb-hint-text">这些图片未被任何子任务匹配。选择目标子任务后上传</div>
<div id="jb-unassigned-list">
  <!-- 每一张未分配图片 -->
  <label class="jb-unassigned-item">
    <input type="checkbox" data-name="小刚">
    <span class="jb-filename">小刚.png</span>
  </label>
  <label class="jb-unassigned-item">
    <input type="checkbox" data-name="小华">
    <span class="jb-filename">小华.png</span>
  </label>
</div>
<select id="jb-unassigned-target">
  <option value="0">子任务 1</option>
  <option value="1">子任务 2</option>
</select>
<button id="jb-upload-unassigned-btn" class="jb-btn jb-btn-primary">上传选中图片到子任务</button>
```

**上传未分配图片逻辑：**

```js
async function uploadUnassignedToSubtask(selectedNames, subtaskIdx) {
  const sd = subtaskData[subtaskIdx];
  if (!sd) return;

  // 找到对应的 File 对象
  const filesToUpload = selectedNames
    .map(name => globalPool.find(p => p.name === name))
    .filter(Boolean)
    .map(p => p.file);

  if (!filesToUpload.length) return;

  // 上传到子任务
  await uploadImagesViaPageScript(filesToUpload, subtaskIdx);

  // 更新 matchedImages (新图片追加到末尾)
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

  updateUnassignedImages();
  renderSubtasks();
}
```

#### 2.3 @图片N 编号保证

当前 `localNum = matchedImages 数组下标 + 1`。由于顺序上传保证第 N 张上传的图片对应 matchedImages[N-1]，所以 `@图片N` 与 el-upload 中第 N 张图片一致。删除重传后此保证仍然成立。

---

### 三、超时与错误处理

| 场景 | 处理方式 |
|------|---------|
| 删除图片超时 | 显示警告，继续尝试上传 |
| 某张图片上传失败 | 停止该子任务后续上传，toast 提示"第 X 张上传失败" |
| 整体超时（60s） | resolve(false)，toast 提示超时 |
| 全部成功 | toast 提示"X 张图片上传完成" |

---

### 四、影响范围

| 文件 | 改动类型 |
|------|---------|
| `page_uploader.js` | 新增 `clearElUpload`、`uploadSingleFileToElUpload`、`uploadFilesSequentially`；修改消息处理器 |
| `content_script.js` | 修改 `uploadImagesViaPageScript` 支持 sequential 模式；新增未分配图片全部功能 |
| `content_style.css` | 新增未分配图片区域的样式 |

无新增文件。无后台修改。不依赖服务端变更。

---

### 五、升级兼容

- 保留原 `uploadFilesToElUpload` 函数，添加 `sequential` 开关。
- 旧消息格式（无 sequential 参数）仍然走旧流程，不破坏现有功能。
