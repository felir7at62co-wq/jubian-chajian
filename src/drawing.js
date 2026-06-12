// jubianai - drawing tool (img + canvas overlay)
var _drawingState = null;

function openDrawingTool(item) {
  if (!item || !item.name) return;
  // 必须要有原始文件（非缩略图）才能画图
  if (!(item.file instanceof File || item.file instanceof Blob)) {
    showToast('需先上传图片到资产池才能画图');
    return;
  }
  var src = URL.createObjectURL(item.file);

  var img = new Image();
  img.onload = function() {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#111;z-index:1000003;display:flex;flex-direction:column;';

    overlay.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;background:#1a1a1a;color:#fff;flex-shrink:0;">' +
        '<button class="jb-draw-back" style="background:none;border:none;color:#fff;font-size:16px;cursor:pointer;">Back</button>' +
        '<span style="font-size:14px;font-weight:bold;">' + item.name + '</span>' +
        '<button class="jb-draw-save" style="background:#4caf50;color:#fff;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:bold;">Save</button>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:4px;padding:6px 16px;background:#2a2a2a;color:#fff;flex-shrink:0;flex-wrap:wrap;font-size:12px;">' +
        '<button class="jb-tool active" data-tool="pen" style="background:#2196f3;color:#fff;border:none;padding:3px 8px;border-radius:3px;cursor:pointer;">Pen</button>' +
        '<button class="jb-tool" data-tool="eraser" style="background:#555;color:#fff;border:none;padding:3px 8px;border-radius:3px;cursor:pointer;">Erase</button>' +
        '<span style="color:#666;">|</span>' +
        '<button class="jb-draw-undo" style="background:#555;color:#fff;border:none;padding:3px 8px;border-radius:3px;cursor:pointer;">Undo</button>' +
        '<span style="color:#666;">|</span>' +
        'Size <input type="range" class="jb-size" min="1" max="30" value="4" style="width:50px;vertical-align:middle;">' +
        '<input type="color" class="jb-color" value="#FF0000" style="width:28px;height:20px;border:none;padding:0;cursor:pointer;vertical-align:middle;">' +
        'Alpha <input type="range" class="jb-alpha" min="5" max="100" value="100" style="width:40px;vertical-align:middle;">' +
      '</div>' +
      '<div id="jb-stage" style="flex:1;overflow:hidden;position:relative;background:#000;">' +
        '<img class="jb-stage-img" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;">' +
        '<canvas class="jb-stage-canvas" style="position:absolute;top:0;left:0;width:100%;height:100%;cursor:crosshair;"></canvas>' +
      '</div>';

    document.body.appendChild(overlay);

    var stage = overlay.querySelector('#jb-stage');
    var canvas = overlay.querySelector('.jb-stage-canvas');
    var imgEl = overlay.querySelector('.jb-stage-img');
    imgEl.src = img.src; // show original image via browser engine (sharp)

    function resizeCanvas() {
      var rect = stage.getBoundingClientRect();
      canvas.width = Math.round(rect.width);
      canvas.height = Math.round(rect.height);
    }

    // Initial resize and re-resize on window change
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    var ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    var st = {
      tool: 'pen', size: 4, alpha: 1, color: '#FF0000',
      drawing: false, img: img, canvas: canvas, ctx: ctx,
      undoStack: [canvas.toDataURL()], imgEl: imgEl, stage: stage, resizeFn: resizeCanvas
    };
    _drawingState = st;

    // Tool buttons
    overlay.querySelectorAll('.jb-tool').forEach(function(b) {
      b.onclick = function() {
        overlay.querySelectorAll('.jb-tool').forEach(function(x) { x.style.background = '#555'; });
        b.style.background = '#2196f3';
        st.tool = b.dataset.tool;
      };
    });

    overlay.querySelector('.jb-size').oninput = function() { st.size = parseInt(this.value, 10); };
    overlay.querySelector('.jb-color').oninput = function() { st.color = this.value; };
    overlay.querySelector('.jb-alpha').oninput = function() { st.alpha = parseInt(this.value, 10) / 100; };

    // Drawing
    canvas.onmousedown = function(e) {
      st.drawing = true;
      st.lastX = e.offsetX; st.lastY = e.offsetY;
      ctx.beginPath(); ctx.moveTo(st.lastX, st.lastY);
    };
    canvas.onmousemove = function(e) {
      if (!st.drawing) return;
      ctx.globalAlpha = st.alpha;
      ctx.strokeStyle = st.color;
      ctx.lineWidth = st.size;
      if (st.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = st.size * 3;
      } else {
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.lineTo(e.offsetX, e.offsetY);
      ctx.stroke();
    };
    canvas.onmouseup = function() {
      if (!st.drawing) return;
      st.drawing = false;
      ctx.closePath();
      ctx.globalCompositeOperation = 'source-over';
      st.undoStack.push(canvas.toDataURL());
      if (st.undoStack.length > 30) st.undoStack.shift();
    };
    canvas.onmouseleave = function() { if (st.drawing) { st.drawing = false; ctx.closePath(); } };

    // Undo: use Image to restore (dimension-independent)
    overlay.querySelector('.jb-draw-undo').onclick = function() {
      if (st.undoStack.length < 2) return; // keep at least 1 (initial state)
      st.undoStack.pop(); // discard current
      var prev = st.undoStack[st.undoStack.length - 1];
      var tmp = new Image();
      tmp.onload = function() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
      };
      tmp.src = prev;
    };

    // Close
    overlay.querySelector('.jb-draw-back').onclick = function() {
      window.removeEventListener('resize', resizeCanvas);
      overlay.remove();
      _drawingState = null;
      if (!(item.file instanceof File || item.file instanceof Blob)) {
        URL.revokeObjectURL(img.src);
      }
    };

    // Save: composite at original resolution
    overlay.querySelector('.jb-draw-save').onclick = function() {
      var merged = document.createElement('canvas');
      var nw = st.img.naturalWidth, nh = st.img.naturalHeight;
      merged.width = nw;
      merged.height = nh;
      var mctx = merged.getContext('2d');
      // Draw original image
      mctx.drawImage(st.img, 0, 0, nw, nh);
      // Draw user strokes scaled to original size
      mctx.drawImage(st.canvas, 0, 0, nw, nh);
      merged.toBlob(function(blob) {
        var baseName = item.name.replace(/\.[^.]+$/, '');
        var newFile = new File([blob], baseName + '_draw.png', { type: 'image/png' });
        var id = baseName + '_draw-' + Date.now();
        var reader = new FileReader();
        reader.onload = function(e) {
          var d = e.target.result;
          var saveCat = item.category || 'characters';
          globalState.assets[saveCat].push({
            id: id, name: baseName + '_draw', dataURL: d, file: newFile, category: 'characters'
          });
          if (typeof saveThumbnailToDB === 'function') {
            saveThumbnailToDB(id, saveCat, d, baseName + '_draw');
          }
          if (typeof renderAssetPanel === 'function') renderAssetPanel();
          showToast('Saved');
        };
        reader.readAsDataURL(newFile);
        window.removeEventListener('resize', resizeCanvas);
        overlay.remove();
        _drawingState = null;
      });
    };
  };
  img.onerror = function() { showToast('Image load failed'); };
  img.src = src;
}
