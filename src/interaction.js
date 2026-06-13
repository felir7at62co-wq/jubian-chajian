// src/interaction.js — 交互区：文档上传 + LLM 对话

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
    const sel = document.getElementById('jb-model-selector');
    if (sel) {
      sel.innerHTML = globalState.models.map((m, i) => `<option value="${i}" ${i === 0 ? 'selected' : ''}>${m.name}</option>`).join('');
    }
  });
  renderInteractionPanel();
  setupHistoryNav();
  // 恢复聊天历史
  chrome.storage.local.get('chatHistory', (res) => {
    if (res.chatHistory && res.chatHistory.length) {
      globalState._chatMessages = res.chatHistory;
      const output = document.getElementById('jb-interaction-output');
      if (!output) return;
      output.innerHTML = '';
      for (const msg of globalState._chatMessages) {
        appendMessage(msg.role, msg.content, true);
      }
    }
  });
}

function renderInteractionPanel() {
  var body = document.getElementById('jb-center-body');
  if (!body) return;

  // 确保至少有一个模型可用
  if (!globalState.models || globalState.models.length === 0) {
    globalState.models = [
      { name: 'ARK 内置', url: 'https://ark.cn-beijing.volces.com/api/coding/v1/chat/completions', key: '', model: 'doubao-seed-2-0-code-preview-260215', builtin: true }
    ];
    console.warn('jb: globalState.models was empty, restored default');
  }

  const modelOptions = globalState.models.map((m, i) =>
    `<option value="${i}" ${i === 0 ? 'selected' : ''}>${m.name}</option>`
  ).join('');

  const html = `
    <div style="display:flex;gap:4px;flex-wrap:wrap;flex-shrink:0;">
      <button class="jb-btn jb-btn-primary" id="jb-upload-doc" style="flex:1;padding:6px;font-size:11px;">📄 上传剧本</button>
      <select id="jb-model-selector" style="flex:1;padding:6px;background:#2A2A2A;color:#fff;border:1px solid #FF0055;font-size:11px;">
        ${modelOptions}
      </select>
      <button class="jb-btn" id="jb-settings-btn" style="padding:6px;font-size:11px;">⚙️</button>
    </div>
    <input type="file" id="jb-doc-file-input" accept=".txt,.png,.jpg,.jpeg,.gif,.webp" multiple style="display:none">
    <div id="jb-interaction-output" style="flex:1;background:#0D0D0D;border:1px solid #333;padding:8px;margin:6px 0;overflow-y:auto;font-size:15px;font-weight:400;line-height:1.8;white-space:pre-wrap;color:#e0e0e0;font-family:'Microsoft YaHei UI','Microsoft YaHei','PingFang SC','Noto Sans SC',sans-serif;min-height:60px;">
      <div class="jb-empty">选择 Skill → 输入剧本 → 点击执行</div>
    </div>
    <div style="display:flex;gap:4px;flex-shrink:0;align-items:flex-end;">
      <div id="jb-input-area" style="flex:1;display:flex;flex-direction:column;gap:4px;position:relative;">
        <div id="jb-input-preview" style="display:none;gap:4px;padding:4px;background:#0D0D0D;border:1px solid #333;border-radius:4px;flex-wrap:wrap;"></div>
        <textarea id="jb-input-text" placeholder="输入消息...（拖入图片 / Ctrl+V 粘贴）" style="width:100%;min-height:44px;height:60px;max-height:200px;background:#0D0D0D;color:#fff;border:1px solid #333;padding:8px;font-size:15px;font-weight:400;font-family:'Microsoft YaHei UI','Microsoft YaHei','PingFang SC','Noto Sans SC',sans-serif;resize:vertical;box-sizing:border-box;line-height:1.6;"></textarea>
      </div>
      <button class="jb-btn jb-btn-success" id="jb-execute-btn" style="padding:6px 12px;font-size:12px;white-space:nowrap;">▶ 执行</button>
    </div>
    <div style="display:flex;justify-content:space-between;flex-shrink:0;margin-top:4px;font-size:10px;color:#555;">
      <span>历史: <span id="jb-history-pos">0/0</span></span>
      <div>
        <button id="jb-copy-btn" style="background:none;border:none;color:#555;cursor:pointer;font-size:10px;">📋 复制</button>
        <button id="jb-save-txt-btn" style="background:none;border:none;color:#555;cursor:pointer;font-size:10px;">💾 保存</button>
        <button id="jb-clear-output-btn" style="background:none;border:none;color:#555;cursor:pointer;font-size:10px;">清空</button>
      </div>
    </div>`;
  body.innerHTML = html;
  bindInteractionEvents();
  // 恢复已存在的聊天记录
  const msgs = globalState._chatMessages || [];
  if (msgs.length) {
    const output = document.getElementById('jb-interaction-output');
    if (output) {
      output.innerHTML = '';
      for (const msg of msgs) appendMessage(msg.role, msg.content, true);
    }
  }
}

