/*
 * 必要素材の計算
 * 出典: 試練素材必要数.png（各Lvに上げるために必要な数）。
 * 証・指南・極意書は系統ごとに別の素材。閃きの印・開眼の印・真価の印は系統によらず共通の素材。
 */
(function (global) {
  'use strict';

  var KEI = ['剛', '俊', '技', '心'];
  var KEI_LABEL = { '剛': '剛力', '俊': '俊敏', '技': '技巧', '心': '心' };
  var KEI_MATERIALS = ['証', '指南', '極意書'];          // 系統ごとの素材
  var COMMON_MATERIALS = ['閃きの印', '開眼の印', '真価の印']; // 共通の素材

  // LEVEL_COST[n] = Lv.n に上げるための素材とコイン（n=1 は習得）
  var LEVEL_COST = {
    1: { '証': 8, '閃きの印': 2, coin: 3000 },
    2: { '証': 8, '指南': 8, '閃きの印': 2, '開眼の印': 2, coin: 5000 },
    3: { '証': 12, '指南': 12, '閃きの印': 3, '開眼の印': 3, coin: 7000 },
    4: { '指南': 16, '極意書': 16, '開眼の印': 4, '真価の印': 4, coin: 10000 },
    5: { '指南': 20, '極意書': 20, '開眼の印': 5, '真価の印': 5, coin: 15000 }
  };

  // { kei: { 剛: {証,指南,極意書}, ... }, common: {閃きの印,開眼の印,真価の印} }
  function emptyTable() {
    var t = { kei: {}, common: {} };
    KEI.forEach(function (k) {
      t.kei[k] = {};
      KEI_MATERIALS.forEach(function (m) { t.kei[k][m] = 0; });
    });
    COMMON_MATERIALS.forEach(function (m) { t.common[m] = 0; });
    return t;
  }

  // abilities: [{ kei, lv(0〜5), target(1〜5) }]
  function calculate(abilities) {
    var need = emptyTable(), coin = 0;
    abilities.forEach(function (a) {
      for (var n = a.lv + 1; n <= a.target; n++) {
        var c = LEVEL_COST[n];
        KEI_MATERIALS.forEach(function (m) { need.kei[a.kei][m] += c[m] || 0; });
        COMMON_MATERIALS.forEach(function (m) { need.common[m] += c[m] || 0; });
        coin += c.coin;
      }
    });
    return { need: need, coin: coin };
  }

  // 所持数 - 必要数（マイナスは不足）
  function balance(need, owned) {
    var t = emptyTable();
    KEI.forEach(function (k) {
      KEI_MATERIALS.forEach(function (m) { t.kei[k][m] = ((owned.kei[k] && owned.kei[k][m]) || 0) - need.kei[k][m]; });
    });
    COMMON_MATERIALS.forEach(function (m) { t.common[m] = (owned.common[m] || 0) - need.common[m]; });
    return t;
  }

  global.ProspiCalc = {
    KEI: KEI, KEI_LABEL: KEI_LABEL, KEI_MATERIALS: KEI_MATERIALS, COMMON_MATERIALS: COMMON_MATERIALS,
    LEVEL_COST: LEVEL_COST, emptyTable: emptyTable, calculate: calculate, balance: balance
  };
})(typeof window !== 'undefined' ? window : this);
