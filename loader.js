// loader.js — 动态代码加载器
// 通过 background scripting API 注入代码到 main world
(function() {

  chrome.runtime.sendMessage({ type: 'GET_CODE' }, function(res) {
    if (!res || !res.js) return;

    // 注入 CSS
    if (res.css && !document.getElementById('jb-dynamic-style')) {
      var style = document.createElement('style');
      style.id = 'jb-dynamic-style';
      style.textContent = res.css;
      document.documentElement.appendChild(style);
    }

    // chrome API 中继（main world → content script → background）
    window.addEventListener('message', function(event) {
      if (event.source !== window || !event.data || event.data.t !== '__call') return;
      var c = event.data;
      switch (c.m) {
        case 'rsm':
          chrome.runtime.sendMessage(c.a[0], function(r) {
            window.postMessage({ t: '__cb', i: c.i, r: r }, '*');
          });
          break;
        case 'slg':
          chrome.storage.local.get(c.a[0], function(r) {
            window.postMessage({ t: '__cb', i: c.i, r: r }, '*');
          });
          break;
        case 'sls':
          chrome.storage.local.set(c.a[0], function() {
            window.postMessage({ t: '__cb', i: c.i, r: null }, '*');
          });
          break;
      }
    });

    // 构建 chrome API 代理（运行在 main world）
    var extId = chrome.runtime.id;
    var proxyCode = [
      '(function(){',
      'var _p={},_id=0;',
      'window.addEventListener("message",function(e){',
        'if(e.source!==window||!e.data||e.data.t!=="__cb")return;',
        'var cb=_p[e.data.i];if(cb){cb(e.data.r);delete _p[e.data.i];}',
      '});',
      'function _c(m,a,cb){var i=++_id;_p[i]=cb;window.postMessage({t:"__call",i:i,m:m,a:a},"*");}',
      'var _c2={};',
      '_c2.runtime={sendMessage:function(m,cb){_c("rsm",[m],cb);},getURL:function(p){return"chrome-extension://'+extId+'/"+p;}};',
      '_c2.storage={local:{get:function(k,cb){_c("slg",[k],cb);},set:function(v,cb){_c("sls",[v],cb||function(){});}}};',
      '_c2.runtime.id="'+extId+'";',
      'try{Object.defineProperty(window,"chrome",{get:function(){return _c2;},configurable:true});}catch(e){window.chrome=_c2;}',
      '})();'
    ].join('');

    // 通过 background scripting API 注入
    chrome.runtime.sendMessage({
      type: 'INJECT_CODE',
      code: res.js,
      proxyCode: proxyCode
    });
  });

})();
