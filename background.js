// jubianai 图片匹配助手 v2.0 — Service Worker
// 职责：ARK API 代理 + API Key 管理 + 自动热更新

const ARK_API_URL = 'https://ark.cn-beijing.volces.com/api/coding/v1/chat/completions';
const DEFAULT_MODEL = 'doubao-seed-2-0-code-preview-260215';

// ─── 自动更新配置 ─────────────────────────────────────
// 你的 GitHub 仓库信息（首次使用时配置，也可在插件设置面板修改）
const DEFAULT_UPDATE_URL = 'https://raw.githubusercontent.com/felir7at62co-wq/jubian-chajian/main/version.json';
const DEFAULT_RAW_BASE  = 'https://raw.githubusercontent.com/felir7at62co-wq/jubian-chajian/main/';

// 需要动态更新的源文件列表（相对扩展根目录）
const SOURCE_FILES = [
  'src/state.js',
  'src/panel-system.js',
  'src/skills-init.js',
  'src/skills.js',
  'src/interaction.js',
  'src/assets.js',
  'src/drawing.js',
  'src/comic-ui.js',
  'src/main.js'
];

const CSS_FILES = ['content_style.css'];

// ─── 启动检查：待处理的更新 ───────────────────────────
chrome.storage.local.get('_jb_pending', (r) => {
  if (r._jb_pending) {
    chrome.storage.local.remove('_jb_pending');
    chrome.tabs.query({ url: '*://web.jubianai.net/*' }, (tabs) => {
      tabs.forEach(t => chrome.tabs.reload(t.id));
    });
  }
});

// 注册定时检查（5 分钟间隔）
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('jb-poll-update', { periodInMinutes: 5 });
  // 首次安装时下载最新代码
  syncFromGitHub().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'jb-poll-update') checkForUpdates();
});

// ─── 更新检查与下载 ──────────────────────────────────
async function getUpdateUrl() {
  return new Promise(resolve => {
    chrome.storage.local.get('jb_update_url', (r) => {
      resolve(r.jb_update_url || DEFAULT_UPDATE_URL);
    });
  });
}

async function getRawBase() {
  return new Promise(resolve => {
    chrome.storage.local.get('jb_raw_base', (r) => {
      resolve(r.jb_raw_base || DEFAULT_RAW_BASE);
    });
  });
}

async function checkForUpdates() {
  try {
    const updateUrl = await getUpdateUrl();
    const resp = await fetch(updateUrl, { cache: 'no-cache' });
    if (!resp.ok) return;
    const remote = await resp.json();

    const local = await getStoredVersion();
    if (remote.version && remote.version !== local) {
      await downloadAndStoreCode(remote.version);
      // 标记待刷新并重启扩展
      chrome.storage.local.set({ _jb_pending: true }, () => {
        chrome.runtime.reload();
      });
    }
  } catch (e) {
    // 静默失败，下次轮询再试
  }
}

async function getStoredVersion() {
  return new Promise(resolve => {
    chrome.storage.local.get('_jb_version', (r) => resolve(r._jb_version || ''));
  });
}

async function downloadAndStoreCode(version) {
  const rawBase = await getRawBase();
  const data = { _jb_version: version };

  // 并行下载所有 JS 文件
  const jsParts = await Promise.all(SOURCE_FILES.map(async (f) => {
    try {
      const r = await fetch(rawBase + f);
      if (r.ok) return '// ' + f + '\n' + await r.text();
    } catch (e) {}
    return '';
  }));
  data._jb_js = jsParts.filter(Boolean).join('\n\n');

  // 并行下载 CSS
  const cssParts = await Promise.all(CSS_FILES.map(async (f) => {
    try {
      const r = await fetch(rawBase + f);
      if (r.ok) return await r.text();
    } catch (e) {}
    return '';
  }));
  data._jb_css = cssParts.filter(Boolean).join('\n\n');

  return new Promise(resolve => {
    chrome.storage.local.set(data, resolve);
  });
}

// 首次安装或 GitHub 不可用时，从本地加载代码
async function loadCodeFromLocal() {
  const jsParts = await Promise.all(SOURCE_FILES.map(f =>
    fetch(chrome.runtime.getURL(f)).then(r => r.text()).catch(() => '')
  ));
  const cssParts = await Promise.all(CSS_FILES.map(f =>
    fetch(chrome.runtime.getURL(f)).then(r => r.text()).catch(() => '')
  ));
  return {
    js: jsParts.filter(Boolean).join('\n\n'),
    css: cssParts.filter(Boolean).join('\n\n')
  };
}

