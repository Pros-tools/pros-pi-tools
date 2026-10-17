/*
 * プロスピA「試練アイテム所持数」画面のスクリーンショット読み取り
 *
 * 画面は3行×5列。行は 閃き/証、開眼/指南、真価/極意書。列は 印（共通）、剛力、俊敏、技巧、心。
 * 各マスの下の黒い帯に、所持数が白い数字で表示される。
 *
 * 入力: ImageData 互換オブジェクト { width, height, data(RGBA) }
 * 出力: { values: [[5個]×3行], confidence } 。この画面でなければ null。
 * 座標は iPhone（幅1179px）基準。幅が違う画像は比率で換算する。
 */
(function (global) {
  'use strict';

  var CONFIG = {
    baseWidth: 1179,
    // 各列の数字の帯（黒）の横の範囲
    columns: [[60, 265], [275, 480], [490, 692], [702, 905], [915, 1120]],
    white: 170,              // 数字の白
    holeWhite: 200,          // 穴を探すときの白（輪郭のぼかしで小さな穴がふさがらないよう厳しめ）
    dark: 45,                // 帯の黒
    darkRatio: 0.6,          // 数字の行で、帯の黒が占める割合の下限
    bandHeight: [18, 40],    // 数字の高さ
    rowPitch: [240, 285]     // 行どうしの間隔（検証画像では262px）
  };

  var ROWS = [
    { common: '閃きの印', kei: '証' },
    { common: '開眼の印', kei: '指南' },
    { common: '真価の印', kei: '極意書' }
  ];
  var KEI = ['剛', '俊', '技', '心'];

  var PROTOTYPES = null; // 下で設定

  function minAt(img, x, y) {
    var i = (y * img.width + x) * 4, d = img.data;
    return Math.min(d[i], d[i + 1], d[i + 2]);
  }
  function maxAt(img, x, y) {
    var i = (y * img.width + x) * 4, d = img.data;
    return Math.max(d[i], d[i + 1], d[i + 2]);
  }

  // 5列すべてで「黒い帯の上に白い画素がある」行の連続区間を探す
  function findBands(img, s) {
    var cols = CONFIG.columns.map(function (c) { return [Math.round(c[0] * s), Math.round(c[1] * s)]; });
    var bands = [], start = -1;
    for (var y = 0; y < img.height; y++) {
      var all = cols.every(function (c) {
        var w = 0, dk = 0;
        for (var x = c[0]; x < c[1]; x++) {
          if (minAt(img, x, y) > CONFIG.white) w++;
          else if (maxAt(img, x, y) < CONFIG.dark) dk++;
        }
        return w > 0 && dk / (c[1] - c[0]) > CONFIG.darkRatio;
      });
      if (all && start < 0) start = y;
      if (!all && start >= 0) {
        var h = y - start;
        if (h >= CONFIG.bandHeight[0] * s && h <= CONFIG.bandHeight[1] * s) bands.push([start, y - 1]);
        start = -1;
      }
    }
    return bands;
  }

  // 3行が決まった間隔で並んでいる組を選ぶ
  function pickRows(bands, s) {
    for (var i = 0; i + 2 < bands.length; i++) {
      var d1 = bands[i + 1][0] - bands[i][0], d2 = bands[i + 2][0] - bands[i + 1][0];
      var ok = function (d) { return d >= CONFIG.rowPitch[0] * s && d <= CONFIG.rowPitch[1] * s; };
      if (ok(d1) && ok(d2)) return bands.slice(i, i + 3);
    }
    return null;
  }

  // 数字の並び方。数字どうしが重なって描かれるため、すき間では区切れない。
  // 検証画像（幅1179px、数字の高さ約28px）では、1文字あたり「1」は11px、それ以外は18pxずつ右にずれ、
  // 各文字の幅はずれ幅＋6px。全体の幅 = ずれ幅の合計 + 6px。
  var GLYPH = { advWide: 18, advOne: 11, overlap: 6, tolerance: 3, maxDigits: 6,
    inset: 4,          // 隣の文字と重なる左右の端を、特徴から除く幅
    shift: 2,          // 文字の位置を左右に探す幅
    widthPenalty: 0.05 // 全体の幅が候補とずれているときの減点（1pxあたり、2乗）
  };

  // マス内の白い数字の左右の端
  function digitSpan(img, x0, x1, y0, y1) {
    var L = -1, R = -1;
    for (var x = x0; x < x1; x++) {
      for (var y = y0; y <= y1; y++) {
        if (minAt(img, x, y) > CONFIG.white) { if (L < 0) L = x; R = x; break; }
      }
    }
    return L < 0 ? null : [L, R];
  }

  // 全体の幅に合う「桁数と、どこが1か」の候補をすべて挙げる。ones[i] が true なら i 桁目は「1」
  function layouts(width, u) {
    var A = GLYPH.advWide * u, B = GLYPH.advOne * u, C = GLYPH.overlap * u, out = [];
    out.err = [];
    for (var n = 1; n <= GLYPH.maxDigits; n++) {
      for (var mask = 0; mask < (1 << n); mask++) {
        var ones = [], k = 0;
        for (var i = 0; i < n; i++) { var one = !!(mask & (1 << i)); ones.push(one); if (one) k++; }
        var pred = A * (n - k) + B * k + C;
        if (Math.abs(width - pred) <= GLYPH.tolerance * u) { out.push(ones); out.err.push((width - pred) / u); }
      }
    }
    return out;
  }

  // 候補の並びから、1文字ずつの横の範囲を出す
  function slots(L, ones, u) {
    var x = L, out = [];
    ones.forEach(function (one) {
      var adv = (one ? GLYPH.advOne : GLYPH.advWide) * u, inset = GLYPH.inset * u, end = x + adv + GLYPH.overlap * u;
      // [形を見る左端, 右端, 文字全体の左端, 右端]
      out.push([Math.round(x + inset), Math.round(end - inset) - 1, Math.round(x), Math.round(end) - 1]);
      x += adv;
    });
    return out;
  }

  // 白い部分に囲まれた穴（0,4,6,8,9 の輪）の数と、穴の縦位置（0=上〜1=下）
  function holes(mask, w, h) {
    var seen = new Uint8Array((w + 2) * (h + 2));
    var W = w + 2, H = h + 2;
    var bg = function (x, y) { return x === 0 || y === 0 || x === W - 1 || y === H - 1 || !mask[(y - 1) * w + (x - 1)]; };
    var fill = function (sx, sy) {
      var stack = [[sx, sy]], n = 0, sumY = 0;
      seen[sy * W + sx] = 1;
      while (stack.length) {
        var p = stack.pop(), x = p[0], y = p[1];
        n++; sumY += y;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          var nx = x + d[0], ny = y + d[1];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) return;
          var k = ny * W + nx;
          if (!seen[k] && bg(nx, ny)) { seen[k] = 1; stack.push([nx, ny]); }
        });
      }
      return { n: n, cy: sumY / n };
    };
    fill(0, 0); // 外側の背景
    var list = [];
    for (var y = 1; y < H - 1; y++) for (var x = 1; x < W - 1; x++) {
      if (!seen[y * W + x] && bg(x, y)) {
        var r = fill(x, y);
        if (r.n >= 4) list.push((r.cy - 1) / h);
      }
    }
    return list;
  }

  var HOLE_WEIGHT = 3;

  // 1文字の特徴。形は端を削った範囲 [x0,x1]、穴は文字全体の範囲 [hx0,hx1] で見る
  function digitFeatures(img, x0, x1, y0, y1, hx0, hx1) {
    if (hx0 === undefined) { hx0 = x0; hx1 = x1; }
    var minY = 1e9, maxY = -1, x, y;
    for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) {
      if (minAt(img, x, y) > CONFIG.white) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    var w = x1 - x0 + 1, h = maxY - minY + 1;
    var mask = new Uint8Array(w * h);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) mask[y * w + x] = minAt(img, x0 + x, minY + y) > CONFIG.white ? 1 : 0;
    var COLS = 5, ROWS7 = 7, v = [];
    for (var r = 0; r < ROWS7; r++) for (var q = 0; q < COLS; q++) {
      var ya = Math.floor(r * h / ROWS7), yb = Math.max(ya + 1, Math.floor((r + 1) * h / ROWS7));
      var xa = Math.floor(q * w / COLS), xb = Math.max(xa + 1, Math.floor((q + 1) * w / COLS));
      var on = 0, n = 0;
      for (y = ya; y < yb; y++) for (x = xa; x < xb; x++) { n++; on += mask[y * w + x]; }
      v.push(on / n);
    }
    v.push(w / h);
    var hw = hx1 - hx0 + 1, hmask = new Uint8Array(hw * h);
    for (y = 0; y < h; y++) for (x = 0; x < hw; x++) hmask[y * hw + x] = minAt(img, hx0 + x, minY + y) > CONFIG.holeWhite ? 1 : 0;
    var hl = holes(hmask, hw, h);
    v.push(HOLE_WEIGHT * (hl.length >= 1 ? 1 : 0));
    v.push(HOLE_WEIGHT * (hl.length >= 2 ? 1 : 0));
    v.push(HOLE_WEIGHT * (hl.length === 1 ? hl[0] : 0.5));
    return v;
  }

  // 6 は検証画像に無いため、9 を180度回した形として作る
  function rotate180(p) {
    var grid = p.slice(0, 35).reverse();
    var holeY = p[38];
    return grid.concat([p[35], p[36], p[37], p[36] && !p[37] ? HOLE_WEIGHT - holeY : holeY]);
  }

  function dist(p, v) {
    var d = 0;
    for (var i = 0; i < p.length; i++) d += (p[i] - v[i]) * (p[i] - v[i]);
    return d;
  }

  // 1文字を判定する。feats は位置を少しずつずらした特徴の候補（並びの規則で決めた位置は
  // 前の文字によって数pxずれるため）。one が true なら「1」、false なら「1」以外から選ぶ
  function classify(feats, one, noZero) {
    var best = null, bestD = 1e9;
    for (var k in PROTOTYPES) {
      if (one !== (k === '1')) continue;
      if (noZero && k === '0') continue;
      for (var j = 0; j < feats.length; j++) {
        var d = dist(PROTOTYPES[k], feats[j]);
        if (d < bestD) { bestD = d; best = k; }
      }
    }
    return { digit: best === null ? (one ? '1' : '?') : best, d: best === null ? 0 : bestD };
  }

  // noZero: 2桁以上の数の先頭は0にならない

  // 位置をずらした特徴の候補を作る
  function shiftedFeatures(img, r, x1, y0, y1, u) {
    var out = [], m = Math.round(GLYPH.shift * u);
    for (var dx = -m; dx <= m; dx++) {
      out.push(digitFeatures(img, r[0] + dx, Math.min(r[1] + dx, x1 - 1), y0, y1, r[2] + dx, Math.min(r[3] + dx, x1 - 1)));
    }
    return out;
  }

  // 1マスを読む。並びの候補ごとに各文字を判定し、最も当てはまる候補を選ぶ
  // u は画像の倍率（幅1179pxで1）。数字の帯の高さは1px単位でぶれるので、大きさの基準にしない
  function readCell(img, x0, x1, y0, y1, u) {
    var span = digitSpan(img, x0, x1, y0, y1);
    if (!span) return null;
    var best = null;
    var cands = layouts(span[1] - span[0] + 1, u);
    cands.forEach(function (ones, ci) {
      var text = '', total = 0, sl = slots(span[0], ones, u);
      sl.forEach(function (r, i) {
        var res = classify(shiftedFeatures(img, r, x1, y0, y1, u), ones[i], i === 0 && sl.length > 1);
        text += res.digit; total += res.d;
      });
      var score = total + GLYPH.widthPenalty * cands.err[ci] * cands.err[ci];
      if (!best || score < best.score) best = { text: text, score: score, slots: sl, ones: ones };
    });
    return best;
  }

  function analyze(img) {
    var s = img.width / CONFIG.baseWidth;
    var rows = pickRows(findBands(img, s), s);
    if (!rows) return null;
    var values = [], worst = 0, cells = [];
    rows.forEach(function (band, r) {
      var line = [];
      CONFIG.columns.forEach(function (c, ci) {
        var x0 = Math.round(c[0] * s), x1 = Math.round(c[1] * s);
        var res = readCell(img, x0, x1, band[0], band[1], s);
        line.push(res ? parseInt(res.text, 10) : null);
        if (res && res.score > worst) worst = res.score;
        cells.push({ row: r, col: ci, x0: x0, x1: x1, y0: band[0], y1: band[1], read: res });
      });
      values.push(line);
    });
    return { values: values, worstScore: worst, cells: cells, bands: rows, scale: s };
  }

  // 読み取り結果を ProspiCalc の所持素材の形 { kei: {剛:{証,指南,極意書},…}, common: {…} } に移す
  function toOwned(values, owned) {
    ROWS.forEach(function (row, r) {
      if (values[r][0] !== null) owned.common[row.common] = values[r][0];
      KEI.forEach(function (k, i) {
        if (values[r][i + 1] !== null) owned.kei[k][row.kei] = values[r][i + 1];
      });
    });
    return owned;
  }

  function setPrototypes(p) {
    PROTOTYPES = {};
    for (var k in p) PROTOTYPES[k] = p[k];
    if (PROTOTYPES['9'] && !p['6']) PROTOTYPES['6'] = rotate180(PROTOTYPES['9']);
  }

  // 各数字の特徴（形の5列×7行の塗りつぶし率、縦横比、穴の数と位置）。正解データの所持素材画像4枚の平均から作成
  // （test/tools/train_materials.js で作り直せる）。6 も実物から作成（無いときだけ 9 から作る）。
  setPrototypes({
    "0": [0.268, 0.885, 1, 0.961, 0.455, 0.965, 0.746, 0.259, 0.417, 0.993, 1, 0.162, 0, 0, 0.773, 1, 0.048, 0, 0, 0.724, 1, 0.14, 0, 0, 0.737, 0.982, 0.658, 0.048, 0.268, 0.98, 0.386, 0.825, 1, 0.925, 0.553, 0.585, 3, 0, 1.443],
    "1": [0, 0.084, 0.714, 0.925, 0.566, 0.871, 0.942, 0.96, 0.98, 0.775, 0.063, 0.234, 0.891, 0.98, 0.79, 0, 0.018, 0.866, 0.973, 0.737, 0, 0.018, 0.871, 0.973, 0.792, 0, 0.009, 0.848, 0.955, 0.772, 0, 0, 0.786, 0.926, 0.574, 0.364, 0, 0, 1.5],
    "2": [0.303, 0.875, 1, 0.986, 0.578, 0.927, 0.663, 0.264, 0.396, 0.948, 0.375, 0.056, 0, 0.045, 0.901, 0, 0, 0.194, 0.747, 0.846, 0.142, 0.677, 0.983, 0.684, 0.141, 0.861, 0.955, 0.24, 0.014, 0, 0.986, 1, 0.993, 0.993, 0.979, 0.589, 0, 0, 1.5],
    "3": [0.067, 0.715, 0.993, 1, 0.753, 0.688, 0.833, 0.167, 0.118, 0.854, 0.042, 0.021, 0, 0.104, 0.854, 0, 0, 0.215, 0.903, 0.99, 0.16, 0.049, 0, 0.014, 0.615, 0.965, 0.743, 0.083, 0.049, 0.656, 0.285, 0.799, 0.993, 0.972, 0.786, 0.586, 0, 0, 1.5],
    "4": [0, 0, 0.278, 0.965, 0.864, 0, 0.106, 0.871, 0.894, 0.886, 0.045, 0.758, 0.561, 0.341, 0.864, 0.636, 0.712, 0.053, 0.303, 0.864, 0.985, 0.697, 0.492, 0.735, 0.966, 0.477, 0.485, 0.492, 0.712, 0.994, 0, 0, 0, 0.273, 0.949, 0.585, 3, 0, 1.374],
    "5": [0.419, 1, 1, 1, 1, 0.681, 0.792, 0.319, 0.313, 0.307, 0.792, 0.812, 0.472, 0.458, 0.198, 0.785, 0.806, 0.542, 0.625, 0.943, 0, 0, 0, 0, 0.693, 0.736, 0.41, 0.007, 0.069, 0.818, 0.486, 0.847, 0.931, 0.944, 0.656, 0.591, 0, 0, 1.5],
    "6": [0.093, 0.704, 0.981, 1, 0.708, 0.75, 0.833, 0.153, 0.194, 0.76, 1, 0.528, 0.389, 0.417, 0.156, 1, 0.931, 0.556, 0.639, 1, 1, 0.333, 0, 0, 0.698, 0.958, 0.569, 0, 0.042, 0.823, 0.25, 0.847, 0.944, 0.917, 0.708, 0.593, 3, 0, 1.974],
    "7": [1, 1, 1, 1, 1, 0.295, 0.295, 0.295, 0.447, 0.994, 0, 0, 0.061, 0.788, 0.58, 0, 0.008, 0.629, 0.902, 0.102, 0, 0.242, 0.992, 0.447, 0, 0.008, 0.644, 0.97, 0.121, 0, 0.023, 0.909, 0.758, 0, 0, 0.585, 0, 0, 1.5],
    "8": [0.148, 0.704, 0.986, 1, 0.736, 0.778, 0.861, 0.139, 0.083, 0.875, 0.625, 0.903, 0.292, 0.208, 0.885, 0.403, 1, 0.875, 0.861, 1, 1, 0.694, 0.014, 0, 0.573, 1, 0.806, 0.097, 0.056, 0.688, 0.278, 0.778, 0.944, 1, 0.76, 0.578, 3, 3, 1.5],
    "9": [0.199, 0.795, 1, 0.985, 0.588, 0.859, 0.808, 0.237, 0.263, 0.851, 0.949, 0.487, 0, 0, 0.649, 0.801, 0.878, 0.385, 0.365, 0.894, 0.122, 0.487, 0.654, 0.59, 0.861, 0.41, 0.365, 0.013, 0.115, 0.817, 0.378, 0.865, 0.891, 0.885, 0.606, 0.591, 3, 0, 0.918]
  });

  global.ProspiMaterials = {
    CONFIG: CONFIG,
    analyze: analyze,
    toOwned: toOwned,
    _digitFeatures: digitFeatures,
    _digitSpan: digitSpan,
    _slots: slots,
    _shiftedFeatures: shiftedFeatures,
    _classify: classify,
    GLYPH: GLYPH,
    _setPrototypes: setPrototypes,
    _rotate180: rotate180
  };
})(typeof window !== 'undefined' ? window : this);
