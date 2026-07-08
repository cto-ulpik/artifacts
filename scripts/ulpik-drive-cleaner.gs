// ════════════════════════════════════════════════════════════
//  APPS SCRIPT — Ulpik Drive Cleaner
//  Frontend: pages/varios/Ulpik Drive Cleaner (standalone).html
//
//  Acciones (?action=):
//    auth     → OAuth Google + redirige al HTML con ?auth=ok&email=...
//    status   → { ok, email, used, quota }
//    scan     → { ok, email, used, quota, files: [...] }
//    delete   → { ok, deleted }  (ids en JSON via ?ids=[...])
//
//  DESPLIEGUE (obligatorio):
//  1. script.google.com → pegar este código
//  2. Implementar → Nueva implementación → Aplicación web
//       Ejecutar como: Usuario que accede a la aplicación web  ← imprescindible
//       Acceso: Cualquier usuario (o solo tu organización @ulpik.com)
//  3. Copiar la URL /exec de la App web (NO la de biblioteca) al HTML:
//     https://script.google.com/a/macros/ulpik.com/s/.../exec
//  4. Autorizar: abrir la URL /exec en el navegador con cuenta @ulpik.com
//     y aceptar permisos de Google Drive
//
//  NOTA: Solo emails @ulpik.com. El admin de Workspace puede restringir
//  la app en Admin Console → Seguridad → Controles de API → Apps Script.
// ════════════════════════════════════════════════════════════

var ALLOWED_REDIRECT_HOSTS = [
  'cto-ulpik.github.io',
  'ia.ulpik.com',
  'localhost',
  '127.0.0.1'
];

// ────────────────────────────────────────────────────────────
//  HTTP
// ────────────────────────────────────────────────────────────

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'status';

    if (action === 'auth') {
      return handleAuth_(e);
    }

    var user = requireUlpikUser_();

    if (action === 'status') {
      return jsonResponse(buildStatus_(user), e);
    }

    if (action === 'scan') {
      var minMb = parseInt((e.parameter && e.parameter.minMb) || '500', 10);
      return jsonResponse(buildScan_(user, minMb), e);
    }

    if (action === 'delete') {
      var ids = parseIds_(e.parameter && e.parameter.ids);
      return jsonResponse(deleteFiles_(user, ids), e);
    }

    return jsonResponse({ ok: true, message: 'Ulpik Drive Cleaner API activa', email: user.email }, e);

  } catch (err) {
    return jsonResponse({ ok: false, error: String(err.message || err) }, e);
  }
}

function doPost(e) {
  return doGet(e);
}

