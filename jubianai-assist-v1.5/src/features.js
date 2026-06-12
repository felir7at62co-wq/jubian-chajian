// jubianai 图片匹配助手 — 子任务检测 + 匹配引擎 + LLM 分析

// ============ Textarea/Subtask Detection ============

/** 找到页面上所有子任务 */
function findSubtasks() {
  const all = document.querySelectorAll('textarea');
  const result = [];
  for (const ta of all) {
    if (ta.offsetWidth < 50 || ta.offsetHeight < 30) continue;
    if (ta.closest('#jb-assist-sidebar')) continue;
    const ancestors = getAncestorChain(ta, 6);
    const isSubtask = ancestors.some((el) => {
      if (!el) return false;
      const html = el.innerHTML || '';
      const hasUploadFeature =
        html.includes('上传') || html.includes('选取') ||
        html.includes('素材') || html.includes('参考图') || html.includes('图片');
      const hasSubtaskLabel =
        html.includes('子任务') ||
        el.className.toLowerCase().includes('task') ||
        el.className.toLowerCase().includes('card') ||
        el.className.toLowerCase().includes('subtask');
      return hasUploadFeature && hasSubtaskLabel;
    });
    if (isSubtask) result.push(ta);
  }
  // 保底：未检测到子任务时直接用全部 textarea
  if (result.length === 0 && all.length > 0) {
    for (let i = 0; i < all.length; i++) result.push(all[i]);
  }
  return result;
}

function getAncestorChain(el, depth) {
  const chain = [];
  let cur = el.parentElement;
  for (let i = 0; i < depth && cur; i++) {
    chain.push(cur);
    cur = cur.parentElement;
  }
  return chain;
}

// ============ Name Extraction ============

function extractNameFromFilename(filename) {
  return filename.replace(/^.*[/\\]/, '').replace(/\.[^.]+$/, '').trim();
}

// ============ Matching Engine ============

/** 扫描脚本，替换名称 -> @图片N */
function scanAndReplaceForSubtask(script, matchedImages) {
  if (!script || !matchedImages.length) {
    return { matches: [], text: script, matchedImages };
  }
  const cleanScript = script.replace(/@图片\d+/g, '');
  const localNameList = matchedImages.map((m, i) => ({ name: m.name, localNum: i + 1 }));
  localNameList.sort((a, b) => b.name.length - a.name.length);
  const matches = [];
  for (const item of localNameList) {
    let count = 0, pos = 0;
    while (pos < cleanScript.length) {
      const idx = cleanScript.indexOf(item.name, pos);
      if (idx === -1) break;
      count++;
      pos = idx + item.name.length;
    }
    matches.push({ name: item.name, localNum: item.localNum, count, status: count > 0 ? 'match' : 'warn' });
  }
  let result = cleanScript;
  const matchNames = matches.filter((m) => m.count > 0);
  matchNames.sort((a, b) => b.name.length - a.name.length);
  for (const m of matchNames) {
    const tag = `@图片${m.localNum}`;
    let searchFrom = result.length, found = 0;
    while (found < m.count) {
      const idx = result.lastIndexOf(m.name, searchFrom);
      if (idx === -1) break;
      const after = result.slice(idx + m.name.length, idx + m.name.length + 2);
      if (after !== '@图') {
        result = result.slice(0, idx + m.name.length) + tag + result.slice(idx + m.name.length);
        searchFrom = idx - 1;
      } else {
        searchFrom = idx - 1;
      }
      found++;
    }
  }
  return { matches, text: result, matchedImages };
}

/** 从全局池中找出子任务需要的图片（字符串匹配） */
function matchImagesForSubtask(script, pool) {
  const sorted = [...pool].sort((a, b) => b.name.length - a.name.length);
  const matched = [];
  for (const item of sorted) {
    if (script.includes(item.name)) matched.push({ name: item.name, file: item.file });
  }
  return matched;
}

/** 在剧本中找未匹配的名称候选词 */
function findUnmatchedInScript(script, knownNames) {
  if (!script) return [];
  const found = new Set();
  const matches = script.match(/[一-鿿㐀-䶿]{2,6}/g);
  if (!matches) return [];
  const unique = [...new Set(matches)].sort((a, b) => b.length - a.length);
  const stopWords = ['因为','所以','但是','然后','之后','而且','但是','画面','风格','镜头','声音','效果','背景','颜色','我们','他们','没有','已经','可以','一个','这个','那个','什么','怎么','还是','就是','不是','如果','虽然','因此','同时','时候','目前','现在','开始','结束','进行','通过','之间','之中','之外','以及','关于','根据','按照','采用','使用','提供','进入','出现'];
  for (const word of unique) {
    const isKnown = knownNames.some((k) => word.includes(k) || k.includes(word));
    if (!isKnown && !stopWords.includes(word)) found.add(word);
  }
  return Array.from(found).slice(0, 10);
}

