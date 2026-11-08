// 手寫板：給 iPad + Apple Pencil 手抄生詞用的畫布。
// 只管「畫」—— 欄位區塊、橫線、描紅底字、筆跡、復原；抄哪個字由 js/vocab.js 決定。
//
// 一頁 = 一個生詞，分成幾個欄位區塊（單字／解釋／例句／同義詞）：
// 每個區塊有一條標籤列，下面是幾行橫線；行數依那一欄的字數決定，
// 例句長就多給幾行，單字只要一行。
//
// 設計重點
// - Pointer Events：Apple Pencil 在 Safari 是 pointerType = 'pen'，有壓力值；
//   滑鼠與手指也能寫，所以沒有 Pencil 的電腦／手機一樣用得了。
// - 防手掌誤觸：偵測到第一次 Pencil 之後，手指的觸碰就不再留下筆跡
//   （手掌靠在螢幕上寫字是常態）。要用手指寫可以關掉這個行為。
// - 筆跡存成向量（點陣列），不是點陣圖：旋轉 iPad、視窗縮放、換 devicePixelRatio
//   都能整張重畫，不會糊掉；復原也只是拿掉最後一筆再重畫。
const Handwriting = (() => {
  const COLORS = {
    base: 'rgba(120, 100, 85, .55)',   // 基線：寫字貼著它
    mid: 'rgba(120, 100, 85, .22)',    // x 高度線（虛線）
    top: 'rgba(120, 100, 85, .12)',    // 上緣線
    trace: 'rgba(120, 100, 85, .24)',  // 描紅用的底字
    label: 'rgba(120, 100, 85, .85)',
    strip: 'rgba(120, 100, 85, .07)',
    ink: '#2f2a26'
  };
  // iPad 內建的手寫風字體在前；沒有的系統退回 cursive。離線時不能靠網路字體。
  const TRACE_FONT = '"Bradley Hand", "Segoe Print", "Noteworthy", "Comic Sans MS", cursive';
  const LABEL_H = 28;       // 每個區塊頂端的標籤列
  const MAX_ROWS = 6;       // 一個欄位最多給幾行（再長就抄前面那幾行）

  // 手掌與 Pencil 是不同的指標、可能落在同一頁的不同位置，所以「偵測到 Pencil 了」
  // 是整個 App 共用的狀態，不是單一畫布的。
  let penSeen = false;

  // 把一段文字依寬度切成幾行：英文照單字斷，中文每個字都可以斷
  const TOKEN = /[⺀-鿿＀-￯]|[^\s⺀-鿿＀-￯]+|\s+/g;
  function wrapLines(ctx, text, maxWidth) {
    const tokens = String(text || '').match(TOKEN) || [];
    const lines = [];
    let line = '';
    tokens.forEach(tok => {
      const next = line + tok;
      if (line && ctx.measureText(next).width > maxWidth && tok.trim()) {
        lines.push(line.trim());
        line = tok.trim() ? tok : '';
      } else {
        line = next;
      }
    });
    if (line.trim()) lines.push(line.trim());
    return lines;
  }

  function createPad(canvas, opts = {}) {
    const sections = (opts.sections || []).filter(s => s && s.label);
    const rowHeight = opts.rowHeight || 96;
    const ctx = canvas.getContext('2d');
    let strokes = [];
    let current = null;            // 正在寫的那一筆
    let trace = !!opts.trace;      // 描紅：每一行印淡淡的底字
    let fingerOk = false;          // true = 就算有 Pencil 手指也能寫
    let width = 0;
    let height = 0;
    let bands = [];
    const onChange = opts.onChange || (() => {});

    const traceFont = () => `${Math.round(rowHeight * 0.5)}px ${TRACE_FONT}`;

    // 版面：每個區塊 = 標籤列 + 若干行。行數看文字在這個寬度下要折幾行。
    function layout() {
      ctx.font = traceFont();
      let y = 0;
      bands = sections.map(sec => {
        const lines = wrapLines(ctx, sec.text, width - 32);
        const rows = Math.min(MAX_ROWS, Math.max(sec.minRows || 1, lines.length));
        const band = { label: sec.label, text: sec.text, lines, rows, y, height: LABEL_H + rows * rowHeight };
        y += band.height;
        return band;
      });
      height = Math.max(rowHeight, y);
    }

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const next = Math.max(240, Math.round(canvas.parentElement.clientWidth || canvas.clientWidth || 600));
      // 寬度變了（旋轉 iPad）：筆跡的 x 跟著等比例縮放，才不會偏出格子
      if (width && next !== width) {
        const k = next / width;
        strokes.forEach(s => s.pts.forEach(p => { p[0] *= k; }));
      }
      width = next;
      layout();
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render();
    }

    function line(x1, y1, x2, y2) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    function drawBands() {
      bands.forEach(band => {
        // 標籤列
        ctx.fillStyle = COLORS.strip;
        ctx.fillRect(0, band.y, width, LABEL_H);
        ctx.fillStyle = COLORS.label;
        ctx.font = '600 13px system-ui, -apple-system, "PingFang TC", sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(band.label, 14, band.y + LABEL_H / 2 + 1);

        for (let r = 0; r < band.rows; r++) {
          const y0 = band.y + LABEL_H + r * rowHeight;
          const base = y0 + rowHeight * 0.74;
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
          ctx.strokeStyle = COLORS.top;
          line(0, y0 + rowHeight * 0.14, width, y0 + rowHeight * 0.14);
          ctx.setLineDash([6, 6]);
          ctx.strokeStyle = COLORS.mid;
          line(0, y0 + rowHeight * 0.44, width, y0 + rowHeight * 0.44);
          ctx.setLineDash([]);
          ctx.strokeStyle = COLORS.base;
          ctx.lineWidth = 1.5;
          line(0, base, width, base);
          // 描紅：這一欄的字依序印在每一行上，沿著它寫
          if (trace && band.lines[r]) {
            ctx.fillStyle = COLORS.trace;
            ctx.font = traceFont();
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(band.lines[r], 16, base - 2, width - 32);
          }
        }
      });
      ctx.setLineDash([]);
    }

    // 筆壓：Pencil 用實際壓力；滑鼠與手指沒有壓力，固定中等粗細
    const widthFor = p => 1.2 + 2.6 * (p > 0 ? p : 0.5);

    function drawSegment(a, b) {
      ctx.strokeStyle = COLORS.ink;
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
        ctx.fillStyle = COLORS.ink;
        ctx.beginPath();
        ctx.arc(pts[0][0], pts[0][1], widthFor(pts[0][2]) / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      for (let i = 1; i < pts.length; i++) drawSegment(pts[i - 1], pts[i]);
    }

    function render() {
      ctx.clearRect(0, 0, width, height);
      drawBands();
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
      get height() { return height; },
      /** 版面：每個區塊的標籤、行數與位置（測試與除錯用） */
      get bands() { return bands.map(b => ({ label: b.label, rows: b.rows, y: b.y, height: b.height })); },
      getStrokes: () => strokes,
      setStrokes(list) { strokes = list || []; current = null; render(); onChange(strokes.length); },
      undo() { if (strokes.length) { strokes.pop(); render(); onChange(strokes.length); } },
      clear() { strokes = []; current = null; render(); onChange(0); },
      setTrace(on) { trace = !!on; render(); },
      allowFinger(on) { fingerOk = !!on; },
      isFingerAllowed: () => fingerOk,
      /** 畫布上有沒有任何筆跡（「寫好了」要不要亮起來） */
      hasInk: () => strokes.length > 0 || !!current,
      resize,
      destroy() { window.removeEventListener('resize', resize); }
    };
  }

  return { createPad, wrapLines };
})();
