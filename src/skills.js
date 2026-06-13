// src/skills.js — Skill 管理系统

const _loadingSkills = new Set(); // 防止并行加载同一个 skill

function initSkills() {
  if (!globalState.skills.length) {
    // 只复制元数据，system_prompt 在点击 skill 时按需加载
    globalState.skills = BUILTIN_SKILLS.map(s => ({ ...s }));
  }
  renderSkillPanel(); // 先渲染内置 skill
  chrome.storage.local.get('userSkills', (res) => {
    if (res.userSkills) {
      for (const us of res.userSkills) {
        if (!globalState.skills.find(s => s.id === us.id)) {
          globalState.skills.push(us);
        }
      }
    }
    renderSkillPanel(); // 合并用户 skill 后重绘
  });
}

// 运行时从 skills/<id>/SKILL.md + references/ 加载完整内容
async function loadSkillContent(skill) {
  if (skill.system_prompt) return skill.system_prompt;
  if (!skill.dir) return skill.system_prompt || '';
  // 防止同时加载同一个 skill
  if (_loadingSkills.has(skill.id)) {
    await new Promise(r => { const iv = setInterval(() => { if (!_loadingSkills.has(skill.id)) { clearInterval(iv); r(); } }, 50); });
    return skill.system_prompt || '';
  }
  _loadingSkills.add(skill.id);
  try {
    const base = chrome.runtime.getURL(skill.dir);
    const resp = await fetch(base + '/SKILL.md');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    let content = await resp.text();

    // 加载 reference 文件
    const refs = skill.refs || [];
    for (const ref of refs) {
      try {
        const r = await fetch(base + '/references/' + ref);
        if (r.ok) {
          const text = await r.text();
          content += '\n\n# 参考文件：' + ref + '\n' + text;
        }
      } catch (e) {
        console.warn('Failed to load reference:', ref, e);
      }
    }

    skill.system_prompt = content;
    return content;
  } catch (e) {
    console.error('Failed to load skill:', skill.id, e);
    delete skill.system_prompt; // 清空以便重试
    return '';
  } finally {
    _loadingSkills.delete(skill.id);
  }
}

function renderSkillPanel() {
  var body = JB.getBody('skills');
  if (!body) return;

  let html = `
    <div style="margin-bottom:8px;display:flex;gap:4px;">
      <button class="jb-btn jb-btn-primary" id="jb-upload-skill" style="flex:1;padding:6px;font-size:11px;">📂 上传</button>
      <button class="jb-btn" id="jb-new-skill" style="padding:6px;font-size:11px;">📝 新建</button>
      <button class="jb-btn" id="jb-new-folder" style="padding:6px;font-size:11px;">📁</button>
    </div>
    <input type="file" id="jb-skill-file-input" accept=".skill,.json" style="display:none">
    <div id="jb-skill-list">`;

  const folders = globalState.skillFolders || [];
  const uncategorized = globalState.skills.filter(s => !folders.find(f => f.children.includes(s.id)));

  for (const f of folders) {
    html += `<div class="jb-skill-folder">
      <div style="display:flex;align-items:center;gap:4px;padding:4px 0;color:#00E5FF;font-size:12px;">
        <span>📁 ${f.name}</span>
        <button class="jb-folder-remove-btn" data-folder="${f.name}" style="background:none;border:none;color:#666;cursor:pointer;font-size:10px;margin-left:auto;">✕</button>
      </div>`;
    for (const sid of f.children) {
      const s = globalState.skills.find(sk => sk.id === sid);
      if (s) html += renderSkillItem(s);
    }
    html += `</div>`;
  }
  for (const s of uncategorized) html += renderSkillItem(s);

  html += `</div>`;
  body.innerHTML = html;
  bindSkillEvents();
}

function renderSkillItem(skill) {
  const active = globalState.currentSkillId === skill.id ? 'active' : '';
  return `<div class="jb-skill-item ${active}" data-skill-id="${skill.id}">
    <span style="font-size:12px;color:#ccc;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${skill.builtin ? '📦' : '📄'} ${skill.name}</span>
    <span style="font-size:10px;color:#888;flex:0 0 auto;max-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${(skill.description || '').substring(0,14)}</span>
    <span style="display:flex;gap:2px;flex-shrink:0;">
      <button class="jb-skill-edit-btn" data-skill-id="${skill.id}" style="background:none;border:none;color:#999;cursor:pointer;font-size:11px;padding:1px 3px;" title="编辑">✏️</button>
      ${skill.builtin ? '' : '<button class="jb-skill-remove" data-skill-id="' + skill.id + '" style="background:none;border:none;color:#999;cursor:pointer;font-size:11px;padding:1px 3px;" title="删除">✕</button>'}
    </span>
  </div>`;
}

