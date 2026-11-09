(function () {
  document.documentElement.classList.add('js');
  var items = document.querySelectorAll('.reveal, .steps li');
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