function bindInteractionEvents() {
  document.getElementById('jb-upload-doc')?.addEventListener('click', () => {
    document.getElementById('jb-doc-file-input').click();
  });
  document.getElementById('jb-doc-file-input')?.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    e.target.value = '';
    let textLoaded = false;
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        handleImageInput(file);
      } else if (!textLoaded) {
        textLoaded = true;
        const reader = new FileReader();
        reader.onload = (ev) => {
          document.getElementById('jb-input-text').value = ev.target.result;
          showToast('✅ 已加载: ' + file.name);
        };
        reader.readAsText(file);
      }
    }
  });
  // 拖入图片到输入区（桌面拖拽 / 资产池拖拽 均走 files）
  const inputArea = document.getElementById('jb-input-area');
  if (inputArea) {
    inputArea.addEventListener('dragover', (e) => { e.preventDefault(); inputArea.style.outline = '2px dashed #FF0055'; });
    inputArea.addEventListener('dragleave', () => { inputArea.style.outline = 'none'; });
    inputArea.addEventListener('drop', (e) => {
      e.preventDefault();
      inputArea.style.outline = 'none';
      const files = [];
      // 从 dataTransfer.files 收集（桌面拖拽）
      for (var i = 0; i < e.dataTransfer.files.length; i++) {
        var f = e.dataTransfer.files[i];
        if (f) files.push(f);
      }
      // 从 dataTransfer.items 收集（资产池/程序拖拽，补充 files 中没有的）
      for (var j = 0; j < e.dataTransfer.items.length; j++) {
        var item = e.dataTransfer.items[j];
        if (item.kind === 'file') {
          var fi = item.getAsFile();
          if (fi && !files.some(function(x) { return x.name === fi.name && x.size === fi.size; })) {
            files.push(fi);
          }
        }
      }
      // 过滤出图片文件
      var imageFiles = files.filter(function(f) { return f.type && f.type.startsWith('image/'); });
      // 兜底：从 text/uri-list（blob URL）
      if (!imageFiles.length) {
        var blobUrl = e.dataTransfer.getData('text/uri-list');
        if (blobUrl && blobUrl.startsWith('blob:')) {
          fetch(blobUrl).then(function(r) { return r.blob(); }).then(function(b) { handleImageInput(b); });
          return;
        }
      }
      for (var k = 0; k < imageFiles.length; k++) handleImageInput(imageFiles[k]);
      if (imageFiles.length > 1) showToast('🖼️ 已添加 ' + imageFiles.length + ' 张图片');
    });
  }

  // Ctrl+V 粘贴图片
  document.getElementById('jb-input-text')?.addEventListener('paste', (e) => {
    const items = e.clipboardData.items;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) handleImageInput(file);
        e.preventDefault();
        break;
      }
    }
  });

  document.getElementById('jb-execute-btn')?.addEventListener('click', executeSkill);
  document.getElementById('jb-input-text')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      executeSkill();
    }
  });
  document.getElementById('jb-copy-btn')?.addEventListener('click', () => {
    const msgs = globalState._chatMessages || [];
    // 找最后一条 AI 回复
    let lastAi = '';
    for (var i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'ai' && !msgs[i].content.startsWith('⏳')) {
        lastAi = msgs[i].content;
        break;
      }
    }
    if (!lastAi) { showToast('⚠️ 没有可复制的 AI 回复'); return; }
    navigator.clipboard.writeText(lastAi)
      .then(() => showToast('✅ 已复制 AI 回复'))
      .catch(() => showToast('❌ 复制失败'));
  });
  document.getElementById('jb-save-txt-btn')?.addEventListener('click', saveOutputAsSkillFile);
  document.getElementById('jb-settings-btn')?.addEventListener('click', showSettingsDialog);
  document.getElementById('jb-clear-output-btn')?.addEventListener('click', () => {
    document.getElementById('jb-interaction-output').innerHTML = '<div class="jb-empty">暂无对话</div>';
    globalState._chatMessages = [];
    chrome.storage.local.remove('chatHistory');
  });
}