// ============ Image Upload via Page Script ============

function uploadImagesViaPageScript(files, subtaskIdx, sequential = true) {
  return new Promise((resolve) => {
    window.postMessage({ type: '__JB_UPLOAD', files, subtaskIdx, sequential, source: 'jb-assist-content' }, '*');
    const handler = (e) => {
      if (e.data && e.data.type === '__JB_UPLOAD_DONE' &&
          e.data.subtaskIdx === subtaskIdx && e.data.source === 'jb-assist-page') {
        window.removeEventListener('message', handler);
        resolve(e.data.success);
      }
    };
    window.addEventListener('message', handler);
    setTimeout(() => { window.removeEventListener('message', handler); resolve(false); }, 60000);
  });
}

// ============ Subtask Scanning ============

function findUploadEl(ta) {
  let el = ta.parentElement;
  for (let i = 0; i < 8 && el; i++) {
    const upload = el.querySelector('.el-upload');
    if (upload) return upload;
    el = el.parentElement;
  }
  const allUploads = [...document.querySelectorAll('.el-upload')].filter((u) => !u.closest('#jb-assist-sidebar'));
  if (!allUploads.length) return null;
  const taRect = ta.getBoundingClientRect();
  let closest = null, minDist = Infinity;
  for (const u of allUploads) {
    const dist = Math.abs(u.getBoundingClientRect().top - taRect.top);
    if (dist < minDist) { minDist = dist; closest = u; }
  }
  return minDist < 300 ? closest : null;
}

// 上一次轮询的内容哈希（避免无变化时重复渲染）
let _lastContentHash = '';

function scanAllSubtasks() {
  const section = document.getElementById('jb-subtask-section');
  if (!section) return;

  // 侧边栏隐藏时跳过轮询
  const sidebar = document.getElementById('jb-assist-sidebar');
  if (sidebar && sidebar.classList.contains('jb-hidden')) return;

  if (!globalPool.length) {
    section.innerHTML = '<div class="jb-empty" style="margin-top:12px">先拖入图片，自动检测子任务</div>';
    _lastContentHash = '';
    return;
  }
  const textareas = findSubtasks();
  if (!textareas.length) {
    section.innerHTML = '<div class="jb-empty" style="margin-top:12px">未检测到子任务，请点刷新</div>';
    _lastContentHash = '';
    return;
  }

  // 内容哈希检查：各 textarea 内容 + 图片池数量 + 已有 applied 状态不变则跳过重渲染
  const newHash = textareas.map(ta => ta.value).join('|') + '|pool:' + globalPool.length + '|applied:' + subtaskData.filter(s => s.applied).length;
  if (newHash === _lastContentHash) return;
  _lastContentHash = newHash;

  subtaskData = [];
  for (let i = 0; i < textareas.length; i++) {
    const ta = textareas[i];
    const script = ta.value;
    const matchedImages = matchImagesForSubtask(script, globalPool);
    const { matches, text } = scanAndReplaceForSubtask(script, matchedImages);
    const uploadEl = findUploadEl(ta);
    if (uploadEl) uploadEl.dataset.jbUploadIdx = String(i);
    subtaskData.push({ ta, label: `子任务 ${i + 1}`, matchedImages, matches, processedText: text, applied: false, uploaded: false, llmAnalysis: null });
  }
  renderSubtasks();
  updateUnassignedImages();
}

