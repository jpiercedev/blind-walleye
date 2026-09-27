// Replaces Webflow's native form submission (which only works on Webflow hosting) with /api/contact while
// reproducing webflow.js's UI exactly: the submit button shows its data-wait text and is disabled, then on
// success the form is hidden and .w-form-done shown; on failure .w-form-fail is shown and the form stays.
// Success is only shown when the server confirms the email provider accepted the message.
(function () {
  var ENDPOINT = '/api/contact';
  var loadedAt = Date.now();

  function show(el, visible) {
    if (el) el.style.display = visible ? 'block' : 'none';
  }

  function addHoneypot(form) {
    if (form.querySelector('input[name="company_website"]')) return;
    var hp = document.createElement('input');
    hp.type = 'text';
    hp.name = 'company_website';
    hp.tabIndex = -1;
    hp.autocomplete = 'off';
    hp.setAttribute('aria-hidden', 'true');
    hp.style.cssText = 'position:absolute!important;left:-10000px!important;width:1px;height:1px;opacity:0;pointer-events:none';
    form.appendChild(hp);
  }

  function forms() {
    return document.querySelectorAll('.w-form form');
  }

  function init() {
    Array.prototype.forEach.call(forms(), addHoneypot);
  }

  // Capture phase on window runs before webflow.js's delegated jQuery handler on document, and stopping
  // propagation here keeps the native Webflow submission from also firing.
  window.addEventListener(
    'submit',
    function (evt) {
      var form = evt.target;
      if (!(form instanceof HTMLFormElement) || !form.closest('.w-form')) return;
      evt.preventDefault();
      evt.stopImmediatePropagation();
      submit(form);
    },
    true,
  );

  function submit(form) {
    var wrapper = form.closest('.w-form');
    var done = wrapper.querySelector(':scope > .w-form-done');
    var fail = wrapper.querySelector(':scope > .w-form-fail');
    var btn = form.querySelector('input[type="submit"], button[type="submit"]');
    var label = btn && btn.value;
    var wait = btn && btn.getAttribute('data-wait');
    if (btn) {
      if (btn.disabled) return;
      btn.disabled = true;
      if (wait) btn.value = wait;
    }

    var data = new URLSearchParams();
    Array.prototype.forEach.call(form.querySelectorAll('input, textarea, select'), function (el) {
      if (!el.name || el.type === 'submit' || el.type === 'button' || el.type === 'file') return;
      data.append(el.name, typeof el.value === 'string' ? el.value.trim() : '');
    });
    data.append('_elapsed', String(Date.now() - loadedAt));
    data.append('_page', location.pathname);

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: data.toString(),
      credentials: 'same-origin',
    })
      .then(function (res) {
        return res.json().then(
          function (body) {
            return res.ok && body && body.ok === true;
          },
          function () {
            return false;
          },
        );
      })
      .catch(function () {
        return false;
      })
      .then(function (success) {
        show(done, success);
        show(fail, !success);
        var target = success ? done : fail;
        if (target) target.focus();
        form.style.display = success ? 'none' : '';
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('w-form-loading');
          if (label != null) btn.value = label;
        }
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
