// ページ上部の帯のメニュー（三本線のボタン）の開け閉め
(function () {
  var button = document.querySelector('.menu-button');
  var menu = document.getElementById('site-menu');
  if (!button || !menu) return;

  function setOpen(open) {
    menu.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
  }

  button.addEventListener('click', function (e) {
    e.stopPropagation();
    setOpen(menu.hidden);
  });
  // メニューの外を押す・Escキーで閉じる
  document.addEventListener('click', function (e) {
    if (!menu.hidden && !menu.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !menu.hidden) {
      setOpen(false);
      button.focus();
    }
  });
})();
