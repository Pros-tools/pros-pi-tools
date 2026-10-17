/*
 * 所持コインの読み取り
 *
 * 特殊能力の画面（選手一覧・試練アイテム所持数のどちらも）の左上、「能力習得選手選択」の上にある数字。
 * 数字は1文字ずつすき間があり、右寄せで表示される。試練アイテム所持数の画面では暗く表示される。
 *
 * 数字の判定は、穴の数と位置・上下の横棒・左右の線といった構造で行う（書体によらない判定）。
 * 入力: ImageData 互換オブジェクト { width, height, data(RGBA) }
 * 出力: { value, digits } 。読めなければ null。
 * 座標は iPhone（幅1179px）基準。幅が違う画像は比率で換算する。
 */
(function (global) {
  'use strict';

  var CONFIG = {
    baseWidth: 1179,
    box: { x: [200, 395], y: [242, 285] }, // コインの数字を探す範囲（黒い帯の内側。7桁まで入る）
    minBrightness: 60,     // 数字の明るさの下限（これより暗ければ数字が無いとみなす）
    threshold: 0.6,        // 範囲内で一番明るい画素に対する、数字とみなす明るさの割合
    digitHeight: [24, 44], // 数字の高さ
    rightEdge: [378, 394], // 最後の文字の右端（右寄せ）
    leftClear: [186, 199], // 黒い帯の内側の左端。ここに文字があればコインではない（「能力習得選手選択」などの見出し）
    searchHeight: 0.5      // 上から探す範囲（画像の幅に対する割合）
  };

  function minAt(img, x, y) {
    var i = (y * img.width + x) * 4, d = img.data;
    return Math.min(d[i], d[i + 1], d[i + 2]);
  }

  // ---- 1文字の判定（mask は w×h の 0/1） ----
  function holes(mask, w, h) {
    var W = w + 2, H = h + 2, seen = new Uint8Array(W * H);
    var bg = function (x, y) { return x === 0 || y === 0 || x === W - 1 || y === H - 1 || !mask[(y - 1) * w + (x - 1)]; };
    var fill = function (sx, sy) {
      var stack = [sx, sy], n = 0, sumY = 0, minY = 1e9, maxY = -1;
      seen[sy * W + sx] = 1;
      while (stack.length) {
        var y = stack.pop(), x = stack.pop();
        n++; sumY += y; if (y < minY) minY = y; if (y > maxY) maxY = y;
        var nb = [x + 1, y, x - 1, y, x, y + 1, x, y - 1];
        for (var i = 0; i < 8; i += 2) {
          var nx = nb[i], ny = nb[i + 1];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          var k = ny * W + nx;
          if (!seen[k] && bg(nx, ny)) { seen[k] = 1; stack.push(nx, ny); }
        }
      }
      return { n: n, cy: (sumY / n - 1) / h, height: (maxY - minY + 1) / h };
    };
    fill(0, 0);
    var list = [];
    for (var y = 1; y < H - 1; y++) for (var x = 1; x < W - 1; x++) {
      if (!seen[y * W + x] && bg(x, y)) {
        var r = fill(x, y);
        if (r.n >= Math.max(4, w * h * 0.01)) list.push(r); // ごく小さい穴は輪郭のぼかしによるものとして無視
      }
    }
    return list;
  }

  // 横の帯 [ya,yb)（0〜1）× 縦の帯 [xa,xb)（0〜1）に線があるか（塗りの割合）
  function ink(mask, w, h, xa, xb, ya, yb) {
    var x0 = Math.floor(xa * w), x1 = Math.max(x0 + 1, Math.ceil(xb * w));
    var y0 = Math.floor(ya * h), y1 = Math.max(y0 + 1, Math.ceil(yb * h));
    var on = 0, n = 0;
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { n++; on += mask[y * w + x]; }
    return on / n;
  }

  // 横の帯の中で、線のある列の割合（横棒の長さ）
  function span(mask, w, h, ya, yb) {
    var y0 = Math.floor(ya * h), y1 = Math.max(y0 + 1, Math.ceil(yb * h)), cols = 0;
    for (var x = 0; x < w; x++) {
      for (var y = y0; y < y1; y++) if (mask[y * w + x]) { cols++; break; }
    }
    return cols / w;
  }

  // 縦にほぼ途切れない線（「1」や「4」の縦棒）の左端の列。無ければ -1
  function stemLeft(mask, w, h) {
    var y0 = Math.floor(0.05 * h), y1 = Math.ceil(0.95 * h);
    for (var x = 0; x < w; x++) {
      var on = 0;
      for (var y = y0; y < y1; y++) on += mask[y * w + x];
      if (on / (y1 - y0) >= 0.92) return x;
    }
    return -1;
  }

  // 横の帯の各行で、一番長い横の連なり（幅に対する割合）の最大値
  function maxRun(mask, w, h, ya, yb) {
    var best = 0;
    for (var y = Math.floor(ya * h); y < Math.ceil(yb * h); y++) {
      var run = 0;
      for (var x = 0; x < w; x++) {
        run = mask[y * w + x] ? run + 1 : 0;
        if (run > best) best = run;
      }
    }
    return best / w;
  }

  function classifyMask(mask, w, h) {
    var aspect = w / h;
    var hl = holes(mask, w, h);
    if (hl.length >= 2) return '8';
    if (hl.length === 1) {
      var hole = hl[0];
      // 4 の下の方は右寄りの縦線だけ。0・6・9 は下の方に左右に広がる曲線がある
      if (ink(mask, w, h, 0, 0.35, 0.85, 1) < 0.05 && span(mask, w, h, 0.88, 1) < 0.5) return '4';
      if (hole.height > 0.42) return '0';
      return hole.cy < 0.5 ? '9' : '6';
    }
    // 穴が無い: 1, 2, 3, 5, 7
    if (aspect < 0.45) return '1';
    var sx = stemLeft(mask, w, h);
    if (sx > 0 && ink(mask, w, h, 0, (sx - 1) / w, 0.45, 1) < 0.03) return '1';
    // 2 は下が平らな横棒で左下の角まで埋まり、その上（下から2〜4割）の線は左寄り。
    // 3・5 は同じ高さで右側にふくらみがある
    if (ink(mask, w, h, 0, 0.25, 0.88, 1) > 0.5 && ink(mask, w, h, 0, 1, 0.9, 1) > 0.6 &&
        ink(mask, w, h, 0, 0.45, 0.6, 0.8) > ink(mask, w, h, 0.55, 1, 0.6, 0.8)) return '2';
    // 7 は上が横棒で、下半分には横に長い線が無い
    if (span(mask, w, h, 0, 0.1) > 0.75 && maxRun(mask, w, h, 0.55, 0.95) < 0.45) return '7';
    // 3 と 5: 上から2〜4割の高さで、線が左にあれば 5、右にあれば 3
    var upLeft = ink(mask, w, h, 0, 0.3, 0.2, 0.4), upRight = ink(mask, w, h, 0.7, 1, 0.2, 0.4);
    return upLeft > upRight ? '5' : '3';
  }

  // ---- 画面からコインの数字を探して読む ----
  // 縦の位置 y0 から高さ box の範囲でコインの数字を読む。数字の列らしくなければ null
  function readAt(img, s, y0) {
    var x0 = Math.round(CONFIG.box.x[0] * s), x1 = Math.round(CONFIG.box.x[1] * s);
    var y1 = Math.round(y0 + (CONFIG.box.y[1] - CONFIG.box.y[0]) * s);
    if (y1 >= img.height || x1 >= img.width) return null;
    var maxB = 0, x, y;
    for (y = y0; y < y1; y++) for (x = x0; x < x1; x++) { var v = minAt(img, x, y); if (v > maxB) maxB = v; }
    if (maxB < CONFIG.minBrightness) return null;
    var t = maxB * CONFIG.threshold;
    var on = function (x, y) { return minAt(img, x, y) > t; };

    // 文字を列のすき間で区切る
    var segs = [], st = -1;
    for (x = x0; x <= x1; x++) {
      var col = false;
      if (x < x1) for (y = y0; y < y1 && !col; y++) col = on(x, y);
      if (col) { if (st < 0) st = x; }
      else if (st >= 0) { segs.push([st, x - 1]); st = -1; }
    }
    if (!segs.length) return null;
    // コインは右寄せ。最後の文字の右端が決まった位置に来る
    var right = segs[segs.length - 1][1];
    if (right < CONFIG.rightEdge[0] * s || right > CONFIG.rightEdge[1] * s) return null;

    var digits = '', heights = [], tops = [], bottoms = [];
    for (var i = 0; i < segs.length; i++) {
      var a = segs[i][0], b = segs[i][1], top = 1e9, bottom = -1;
      for (y = y0; y < y1; y++) for (x = a; x <= b; x++) if (on(x, y)) { if (y < top) top = y; if (y > bottom) bottom = y; }
      var w = b - a + 1, h = bottom - top + 1;
      if (h < CONFIG.digitHeight[0] * s || h > CONFIG.digitHeight[1] * s) return null;
      // 範囲の上下の端にかかっている＝数字が範囲からはみ出している
      if (top <= y0 || bottom >= y1 - 1) return null;
      var mask = new Uint8Array(w * h);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) mask[y * w + x] = on(a + x, top + y) ? 1 : 0;
      digits += classifyMask(mask, w, h);
      heights.push(h); tops.push(top); bottoms.push(bottom);
    }
    // 高さと上下の位置がそろっていなければ数字の列ではない
    var spread = function (v) { return Math.max.apply(null, v) - Math.min.apply(null, v); };
    if (spread(heights) > 3 * s || spread(tops) > 3 * s || spread(bottoms) > 3 * s) return null;
    // 左隣（コインのマーク側）に同じ明るさの文字があれば、コインではない（見出しの文字など）
    var top0 = Math.min.apply(null, tops), bot0 = Math.max.apply(null, bottoms);
    var lx0 = Math.round(CONFIG.leftClear[0] * s), lx1 = Math.round(CONFIG.leftClear[1] * s);
    for (y = top0; y <= bot0; y++) for (x = lx0; x < lx1; x++) if (on(x, y)) return null;
    if (digits.length > 1 && digits[0] === '0') return null;
    return { value: parseInt(digits, 10), digits: digits, top: top0 };
  }

  // 画面の上の方を縦にずらしながら探す（スクリーンショットの上が切り取られていても読めるように）。
  // まず通常の位置を試す
  function analyze(img) {
    var s = img.width / CONFIG.baseWidth;
    var r = readAt(img, s, Math.round(CONFIG.box.y[0] * s));
    if (r) return r;
    var limit = Math.min(img.height, img.width * CONFIG.searchHeight);
    for (var y = 0; y < limit; y += Math.max(1, Math.round(2 * s))) {
      r = readAt(img, s, y);
      if (r) return r;
    }
    return null;
  }

  global.ProspiCoin = { CONFIG: CONFIG, analyze: analyze, classifyMask: classifyMask };
})(typeof window !== 'undefined' ? window : this);
