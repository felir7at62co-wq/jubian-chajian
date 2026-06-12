// src/assets.js — 资产管理系统：三分类 + 拖拽上传 + 缩略图 + 画图入口

const ASSET_CATEGORIES = [
  { key: 'characters', icon: '👤', label: '角色' },
  { key: 'scenes', icon: '🏠', label: '场景' },
  { key: 'props', icon: '📦', label: '道具' }
];

let _currentAssetCategory = sessionStorage.getItem('jb_asset_category') || 'characters';
let _db = null;

function initAssets() {
  openAssetDB().then(() => {
    loadAssetsFromDB();
    renderAssetPanel();
  });
}

function openAssetDB() {
  return new Promise((resolve) => {
    const req = indexedDB.open('JBAssetsDB', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('thumbnails')) {
        db.createObjectStore('thumbnails', { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(); };
    req.onerror = () => resolve();
  });
}

function loadAssetsFromDB() {
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
    renderAssetPanel();
  };
}

function saveThumbnailToDB(id, category, dataURL, name) {
  if (!_db) return;
  const tx = _db.transaction('thumbnails', 'readwrite');
  tx.objectStore('thumbnails').put({ id, category, dataURL, name, time: Date.now() });
}

function deleteThumbnailFromDB(id) {
  if (!_db) return;
  const tx = _db.transaction('thumbnails', 'readwrite');
  tx.objectStore('thumbnails').delete(id);
}

function renderAssetPanel() {
  const panel = jbPanelSystem.panels.find(p => p.id === 'assets');
  if (!panel) return;

  const tabs = ASSET_CATEGORIES.map(c =>
    `<button class="jb-tab ${c.key === _currentAssetCategory ? 'active' : ''}" data-cat="${c.key}">${c.icon} ${c.label}</button>`
  ).join('');

  const currentCat = _currentAssetCategory;
  const items = globalState.assets[currentCat] || [];
  const itemList = items.map(item => {
    const copySrc = item.dataURL || '';
    return `<div class="jb-asset-item" data-id="${item.id}" draggable="true">
      <img class="jb-asset-thumb" src="${item.dataURL}" alt="${item.name}">
      <span class="jb-asset-name">${item.name}</span>
      <div class="jb-asset-actions">
        <button class="jb-asset-copy-btn" data-src="${copySrc}" title="复制路径">📋</button>
        <button class="jb-asset-draw-btn" data-id="${item.id}" title="画图">✏️</button>
        <button class="jb-asset-remove-btn" data-id="${item.id}" title="删除">✕</button>
      </div>
    </div>`;
  }).join('');

  const html = `
    <div class="jb-tabs">${tabs}</div>
    <div class="jb-dropzone" id="jb-asset-dropzone">${ASSET_CATEGORIES.find(c => c.key === currentCat)?.icon} 拖入图片到此处</div>
    <input type="file" id="jb-asset-file-input" multiple accept="image/*" style="display:none">
    <div id="jb-asset-list">${itemList.length ? itemList : '<div class="jb-empty">暂无图片</div>'}</div>`;

  panel.element.querySelector('.jb-panel-body').innerHTML = html;
  bindAssetEvents();
}

function bindAssetEvents() {
  document.querySelectorAll('.jb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      _currentAssetCategory = tab.dataset.cat;
      sessionStorage.setItem('jb_asset_category', _currentAssetCategory);
      renderAssetPanel();
    });
  });

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

  
  // 下载原图到本地
  document.querySelectorAll('.jb-asset-copy-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var id = this.closest('.jb-asset-item').dataset.id;
      var cat = globalState.assets[_currentAssetCategory] || [];
      var item = cat.find(function(a) { return a.id === id; });
      if (!item) return;
      var a = document.createElement('a');
      // 有原始 File 则用 File，否则用 dataURL
      if (item.file instanceof File || item.file instanceof Blob) {
        a.href = URL.createObjectURL(item.file);
        a.download = item.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
      } else if (item.dataURL) {
        a.href = item.dataURL;
        a.download = item.name + '.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      showToast('已下载');
    });
  });

  // 拖拽到 web
  document.querySelectorAll('.jb-asset-item').forEach(function(el) {
    el.addEventListener('dragstart', function(e) {
      var id = this.dataset.id;
      var cat = globalState.assets[_currentAssetCategory] || [];
      var item = cat.find(function(a) { return a.id === id; });
      if (!item) return;
      if (item.file instanceof File) {
        e.dataTransfer.items.add(item.file);
        var blobUrl = URL.createObjectURL(item.file);
        e.dataTransfer.setData('text/uri-list', blobUrl);
        e.dataTransfer.setData('text/plain', item.name);
      } else if (item.dataURL) {
        e.dataTransfer.setData('text/uri-list', item.dataURL);
        e.dataTransfer.setData('text/plain', item.name);
      }
      e.dataTransfer.effectAllowed = 'copy';
    });
  });

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
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 200 / img.width);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataURL = canvas.toDataURL('image/webp', 0.7);
        const asset = { id, name, dataURL, file, category: _currentAssetCategory };
        globalState.assets[_currentAssetCategory].push(asset);
        saveThumbnailToDB(id, _currentAssetCategory, dataURL, name);
        renderAssetPanel();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }
}