function bindSkillEvents() {
  document.querySelectorAll('.jb-skill-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.skillId;
      globalState.currentSkillId = id;
      document.querySelectorAll('.jb-skill-item').forEach(e => e.classList.remove('active'));
      el.classList.add('active');
      // 按需加载 skill 内容
      const skill = globalState.skills.find(s => s.id === id);
      if (skill && skill.dir && !skill.system_prompt) {
        showToast('⏳ 加载 Skill...');
        loadSkillContent(skill).then(() => {
          showToast('✅ 已加载: ' + skill.name);
        }).catch(() => {
          showToast('⚠️ Skill 加载失败');
        });
      } else {
        showToast('✅ 已选择 Skill: ' + (skill?.name || id));
      }
    });
  });
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
  // 编辑 skill（如果内容未加载，先加载再打开编辑器）
  document.querySelectorAll('.jb-skill-edit-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.skillId;
      const skill = globalState.skills.find(s => s.id === id);
      if (!skill) return;
      if (skill.dir && !skill.system_prompt) {
        showToast('⏳ 加载 Skill...');
        await loadSkillContent(skill);
      }
      showSkillEditor(skill);
    });
  });

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
        delete skill.dir;   // 上传的 skill 没有目录结构
        delete skill.refs;
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
  document.getElementById('jb-new-skill')?.addEventListener('click', () => {
    const name = '未命名-' + Date.now();
    globalState.skills.push({
      id: name, name: name, description: '新建文本', builtin: false,
      version: '1.0', output_format: 'text', system_prompt: ''
    });
    saveUserSkills();
    renderSkillPanel();
    // 自动打开编辑器
    const s = globalState.skills.find(x => x.id === name);
    if (s) showSkillEditor(s);
  });

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

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showSkillEditor(skill) {
  var old = document.getElementById('jb-editor-panel');
  if (old) old.remove();
  var panel = document.createElement('div');
  panel.id = 'jb-editor-panel';
  panel.style.cssText = 'position:fixed;z-index:1000010;width:560px;height:420px;background:#1A1A1A;border:2px solid #FF0055;border-radius:6px;display:flex;flex-direction:column;box-shadow:4px 4px 20px rgba(0,0,0,0.6);';
  panel.style.top = Math.max(40, Math.round((window.innerHeight - 420) / 2)) + 'px';
  panel.style.left = Math.max(40, Math.round((window.innerWidth - 560) / 2)) + 'px';
  panel.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:linear-gradient(135deg,#FF0055,#CC0044);cursor:grab;border-radius:4px 4px 0 0;flex-shrink:0;user-select:none;">' +
      '<span style="color:#fff;font-size:14px;font-weight:bold;">\u270f\ufe0f ' + escHtml(skill.name) + '</span>' +
      '<button class="jb-edit-close" style="background:none;border:none;color:#fff;font-size:16px;cursor:pointer;padding:0 4px;">\u2715</button>' +
    '</div>' +
    '<div style="flex:1;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:6px;">' +
      '<input class="jb-edit-name" value="' + escHtml(skill.name) + '" style="width:100%;padding:5px 8px;background:#0D0D0D;color:#fff;border:1px solid #333;border-radius:4px;font-size:13px;box-sizing:border-box;">' +
      '<input class="jb-edit-desc" value="' + escHtml(skill.description || '') + '" placeholder="\u63cf\u8ff0" style="width:100%;padding:5px 8px;background:#0D0D0D;color:#fff;border:1px solid #333;border-radius:4px;font-size:12px;box-sizing:border-box;">' +
      '<textarea class="jb-edit-prompt" style="flex:1;min-height:150px;background:#0D0D0D;color:#ccc;border:1px solid #333;border-radius:4px;padding:8px;font-size:12px;font-family:monospace;resize:none;box-sizing:border-box;"></textarea>' +
    '</div>' +
    '<div style="display:flex;gap:6px;justify-content:flex-end;padding:8px 10px;border-top:1px solid #333;flex-shrink:0;">' +
      '<button class="jb-edit-close" style="background:none;border:1px solid #FF0055;color:#FF0055;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:11px;">\u53d6\u6d88</button>' +
      '<button class="jb-edit-save" style="background:#FF0055;color:#fff;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:bold;">\u4fdd\u5b58</button>' +
    '</div>' +
    '<div class="jb-edit-resize" style="position:absolute;bottom:0;right:0;width:16px;height:16px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,#FF0055 50%);"></div>';
  document.body.appendChild(panel);
  panel.querySelector('.jb-edit-prompt').value = skill.system_prompt || '';

  // 拖拽移动
  panel.querySelector('div[style*="cursor:grab"]').onmousedown = function(e) {
    if (e.target.tagName === 'BUTTON') return;
    var sx = e.clientX - panel.offsetLeft, sy = e.clientY - panel.offsetTop;
    function mv(ev) { panel.style.left = (ev.clientX - sx) + 'px'; panel.style.top = (ev.clientY - sy) + 'px'; }
    function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  };

  // 调整大小
  panel.querySelector('.jb-edit-resize').onmousedown = function(e) {
    e.stopPropagation();
    var sw = panel.offsetWidth, sh = panel.offsetHeight, sx = e.clientX, sy = e.clientY;
    function mv(ev) { panel.style.width = Math.max(300, sw + ev.clientX - sx) + 'px'; panel.style.height = Math.max(250, sh + ev.clientY - sy) + 'px'; }
    function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  };

  // 关闭
  panel.querySelectorAll('.jb-edit-close').forEach(function(b) { b.onclick = function() { panel.remove(); }; });

  // 保存
  panel.querySelector('.jb-edit-save').onclick = function() {
    var name = panel.querySelector('.jb-edit-name').value.trim();
    var prompt = panel.querySelector('.jb-edit-prompt').value;
    if (!name || !prompt) { showToast('\u26a0\ufe0f \u540d\u79f0\u548c Prompt \u4e0d\u80fd\u4e3a\u7a7a'); return; }
    skill.name = name;
    skill.description = panel.querySelector('.jb-edit-desc').value.trim();
    skill.system_prompt = prompt;
    if (skill.builtin) {
      var copy = { ...skill, id: skill.name + '-' + Date.now(), builtin: false };
      globalState.skills.push(copy);
      showToast('\u2705 \u5df2\u4fdd\u5b58\u4e3a\u81ea\u5b9a\u4e49\u526f\u672c');
    }
    saveUserSkills(); renderSkillPanel(); panel.remove();
  };
}