// 首次安装时从 GitHub 同步，失败则用本地
async function syncFromGitHub() {
  try {
    const updateUrl = await getUpdateUrl();
    const resp = await fetch(updateUrl, { cache: 'no-cache' });
    if (resp.ok) {
      const remote = await resp.json();
      if (remote.version) {
        await downloadAndStoreCode(remote.version);
        return;
      }
    }
  } catch (e) {}
  // GitHub 不可用 → 用本地代码作为初始版本
  const local = await loadCodeFromLocal();
  chrome.storage.local.set({
    _jb_version: chrome.runtime.getManifest().version,
    _jb_js: local.js,
    _jb_css: local.css
  });
}

// ─── 请求缓存（同内容去重，5 分钟内有效）─────────────
const requestCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'CALL_ARK':
      handleArkApi(request, sendResponse);
      return true; // 保持通道打开
    case 'GET_API_KEY':
      chrome.storage.local.get('ARK_API_KEY', (result) => {
        sendResponse({ ok: true, key: result.ARK_API_KEY || 'aeb39cba-856b-483d-aca1-1b22becb09dc' });
      });
      return true;
    case 'SAVE_API_KEY':
      chrome.storage.local.set({ ARK_API_KEY: request.key }, () => {
        sendResponse({ ok: true });
      });
      return true;
    case 'LOAD_MODELS':
      chrome.storage.local.get('userModels', (result) => {
        sendResponse({ ok: true, models: result.userModels || [] });
      });
      return true;
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
    // ── 为 loader.js 提供代码 ──
    case 'GET_CODE':
      chrome.storage.local.get(['_jb_js', '_jb_css'], async (res) => {
        if (res._jb_js) {
          sendResponse({ js: res._jb_js, css: res._jb_css || '' });
        } else {
          // 首次加载，storage 还没有缓存 → 从本地文件加载
          const local = await loadCodeFromLocal();
          chrome.storage.local.set({
            _jb_version: chrome.runtime.getManifest().version,
            _jb_js: local.js,
            _jb_css: local.css
          });
          sendResponse(local);
        }
      });
      return true;
    // ── 保存更新配置 ──
    case 'SAVE_UPDATE_CONFIG':
      chrome.storage.local.set({
        jb_update_url: request.updateUrl,
        jb_raw_base: request.rawBase
      }, () => sendResponse({ ok: true }));
      return true;
    // ── 获取更新配置 ──
    case 'GET_UPDATE_CONFIG':
      chrome.storage.local.get(['jb_update_url', 'jb_raw_base'], (r) => {
        sendResponse({
          updateUrl: r.jb_update_url || DEFAULT_UPDATE_URL,
          rawBase: r.jb_raw_base || DEFAULT_RAW_BASE
        });
      });
      return true;
    // ── 手动触发检查更新 ──
    case 'CHECK_UPDATE_NOW':
      checkForUpdates().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
      return true;
    // ── 通过 scripting API 注入代码到 main world ──
    case 'INJECT_CODE':
      if (!sender.tab || !sender.tab.id) {
        sendResponse({ ok: false, error: 'No tab context' });
        return true;
      }
      chrome.scripting.executeScript({
        target: { tabId: sender.tab.id },
        world: 'MAIN',
        func: (code, proxyCode) => { eval(proxyCode); eval(code); },
        args: [request.code, request.proxyCode]
      }).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    default:
      sendResponse({ ok: false, error: `未知消息类型: ${request.type}` });
      return true;
  }
});

async function handleArkApi(request, sendResponse) {
  const { messages, model = DEFAULT_MODEL, maxTokens = 4096, temperature = 0.1, url } = request;
  const API_URL = url || ARK_API_URL;

  // 缓存检查（仅对纯文本请求，视觉请求不缓存）
  const cacheKey = request._noCache ? null : JSON.stringify({ messages, model, url: API_URL });
  if (cacheKey && requestCache.has(cacheKey)) {
    const cached = requestCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      sendResponse({ ok: true, data: cached.data });
      return;
    }
    requestCache.delete(cacheKey);
  }

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${request.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '未知错误');
      // 502/503 自动重试一次
      if (response.status >= 500 && response.status < 600) {
        await new Promise(r => setTimeout(r, 2000));
        const retryResp = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${request.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: maxTokens,
            temperature,
          }),
        });
        if (!retryResp.ok) {
          sendResponse({ ok: false, error: `API 错误 (${retryResp.status}): ${errorText}` });
          return;
        }
        const data = await retryResp.json();
        if (cacheKey) requestCache.set(cacheKey, { data, timestamp: Date.now() });
        sendResponse({ ok: true, data });
        return;
      }
      sendResponse({ ok: false, error: `API 错误 (${response.status}): ${errorText}` });
      return;
    }

    const data = await response.json();
    if (cacheKey) requestCache.set(cacheKey, { data, timestamp: Date.now() });
    sendResponse({ ok: true, data });
  } catch (err) {
    sendResponse({ ok: false, error: `网络错误: ${err.message}` });
  }
}
