// 筆跡的壓縮、還原與 SVG 輸出。純函式，不碰畫面也不碰儲存，所以 Node 裡也能測。
//
// 為什麼要壓：Apple Pencil 一秒送來上百個點，原樣存下來一頁就是幾百 KB，
// 幾十個生詞就會塞滿瀏覽器的儲存空間（上限約 5MB，還要跟單字庫共用）。
// 所以存的時候 ——
//   1. 簡化：把幾乎在同一條線上的點拿掉（Ramer–Douglas–Peucker，容許誤差 0.8px，
//      肉眼看不出差別），一個字母從幾十個點變成幾個點
//   2. 取整數座標，且只存「跟前一點的差」，差值大多是個位數，JSON 很短
//   3. 筆壓只存每一筆的平均值（一位數），不逐點存
//
// 一筆壓縮後 = [k, x0, y0, dx1, dy1, dx2, dy2, ...]
//   k 是平均筆壓 0–9；沒有任何位移的一筆（點一下）只有 [k, x0, y0]
const Ink = (() => {
  const EPSILON = 0.8;

  // Ramer–Douglas–Peucker。用堆疊而不是遞迴，長筆畫不會爆呼叫堆疊。
  function simplify(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const keep = new Array(pts.length).fill(false);
    keep[0] = keep[pts.length - 1] = true;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let far = -1, farDist = eps;
      const [ax, ay] = pts[a], [bx, by] = pts[b];
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      for (let i = a + 1; i < b; i++) {
        const [px, py] = pts[i];
        let d;
        if (len2 === 0) d = Math.hypot(px - ax, py - ay);
        else {
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
          d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        }
        if (d > farDist) { far = i; farDist = d; }
      }
      if (far >= 0) { keep[far] = true; stack.push([a, far], [far, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }

  const avgPressure = pts => {
    const ps = pts.map(p => p[2]).filter(p => p > 0);
    return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0.5;
  };

  /** 筆畫（pad 內部的格式：{ pts: [[x, y, pressure], ...] }）→ 壓縮格式。 */
  function compress(strokes) {
    return strokes.filter(s => s && s.pts && s.pts.length).map(s => {
      const k = Math.max(1, Math.min(9, Math.round(avgPressure(s.pts) * 9)));
      const pts = simplify(s.pts, EPSILON).map(p => [Math.round(p[0]), Math.round(p[1])]);
      const out = [k, pts[0][0], pts[0][1]];
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
        if (dx || dy) out.push(dx, dy);   // 取整數之後沒動的點直接丟掉
      }
      return out;
    });
  }

  /** 壓縮格式 → 點的陣列 [[x, y], ...] 與筆壓 k。 */
  function expandOne(c) {
    const pts = [[c[1], c[2]]];
    for (let i = 3; i + 1 < c.length; i += 2) {
      const last = pts[pts.length - 1];
      pts.push([last[0] + c[i], last[1] + c[i + 1]]);
    }
    return { k: c[0], pts };
  }

  const expand = compressed => (compressed || []).map(expandOne);

  /** 壓縮格式 → pad 內部的筆畫（可以接著畫、復原）。 */
  function toPadStrokes(compressed, dx = 0, dy = 0, scale = 1) {
    return expand(compressed).map(({ k, pts }) => ({
      type: 'pen', id: 0,
      pts: pts.map(p => [p[0] * scale + dx, p[1] * scale + dy, k / 9])
    }));
  }

  const widthFor = k => 1.2 + 2.6 * (k / 9);

  function bounds(compressed) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    expand(compressed).forEach(({ pts }) => pts.forEach(([x, y]) => {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }));
    return x0 === Infinity ? null : { x0, y0, x1, y1 };
  }

  /**
   * 壓縮格式 → 一段 inline SVG（複習卡背面、拼字題的線索用）。
   * 只裁出有筆跡的範圍，不會留著整欄的空白；寬度跟著容器縮放。
   */
  function toSvg(compressed, className = 'ink-svg') {
    const b = bounds(compressed);
    if (!b) return '';
    const pad = 6;
    const x = Math.floor(b.x0) - pad, y = Math.floor(b.y0) - pad;
    const w = Math.ceil(b.x1 - b.x0) + pad * 2, h = Math.ceil(b.y1 - b.y0) + pad * 2;
    const paths = expand(compressed).map(({ k, pts }) => {
      const d = pts.length === 1
        ? `M${pts[0][0]} ${pts[0][1]}h.01`   // 一個點：給一小段才會畫出圓點
        : 'M' + pts.map(p => `${p[0]} ${p[1]}`).join('L');
      return `<path d="${d}" stroke-width="${widthFor(k).toFixed(1)}"/>`;
    }).join('');
    // 寬度只縮不放：短短一個字不該被拉大到塞滿整張卡；長的才縮小去配合容器。
    // 0.8 倍是 iPad 上寫的字放到複習卡上剛好讀得清楚、又不會太大的比例。
    const natural = Math.round(w * 0.8);
    return `<svg class="${className}" viewBox="${x} ${y} ${w} ${h}" style="max-width:${natural}px" role="img" aria-label="手寫筆記" `
      + `xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="currentColor" `
      + `stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
  }

  return { compress, expand, toPadStrokes, toSvg, bounds, simplify, widthFor };
})();
