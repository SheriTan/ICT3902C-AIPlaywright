// Client-side behaviour of the AI report: theme toggle, expand/collapse, AI variant tabs, filter + search.
(function () {
  document.getElementById('theme').addEventListener('click', function () {
    var root = document.documentElement;
    var now = root.getAttribute('data-theme');
    var isDark = now === 'dark' || (now !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.setAttribute('data-theme', isDark ? 'light' : 'dark');
  });

  document.querySelectorAll('.toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var body = btn.closest('.test-card').querySelector('.test-body');
      var open = !body.hasAttribute('hidden');
      if (open) {
        body.setAttribute('hidden', '');
        btn.textContent = 'Details';
        btn.setAttribute('aria-expanded', 'false');
      } else {
        body.removeAttribute('hidden');
        btn.textContent = 'Hide';
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  document.querySelectorAll('.variant-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      var panel = tab.closest('.ai-panel');
      var idx = tab.getAttribute('data-variant-index');
      panel.querySelectorAll('.variant-tab').forEach(function (t) {
        t.classList.toggle('active', t === tab);
      });
      panel.querySelectorAll('.variant-panel').forEach(function (p) {
        p.classList.toggle('active', p.getAttribute('data-variant-index') === idx);
      });
    });
  });

  var activeFilter = 'all';
  var query = '';
  function apply() {
    document.querySelectorAll('.test-card').forEach(function (card) {
      var okStatus = activeFilter === 'all' || card.getAttribute('data-status') === activeFilter;
      var okQuery = !query || card.getAttribute('data-search').indexOf(query) !== -1;
      card.style.display = okStatus && okQuery ? '' : 'none';
    });
  }
  document.querySelectorAll('[data-filter]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      activeFilter = btn.getAttribute('data-filter');
      document.querySelectorAll('[data-filter]').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      apply();
    });
  });
  document.getElementById('search').addEventListener('input', function (e) {
    query = e.target.value.toLowerCase();
    apply();
  });

  var expanded = false;
  document.getElementById('expand').addEventListener('click', function () {
    expanded = !expanded;
    this.textContent = expanded ? 'Collapse all' : 'Expand all';
    document.querySelectorAll('.test-card').forEach(function (card) {
      var body = card.querySelector('.test-body');
      var btn = card.querySelector('.toggle');
      if (expanded) {
        body.removeAttribute('hidden');
        btn.textContent = 'Hide';
      } else {
        body.setAttribute('hidden', '');
        btn.textContent = 'Details';
      }
    });
    document.querySelectorAll('.attempt').forEach(function (d) {
      d.open = expanded;
    });
  });
})();
