(function () {
  'use strict';

  var R = window.ProspiReader, C = window.ProspiCalc, M = window.ProspiMaterials, K = window.ProspiCoin;
  var STORAGE_KEY = 'prospi-material-calc-v1';
  var KEI_ORDER = ['剛', '技', '俊', '心'];
  var LV_LABEL = ['Lv.−', 'Lv.1', 'Lv.2', 'Lv.3', 'Lv.4', 'Lv.5'];

  var state = { players: [], owned: C.emptyTable(), ownedCoin: 0 };
  var nextId = 1;

  // ---- 保存と復元（読み取りの照合用データは保存しない） ----
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        owned: state.owned,
        ownedCoin: state.ownedCoin,
        players: state.players.map(function (p) {
          return { thumb: p.thumb, rows: p.rows, checked: p.checked, target: p.target };
        })
      }));
    } catch (e) { /* 保存できなくても計算は続ける */ }
  }

  function restore() {
    try {
      var s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!s) return;
      if (s.owned) {
        // 旧形式（印も系統ごと）の保存データは、系統ごとの素材だけ引き継ぐ
        var kei = s.owned.kei || s.owned, common = s.owned.common || {};
        C.KEI.forEach(function (k) {
          C.KEI_MATERIALS.forEach(function (m) { state.owned.kei[k][m] = (kei[k] && +kei[k][m]) || 0; });
        });
        C.COMMON_MATERIALS.forEach(function (m) { state.owned.common[m] = +common[m] || 0; });
        state.ownedCoin = +s.ownedCoin || 0;
      }
      (s.players || []).forEach(function (p) {
        state.players.push({ id: nextId++, thumb: p.thumb, rows: p.rows, checked: !!p.checked, target: p.target || 5, signature: null });
      });
    } catch (e) { /* 壊れた保存データは無視する */ }
  }

  // ---- 画像の読み取り ----
  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('画像を開けませんでした')); };
      img.src = url;
    });
  }

  function cropThumb(img, scale, top) {
    var sx = 90 * scale, sy = Math.max(0, top - 14 * scale);
    var sw = 1000 * scale, sh = Math.min(img.naturalHeight - sy, 232 * scale);
    var c = document.createElement('canvas');
    c.width = 480; c.height = Math.round(480 * sh / sw);
    c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  }

  function readFiles(files) {
    var status = document.getElementById('read-status');
    var added = 0, dup = 0, unreadable = 0, failed = 0, materials = 0, coin = null;
    var list = Array.prototype.slice.call(files);
    status.textContent = '読み取り中…';

    return list.reduce(function (chain, file, i) {
      return chain.then(function () {
        status.textContent = '読み取り中… (' + (i + 1) + '/' + list.length + ')';
        return loadImage(file).then(function (o) {
          var canvas = document.createElement('canvas');
          canvas.width = o.img.naturalWidth; canvas.height = o.img.naturalHeight;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(o.img, 0, 0);
          var data = ctx.getImageData(0, 0, canvas.width, canvas.height);
          // 「試練アイテム所持数」画面なら所持素材として読む
          // 所持コインはどちらの画面にも出ているので、読めたら入れる（後の画像を優先）
          var c = K.analyze(data);
          if (c) { coin = c.value; state.ownedCoin = c.value; }
          var mat = M.analyze(data);
          if (mat) { applyMaterials(o.img, mat); materials++; URL.revokeObjectURL(o.url); return; }
          var res = R.analyze(data);
          unreadable += res.unreadable.length;
          res.players.forEach(function (p) {
            var exists = state.players.some(function (q) { return isSameAsExisting(p, q); });
            if (exists) { dup++; return; }
            state.players.push({
              id: nextId++,
              thumb: cropThumb(o.img, res.scale, p.top),
              rows: p.rows.map(function (r) { return { kei: r.kei, lv: r.lv === null ? 0 : r.lv }; }),
              checked: false, target: 5,
              signature: p.signature,
              // samePlayer 用（系統とLvは読み取り時の値で照合する）
              _readRows: p.rows.map(function (r) { return { kei: r.kei, lv: r.lv }; })
            });
            added++;
          });
          URL.revokeObjectURL(o.url);
        }).catch(function () { failed++; });
      });
    }, Promise.resolve()).then(function () {
      var msg = '';
      if (added || dup || unreadable) msg += added + '人を読み取りました。';
      if (dup) msg += '重複した' + dup + '人は除きました。';
      if (unreadable) msg += '画面の端で切れている・名前が隠れているなどで読み取れなかった選手が' + unreadable + '人います（別の画像に全体が写っていれば読み取れます）。';
      if (failed) msg += failed + '枚の画像を開けませんでした。';
      if (!msg && !materials && coin === null) msg = '選手も所持素材も見つかりませんでした。「能力習得選手選択」画面か「試練アイテム所持数」画面のスクリーンショットか確認してください。';
      status.textContent = msg;
      if (materials || coin !== null) renderOwned();
      render();
      return { materials: materials, players: added + dup + unreadable };
    });
  }

  // 所持素材の読み取り結果を入力欄に入れ、確認用に読み取った部分の画像を出す
  function applyMaterials(img, mat) {
    M.toOwned(mat.values, state.owned);
    var s = mat.scale, top = Math.max(0, mat.bands[0][0] - 200 * s);
    var bottom = Math.min(img.naturalHeight, mat.bands[2][1] + 12 * s);
    var sx = 40 * s, sw = 1100 * s, sh = bottom - top;
    var c = document.createElement('canvas');
    c.width = 600; c.height = Math.round(600 * sh / sw);
    c.getContext('2d').drawImage(img, sx, top, sw, sh, 0, 0, c.width, c.height);
    var thumb = document.getElementById('owned-thumb');
    thumb.src = c.toDataURL('image/jpeg', 0.85);
    thumb.hidden = false;
    var missing = mat.values.reduce(function (n, row) { return n + row.filter(function (v) { return v === null; }).length; }, 0);
    document.getElementById('owned-status').textContent = '画像から所持素材を入力しました。下の表の数字が画像と合っているか確認し、違うときは直してください。' +
      (missing ? '読み取れなかった' + missing + 'か所は、元の数のままです。' : '');
  }

  // 既に一覧にいる選手か。手で直した後でも判定がぶれないよう、読み取り時の値で照合する
  function isSameAsExisting(p, q) {
    if (!q.signature) return false;
    return R.samePlayer(p, { rows: q._readRows, signature: q.signature });
  }

  // ---- 表示 ----
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function select(options, value, onChange, cls) {
    var s = el('select', cls);
    options.forEach(function (o) {
      var opt = el('option', null, o.label);
      opt.value = o.value;
      if (String(o.value) === String(value)) opt.selected = true;
      s.appendChild(opt);
    });
    s.addEventListener('change', function () { onChange(s.value); });
    return s;
  }

  function isMaxed(p) { return p.rows.every(function (r) { return r.lv >= 5; }); }

  function renderPlayers() {
    var list = document.getElementById('player-list');
    var tpl = document.getElementById('player-template');
    list.innerHTML = '';
    state.players.forEach(function (p) {
      var node = tpl.content.firstElementChild.cloneNode(true);
      var cb = node.querySelector('.pick-input');
      cb.checked = p.checked;
      cb.disabled = isMaxed(p);
      if (isMaxed(p)) node.querySelector('.pick-label').textContent = 'すべてLv.5';
      cb.addEventListener('change', function () { p.checked = cb.checked; update(); });
      node.classList.toggle('checked', p.checked);

      var img = node.querySelector('.thumb');
      if (p.thumb) img.src = p.thumb;
      else { img.remove(); node.querySelector('.rows-label').textContent = '手入力'; }

      var rows = node.querySelector('.rows');
      p.rows.forEach(function (r, i) {
        var line = el('div', 'row');
        line.appendChild(el('span', 'row-no', String(i + 1)));
        line.appendChild(select(KEI_ORDER.map(function (k) { return { value: k, label: k + '（' + C.KEI_LABEL[k] + '）' }; }),
          r.kei, function (v) { r.kei = v; render(); }, 'kei kei-' + r.kei));
        line.appendChild(select(LV_LABEL.map(function (l, n) { return { value: n, label: l }; }),
          r.lv, function (v) { r.lv = +v; render(); }, 'lv'));
        rows.appendChild(line);
      });

      var target = node.querySelector('.target');
      target.value = String(p.target);
      target.addEventListener('change', function () { p.target = +target.value; update(); });
      node.querySelector('.remove').addEventListener('click', function () {
        state.players = state.players.filter(function (q) { return q !== p; });
        render();
      });
      list.appendChild(node);
    });
    document.getElementById('empty-players').hidden = state.players.length > 0;
  }

  function numberInput(obj, key, label) {
    var input = el('input');
    input.type = 'number'; input.inputMode = 'numeric'; input.min = '0';
    input.value = obj[key] || '';
    input.placeholder = '0';
    input.setAttribute('aria-label', label);
    input.addEventListener('input', function () {
      obj[key] = Math.max(0, parseInt(input.value, 10) || 0);
      update(true);
    });
    return input;
  }

  // 素材の表（所持素材表示順.png の並び）。行は「印 / 系統ごとの素材」の組、
  // 列は 印（共通）・剛力・俊敏・技巧・心。
  var TABLE_ROWS = [
    { label: '閃き / 証', common: '閃きの印', kei: '証' },
    { label: '開眼 / 指南', common: '開眼の印', kei: '指南' },
    { label: '真価 / 極意書', common: '真価の印', kei: '極意書' }
  ];

  // cell(td, group, kei, material) でセルの中身を入れる（group は 'kei' か 'common'）
  function renderMaterialTable(table, cell) {
    table.innerHTML = '';
    table.appendChild(headerRow());
    TABLE_ROWS.forEach(function (row) {
      var tr = el('tr');
      tr.appendChild(el('th', null, row.label));
      var td = el('td', 'common-cell'); cell(td, 'common', null, row.common); tr.appendChild(td);
      C.KEI.forEach(function (k) { var t = el('td'); cell(t, 'kei', k, row.kei); tr.appendChild(t); });
      table.appendChild(tr);
    });
  }

  function renderOwned() {
    var coinInput = document.getElementById('owned-coin');
    coinInput.value = state.ownedCoin || '';
    renderMaterialTable(document.getElementById('owned-table'),
      function (td, group, k, m) {
        if (group === 'kei') td.appendChild(numberInput(state.owned.kei[k], m, C.KEI_LABEL[k] + 'の' + m));
        else td.appendChild(numberInput(state.owned.common, m, m));
      });
  }

  function headerRow() {
    var tr = el('tr');
    tr.appendChild(el('th', null, ''));
    tr.appendChild(el('th', 'kei-head', '印'));
    C.KEI.forEach(function (k) { tr.appendChild(el('th', 'kei-head kei-' + k, C.KEI_LABEL[k])); });
    return tr;
  }

  function renderResult() {
    var abilities = [];
    state.players.forEach(function (p) {
      if (!p.checked) return;
      p.rows.forEach(function (r) { if (r.lv < p.target) abilities.push({ kei: r.kei, lv: r.lv, target: p.target }); });
    });
    var res = C.calculate(abilities), bal = C.balance(res.need, state.owned);
    document.getElementById('coin-total').textContent = res.coin.toLocaleString('ja-JP');
    var cb = state.ownedCoin - res.coin, cbEl = document.getElementById('coin-balance');
    document.getElementById('coin-owned').textContent = state.ownedCoin.toLocaleString('ja-JP');
    cbEl.textContent = (cb > 0 ? '+' : '') + cb.toLocaleString('ja-JP');
    cbEl.className = 'bal' + (cb < 0 ? ' short' : '');

    renderMaterialTable(document.getElementById('result-table'),
      function (td, group, k, m) {
        var need = group === 'kei' ? res.need.kei[k][m] : res.need.common[m];
        var b = group === 'kei' ? bal.kei[k][m] : bal.common[m];
        td.appendChild(el('div', 'need', String(need)));
        td.appendChild(el('div', 'bal' + (b < 0 ? ' short' : ''), (b > 0 ? '+' : '') + b));
      });

    var n = state.players.filter(function (p) { return p.checked; }).length;
    document.getElementById('selected-count').textContent = n + '人を選択中';
  }

  function update(skipPlayers) {
    if (!skipPlayers) {
      // チェック状態の見た目だけ更新
      var nodes = document.querySelectorAll('#player-list .player');
      state.players.forEach(function (p, i) { if (nodes[i]) nodes[i].classList.toggle('checked', p.checked); });
    }
    renderResult();
    save();
  }

  function render() {
    renderPlayers();
    renderResult();
    save();
  }

  // ---- 操作 ----
  document.getElementById('file-input').addEventListener('change', function (e) {
    if (e.target.files.length) readFiles(e.target.files).then(function () { e.target.value = ''; });
  });
  document.getElementById('owned-file-input').addEventListener('change', function (e) {
    if (!e.target.files.length) return;
    readFiles(e.target.files).then(function (r) {
      e.target.value = '';
      if (!r.materials) {
        document.getElementById('owned-status').textContent = '「試練アイテム所持数」画面が見つかりませんでした。画面全体のスクリーンショットか確認してください。';
      }
    });
  });
  document.getElementById('owned-coin').addEventListener('input', function (e) {
    state.ownedCoin = Math.max(0, parseInt(e.target.value, 10) || 0);
    update(true);
  });
  document.getElementById('reset-owned').addEventListener('click', function () {
    if (!confirm('所持素材の数をすべて0に戻しますか？')) return;
    state.owned = C.emptyTable();
    state.ownedCoin = 0;
    document.getElementById('owned-status').textContent = '';
    var thumb = document.getElementById('owned-thumb');
    thumb.hidden = true; thumb.removeAttribute('src');
    renderOwned();
    update(true);
  });
  document.getElementById('select-all').addEventListener('click', function () {
    state.players.forEach(function (p) { if (!isMaxed(p)) p.checked = true; });
    render();
  });
  document.getElementById('select-none').addEventListener('click', function () {
    state.players.forEach(function (p) { p.checked = false; });
    render();
  });
  document.getElementById('add-manual').addEventListener('click', function () {
    state.players.push({ id: nextId++, thumb: null, rows: [{ kei: '剛', lv: 0 }, { kei: '剛', lv: 0 }, { kei: '剛', lv: 0 }], checked: true, target: 5, signature: null });
    render();
  });
  document.getElementById('clear-players').addEventListener('click', function () {
    if (state.players.length && confirm('選手の一覧をすべて消しますか？（所持素材は残ります）')) {
      state.players = [];
      document.getElementById('read-status').textContent = '';
      render();
    }
  });

  restore();
  renderOwned();
  render();
})();
