// ════════════════════════════════════════════════════════════
//  APPS SCRIPT — Ulpik Drive Cleaner
//  Frontend: pages/varios/Ulpik Drive Cleaner (standalone).html
//
//  Acciones (?action=):
//    auth          → OAuth + redirige con ?auth=ok&email=...
//    scan_redirect → escanea Drive y redirige con ?scanToken=... (evita JSONP sin cookies)
//    payload       → devuelve resultado del escaneo por token (JSONP OK)
//    status        → { ok, email, used, quota }
//    scan          → { ok, files, ... } (JSONP; puede fallar fuera de script.google.com)
//    delete        → { ok, deleted }
//
//  DESPLIEGUE:
//    Ejecutar como: Usuario que accede a la aplicación web
//    Acceso: Cualquier usuario de ulpik.com
//    URL App web /exec → APPS_SCRIPT_URL en el HTML
//
//  AUTORIZAR DRIVE (obligatorio la primera vez):
//    1. En el editor, ejecutar authorizeDrive() → Aceptar permisos de Drive
//    2. Implementar → Nueva versión de la App web
//    3. Abrir la URL /exec con cuenta @ulpik.com y aceptar permisos otra vez
//
//  Si ves "You do not have permission to call DriveApp.getStorageUsed":
//    → Falta el paso 1 y/o 2 arriba.
// ════════════════════════════════════════════════════════════

var ALLOWED_REDIRECT_HOSTS = [
  'cto-ulpik.github.io',
  'ia.ulpik.com',
  'localhost',
  '127.0.0.1'
];

var CACHE_TTL = 600; // 10 min

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'status';

    if (action === 'auth') {
      return handleAuth_(e);
    }

    if (action === 'scan_redirect') {
      return handleScanRedirect_(e);
    }

    if (action === 'payload') {
      return handlePayload_(e);
    }

    var user = requireUlpikUser_();

    if (action === 'status') {
      return jsonResponse(buildStatus_(user), e);
    }

    if (action === 'scan') {
      var minMb = parseInt((e.parameter && e.parameter.minMb) || '50', 10);
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
  if (!redirect) throw new Error('Falta el parámetro redirect');
  assertAllowedRedirect_(redirect);

  var user = requireUlpikUser_();
  var sep = redirect.indexOf('?') >= 0 ? '&' : '?';
  var target = redirect + sep + 'auth=ok&email=' + encodeURIComponent(user.email);

  return htmlRedirect_(target, 'Conectando ' + user.email + '…');
}

function handleScanRedirect_(e) {
  var redirect = (e.parameter && e.parameter.redirect) || '';
  if (!redirect) throw new Error('Falta el parámetro redirect');
  assertAllowedRedirect_(redirect);

  var user = requireUlpikUser_();
  var minMb = parseInt((e.parameter && e.parameter.minMb) || '50', 10);
  var payload = buildScan_(user, minMb);

  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('scan:' + token, JSON.stringify(payload), CACHE_TTL);

  var sep = redirect.indexOf('?') >= 0 ? '&' : '?';
  var target = redirect + sep +
    'scanToken=' + encodeURIComponent(token) +
    '&email=' + encodeURIComponent(user.email);

  return htmlRedirect_(target, 'Escaneando tu Drive…');
}

function handlePayload_(e) {
  var token = (e.parameter && e.parameter.token) || '';
  if (!token) throw new Error('Falta token de escaneo');

  var raw = CacheService.getScriptCache().get('scan:' + token);
  if (!raw) throw new Error('Escaneo expirado. Pulsa «Volver a escanear».');

  CacheService.getScriptCache().remove('scan:' + token);
  return jsonResponse(JSON.parse(raw), e);
}