function saveChatHistory() {
  const msgs = (globalState._chatMessages || []).slice(-100);
  chrome.storage.local.set({ chatHistory: msgs });
}

function appendMessage(role, content, skipSave) {
  const output = document.getElementById('jb-interaction-output');
  if (!output) return;
  if (!globalState._chatMessages) globalState._chatMessages = [];
  if (!skipSave) {
    globalState._chatMessages.push({ role, content });
    saveChatHistory();
  }

  const empty = output.querySelector('.jb-empty');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.style.cssText = 'padding:8px 12px;margin-bottom:6px;border-radius:6px;font-size:15px;font-weight:400;line-height:1.8;white-space:pre-wrap;word-break:break-word;font-family:"Microsoft YaHei UI","Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif;color:#e0e0e0;';

  if (role === 'user') {
    div.style.background = 'rgba(0,255,102,0.08)';
    div.style.border = '1px solid rgba(0,255,102,0.2)';
    div.style.color = '#e0e0e0';
    div.innerHTML = '<div style="font-size:11px;color:#00FF66;margin-bottom:3px;">🧑 你</div><div>' + escHtml(content) + '</div>';
  } else if (role === 'error') {
    div.style.background = 'rgba(255,0,85,0.1)';
    div.style.border = '1px solid rgba(255,0,85,0.25)';
    div.style.color = '#ff7777';
    div.style.fontSize = '12px';
    div.innerHTML = '<div style="font-size:11px;color:#FF0055;margin-bottom:3px;">❌ 错误</div><div>' + escHtml(content) + '</div>';
  } else {
    div.style.background = 'rgba(0,229,255,0.06)';
    div.style.border = '1px solid rgba(0,229,255,0.15)';
    div.style.color = '#ddd';
    if (content.startsWith('⏳')) {
      div.className = 'jb-thinking';
    }
    div.innerHTML = '<div style="font-size:11px;color:#00E5FF;margin-bottom:3px;">🤖 AI</div><div>' + escHtml(content) + '</div>';
  }
  output.appendChild(div);
  output.scrollTop = output.scrollHeight;
}

function replaceLastMessage(role, content) {
  const output = document.getElementById('jb-interaction-output');
  if (!output || !output.lastChild) return;
  const last = output.lastChild;
  if (role === 'error') {
    last.innerHTML = '<div style="font-size:11px;color:#FF0055;margin-bottom:3px;">❌ 错误</div><div>' + escHtml(content) + '</div>';
    last.style.border = '1px solid rgba(255,0,85,0.25)';
    last.className = '';
  } else {
    last.className = '';
    last.innerHTML = '<div style="font-size:11px;color:#00E5FF;margin-bottom:3px;">🤖 AI</div><div>' + escHtml(content) + '</div>';
  }
  output.scrollTop = output.scrollHeight;
}

const MAX_IMAGES = 9;

function handleImageInput(file) {
  if (!globalState._pendingImages) globalState._pendingImages = [];
  if (globalState._pendingImages.length >= MAX_IMAGES) {
    showToast('⚠️ 最多支持 ' + MAX_IMAGES + ' 张图片');
    return;
  }
  // 大图自动压缩（超过 3MB 缩小到最长边 2048px）
  const MAX_BYTES = 3 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = function() {
        let w = img.naturalWidth, h = img.naturalHeight;
        const maxDim = 2048;
        if (w > maxDim || h > maxDim) {
          const scale = maxDim / Math.max(w, h);
          w = Math.round(w * scale); h = Math.round(h * scale);
        }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataURL = c.toDataURL('image/jpeg', 0.85);
        addPendingImage(dataURL);
        showToast('🖼️ 原图 ' + (file.size / 1024 / 1024).toFixed(1) + 'MB，已压缩');
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  } else {
    const reader = new FileReader();
    reader.onload = (ev) => addPendingImage(ev.target.result);
    reader.readAsDataURL(file);
  }
}

