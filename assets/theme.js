(function () {
  var KEY = 'artifacts-theme';

  function isInternalPage() {
    return /\/pages\//i.test(location.pathname);
  }

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

  function createThemeButton(inline) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'artifacts-theme-toggle' + (inline ? ' artifacts-theme-toggle--inline' : '');
    btn.setAttribute('aria-label', 'Cambiar entre modo claro y oscuro');
    btn.innerHTML =
      '<span data-theme-icon class="artifacts-theme-toggle-icon" aria-hidden="true">☀️</span>' +
      '<span data-theme-label>Modo claro</span>';
    btn.addEventListener('click', function () {
      window.ArtifactsTheme.toggle();
    });
    return btn;
  }

  function mountInternalChrome() {
    if (!isInternalPage()) return;
    if (document.getElementById('artifacts-page-chrome')) return;

    document.body.classList.add('artifacts-internal-page');

    var bar = document.createElement('header');
    bar.id = 'artifacts-page-chrome';
    bar.className = 'artifacts-page-chrome';

    var back = document.createElement('a');
    back.href = '../index.html';
    back.className = 'artifacts-back-link';
    back.textContent = '← Herramientas';

    var actions = document.createElement('div');
    actions.className = 'artifacts-chrome-actions';
    actions.appendChild(createThemeButton(true));

    bar.appendChild(back);
    bar.appendChild(actions);
    document.body.insertBefore(bar, document.body.firstChild);
  }

  function mountFloatingToggle() {
    if (document.getElementById('artifacts-theme-toggle')) return;
    var btn = createThemeButton(false);
    btn.id = 'artifacts-theme-toggle';
    document.body.appendChild(btn);
  }

  function mount() {
    mountInternalChrome();
    if (!isInternalPage()) {
      mountFloatingToggle();
    }
    updateToggleUi(window.ArtifactsTheme.get());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
