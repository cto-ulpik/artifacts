(function () {
  var KEY = 'artifacts-theme';

  function getPreferred() {
    var stored = localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function updateToggleUi(theme) {
    document.querySelectorAll('[data-theme-label]').forEach(function (el) {
      el.textContent = theme === 'light' ? 'Modo oscuro' : 'Modo claro';
    });
    document.querySelectorAll('[data-theme-icon]').forEach(function (el) {
      el.textContent = theme === 'light' ? '🌙' : '☀️';
    });
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(KEY, theme);
    updateToggleUi(theme);
    window.dispatchEvent(new CustomEvent('artifacts-theme-change', { detail: { theme: theme } }));
  }

  apply(getPreferred());

  window.ArtifactsTheme = {
    get: function () {
      return document.documentElement.getAttribute('data-theme');
    },
    set: apply,
    toggle: function () {
      var current = document.documentElement.getAttribute('data-theme');
      apply(current === 'light' ? 'dark' : 'light');
    }
  };

  function mountToggle() {
    if (document.getElementById('artifacts-theme-toggle')) return;
    var btn = document.createElement('button');
    btn.id = 'artifacts-theme-toggle';
    btn.type = 'button';
    btn.className = 'artifacts-theme-toggle';
    btn.setAttribute('aria-label', 'Cambiar entre modo claro y oscuro');
    btn.innerHTML =
      '<span data-theme-icon class="artifacts-theme-toggle-icon" aria-hidden="true">☀️</span>' +
      '<span data-theme-label>Modo claro</span>';
    btn.addEventListener('click', function () {
      window.ArtifactsTheme.toggle();
    });
    document.body.appendChild(btn);
    updateToggleUi(window.ArtifactsTheme.get());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountToggle);
  } else {
    mountToggle();
  }
})();