function htmlRedirect_(target, message) {
  var html = [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    '<title>', message, '</title>',
    '<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f0f2ef;color:#1c211e}</style>',
    '</head><body><p>', message, '</p>',
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

function safeStorageInfo_() {
  try {
    return {
      used: DriveApp.getStorageUsed(),
      quota: normalizeQuota_(DriveApp.getStorageLimit())
    };
  } catch (err) {
    var msg = String(err.message || err);
    if (/permission|authorization|permiso/i.test(msg)) {
      throw new Error(
        'Faltan permisos de Google Drive. En Apps Script ejecuta authorizeDrive(), ' +
        'acepta los permisos, crea una nueva versión del despliegue y vuelve a abrir la App web.'
      );
    }
    throw err;
  }
}

function buildStatus_(user) {
  var storage = safeStorageInfo_();
  return {
    ok: true,
    email: user.email,
    used: storage.used,
    quota: storage.quota,
    scanned: 0
  };
}

function buildScan_(user, minMb) {
  var status = buildStatus_(user);
  var files = scanDriveFiles_(minMb);
  markDuplicates_(files);
  status.files = files;
  status.scanned = files.length;
  return status;
}

function normalizeQuota_(quota) {
  if (!quota || quota <= 0) {
    return 100 * 1024 * 1024 * 1024;
  }
  return quota;
}

function scanDriveFiles_(minMb) {
  var minBytes = Math.max(1, (minMb || 50)) * 1024 * 1024;
  var files = [];
  var seen = {};
  var maxFiles = 300;
  var maxIter = 5000;

  var it = DriveApp.searchFiles('trashed = false and mimeType != "application/vnd.google-apps.folder"');
  var n = 0;

  while (it.hasNext() && n < maxIter && files.length < maxFiles) {
    n++;
    var file = it.next();
    var id = file.getId();
    if (seen[id]) continue;

    var size = file.getSize();
    var months = monthsSince_(file.getLastUpdated());
    var mime = file.getMimeType() || '';
    var isGoogleNative = mime.indexOf('application/vnd.google-apps.') === 0 && mime !== 'application/vnd.google-apps.folder';

    if (size >= minBytes || months >= 6 || size >= 5 * 1024 * 1024 || isGoogleNative) {
      seen[id] = true;
      files.push(fileToDto_(file, isGoogleNative));
    }
  }

  files.sort(function(a, b) { return b.size - a.size; });
  return files;
}

function fileToDto_(file, isGoogleNative) {
  var name = file.getName();
  var ext = name.indexOf('.') >= 0 ? name.split('.').pop().toUpperCase() : 'FILE';
  if (isGoogleNative) {
    var mime = file.getMimeType() || '';
    if (mime.indexOf('document') >= 0) ext = 'DOC';
    else if (mime.indexOf('spreadsheet') >= 0) ext = 'XLSX';
    else if (mime.indexOf('presentation') >= 0) ext = 'KEY';
    else ext = 'FILE';
  }
  var path = 'Mi unidad';
  var parents = file.getParents();
  if (parents.hasNext()) {
    try { path = 'Mi unidad / ' + parents.next().getName(); } catch (err) {}
  }
  var size = file.getSize();
  if (isGoogleNative && size === 0) size = 2 * 1024 * 1024;
  return {
    id: file.getId(),
    name: name,
    ext: ext,
    size: size,
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
  if (!ids.length) throw new Error('No hay archivos para eliminar');
  var deleted = 0;
  ids.forEach(function(id) {
    var file = DriveApp.getFileById(id);
    var ownerEmail = '';
    try { ownerEmail = file.getOwner().getEmail(); } catch (err) {}
    if (ownerEmail && ownerEmail !== user.email && !isSharedWithUser_(file, user.email)) {
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

/**
 * Ejecutar UNA VEZ desde el editor (▶) para solicitar permisos de Google Drive.
 * Acepta el diálogo de Google → luego Implementar → Nueva versión.
 */
function authorizeDrive() {
  var storage = safeStorageInfo_();
  var n = 0;
  var it = DriveApp.searchFiles('trashed = false');
  while (it.hasNext() && n < 5) {
    it.next();
    n++;
  }
  Logger.log('Drive autorizado para ' + Session.getActiveUser().getEmail());
  Logger.log('Uso: ' + storage.used + ' bytes | Muestra de archivos: ' + n);
}

function testStatus() {
  Logger.log(doGet({ parameter: { action: 'status', callback: 'cb' } }).getContent());
}

function testScan() {
  authorizeDrive();
  Logger.log(doGet({ parameter: { action: 'scan', minMb: '10', callback: 'cb' } }).getContent().slice(0, 800));
}

function testScanRedirect() {
  Logger.log(doGet({
    parameter: {
      action: 'scan_redirect',
      minMb: '10',
      redirect: 'https://cto-ulpik.github.io/artifacts/pages/varios/Ulpik%20Drive%20Cleaner%20(standalone).html'
    }
  }).getContent().slice(0, 400));
}