function addPendingImage(dataURL) {
  if (!globalState._pendingImages) globalState._pendingImages = [];
  if (globalState._pendingImages.length >= MAX_IMAGES) {
    showToast('⚠️ 最多支持 ' + MAX_IMAGES + ' 张图片');
    return;
  }
  globalState._pendingImages.push(dataURL);
  showToast('📸 ' + globalState._pendingImages.length + '/' + MAX_IMAGES);
  renderPreview();
}

function renderPreview() {
  const preview = document.getElementById('jb-input-preview');
  if (!preview) return;
  var images = globalState._pendingImages || [];
  if (!images.length) {
    preview.style.display = 'none';
    preview.innerHTML = '';
    return;
  }
  preview.style.display = 'flex';
  preview.innerHTML = images.map(function(d, i) {
    return '<div data-idx="' + i + '" style="position:relative;display:inline-block;">' +
      '<img src="' + d + '" style="height:60px;border-radius:4px;">' +
      '<span class="jb-prv-rm" style="position:absolute;top:-6px;right:-6px;background:#FF0055;color:#fff;border-radius:50%;width:16px;height:16px;font-size:11px;text-align:center;line-height:16px;cursor:pointer;">✕</span>' +
    '</div>';
  }).join('') +
  '<span style="font-size:10px;color:#888;align-self:flex-end;padding:2px;">' + images.length + '/' + MAX_IMAGES + '</span>';

  Array.from(preview.querySelectorAll('.jb-prv-rm')).forEach(function(btn) {
    btn.onclick = function() {
      var wrapper = this.parentElement;
      var idx = parseInt(wrapper.dataset.idx);
      if (globalState._pendingImages) {
        globalState._pendingImages.splice(idx, 1);
      }
      renderPreview();
    };
  });
}

async function executeSkill() {
  const input = document.getElementById('jb-input-text').value.trim();
  const pendingImages = globalState._pendingImages || [];
  if (!input && !pendingImages.length) { showToast('⚠️ 请输入内容或上传图片'); return; }

  const modelIdx = parseInt(document.getElementById('jb-model-selector')?.value || '0');
  const modelCfg = globalState.models[modelIdx];
  if (!modelCfg) { showToast('⚠️ 未找到模型配置'); return; }

  const skill = getCurrentSkill();
  // 如果 skill 内容未加载（运行时从文件读取），等加载完成
  if (skill && skill.dir && !skill.system_prompt) {
    showToast('⏳ 正在加载 Skill...');
    try {
      await loadSkillContent(skill);
    } catch (e) {
      showToast('⚠️ Skill 加载失败，使用默认提示词');
    }
  }
  const systemPrompt = (skill && skill.system_prompt) ? skill.system_prompt : '你是一个有帮助的AI助手。请简洁准确地回答用户问题。';

  // 显示用户消息（含预览中的图片）
  const imgLabel = pendingImages.length ? '[图片 x' + pendingImages.length + ']' : '';
  appendMessage('user', input || imgLabel);
  if (pendingImages.length) {
    const output = document.getElementById('jb-interaction-output');
    if (output) {
      for (const dataURL of pendingImages) {
        const img = document.createElement('img');
        img.src = dataURL;
        img.style.cssText = 'max-width:200px;max-height:200px;border-radius:4px;margin:4px 0;display:block;';
        output.appendChild(img);
      }
      output.scrollTop = output.scrollHeight;
    }
  }
  // 清空输入和图片预览
  document.getElementById('jb-input-text').value = '';
  const preview = document.getElementById('jb-input-preview');
  if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
  appendMessage('ai', '⏳ 思考中...');

  const apiKey = modelCfg.builtin ? await getApiKeyFromStorage() : modelCfg.key;
  if (!apiKey) {
    replaceLastMessage('error', '请先配置 API Key');
    globalState._pendingImages = []; // API Key 失败时也要清空
    return;
  }

  // 构建上下文（排除"思考中"）
  let historyMsgs = (globalState._chatMessages || [])
    .filter(m => !(m.role === 'ai' && m.content.startsWith('⏳')))
    .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));

  callLLM(systemPrompt, historyMsgs, input, modelCfg, apiKey);
}

