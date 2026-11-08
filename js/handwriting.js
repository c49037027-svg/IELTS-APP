// 手寫板：給 iPad + Apple Pencil 手抄單字用的畫布。
// 只管「畫」—— 筆跡、橫線、描紅底字、復原；抄哪個字、抄幾遍由 js/vocab.js 決定。
//
// 設計重點
// - Pointer Events：Apple Pencil 在 Safari 是 pointerType = 'pen'，有壓力值；
//   滑鼠與手指也能寫，所以沒有 Pencil 的電腦／手機一樣用得了。
// - 防手掌誤觸：偵測到第一次 Pencil 之後，手指的觸碰就不再留下筆跡
//   （手掌靠在螢幕上寫字是常態）。要用手指寫可以關掉這個行為。
// - 筆跡存成向量（點陣列），不是點陣圖：旋轉 iPad、視窗縮放、換 devicePixelRatio
//   都能整張重畫，不會糊掉；復原也只是拿掉最後一筆再重畫。
const Handwriting = (() => {
  const ROW_COLORS = {
    base: 'rgba(120, 100, 85, .55)',   // 基線：寫字貼著它
    mid: 'rgba(120, 100, 85, .22)',    // x 高度線（虛線）
    top: 'rgba(120, 100, 85, .12)',    // 上緣線
    trace: 'rgba(120, 100, 85, .22)',  // 描紅用的底字
    ink: '#2f2a26'
  };
  // iPad 內建的手寫風字體在前；沒有的系統退回 cursive。離線時不能靠網路字體。
  const TRACE_FONT = '"Bradley Hand", "Segoe Print", "Noteworthy", "Comic Sans MS", cursive';

  function createPad(canvas, opts = {}) {
    const rows = opts.rows || 6;
    const rowHeight = opts.rowHeight || 96;
    const ctx = canvas.getContext('2d');
    let strokes = [];
    let current = null;            // 正在寫的那一筆
    let guide = opts.guide || '';  // 描紅底字（空字串 = 不描）
    let penSeen = false;
    let fingerOk = false;          // true = 就算有 Pencil 手指也能寫
    let width = 0;
    const onChange = opts.onChange || (() => {});

    const height = rows * rowHeight;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      width = Math.max(240, Math.round(canvas.parentElement.clientWidth || canvas.clientWidth || 600));
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render();
    }

    function drawRuledLines() {
      for (let r = 0; r < rows; r++) {
        const y0 = r * rowHeight;
        const base = y0 + rowHeight * 0.72;
        const mid = y0 + rowHeight * 0.42;
        const top = y0 + rowHeight * 0.14;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.strokeStyle = ROW_COLORS.top;
        line(0, top, width, top);
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = ROW_COLORS.mid;
        line(0, mid, width, mid);
        ctx.setLineDash([]);
        ctx.strokeStyle = ROW_COLORS.base;
        ctx.lineWidth = 1.5;
        line(0, base, width, base);
        // 描紅：每一行都淡淡印一個字，沿著它寫
        if (guide) {
          ctx.fillStyle = ROW_COLORS.trace;
          ctx.font = `${Math.round(rowHeight * 0.58)}px ${TRACE_FONT}`;
          ctx.textBaseline = 'alphabetic';
          ctx.fillText(guide, 16, base - 2, width - 32);
        }
      }
      ctx.setLineDash([]);
    }

    function line(x1, y1, x2, y2) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // 筆壓：Pencil 用實際壓力；滑鼠與手指沒有壓力，固定中等粗細
    const widthFor = p => 1.2 + 2.6 * (p > 0 ? p : 0.5);

    function drawSegment(a, b) {
      ctx.strokeStyle = ROW_COLORS.ink;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = widthFor((a[2] + b[2]) / 2);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }

    function drawStroke(stroke) {
      const pts = stroke.pts;
      if (pts.length === 1) {   // 點一下 = 一個點（i 的點、句號）
        ctx.fillStyle = ROW_COLORS.ink;
        ctx.beginPath();
        ctx.arc(pts[0][0], pts[0][1], widthFor(pts[0][2]) / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      for (let i = 1; i < pts.length; i++) drawSegment(pts[i - 1], pts[i]);
    }

    function render() {
      ctx.clearRect(0, 0, width, height);
      drawRuledLines();
      strokes.forEach(drawStroke);
      if (current) drawStroke(current);
    }

    // ---------------------------------------------------------- 輸入
    const point = (e, rect) => [e.clientX - rect.left, e.clientY - rect.top, e.pressure || 0];

    // 這個指標該不該畫？Pencil 一出現就記住，之後手指一律不畫（防手掌）
    function accepts(e) {
      if (e.pointerType === 'pen') { penSeen = true; return true; }
      if (e.pointerType === 'touch' && penSeen && !fingerOk) return false;
      return true;
    }

    canvas.addEventListener('pointerover', e => { if (e.pointerType === 'pen') penSeen = true; });

    canvas.addEventListener('pointerdown', e => {
      if (!accepts(e)) return;
      // Pencil 落筆時如果手指的筆跡還在畫（手掌先碰到），丟掉那一筆
      if (current && current.type !== 'pen' && e.pointerType === 'pen') current = null;
      if (current) return;
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* 合成事件沒有 pointer */ }
      const rect = canvas.getBoundingClientRect();
      current = { type: e.pointerType, id: e.pointerId, pts: [point(e, rect)] };
      render();
    });

    canvas.addEventListener('pointermove', e => {
      if (e.pointerType === 'pen') penSeen = true;
      if (!current || e.pointerId !== current.id) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      // 一幀裡 Pencil 可能送來好幾個點，全收才不會有稜角
      const events = (e.getCoalescedEvents && e.getCoalescedEvents().length)
        ? e.getCoalescedEvents() : [e];
      events.forEach(ev => {
        const p = point(ev, rect);
        const last = current.pts[current.pts.length - 1];
        current.pts.push(p);
        drawSegment(last, p);   // 只補畫新的一小段，不整張重畫
      });
    });

    function finish(e) {
      if (!current || e.pointerId !== current.id) return;
      if (current.pts.length) strokes.push(current);
      current = null;
      onChange(strokes.length);
    }
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', e => {
      // 系統手勢（例如手掌誤觸被 iPadOS 接管）取消的那一筆不算
      if (current && e.pointerId === current.id) { current = null; render(); }
    });

    // iPad 長按會跳選單、拖曳會選取文字，書寫時都不要
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    window.addEventListener('resize', resize);
    resize();

    return {
      get strokeCount() { return strokes.length; },
      get penDetected() { return penSeen; },
      getStrokes: () => strokes,
      setStrokes(list) { strokes = list || []; current = null; render(); onChange(strokes.length); },
      undo() { if (strokes.length) { strokes.pop(); render(); onChange(strokes.length); } },
      clear() { strokes = []; current = null; render(); onChange(0); },
      setGuide(text) { guide = text || ''; render(); },
      allowFinger(on) { fingerOk = !!on; },
      isFingerAllowed: () => fingerOk,
      /** 畫布上有沒有任何筆跡（測試與「寫好了」的判斷用） */
      hasInk: () => strokes.length > 0 || !!current,
      resize,
      destroy() { window.removeEventListener('resize', resize); }
    };
  }

  return { createPad };
})();
