// jubianai 图片上传器 — 注入到页面上下文运行
// 直接操作 el-upload 的文件输入元素
(function () {
  'use strict';

  /** 上传文件到 el-upload 组件 */
  async function uploadFilesToElUpload(files, uploadEl) {
    if (!files.length) return true;

    // 找到 el-upload 内部的隐藏文件输入
    const fileInput = uploadEl.querySelector('input[type="file"]');
    if (!fileInput) {
      console.warn('jb-upload: no file input found in el-upload');
      return false;
    }

    // 创建 DataTransfer 并添加文件
    const dt = new DataTransfer();
    for (const file of files) {
      if (!file) continue;
      dt.items.add(file);
    }
    if (!dt.files.length) return false;

    // 用 Object.defineProperty 绕过只读限制设置 files
    try {
      Object.defineProperty(fileInput, 'files', {
        value: dt.files,
        writable: false,
        configurable: true,
      });
    } catch (e) {
      // 如果 defineProperty 失败，尝试另一种方式
      try {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'files'
        )?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(fileInput, dt.files);
        }
      } catch (e2) {
        console.warn('jb-upload: cannot set files property:', e2.message);
        return false;
      }
    }

    // 触发 change 事件，让 el-upload 处理这些文件
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    // 等待上传出现 → 等待上传完成（动态等待，最长 15 秒）
    await waitForUploadItem(el, 8000);
    await waitForEmpty(el, 15000);
    return true;
  }

  /** 轮询直到上传列表为空（最多等待 timeout 毫秒） */
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

  /** 轮询直到上传列表出现条目（上传已触发，最多等待 timeout 毫秒） */
  function waitForUploadItem(el, timeout) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (el.querySelector('.el-upload-list__item')) return resolve(true);
        if (Date.now() - start > timeout) return resolve(false);
        setTimeout(check, 200);
      };
      check();
    });
  }

  /** 清除 el-upload 组件中已上传的文件 */
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

    return await waitForEmpty(list, 5000);
  }

  /** 上传单个文件到 el-upload 组件 */
  async function uploadSingleFileToElUpload(file, uploadEl) {
    if (!file) return false;

    const fileInput = uploadEl.querySelector('input[type="file"]');
    if (!fileInput) return false;

    const dt = new DataTransfer();
    dt.items.add(file);
    if (!dt.files.length) return false;

    try {
      Object.defineProperty(fileInput, 'files', {
        value: dt.files,
        writable: false,
        configurable: true,
      });
    } catch (e) {
      try {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'files'
        )?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(fileInput, dt.files);
        }
      } catch (e2) {
        console.warn('jb-upload: cannot set files property:', e2.message);
        return false;
      }
    }

    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    // 等待上传出现 → 等待上传完成（动态等待）
    await waitForUploadItem(el, 5000);
    await waitForEmpty(el, 10000);
    return true;
  }

  /** 按顺序逐一上传文件 */
  async function uploadFilesSequentially(files, uploadEl) {
    for (let i = 0; i < files.length; i++) {
      const ok = await uploadSingleFileToElUpload(files[i], uploadEl);
      if (!ok) return { success: false, failedAt: i };
    }
    return { success: true, failedAt: -1 };
  }

  // ============ 接收来自 content script 的消息 ============

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
      console.warn('jb-assist page_uploader:', error);
    }

    window.postMessage(
      {
        type: '__JB_UPLOAD_DONE',
        subtaskIdx,
        success,
        error,
        source: 'jb-assist-page',
      },
      '*'
    );
  });
})();