function handleAuth_(e) {
  var redirect = (e.parameter && e.parameter.redirect) || '';
  if (!redirect) {
    throw new Error('Falta el parámetro redirect');
  }
  assertAllowedRedirect_(redirect);

  var user = requireUlpikUser_();
  var sep = redirect.indexOf('?') >= 0 ? '&' : '?';
  var target = redirect + sep + 'auth=ok&email=' + encodeURIComponent(user.email);

  var html = [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    '<title>Conectando Drive…</title>',
    '<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f0f2ef;color:#1c211e}</style>',
    '</head><body><p>Conectando <strong>', user.email, '</strong>…</p>',
    '<script>location.replace(', JSON.stringify(target), ');</script>',
    '</body></html>'
  ].join('');

  return HtmlService.createHtmlOutput(html)
    .setTitle('Ulpik Drive Cleaner')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function requireUlpikUser_() {
  var email = '';
  try {
    email = Session.getActiveUser().getEmail() || '';
  } catch (err) {
    email = '';
  }
  if (!email) {
    throw new Error('Inicia sesión con tu cuenta Google @ulpik.com y autoriza el acceso a Drive');
  }
  if (!/@ulpik\.com$/i.test(email)) {
    throw new Error('Solo cuentas @ulpik.com');
  }
  return { email: email };
}

function assertAllowedRedirect_(url) {
  var host = '';
  try {
    host = url.match(/^https?:\/\/([^\/]+)/i)[1].toLowerCase();
  } catch (err) {
    throw new Error('URL de retorno inválida');
  }
  var ok = ALLOWED_REDIRECT_HOSTS.some(function(h) {
    return host === h || host.indexOf(h + ':') === 0 || host.slice(-('.' + h).length) === '.' + h;
  });
  if (!ok) {
    throw new Error('Dominio de retorno no permitido: ' + host);
  }
}

function buildStatus_(user) {
  var used = DriveApp.getStorageUsed();
  var quota = DriveApp.getStorageLimit();
  return {
    ok: true,
    email: user.email,
    used: used,
    quota: quota
  };
}

function buildScan_(user, minMb) {
  var status = buildStatus_(user);
  var files = scanDriveFiles_(minMb);
  markDuplicates_(files);
  status.files = files;
  return status;
}

function scanDriveFiles_(minMb) {
  var minBytes = (minMb || 500) * 1024 * 1024;
  var files = [];
  var seen = 0;
  var max = 400;

  // Archivos grandes
  var largeIt = DriveApp.searchFiles('trashed = false and mimeType != "application/vnd.google-apps.folder"');
  while (largeIt.hasNext() && seen < max) {
    var file = largeIt.next();
    seen++;
    var size = file.getSize();
    if (size < minBytes && monthsSince_(file.getLastUpdated()) < 12) {
      continue;
    }
    files.push(fileToDto_(file));
  }

  files.sort(function(a, b) { return b.size - a.size; });
  return files.slice(0, 200);
}

function fileToDto_(file) {
  var name = file.getName();
  var ext = name.indexOf('.') >= 0 ? name.split('.').pop().toUpperCase() : 'FILE';
  var path = 'Mi unidad';
  var parents = file.getParents();
  if (parents.hasNext()) {
    try { path = 'Mi unidad / ' + parents.next().getName(); } catch (err) {}
  }
  return {
    id: file.getId(),
    name: name,
    ext: ext,
    size: file.getSize(),
    months: monthsSince_(file.getLastUpdated()),
    path: path
  };
}

function monthsSince_(date) {
  var now = new Date();
  return Math.max(0,
    (now.getFullYear() - date.getFullYear()) * 12 +
    (now.getMonth() - date.getMonth())
  );
}

function markDuplicates_(files) {
  var map = {};
  var code = 'A'.charCodeAt(0);
  files.forEach(function(f) {
    var key = f.name + '|' + f.size;
    if (!map[key]) map[key] = [];
    map[key].push(f);
  });
  Object.keys(map).forEach(function(key) {
    if (map[key].length > 1) {
      var label = String.fromCharCode(code++);
      map[key].forEach(function(f) { f.dup = label; });
    }
  });
}

function parseIds_(raw) {
  if (!raw) return [];
  try {
    var ids = JSON.parse(raw);
    return Array.isArray(ids) ? ids.map(String) : [];
  } catch (err) {
    throw new Error('ids inválidos');
  }
}

function deleteFiles_(user, ids) {
  if (!ids.length) {
    throw new Error('No hay archivos para eliminar');
  }
  var deleted = 0;
  ids.forEach(function(id) {
    var file = DriveApp.getFileById(id);
    if (file.getOwner().getEmail() !== user.email && !isSharedWithUser_(file, user.email)) {
      throw new Error('No puedes eliminar: ' + file.getName());
    }
    file.setTrashed(true);
    deleted++;
  });
  return { ok: true, deleted: deleted };
}

function isSharedWithUser_(file, email) {
  try {
    var editors = file.getEditors();
    for (var i = 0; i < editors.length; i++) {
      if (editors[i].getEmail() === email) return true;
    }
  } catch (err) {}
  return false;
}

function jsonResponse(obj, e) {
  var text = JSON.stringify(obj);
  var cb = e && e.parameter && e.parameter.callback;
  if (cb && /^[a-zA-Z_$][\w$]*$/.test(cb)) {
    return ContentService
      .createTextOutput(cb + '(' + text + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);
}

// ────────────────────────────────────────────────────────────
//  Pruebas (ejecutar desde el editor con tu cuenta @ulpik.com)
// ────────────────────────────────────────────────────────────

function testStatus() {
  var res = doGet({ parameter: { action: 'status', callback: 'cb' } });
  Logger.log(res.getContent());
}

function testScan() {
  var res = doGet({ parameter: { action: 'scan', minMb: '100', callback: 'cb' } });
  Logger.log(res.getContent().slice(0, 500) + '...');
}

function testAuthRedirect() {
  var res = doGet({
    parameter: {
      action: 'auth',
      redirect: 'https://cto-ulpik.github.io/artifacts/pages/varios/Ulpik%20Drive%20Cleaner%20(standalone).html'
    }
  });
  Logger.log(res.getContent().slice(0, 300));
}