function renderSubtasks() {
  const section = document.getElementById('jb-subtask-section');
  if (!section) return;
  if (!subtaskData.length) {
    section.innerHTML = '<div class="jb-empty" style="margin-top:12px">未检测到子任务</div>';
    return;
  }
  let html = '<div class="jb-section-title">📋 子任务列表</div>';
  for (let i = 0; i < subtaskData.length; i++) {
    const sd = subtaskData[i];
    const hasContent = sd.ta.value.trim().length > 0;
    const matchCount = sd.matches.filter((m) => m.count > 0).length;
    const imageItems = sd.matchedImages.map((m, j) =>
      `<div class="jb-sub-image-item" draggable="true" data-si="${i}" data-sj="${j}">
        <span class="jb-num">${j + 1}</span>
        <span class="jb-filename">${m.name}</span>
        <span class="jb-sub-img-order">⬍</span>
      </div>`).join('');
    const matchTags = sd.matches.filter((m) => m.count > 0)
      .map((m) => `<span class="jb-match-tag">${m.name}→@图片${m.localNum}<span class="jb-tag-count">×${m.count}</span></span>`).join('');
    const warnTags = sd.matches.filter((m) => m.status === 'warn')
      .map((m) => `<span class="jb-warn-tag">⚠️ ${m.name}（剧本未出现）</span>`).join('');
    const poolNames = globalPool.map((p) => p.name);
    const unmatchedInScript = findUnmatchedInScript(sd.ta.value, poolNames);

    html += `<div class="jb-subtask-card" data-idx="${i}">
      <div class="jb-subtask-header">
        <span class="jb-subtask-label">${sd.label}</span>
        <span class="jb-subtask-status ${sd.applied ? 'jb-status-done' : matchCount > 0 && hasContent ? 'jb-status-ready' : 'jb-status-empty'}">
          ${sd.applied ? '✅ 已应用' : !hasContent ? '空' : matchCount > 0 ? `匹配 ${matchCount} 项` : '无匹配'}
        </span>
      </div>
      ${hasContent ? `<div class="jb-subtask-preview">🎨 ${colorizePreview(sd.ta.value, sd.matches.filter(m=>m.count>0).map(m=>m.name), unmatchedInScript)}</div>`
        : '<div class="jb-empty" style="padding:8px 0">（空脚本）</div>'}
      <div class="jb-debug-info">🔍 搜索 ${globalPool.map(f=>f.name).join('、') || '无'} | 找到 ${sd.matchedImages.length} 个匹配 | 脚本 ${sd.ta.value.length} 字</div>
      ${sd.matchedImages.length > 0 && hasContent ? `
        <div class="jb-sub-section-label">🖼️ 子任务图片顺序（拖拽调整）：</div>
        <div class="jb-sub-image-list" data-si="${i}">${imageItems}</div>` : ''}
      ${matchTags ? `<div class="jb-sub-section-label">📝 匹配结果：</div><div class="jb-subtask-matches">${matchTags}</div>` : ''}
      ${warnTags ? `<div class="jb-subtask-warns">${warnTags}</div>` : ''}
      ${unmatchedInScript.length > 0 ? `<div class="jb-subtask-unmatched">❌ 剧本中出现但无对应图片：${unmatchedInScript.join('、')}</div>` : ''}
      ${!sd.applied && hasContent && matchCount > 0 ? `
        <div class="jb-subtask-actions">
          <button class="jb-btn-apply-one" data-idx="${i}">✅ 上传图片 + 应用</button>
          <button class="jb-btn-preview" data-idx="${i}">👁️ 预览</button>
          <button class="jb-btn-analyze" data-idx="${i}">🤖 分析</button>
        </div>` : ''}
      ${sd.applied ? `<div class="jb-subtask-actions"><button class="jb-btn-undo" data-idx="${i}">↩️ 撤销</button></div>` : ''}
      ${renderAnalysisPanelInline(i)}
    </div>`;
  }
  const anyPending = subtaskData.some((sd) => !sd.applied && sd.ta.value.trim().length > 0 && sd.matches.some((m) => m.count > 0));
  if (anyPending) html += `<button id="jb-apply-all-btn" class="jb-btn jb-btn-success">⚡ 一键应用到所有子任务</button>`;
  section.innerHTML = html;

  // Bind events
  section.querySelectorAll('.jb-sub-image-list').forEach((list) => {
    const si = parseInt(list.dataset.si, 10);
    let dragSrc = null;
    list.querySelectorAll('.jb-sub-image-item').forEach((item) => {
      item.addEventListener('dragstart', () => { dragSrc = parseInt(item.dataset.sj, 10); item.style.opacity = '0.4'; });
      item.addEventListener('dragend', () => { item.style.opacity = '1'; });
      item.addEventListener('dragover', (e) => e.preventDefault());
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        if (dragSrc === null) return;
        const t = parseInt(item.dataset.sj, 10);
        if (dragSrc !== t) reorderSubtaskImage(si, dragSrc, t);
        dragSrc = null;
      });
    });
  });
  section.querySelectorAll('.jb-btn-apply-one').forEach((btn) => {
    btn.addEventListener('click', () => applyOne(parseInt(btn.dataset.idx, 10)));
  });
  section.querySelectorAll('.jb-btn-preview').forEach((btn) => {
    btn.addEventListener('click', () => previewOne(parseInt(btn.dataset.idx, 10)));
  });
  section.querySelectorAll('.jb-btn-undo').forEach((btn) => {
    btn.addEventListener('click', () => undoOne(parseInt(btn.dataset.idx, 10)));
  });
  section.querySelectorAll('.jb-btn-analyze').forEach((btn) => {
    btn.addEventListener('click', () => analyzeSubtaskWithLLM(parseInt(btn.dataset.idx, 10)));
  });
  // 分析面板事件绑定
  section.querySelectorAll('.jb-analysis-panel input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const panel = cb.closest('.jb-analysis-panel');
      const idx = parseInt(panel.dataset.idx, 10);
      const sd = subtaskData[idx];
      if (!sd || !sd.llmAnalysis) return;
      const ai = parseInt(cb.dataset.ai, 10);
      sd.llmAnalysis.checkState[ai] = cb.checked;
      const item = cb.closest('.jb-analysis-item');
      if (item) item.classList.toggle('jb-analysis-skipped', !cb.checked);
    });
  });
  section.querySelectorAll('.jb-analysis-select-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.closest('.jb-analysis-panel');
      const idx = parseInt(panel.dataset.idx, 10);
      const ai = parseInt(btn.dataset.ai, 10);
      const sd = subtaskData[idx];
      const name = sd?.llmAnalysis?.items[ai]?.name || '';
      openImageSelector(idx, ai, name);
    });
  });
  section.querySelectorAll('.jb-btn-insert').forEach(btn => {
    btn.addEventListener('click', () => confirmInsert(parseInt(btn.dataset.idx, 10)));
  });
  const aab = document.getElementById('jb-apply-all-btn');
  if (aab) aab.addEventListener('click', applyAll);
}

