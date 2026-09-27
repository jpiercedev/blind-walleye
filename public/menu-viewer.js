// Tap-to-enlarge viewer for the menu page images, which are too small to read on phones.
// Each .menu-image becomes a keyboard-accessible button that opens a modal <dialog> with the full-resolution
// image. Zoom buttons (and double-tap) scale it; panning is native scrolling. Escape, the Close button or a tap
// on the backdrop closes it and focus returns to the image that opened it.
(function () {
  var images = document.querySelectorAll('.menu-image');
  if (!images.length || typeof HTMLDialogElement === 'undefined') return;

  var STEPS = [1, 1.5, 2, 3];
  var css =
    '.mv-dialog{position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:0;border:0;background:#111;color:#fff;overflow:hidden}' +
    '.mv-dialog::backdrop{background:rgba(0,0,0,.85)}' +
    '.mv-bar{position:absolute;top:0;left:0;right:0;z-index:1;display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(17,17,17,.92);font:16px/1.2 Varela,sans-serif}' +
    '.mv-bar .mv-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.mv-btn{min-width:44px;min-height:44px;padding:0 12px;border:1px solid #fff6;border-radius:22px;background:#0000;color:#fff;font:inherit;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}' +
    '.mv-btn:focus-visible{outline:3px solid #fff;outline-offset:2px}' +
    '.mv-btn[disabled]{opacity:.4;cursor:default}' +
    '.mv-close{background:#fff;color:#111;font-weight:700}' +
    '.mv-scroll{position:absolute;inset:60px 0 0;overflow:auto;-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y pinch-zoom}' +
    '.mv-scroll img{display:block;margin:0 auto;max-width:none;height:auto;border-radius:0}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var dialog = document.createElement('dialog');
  dialog.className = 'mv-dialog';
  dialog.setAttribute('aria-label', 'Menu page, full size');
  dialog.innerHTML =
    '<div class="mv-bar">' +
    '<span class="mv-title"></span>' +
    '<button type="button" class="mv-btn mv-out" aria-label="Zoom out">&minus;</button>' +
    '<button type="button" class="mv-btn mv-in" aria-label="Zoom in">+</button>' +
    '<a class="mv-btn mv-open" target="_blank" rel="noopener">Open</a>' +
    '<button type="button" class="mv-btn mv-close">Close</button>' +
    '</div>' +
    '<div class="mv-scroll"><img alt=""></div>';
  document.body.appendChild(dialog);

  var title = dialog.querySelector('.mv-title');
  var scroller = dialog.querySelector('.mv-scroll');
  var big = scroller.querySelector('img');
  var zoomIn = dialog.querySelector('.mv-in');
  var zoomOut = dialog.querySelector('.mv-out');
  var openLink = dialog.querySelector('.mv-open');
  var step = 0;
  var opener = null;

  function fullSrc(img) {
    // Largest srcset candidate is the original upload; fall back to src.
    var best = img.currentSrc || img.src;
    var max = 0;
    (img.getAttribute('srcset') || '').split(',').forEach(function (part) {
      var bits = part.trim().split(/\s+/);
      var w = parseInt(bits[1], 10);
      if (bits[0] && w > max) {
        max = w;
        best = bits[0];
      }
    });
    return best;
  }

  function applyZoom(keepCenter) {
    var cx = scroller.scrollLeft + scroller.clientWidth / 2;
    var cy = scroller.scrollTop + scroller.clientHeight / 2;
    var before = big.offsetWidth || 1;
    big.style.width = scroller.clientWidth * STEPS[step] + 'px';
    zoomOut.disabled = step === 0;
    zoomIn.disabled = step === STEPS.length - 1;
    if (keepCenter) {
      var ratio = big.offsetWidth / before;
      scroller.scrollLeft = cx * ratio - scroller.clientWidth / 2;
      scroller.scrollTop = cy * ratio - scroller.clientHeight / 2;
    }
  }

  function open(img, index) {
    opener = img;
    step = 0;
    var src = fullSrc(img);
    title.textContent = 'Menu page ' + (index + 1) + ' of ' + images.length;
    big.alt = 'Menu page ' + (index + 1);
    big.src = src;
    openLink.href = src;
    document.documentElement.style.overflow = 'hidden';
    dialog.showModal();
    applyZoom(false);
    scroller.scrollTop = 0;
    dialog.querySelector('.mv-close').focus();
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener('close', function () {
    document.documentElement.style.overflow = '';
    big.removeAttribute('src');
    if (opener) opener.focus();
  });
  dialog.querySelector('.mv-close').addEventListener('click', close);
  zoomIn.addEventListener('click', function () {
    if (step < STEPS.length - 1) step++;
    applyZoom(true);
  });
  zoomOut.addEventListener('click', function () {
    if (step > 0) step--;
    applyZoom(true);
  });
  big.addEventListener('dblclick', function () {
    step = step === 0 ? 2 : 0;
    applyZoom(true);
  });
  window.addEventListener('resize', function () {
    if (dialog.open) applyZoom(false);
  });

  Array.prototype.forEach.call(images, function (img, i) {
    img.setAttribute('data-viewer', '');
    img.setAttribute('role', 'button');
    img.setAttribute('tabindex', '0');
    img.setAttribute('aria-haspopup', 'dialog');
    img.setAttribute('aria-label', 'Menu page ' + (i + 1) + ' of ' + images.length + ', open full size');
    img.addEventListener('click', function () {
      open(img, i);
    });
    img.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(img, i);
      }
    });
  });
})();
