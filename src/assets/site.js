(function () {
  document.documentElement.classList.add('js');
  var items = document.querySelectorAll('.reveal, .steps li, .path li');
  if (!('IntersectionObserver' in window)) {
    items.forEach(function (el) { el.classList.add('in'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  items.forEach(function (el) { io.observe(el); });
})();

/* The mobile call bar appears once the hero has scrolled away, so it never
   covers the hero's own buttons. */
(function () {
  var bar = document.querySelector('.cta-bar');
  if (!bar) return;
  var toggle = function () {
    bar.classList.toggle('is-visible', window.scrollY > 420);
  };
  window.addEventListener('scroll', toggle, { passive: true });
  toggle();
})();

/* Conversion events. Everything is pushed onto window.dataLayer so a tag
   manager or analytics provider can pick it up; nothing is sent anywhere
   until a provider is configured in _data/analytics.js. */
(function () {
  window.dataLayer = window.dataLayer || [];
  function track(name, detail) {
    var payload = { event: name, page: window.location.pathname };
    if (detail) {
      Object.keys(detail).forEach(function (k) { payload[k] = detail[k]; });
    }
    window.dataLayer.push(payload);
  }
  window.dlTrack = track;

  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (href.indexOf('contact.html') === 0) {
      track('book_call_click', { link_text: (a.textContent || '').trim() });
    } else if (href.indexOf('refer.html') === 0) {
      track('refer_click', { link_text: (a.textContent || '').trim() });
    } else if (a.closest('.related')) {
      track('related_link_click', { link_url: href });
    }
  }, { passive: true });

  document.addEventListener('submit', function (e) {
    var form = e.target;
    track('form_submit', { form_id: form.id || form.getAttribute('name') || 'unnamed' });
  }, true);
})();

/* A second click while the first submission is still in flight creates a
   second lead in the CRM. The submission itself is left alone: the browser
   still posts the form exactly as it would without JavaScript. */
(function () {
  function setBusy(form, busy) {
    var btn = form.querySelector('button[type="submit"], input[type="submit"]');
    if (!btn) return;
    if (busy) {
      if (btn.tagName === 'INPUT') {
        btn.dataset.label = btn.value;
        btn.value = 'Sending\u2026';
      } else {
        btn.dataset.label = btn.textContent;
        btn.textContent = 'Sending\u2026';
      }
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
    } else {
      if (btn.dataset.label) {
        if (btn.tagName === 'INPUT') btn.value = btn.dataset.label;
        else btn.textContent = btn.dataset.label;
      }
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  }
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.nodeName !== 'FORM' || form.dataset.sending) return;
    form.dataset.sending = '1';
    setBusy(form, true);
  }, false);
  /* Returning with the back button restores the page from cache, button
     included, so reset it rather than leave a dead form behind. */
  window.addEventListener('pageshow', function () {
    Array.prototype.forEach.call(document.querySelectorAll('form[data-sending]'), function (form) {
      delete form.dataset.sending;
      setBusy(form, false);
    });
  });

  var fit = document.querySelector('.fit-panel');
  if (fit) {
    document.addEventListener('change', function (e) {
      if (!fit.contains(e.target)) return;
      track('fit_check_started', { question: e.target.name || '' });
    }, true);
  }
})();

/* The published figures count up once as they scroll into view. Text is only
   ever left complete: the final frame writes the exact source value. */
(function () {
  var nums = document.querySelectorAll('.ticker-num, .criteria-num, .criteria-item strong');
  if (!nums.length || !('IntersectionObserver' in window)) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function countUp(el) {
    var raw = (el.textContent || '').trim();
    var m = raw.match(/^(\d+)(.*)$/);
    if (!m || reduce) return;
    var target = parseInt(m[1], 10);
    var suffix = m[2];
    var start = null;
    function frame(now) {
      if (start === null) start = now;
      var p = Math.min(1, (now - start) / 900);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))) + suffix;
      if (p < 1) requestAnimationFrame(frame);
      else el.textContent = target + suffix;
    }
    requestAnimationFrame(frame);
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) { countUp(entry.target); io.unobserve(entry.target); }
    });
  }, { threshold: 0.6 });
  nums.forEach(function (el) { io.observe(el); });
})();

/* ---------- #buyer-view: what the buyer receives, as you narrow it ---------- */
(function () {
  var demo = document.querySelector('[data-redact]');
  if (!demo) return;
  var picks = demo.querySelectorAll('input[data-share]');
  var count = demo.querySelector('[data-redact-count]');
  function sync() {
    var on = 0;
    Array.prototype.forEach.call(picks, function (input) {
      var out = demo.querySelector('[data-out="' + input.getAttribute('data-share') + '"]');
      if (input.checked) on += 1;
      if (!out) return;
      out.classList.toggle('is-out', !input.checked);
      var value = out.querySelector('b');
      value.textContent = input.checked ? value.getAttribute('data-show') : 'excluded';
    });
    if (count) count.textContent = on;
  }
  demo.addEventListener('change', sync);
  sync();
})();