var _currentRequestId = null;

function abortCurrentRequest() {
  if (!_currentRequestId) return;
  chrome.runtime.sendMessage({ type: 'ABORT_ARK', requestId: _currentRequestId });
  _currentRequestId = null;
  replaceLastMessage('error', '⛔ 已中止');
  var btn = document.getElementById('jb-execute-btn');
  if (btn) { btn.textContent = '▶ 执行'; btn.className = 'jb-btn jb-btn-success'; btn.onclick = executeSkill; }
}

function callLLM(systemPrompt, historyMsgs, input, modelCfg, apiKey) {
  // 如果有待发送的图片，把最后一条 user 消息改为多模态格式
  let lastUserMsg = { role: 'user', content: input };
  const pendingImages = globalState._pendingImages || [];
  if (pendingImages.length) {
    const contentArray = [{ type: 'text', text: input || '看图说话' }];
    for (const imgData of pendingImages) {
      contentArray.push({ type: 'image_url', image_url: { url: imgData } });
    }
    lastUserMsg = { role: 'user', content: contentArray };
  }
  // 清空图片缓存
  globalState._pendingImages = [];

  // 设置中止状态
  var reqId = 'ark-' + Date.now() + '-' + Math.random();
  _currentRequestId = reqId;
  var btn = document.getElementById('jb-execute-btn');
  if (btn) { btn.textContent = '■ 中止'; btn.className = 'jb-btn jb-btn-danger'; btn.onclick = abortCurrentRequest; }

  chrome.runtime.sendMessage({
    type: 'CALL_ARK', apiKey, url: modelCfg.url, requestId: reqId,
    messages: [
      { role: 'system', content: systemPrompt },
      ...historyMsgs,
      lastUserMsg
    ],
    model: modelCfg.model || 'doubao-seed-2-0-code-preview-260215',
    maxTokens: 8192, temperature: 0.3, _noCache: false
  }, (res) => {
    _currentRequestId = null;
    if (btn) { btn.textContent = '▶ 执行'; btn.className = 'jb-btn jb-btn-success'; btn.onclick = executeSkill; }
    // 用户已点击中止，不覆盖已有提示
    if (res && res.error === '用户中止') return;
    if (!res || !res.ok) {
      const errMsg = (res?.error || '').toLowerCase();
      if ((errMsg.includes('context_length') || errMsg.includes('too many') || errMsg.includes('maximum'))
          && globalState._chatMessages && globalState._chatMessages.length > 6) {
        replaceLastMessage('ai', '⏳ 正在压缩旧内容...');
        const half = Math.floor(globalState._chatMessages.length / 2);
        const toCompress = globalState._chatMessages.slice(0, half);
        const toKeep = globalState._chatMessages.slice(half);
        const compressText = toCompress.map(m => (m.role === 'user' ? '用户：' : 'AI：') + m.content).join('\n');
        chrome.runtime.sendMessage({
          type: 'CALL_ARK', apiKey, url: modelCfg.url,
          messages: [
            { role: 'system', content: '压缩以下对话为一段摘要，保留关键信息。' },
            { role: 'user', content: compressText }
          ],
          model: modelCfg.model || 'doubao-seed-2-0-code-preview-260215',
          maxTokens: 1024, temperature: 0.3, _noCache: true
        }, (res2) => {
          if (res2?.ok) {
            const summary = '【历史摘要】' + res2.data.choices[0].message.content;
            globalState._chatMessages = [{ role: 'assistant', content: summary }, ...toKeep];
            saveChatHistory();
          } else {
            globalState._chatMessages.splice(0, half);
            saveChatHistory();
          }
          showToast('↻ 已压缩，继续回复...');
          // 直接用压缩后的新历史重新调用，不重复添加用户消息
          const newHistory = globalState._chatMessages
            .filter(m => !(m.role === 'ai' && m.content.startsWith('⏳')))
            .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
          callLLM(systemPrompt, newHistory, input, modelCfg, apiKey);
        });
        return;
      }
      replaceLastMessage('error', (res?.error || '未知错误') + ' (' + modelCfg.name + ')');
      return;
    }
    const text = res.data.choices[0].message.content;
    replaceLastMessage('ai', text);
    if (globalState._chatMessages) {
      globalState._chatMessages[globalState._chatMessages.length - 1].content = text;
      saveChatHistory();
    }
  });
}