/** 渲染分析结果面板内联（用于 renderSubtasks） */
function renderAnalysisPanelInline(idx) {
  const sd = subtaskData[idx];
  if (!sd || !sd.llmAnalysis) return '<div class="jb-analysis-panel" data-idx="' + idx + '" style="display:none"></div>';

  const analysis = sd.llmAnalysis;
  const checkState = analysis.checkState;
  let currentCategory = '';
  let html = `<div class="jb-analysis-panel" data-idx="${idx}" style="display:block;">
    <div class="jb-analysis-header">🤖 分析结果</div>`;

  for (let i = 0; i < analysis.items.length; i++) {
    const m = analysis.items[i];
    if (m.type !== currentCategory) {
      currentCategory = m.type;
      html += `<div class="jb-analysis-category">${m.type}</div>`;
    }
    const checked = checkState && checkState[i] !== false ? 'checked' : '';
    const statusIcon = m.matched ? '✅' : '⚠️';
    const statusText = m.matched ? m.poolItem.name : '未匹配';
    const skipClass = (!checkState || checkState[i] === false) ? 'jb-analysis-skipped' : '';

    html += `<div class="jb-analysis-item ${skipClass}">
      <label class="jb-analysis-checkbox">
        <input type="checkbox" data-ai="${i}" ${checked}>
        <span class="jb-analysis-name">${escHtml(m.name)}</span>
      </label>
      <span class="jb-analysis-status">${statusIcon} ${statusText}</span>
      ${!m.matched && (!checkState || checkState[i] !== false) ? `<button class="jb-analysis-select-btn" data-ai="${i}">❓选图</button>` : ''}
    </div>`;
  }

  html += `<div class="jb-analysis-footer">
    <button class="jb-btn-insert" data-idx="${idx}">✅ 确认插入</button>
  </div></div>`;

  return html;
}

// ============ LLM 分析 ============

/** 获取 API Key */
async function getApiKey() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_API_KEY' }, (res) => {
      resolve(res.ok ? res.key : '');
    });
  });
}

const LLM_SYSTEM_PROMPT = `你是一个微短剧分镜脚本分析助手。分析以下脚本内容，提取所有需要配图的实体。

规则：
1. 角色：故事中出现的所有人物名称（包括昵称、别名、尊称），如"裴野""苏队长""璃儿"
2. 场景：故事发生的具体地点，如"村口""苏家院子""后山""火车站"
3. 道具：关键物品，如"窝窝头""欠条""龙骨水车""琥珀果酿"

注意：
- 排除通用词（"我们""他们""因为""所以"等）
- 排除指令性词语（"镜头""画面""风格"等分镜术语）
- 同一实体多个叫法时合并为同一名称（如"苏璃""璃儿""苏村长"都归为"苏璃"）

输出严格 JSON 格式，不要额外解释：
{"characters":["名称1","名称2"],"scenes":["地点1","地点2"],"props":["物品1","物品2"]}`;

