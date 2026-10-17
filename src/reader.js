/*
 * プロスピA「能力習得選手選択」画面のスクリーンショット読み取り
 *
 * 入力: ImageData 互換オブジェクト { width, height, data(RGBA) }
 * 出力: 選手ごとの [系統, 現在Lv] ×3 と、読み取れなかった選手の情報
 *
 * ゲーム内の画像は持たず、色と形の特徴だけで判定する。
 * 座標は iPhone（幅1179px）基準。幅が違う画像は比率で換算する。
 */
(function (global) {
  'use strict';

  // ---- 設定（画面の変更に合わせてここを直す） ----
  var CONFIG = {
    baseWidth: 1179,
    icon: {
      leftX: [318, 322],     // アイコン左枠を探す列
      rightX: [375, 380],    // アイコン右枠を探す列
      runMin: 46,            // 完全に見えているアイコンの枠の長さ（px）
      runMax: 56,
      innerX: [324, 372],    // 系統の色を数える範囲
      innerY: [4, 46]        // アイコン上端からの範囲
    },
    rowGap: [60, 80],        // 同じ選手の行どうしの間隔
    lv: { x: [754, 800], y: [2, 46], white: 170, dashMaxHeight: 9 },
    name: { x: [125, 300], y: [132, 170] },
    abilityBar: { x: [450, 690], y: [12, 44] },
    backButton: { x: [20, 200], color: { rMin: 200, gMin: 120, bMax: 100 }, ratio: 0.5 },
    dedupThreshold: 8        // 検証データ: 同じ選手は最大3.5、別の選手は最小14.7
  };

  var KEI = ['剛', '技', '俊', '心'];

  // 数字1〜5の形の特徴（5列×7行の塗りつぶし率）。検証用画像の平均から作成。
  var DIGIT_PROTOTYPES = null; // 下で設定

  function px(img, x, y) {
    var i = (y * img.width + x) * 4, d = img.data;
    return [d[i], d[i + 1], d[i + 2]];
  }

  function isColored(c) {
    var mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
    return mx - mn > 60 && mx > 100;
  }

  function hue(c) {
    var r = c[0], g = c[1], b = c[2];
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d === 0) return 0;
    var h;
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    return h < 0 ? h + 360 : h;
  }

  // 列範囲 [x0,x1) のどこかに色付き画素がある行の、連続区間を返す
  function coloredRuns(img, s, xr) {
    var x0 = Math.round(xr[0] * s), x1 = Math.round(xr[1] * s);
    var runs = [], start = -1;
    for (var y = 0; y < img.height; y++) {
      var on = false;
      for (var x = x0; x < x1 && !on; x++) on = isColored(px(img, x, y));
      if (on && start < 0) start = y;
      if (!on && start >= 0) { runs.push([start, y - 1]); start = -1; }
    }
    if (start >= 0) runs.push([start, img.height - 1]);
    return runs;
  }

  // 行の基準位置（アイコン左枠の縦線の上端）を探す。
  // 左右の枠が両方とも完全な長さで見えているものだけを採用し、画面端で切れたアイコンは捨てる。
  // 切れたアイコンを捨てると、その選手は3行そろわないので「読み取れない」扱いになる。
  function findIcons(img, s) {
    var c = CONFIG.icon, min = c.runMin * s, max = c.runMax * s;
    var left = coloredRuns(img, s, c.leftX), right = coloredRuns(img, s, c.rightX);
    var tops = [];
    left.forEach(function (L) {
      var len = L[1] - L[0] + 1;
      var R = right.filter(function (r) { return Math.abs(r[0] - L[0]) <= 4 * s; })[0];
      if (len >= min && len <= max && R && (R[1] - R[0] + 1) >= min - 4 * s) tops.push(L[0]);
    });
    return tops;
  }

  function classifyKei(img, s, top) {
    var c = CONFIG.icon, counts = [0, 0, 0, 0];
    for (var y = Math.round(top + c.innerY[0] * s); y < top + c.innerY[1] * s; y++) {
      for (var x = Math.round(c.innerX[0] * s); x < c.innerX[1] * s; x++) {
        var p = px(img, x, y);
        if (!isColored(p)) continue;
        var h = hue(p);
        if (h < 25 || h >= 345) counts[0]++;
        else if (h >= 65 && h < 165) counts[1]++;
        else if (h >= 175 && h < 255) counts[2]++;
        else if (h >= 275 && h < 345) counts[3]++;
      }
    }
    var best = 0;
    for (var i = 1; i < 4; i++) if (counts[i] > counts[best]) best = i;
    var total = counts[0] + counts[1] + counts[2] + counts[3];
    return { kei: KEI[best], confidence: total ? counts[best] / total : 0 };
  }

  // Lv表示の数字部分から特徴を取り出す
  function lvFeatures(img, s, top) {
    var c = CONFIG.lv;
    var x0 = Math.round(c.x[0] * s), x1 = Math.round(c.x[1] * s);
    var y0 = Math.round(top + c.y[0] * s), y1 = Math.round(top + c.y[1] * s);
    var minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, x, y;
    var mask = function (x, y) {
      var p = px(img, x, y);
      return Math.min(p[0], p[1], p[2]) > c.white;
    };
    for (y = y0; y < y1; y++) for (x = x0; x < x1; x++) {
      if (mask(x, y)) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return null;
    var w = maxX - minX + 1, h = maxY - minY + 1;
    if (h <= c.dashMaxHeight * s) return { dash: true };
    var COLS = 5, ROWS = 7, v = [];
    for (var r = 0; r < ROWS; r++) for (var q = 0; q < COLS; q++) {
      var ya = minY + Math.floor(r * h / ROWS), yb = minY + Math.floor((r + 1) * h / ROWS);
      var xa = minX + Math.floor(q * w / COLS), xb = minX + Math.floor((q + 1) * w / COLS);
      var on = 0, n = 0;
      for (y = ya; y < Math.max(yb, ya + 1); y++) for (x = xa; x < Math.max(xb, xa + 1); x++) { n++; if (mask(x, y)) on++; }
      v.push(on / n);
    }
    v.push(w / h); // 縦横比（「1」が細いことを使う）
    return { dash: false, v: v };
  }

  function classifyLv(img, s, top) {
    var f = lvFeatures(img, s, top);
    if (!f) return { lv: null, confidence: 0 };
    if (f.dash) return { lv: 0, confidence: 1 };
    var best = null, bestD = 1e9, second = 1e9;
    for (var k in DIGIT_PROTOTYPES) {
      var p = DIGIT_PROTOTYPES[k], d = 0;
      for (var i = 0; i < p.length; i++) d += (p[i] - f.v[i]) * (p[i] - f.v[i]);
      if (d < bestD) { second = bestD; bestD = d; best = +k; }
      else if (d < second) second = d;
    }
    return { lv: best, confidence: second > 0 ? 1 - bestD / second : 1 };
  }

  // 重複判定用の縮小画像（グレースケール）
  function thumb(img, s, xr, yr, top, cols, rows) {
    var out = [];
    var x0 = xr[0] * s, x1 = xr[1] * s, y0 = top + yr[0] * s, y1 = top + yr[1] * s;
    for (var r = 0; r < rows; r++) for (var q = 0; q < cols; q++) {
      var sum = 0, n = 0;
      var ya = Math.round(y0 + r * (y1 - y0) / rows), yb = Math.round(y0 + (r + 1) * (y1 - y0) / rows);
      var xa = Math.round(x0 + q * (x1 - x0) / cols), xb = Math.round(x0 + (q + 1) * (x1 - x0) / cols);
      for (var y = ya; y < yb; y += 2) for (var x = xa; x < xb; x += 2) {
        if (y < 0 || y >= img.height) continue;
        var p = px(img, x, y); sum += (p[0] + p[1] + p[2]) / 3; n++;
      }
      out.push(n ? sum / n : 0);
    }
    return out;
  }

  // 「戻る」ボタンの上端（見つからなければ画像の高さ）
  function findBackButtonTop(img, s) {
    var c = CONFIG.backButton, x0 = Math.round(c.x[0] * s), x1 = Math.round(c.x[1] * s);
    for (var y = Math.round(img.height * 0.6); y < img.height; y++) {
      var on = 0;
      for (var x = x0; x < x1; x++) {
        var p = px(img, x, y);
        if (p[0] > c.color.rMin && p[1] > c.color.gMin && p[2] < c.color.bMax) on++;
      }
      if (on / (x1 - x0) > c.ratio) return y;
    }
    return img.height;
  }

  function analyze(img) {
    var s = img.width / CONFIG.baseWidth;
    var icons = findIcons(img, s);
    var backTop = findBackButtonTop(img, s);

    // 行を選手ごとにまとめる（同じ選手の行は約70px間隔、次の選手までは約127px）
    var groups = [], cur = null;
    icons.forEach(function (y) {
      if (cur && y - cur[cur.length - 1].y <= CONFIG.rowGap[1] * s) cur.push({ y: y });
      else { cur = [{ y: y }]; groups.push(cur); }
    });

    var players = [], unreadable = [];
    groups.forEach(function (g) {
      var top = g[0].y;
      if (g.length !== 3) {
        unreadable.push({ top: top, reason: '画面の端で切れている' });
        return;
      }
      if (top + CONFIG.name.y[1] * s > backTop) {
        unreadable.push({ top: top, reason: '「戻る」ボタンで選手名が隠れている' });
        return;
      }
      var rows = g.map(function (r) {
        var k = classifyKei(img, s, r.y), l = classifyLv(img, s, r.y);
        return { kei: k.kei, lv: l.lv, keiConfidence: k.confidence, lvConfidence: l.confidence, top: r.y };
      });
      var sig = thumb(img, s, CONFIG.name.x, CONFIG.name.y, top, 16, 4);
      rows.forEach(function (r) { sig = sig.concat(thumb(img, s, CONFIG.abilityBar.x, CONFIG.abilityBar.y, r.top, 16, 3)); });
      players.push({ top: top, rows: rows, signature: sig });
    });
    return { players: players, unreadable: unreadable, scale: s };
  }

  function signatureDistance(a, b) {
    var d = 0;
    for (var i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    return d / a.length;
  }

  function samePlayer(a, b) {
    for (var i = 0; i < 3; i++) {
      if (a.rows[i].kei !== b.rows[i].kei || a.rows[i].lv !== b.rows[i].lv) return false;
    }
    return signatureDistance(a.signature, b.signature) < CONFIG.dedupThreshold;
  }

  // 複数枚の結果をまとめ、同じ選手を1人にする
  function merge(results) {
    var out = [];
    results.forEach(function (res, imageIndex) {
      res.players.forEach(function (p) {
        var dup = out.some(function (q) { return samePlayer(p, q); });
        if (!dup) out.push(Object.assign({ imageIndex: imageIndex }, p));
      });
    });
    return out;
  }

  DIGIT_PROTOTYPES = {
    "1": [0, 0, 0, 0.511, 0.993, 0.526, 0.635, 0.853, 1, 1, 0.168, 0.2, 0.216, 0.793, 1, 0, 0, 0, 0.667, 1, 0, 0, 0, 0.667, 1, 0, 0, 0, 0.667, 1, 0, 0, 0, 0.639, 0.982, 0.378],
    "2": [0.075, 0.763, 1, 0.863, 0.23, 0.66, 0.84, 0.312, 0.75, 0.768, 0.55, 0.25, 0, 0.5, 0.92, 0, 0, 0.24, 0.95, 0.52, 0.01, 0.56, 0.96, 0.49, 0, 0.65, 0.95, 0.16, 0, 0, 1, 1, 1, 1, 0.8, 0.647],
    "3": [0.166, 0.745, 0.989, 0.82, 0.229, 0.771, 0.7, 0.051, 0.679, 0.737, 0.143, 0.057, 0.046, 0.65, 0.663, 0, 0, 0.629, 1, 0.417, 0.129, 0.036, 0, 0.443, 0.977, 0.929, 0.629, 0.109, 0.521, 0.931, 0.264, 0.821, 0.966, 0.836, 0.286, 0.634],
    "4": [0, 0, 0.569, 1, 0.35, 0, 0.169, 0.88, 1, 0.4, 0, 0.819, 0.315, 1, 0.4, 0.569, 0.681, 0, 1, 0.4, 1, 0.688, 0.56, 1, 0.735, 0.4, 0.4, 0.44, 1, 0.56, 0, 0, 0, 0.981, 0.2, 0.647],
    "5": [0.388, 0.994, 1, 1, 0.62, 0.5, 0.795, 0.36, 0.36, 0.26, 0.59, 0.67, 0.452, 0.35, 0.024, 0.72, 0.863, 0.544, 0.883, 0.612, 0, 0, 0, 0.335, 0.992, 0.85, 0.495, 0.012, 0.52, 0.916, 0.375, 0.87, 0.948, 0.845, 0.268, 0.651]
  };

  global.ProspiReader = {
    CONFIG: CONFIG,
    analyze: analyze,
    merge: merge,
    samePlayer: samePlayer,
    signatureDistance: signatureDistance,
    _lvFeatures: lvFeatures,
    _setDigitPrototypes: function (p) { DIGIT_PROTOTYPES = p; }
  };
})(typeof window !== 'undefined' ? window : this);
