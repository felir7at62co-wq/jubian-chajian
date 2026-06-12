// src/state.js
let globalState = {
  skills: [],
  skillFolders: [],
  assets: { characters: [], scenes: [], props: [] },
  assetFolders: { characters: [], scenes: [], props: [] },
  models: [
    { name: 'ARK 内置', url: 'https://ark.cn-beijing.volces.com/api/coding/v1/chat/completions', key: 'aeb39cba-856b-483d-aca1-1b22becb09dc', model: 'doubao-seed-2-0-code-preview-260215', builtin: true }
  ],
  currentSkillId: null,
  _arkApiKey: '' // 运行时 API Key 缓存
};

function showToast(msg) {
  let t = document.getElementById('jb-toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'jb-toast';
    t.id = 'jb-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('jb-show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('jb-show'), 3000);
}