/** 对子任务执行 LLM 分析 */
async function analyzeSubtaskWithLLM(idx) {
  const sd = subtaskData[idx];
  if (!sd) return;
  const panel = document.querySelector(`.jb-analysis-panel[data-idx="${idx}"]`);
  if (!panel) return;

  // 检查 API Key
  const apiKey = await getApiKey();
  if (!apiKey) {
    showToast('⚠️ 请先在底部 🔑 设置中保存 API Key');
    return;
  }

  // 显示加载状态
  panel.style.display = 'block';
  panel.innerHTML = '<div class="jb-analysis-loading">🤔 正在分析脚本...</div>';

  // 调用 background.js → ARK API
  chrome.runtime.sendMessage({
    type: 'CALL_ARK',
    apiKey,
    messages: [
      { role: 'system', content: LLM_SYSTEM_PROMPT },
      { role: 'user', content: sd.ta.value }
    ],
    maxTokens: 2048,
    temperature: 0.1,
    _noCache: false,
  }, (res) => {
    if (!res || !res.ok) {
      panel.innerHTML = `<div class="jb-analysis-error">❌ 分析失败：${res?.error || '未知错误'} <button class="jb-btn-retry" data-idx="${idx}">重试</button></div>`;
      panel.querySelector('.jb-btn-retry')?.addEventListener('click', () => analyzeSubtaskWithLLM(idx));
      return;
    }

    // 解析 JSON
    let entities;
    try {
      const content = res.data.choices[0].message.content;
      // 提取 JSON（兼容 markdown 包裹）
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || content.match(/{[\s\S]*?}/);
      const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content;
      entities = JSON.parse(jsonStr);
    } catch (e) {
      panel.innerHTML = `<div class="jb-analysis-error">❌ LLM 返回格式异常，请重试 <button class="jb-btn-retry" data-idx="${idx}">重试</button></div>`;
      panel.querySelector('.jb-btn-retry')?.addEventListener('click', () => analyzeSubtaskWithLLM(idx));
      return;
    }

    // 保存实体到 subtaskData
    sd.llmEntities = entities;

    // 将实体与图片池匹配
    const allItems = [
      ...(entities.characters || []).map(name => ({ type: '👤 角色', name })),
      ...(entities.scenes || []).map(name => ({ type: '🏠 场景', name })),
      ...(entities.props || []).map(name => ({ type: '📦 道具', name })),
    ];

    // 对每个实体尝试自动匹配图片
    const items = allItems.map(item => {
      const poolItem = globalPool.find(p => p.name === item.name);
      return { ...item, matched: !!poolItem, poolItem: poolItem || null };
    });

    // 保存到 subtaskData（持久化，renderSubtasks 时内联渲染）
    sd.llmAnalysis = {
      items,
      checkState: sd.llmAnalysis?.checkState || items.map(() => true),
    };

    // 重新渲染以显示面板
    renderSubtasks();
  });
}

/** 打开图片选择器弹窗 */
function openImageSelector(subtaskIdx, entityIdx, entityName) {
  // 创建覆盖层
  const overlay = document.createElement('div');
  overlay.className = 'jb-selector-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:1000002;display:flex;align-items:center;justify-content:center;';

  // 列出所有未匹配到此子任务的图片
  const sd = subtaskData[subtaskIdx];
  const alreadyMatched = new Set(sd.matchedImages.map(m => m.name));
  const available = globalPool.filter(p => !alreadyMatched.has(p.name));

  overlay.innerHTML = `<div style="background:#fff;border-radius:8px;width:400px;max-width:90vw;max-height:70vh;display:flex;flex-direction:column;">
    <div style="padding:12px 16px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;">
      <strong>为「${escHtml(entityName)}」选择图片</strong>
      <button class="jb-selector-close" style="background:none;border:none;font-size:18px;cursor:pointer">✕</button>
    </div>
    <div style="padding:12px;overflow-y:auto;flex:1;">
      ${available.length === 0 ? '<div class="jb-empty">图片池中没有可用的图片</div>' :
        available.map((p, i) => `<label class="jb-unassigned-item" style="display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;">
          <input type="radio" name="selector-image" value="${i}">
          <span>${escHtml(p.name)}</span>
        </label>`).join('')}
    </div>
    <div style="padding:12px;border-top:1px solid #eee;">
      <button class="jb-selector-confirm" style="width:100%;padding:8px;background:#2196f3;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:600;">确认选择</button>
    </div>
  </div>`;

  document.body.appendChild(overlay);

  overlay.querySelector('.jb-selector-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('.jb-selector-confirm').addEventListener('click', () => {
    const selected = overlay.querySelector('input[name="selector-image"]:checked');
    if (selected) {
      const poolIdx = parseInt(selected.value, 10);
      const poolItem = globalPool[poolIdx];
      // 添加到子任务的 matchedImages
      const sd = subtaskData[subtaskIdx];
      sd.matchedImages.push({ name: poolItem.name, file: poolItem.file });
      // 更新 llmAnalysis.items 中的匹配状态
      if (sd.llmAnalysis) {
        const targetItem = sd.llmAnalysis.items.find(i => i.name === entityName);
        if (targetItem) {
          targetItem.matched = true;
          targetItem.poolItem = poolItem;
        }
      }
      // 重新扫描
      const { matches, text } = scanAndReplaceForSubtask(sd.ta.value, sd.matchedImages);
      sd.matches = matches;
      sd.processedText = text;
      showToast(`✅ 已为「${entityName}」选择 ${poolItem.name}`);
      overlay.remove();
      renderSubtasks();
    } else {
      showToast('请先选择一张图片');
    }
  });
}