function showSettingsDialog() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.8);z-index:1000010;display:flex;align-items:center;justify-content:center;';

  const proxyItems = globalState.models.filter(m => !m.builtin).map((m, i) =>
    `<div style="display:flex;gap:4px;margin-bottom:4px;align-items:center;">
      <input class="jb-proxy-url" value="${m.url}" style="flex:2;padding:4px;background:#0D0D0D;color:#fff;border:1px solid #333;border-radius:3px;font-size:11px;" placeholder="URL">
      <input class="jb-proxy-name" value="${m.name}" style="flex:1;padding:4px;background:#0D0D0D;color:#fff;border:1px solid #333;border-radius:3px;font-size:11px;" placeholder="名称">
      <input class="jb-proxy-model" value="${m.model || ''}" style="flex:1;padding:4px;background:#0D0D0D;color:#fff;border:1px solid #333;border-radius:3px;font-size:11px;" placeholder="模型">
      <input class="jb-proxy-key" type="password" value="${m.key || ''}" style="flex:1.5;padding:4px;background:#0D0D0D;color:#fff;border:1px solid #333;border-radius:3px;font-size:11px;" placeholder="Key">
      <button class="jb-proxy-remove" data-idx="${i}" style="background:none;border:none;color:#FF0055;cursor:pointer;">✕</button>
    </div>`
  ).join('');

  overlay.innerHTML = `
    <div style="background:#1A1A1A;border:2px solid #FF0055;border-radius:6px;width:450px;max-width:90vw;padding:20px;">
      <h3 style="color:#fff;margin:0 0 16px;font-size:16px;">⚙️ 设置</h3>
      <div style="margin-bottom:12px;">
        <label style="color:#888;font-size:12px;display:block;margin-bottom:4px;">内置模型 API Key</label>
        <input type="password" id="jb-settings-apikey" style="width:100%;padding:8px;background:#0D0D0D;color:#fff;border:1px solid #333;border-radius:4px;font-size:13px;box-sizing:border-box;">
      </div>
      <div style="margin-bottom:12px;">
        <label style="color:#888;font-size:12px;display:block;margin-bottom:4px;">自定义代理</label>
        <div id="jb-proxy-list">${proxyItems}</div>
        <button id="jb-add-proxy" class="jb-btn" style="padding:4px 8px;font-size:11px;margin-top:4px;">+ 添加代理</button>
      </div>
      <div style="margin-bottom:12px;">
        <label style="color:#888;font-size:12px;display:block;margin-bottom:4px;">🔄 热更新配置</label>
        <input id="jb-settings-update-url" style="width:100%;padding:6px 8px;background:#0D0D0D;color:#fff;border:1px solid #333;border-radius:4px;font-size:11px;box-sizing:border-box;margin-bottom:4px;" placeholder="version.json 的 GitHub raw URL">
        <input id="jb-settings-raw-base" style="width:100%;padding:6px 8px;background:#0D0D0D;color:#fff;border:1px solid #333;border-radius:4px;font-size:11px;box-sizing:border-box;" placeholder="源文件所在的目录 URL（以 / 结尾）">
        <button id="jb-check-update-now" class="jb-btn" style="padding:3px 8px;font-size:10px;margin-top:4px;">🔍 立即检查更新</button>
        <span style="font-size:10px;color:#555;margin-left:6px;">每 5 分钟自动检查</span>
      </div>
      <div style="display:flex;gap:6px;justify-content:flex-end;">
        <button id="jb-settings-cancel" class="jb-btn" style="padding:6px 16px;font-size:12px;">取消</button>
        <button id="jb-settings-save" class="jb-btn jb-btn-primary" style="padding:6px 16px;font-size:12px;">保存</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  chrome.runtime.sendMessage({ type: 'GET_API_KEY' }, (res) => {
    const input = overlay.querySelector('#jb-settings-apikey');
    if (res?.ok && res.key) input.value = res.key;
  });

  // 加载更新配置
  chrome.runtime.sendMessage({ type: 'GET_UPDATE_CONFIG' }, (res) => {
    if (res) {
      const urlInput = overlay.querySelector('#jb-settings-update-url');
      const baseInput = overlay.querySelector('#jb-settings-raw-base');
      if (urlInput) urlInput.value = res.updateUrl || '';
      if (baseInput) baseInput.value = res.rawBase || '';
    }
  });

  // 立即检查更新
  overlay.querySelector('#jb-check-update-now')?.addEventListener('click', () => {
    const urlInput = overlay.querySelector('#jb-settings-update-url');
    const baseInput = overlay.querySelector('#jb-settings-raw-base');
    showToast('⏳ 正在检查更新...');
    // 先保存配置，再检查（链式调用防竞态）
    chrome.runtime.sendMessage({
      type: 'SAVE_UPDATE_CONFIG',
      updateUrl: urlInput?.value || '',
      rawBase: baseInput?.value || ''
    }, () => {
      chrome.runtime.sendMessage({ type: 'CHECK_UPDATE_NOW' }, (res) => {
        showToast(res?.ok ? '✅ 检查完成，如有新版本将自动重启' : '⚠️ 检查失败或无需更新');
      });
    });
  });

  overlay.querySelector('#jb-settings-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#jb-add-proxy')?.addEventListener('click', () => {
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
    // 保存 API Key（同时存入运行时缓存 + chrome.storage）
    const key = overlay.querySelector('#jb-settings-apikey').value;
    globalState._arkApiKey = key; // 运行时缓存，确保同一会话中即时可用
    chrome.runtime.sendMessage({ type: 'SAVE_API_KEY', key }, (res) => {
      if (!res || !res.ok) console.warn('jb: API Key 保存失败', res);
    });

    // 从表单读取自定义代理数据
    const proxyUrls = overlay.querySelectorAll('.jb-proxy-url');
    const proxyNames = overlay.querySelectorAll('.jb-proxy-name');
    const proxyModels = overlay.querySelectorAll('.jb-proxy-model');
    const proxyKeys = overlay.querySelectorAll('.jb-proxy-key');
    const customModels = globalState.models.filter(m => !m.builtin);
    customModels.forEach((m, i) => {
      if (proxyUrls[i]) m.url = proxyUrls[i].value;
      if (proxyNames[i]) m.name = proxyNames[i].value;
      if (proxyModels[i]) m.model = proxyModels[i].value;
      if (proxyKeys[i]) m.key = proxyKeys[i].value;
    });

    chrome.storage.local.set({ userModels: customModels });
    // 保存更新配置
    const updateUrl = overlay.querySelector('#jb-settings-update-url')?.value || '';
    const rawBase = overlay.querySelector('#jb-settings-raw-base')?.value || '';
    if (updateUrl) {
      chrome.runtime.sendMessage({ type: 'SAVE_UPDATE_CONFIG', updateUrl, rawBase });
    }
    const sel = document.getElementById('jb-model-selector');
    if (sel) sel.innerHTML = globalState.models.map((m, i) => `<option value="${i}">${m.name}</option>`).join('');
    showToast('✅ 设置已保存');
    overlay.remove();
  });
}

function saveOutputAsSkillFile() {
  const output = document.getElementById('jb-interaction-output');
  const content = output.textContent;
  const skill = getCurrentSkill();
  const name = 'output-' + (skill?.name || 'unknown') + '-' + Date.now();
  const skillFile = {
    id: name, name: name, description: '从交互区保存的输出',
    builtin: false, version: '1.0', output_format: 'text', system_prompt: content
  };
  globalState.skills.push(skillFile);
  saveUserSkills();
  if (typeof renderSkillPanel === 'function') renderSkillPanel();
  showToast('✅ 已保存到 Skill 栏: ' + name);
}

function getApiKeyFromStorage() {
  // 先查运行时缓存，最快
  if (globalState._arkApiKey) return Promise.resolve(globalState._arkApiKey);
  // 再查 chrome.storage
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_API_KEY' }, (res) => {
      const key = res.ok && res.key ? res.key : '';
      if (key) globalState._arkApiKey = key; // 同步到缓存
      resolve(key);
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
  if (pos) pos.textContent = h.length + '/' + h.length;
}