/** 确认插入 @图片N（含自动上传） */
async function confirmInsert(idx) {
  const sd = subtaskData[idx];
  if (!sd || !sd.llmAnalysis) return;

  const { items, checkState } = sd.llmAnalysis;
  const confirmedImages = [];
  const skipNames = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!checkState[i]) {
      skipNames.push(item.name);
      continue;
    }
    if (item.matched) {
      if (!confirmedImages.some(c => c.name === item.poolItem.name)) {
        confirmedImages.push({ name: item.poolItem.name, file: item.poolItem.file });
      }
    }
  }

  if (confirmedImages.length === 0 && skipNames.length > 0) {
    showToast('⛔ 所有实体都已跳过，无需插入');
    return;
  }
  if (confirmedImages.length === 0) {
    showToast('⚠️ 没有已匹配的图片，请先选择或跳过');
    return;
  }

  // 执行替换
  sd.matchedImages = confirmedImages;
  const { matches: newMatches, text } = scanAndReplaceForSubtask(sd.ta.value, sd.matchedImages);
  sd.matches = newMatches;
  sd.processedText = text;

  // 先上传图片，再写回文本框
  const files = confirmedImages.map(m => m.file).filter(Boolean);
  if (files.length > 0) {
    showToast(`📤 正在上传 ${files.length} 张图片到 ${sd.label}...`);
    const ok = await uploadImagesViaPageScript(files, idx);
    if (ok) { sd.uploaded = true; } else { showToast(`⚠️ ${sd.label} 图片上传可能未成功，请检查`); }
  }

  // 写回文本框
  sd.ta.value = sd.processedText;
  sd.ta.dispatchEvent(new Event('input', { bubbles: true }));
  sd.ta.dispatchEvent(new Event('change', { bubbles: true }));
  sd.applied = true;

  const count = newMatches.reduce((s, m) => s + m.count, 0);
  const skipMsg = skipNames.length > 0 ? `（跳过 ${skipNames.length} 项）` : '';
  showToast(`✅ ${sd.label}：已上传 ${files.length} 张图，插入 ${count} 处 @图片N 引用${skipMsg}`);
  renderSubtasks();
}

// ============ Apply / Undo / Preview ============

async function applyOne(idx) {
  const sd = subtaskData[idx];
  if (!sd || sd.applied) return;
  if (sd.matchedImages.length > 0) {
    const files = sd.matchedImages.map((m) => m.file).filter(Boolean);
    if (files.length > 0) {
      showToast(`📤 正在上传 ${files.length} 张图片到 ${sd.label}...`);
      const ok = await uploadImagesViaPageScript(files, idx);
      if (ok) { sd.uploaded = true; showToast(`✅ ${sd.label} 图片上传完成`);
      } else { showToast(`⚠️ ${sd.label} 图片上传可能未成功，请检查`); }
    }
  }
  sd.ta.value = sd.processedText;
  sd.ta.dispatchEvent(new Event('input', { bubbles: true }));
  sd.ta.dispatchEvent(new Event('change', { bubbles: true }));
  sd.applied = true;
  const count = sd.matches.filter((m) => m.count > 0).reduce((s, m) => s + m.count, 0);
  showToast(`✅ ${sd.label}：已写入 ${count} 处 @图片N 引用`);
  renderSubtasks();
}

async function applyAll() {
  let total = 0, uploadFail = false;
  for (const sd of subtaskData) {
    if (sd.applied) continue;
    if (!sd.ta.value.trim().length || !sd.matches.some((m) => m.count > 0)) continue;
    if (sd.matchedImages.length > 0 && !sd.uploaded) {
      const files = sd.matchedImages.map((m) => m.file).filter(Boolean);
      if (files.length > 0) {
        const ok = await uploadImagesViaPageScript(files, subtaskData.indexOf(sd));
        if (ok) sd.uploaded = true; else uploadFail = true;
      }
    }
    sd.ta.value = sd.processedText;
    sd.ta.dispatchEvent(new Event('input', { bubbles: true }));
    sd.ta.dispatchEvent(new Event('change', { bubbles: true }));
    sd.applied = true;
    total += sd.matches.filter((m) => m.count > 0).reduce((s, m) => s + m.count, 0);
  }
  showToast(`✅ 全部应用完成，共写入 ${total} 处 @图片N 引用${uploadFail ? '（部分图片未自动上传）' : ''}`);
  renderSubtasks();
}

function undoOne(idx) {
  const sd = subtaskData[idx];
  if (!sd || !sd.applied) return;
  sd.ta.value = sd.ta.value.replace(/@图片\d+/g, '');
  sd.ta.dispatchEvent(new Event('input', { bubbles: true }));
  sd.ta.dispatchEvent(new Event('change', { bubbles: true }));
  sd.applied = false;
  sd.uploaded = false;
  const matched = matchImagesForSubtask(sd.ta.value, globalPool);
  const { matches, text } = scanAndReplaceForSubtask(sd.ta.value, matched);
  sd.matchedImages = matched;
  sd.matches = matches;
  sd.processedText = text;
  showToast(`↩️ ${sd.label}：已撤销`);
  renderSubtasks();
}

function previewOne(idx) {
  const sd = subtaskData[idx];
  if (!sd) return;
  const overlay = document.createElement('div');
  overlay.id = 'jb-preview-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:1000001;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `<div style="background:#fff;border-radius:8px;width:700px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid #eee;">
      <strong>${sd.label} — 预览对比</strong>
      <button class="jb-preview-close-btn" style="background:none;border:none;font-size:18px;cursor:pointer">✕</button>
    </div>
    <div style="display:flex;flex:1;overflow:hidden;">
      <div style="flex:1;padding:12px;border-right:1px solid #eee;overflow-y:auto;">
        <div style="font-size:11px;color:#888;margin-bottom:4px;">替换前：</div>
        <pre style="white-space:pre-wrap;font-size:13px;margin:0;line-height:1.6;">${escHtml(sd.ta.value.replace(/@图片\d+/g, ''))}</pre>
      </div>
      <div style="flex:1;padding:12px;overflow-y:auto;">
        <div style="font-size:11px;color:#888;margin-bottom:4px;">替换后：</div>
        <pre style="white-space:pre-wrap;font-size:13px;margin:0;line-height:1.6;">${escHtml(sd.processedText)}</pre>
      </div>
    </div>
    <div style="padding:10px 12px;border-top:1px solid #eee;font-size:12px;color:#888;">
      图片顺序：${sd.matchedImages.map((m, i) => `${i + 1}.${m.name}`).join(' → ')}
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.jb-preview-close-btn').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ============ Pool Management ============

function addToPool(files) {
  for (const file of files) {
    const name = extractNameFromFilename(file.name);
    if (globalPool.some((f) => f.name === name)) continue;
    globalPool.push({ file, name });
  }
  renderPool();
  scanAllSubtasks();
}

function removeFromPool(index) {
  globalPool.splice(index, 1);
  renderPool();
  scanAllSubtasks();
  updateUnassignedImages();
}

function moveInPool(from, to) {
  if (to < 0 || to >= globalPool.length) return;
  const [item] = globalPool.splice(from, 1);
  globalPool.splice(to, 0, item);
  renderPool();
  scanAllSubtasks();
  updateUnassignedImages();
}

function renderPool() {
  const c = document.getElementById('jb-image-list');
  if (!c) return;
  if (!globalPool.length) {
    c.innerHTML = '<div class="jb-empty">暂无图片</div>';
    return;
  }
  c.innerHTML = globalPool.map((f, i) =>
    `<div class="jb-image-item" draggable="true" data-index="${i}">
      <span class="jb-num">${i + 1}</span>
      <span class="jb-filename">${f.name}</span>
      <button class="jb-edit-btn" data-index="${i}" title="在线编辑站位图">✏️</button>
      <button class="jb-remove" data-index="${i}">✕</button>
    </div>`
  ).join('');

  let dragSrc = null;
  c.querySelectorAll('.jb-image-item').forEach((item) => {
    item.addEventListener('dragstart', () => { dragSrc = parseInt(item.dataset.index, 10); item.style.opacity = '0.4'; });
    item.addEventListener('dragend', () => { item.style.opacity = '1'; });
    item.addEventListener('dragover', (e) => e.preventDefault());
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dragSrc === null) return;
      const t = parseInt(item.dataset.index, 10);
      if (dragSrc !== t) moveInPool(dragSrc, t);
      dragSrc = null;
    });
  });
  c.querySelectorAll('.jb-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); removeFromPool(parseInt(btn.dataset.index, 10)); });
  });
  // ✏️ 编辑按钮（Phase 2 实现画图工具后启用）
  c.querySelectorAll('.jb-edit-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index, 10);
      if (typeof openDrawingTool === 'function') {
        openDrawingTool(idx);
      } else {
        showToast('✏️ 画图工具开发中...');
      }
    });
  });
}

function reorderSubtaskImage(subtaskIdx, from, to) {
  const sd = subtaskData[subtaskIdx];
  if (!sd) return;
  const [item] = sd.matchedImages.splice(from, 1);
  sd.matchedImages.splice(to, 0, item);
  const { matches, text } = scanAndReplaceForSubtask(sd.ta.value, sd.matchedImages);
  sd.matches = matches;
  sd.processedText = text;
  renderSubtasks();
}

function updateUnassignedImages() {
  const allMatchedNames = new Set();
  for (const sd of subtaskData) {
    for (const m of sd.matchedImages) allMatchedNames.add(m.name);
  }
  unassignedImages = globalPool.filter(p => !allMatchedNames.has(p.name));
  renderUnassignedImages();
}

function renderUnassignedImages() {
  let container = document.getElementById('jb-unassigned-section');
  if (!container) {
    const ref = document.getElementById('jb-subtask-section');
    if (!ref) return;
    container = document.createElement('div');
    container.id = 'jb-unassigned-section';
    ref.parentNode.insertBefore(container, ref.nextSibling);
  }

  // 保存当前的折叠状态和勾选状态（避免轮询导致展开后自动收回/勾选丢失）
  const wasOpen = container.querySelector('details')?.hasAttribute('open') ?? true;
  const checkedNames = new Set();
  container.querySelectorAll('#jb-unassigned-list input[type="checkbox"]:checked').forEach(cb => {
    if (cb.dataset.name) checkedNames.add(cb.dataset.name);
  });

  if (!unassignedImages.length) { container.innerHTML = ''; return; }
  const subtaskOptions = subtaskData.map((sd, i) => `<option value="${i}">${sd.label}</option>`).join('');
  container.innerHTML = `
    <details${wasOpen ? ' open' : ''}>
      <summary class="jb-section-title">❓ 未分配图片 (${unassignedImages.length})</summary>
      <div class="jb-hint-text">这些图片未被任何子任务匹配。选择目标子任务后上传</div>
      <div id="jb-unassigned-list">${unassignedImages.map(p =>
        `<label class="jb-unassigned-item"><input type="checkbox" data-name="${escHtml(p.name)}"><span class="jb-filename">${escHtml(p.name)}</span></label>`
      ).join('')}</div>
      <select id="jb-unassigned-target" class="jb-unassigned-select">${subtaskOptions}</select>
      <button id="jb-upload-unassigned-btn" class="jb-btn jb-btn-primary">上传选中图片到子任务</button>
    </details>`;
  // 恢复之前勾选的状态
  if (checkedNames.size > 0) {
    container.querySelectorAll('#jb-unassigned-list input[type="checkbox"]').forEach(cb => {
      if (cb.dataset.name && checkedNames.has(cb.dataset.name)) cb.checked = true;
    });
  }
  document.getElementById('jb-upload-unassigned-btn')?.addEventListener('click', async () => {
    const checked = container.querySelectorAll('#jb-unassigned-list input[type="checkbox"]:checked');
    const selectedNames = Array.from(checked).map(cb => cb.dataset.name);
    if (!selectedNames.length) { showToast('请先勾选要上传的图片'); return; }
    const targetIdx = parseInt(document.getElementById('jb-unassigned-target').value, 10);
    await uploadUnassignedToSubtask(selectedNames, targetIdx);
  });
}

async function uploadUnassignedToSubtask(selectedNames, subtaskIdx) {
  const sd = subtaskData[subtaskIdx];
  if (!sd) { showToast('无效的子任务'); return; }
  const filesToUpload = selectedNames.map(name => globalPool.find(p => p.name === name)).filter(Boolean).map(p => p.file);
  if (!filesToUpload.length) { showToast('未找到对应的图片文件'); return; }
  showToast(`📤 正在上传 ${filesToUpload.length} 张图片到 ${sd.label}...`);
  const ok = await uploadImagesViaPageScript(filesToUpload, subtaskIdx);
  if (!ok) { showToast(`⚠️ ${sd.label} 图片上传可能未成功，请检查`); return; }
  for (const name of selectedNames) {
    const poolItem = globalPool.find(p => p.name === name);
    if (poolItem && !sd.matchedImages.some(m => m.name === name)) {
      sd.matchedImages.push({ name: poolItem.name, file: poolItem.file });
    }
  }
  const { matches, text } = scanAndReplaceForSubtask(sd.ta.value, sd.matchedImages);
  sd.matches = matches;
  sd.processedText = text;
  sd.ta.value = sd.processedText;
  sd.ta.dispatchEvent(new Event('input', { bubbles: true }));
  sd.ta.dispatchEvent(new Event('change', { bubbles: true }));
  showToast(`✅ ${sd.label}：已上传 ${filesToUpload.length} 张图片并更新 @图片N 引用`);
  updateUnassignedImages();
  renderSubtasks();
}

// ============ Utilities ============

function colorizePreview(text, matchedNames, unmatchedNames) {
  if (!text) return '';
  const snippet = text.slice(0, 150);
  let html = escHtml(snippet);
  const sortedMatched = [...matchedNames].sort((a, b) => b.length - a.length);
  for (const name of sortedMatched) {
    const escaped = escHtml(name);
    html = html.replace(new RegExp(escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      (match) => `<span class="jb-hl-match">${match}</span>`);
  }
  const sortedUnmatched = [...unmatchedNames].sort((a, b) => b.length - a.length);
  for (const name of sortedUnmatched) {
    const escaped = escHtml(name);
    html = html.replace(new RegExp(escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      (match) => `<span class="jb-hl-unmatch">${match}</span>`);
  }
  return html;
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showToast(msg) {
  const t = document.getElementById('jb-toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('jb-show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('jb-show'), 3000);
}
