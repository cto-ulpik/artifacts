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
//    1. Menú ▶ junto a authorizeDrive → Ejecutar
//    2. Si aparece barra amarilla "Se requiere autorización" → clic en
//       "Revisar permisos" → elegir cuenta @ulpik.com → Aceptar TODO (Drive)
//    3. Volver a ejecutar authorizeDrive() hasta ver "✓ Drive autorizado" en Registro
//    4. Implementar → Administrar implementaciones → Nueva versión → Implementar
//    5. Abrir la URL /exec en el navegador y aceptar permisos otra vez
//
//  Si el error persiste:
//    - Proyecto → ⚙ → Activar "Drive API" en Servicios (+)
//    - ⚙ → Mostrar appsscript.json → pegar scripts/ulpik-drive-cleaner.appsscript.json
//      (debe incluir "runtimeVersion": "V8" — sin esto: error Rhino deprecated)
//    - https://myaccount.google.com/permissions → quitar la app → volver a autorizar
// ════════════════════════════════════════════════════════════

var ALLOWED_REDIRECT_HOSTS = [
  'cto-ulpik.github.io',
  'ia.ulpik.com',
  'localhost',
  '127.0.0.1'
];

var CACHE_TTL = 1800; // 30 min (el payload se lee en segundos; margen por si tarda el redirect)

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
      var minMb = parseInt((e.parameter && e.parameter.minMb) || '5', 10);
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
  var minMb = parseInt((e.parameter && e.parameter.minMb) || '5', 10);
  var payload = buildScan_(user, minMb);

  var token = Utilities.getUuid();
  var cacheKey = 'scan:' + token;
  var stored = cachePutJson_(cacheKey, payload, CACHE_TTL);
  if (!stored) {
    throw new Error('No se pudo guardar el escaneo. Intenta de nuevo.');
  }

  var sep = redirect.indexOf('?') >= 0 ? '&' : '?';
  var target = redirect + sep +
    'scanToken=' + encodeURIComponent(token) +
    '&email=' + encodeURIComponent(user.email);

  return htmlRedirect_(target, 'Escaneando tu Drive…');
}

function handlePayload_(e) {
  var token = (e.parameter && e.parameter.token) || '';
  if (!token) throw new Error('Falta token de escaneo');

  var cacheKey = 'scan:' + token;
  var raw = cacheGetJson_(cacheKey);
  if (!raw) {
    throw new Error('Escaneo expirado o incompleto. Pulsa Reintentar para volver a escanear.');
  }

  cacheRemoveJson_(cacheKey);
  return jsonResponse(JSON.parse(raw), e);
}

/** Script Cache: máx ~100 KB por entrada → partir JSON grande en trozos */
function cachePutJson_(prefix, obj, ttl) {
  var json = JSON.stringify(obj);
  var cache = CacheService.getScriptCache();
  var chunkSize = 90000;

  if (json.length <= chunkSize) {
    cache.put(prefix, json, ttl);
    cache.put(prefix + ':meta', '1', ttl);
    return cache.get(prefix) === json;
  }

  var parts = Math.ceil(json.length / chunkSize);
  for (var i = 0; i < parts; i++) {
    cache.put(prefix + ':p' + i, json.substring(i * chunkSize, (i + 1) * chunkSize), ttl);
  }
  cache.put(prefix + ':meta', 'n:' + parts, ttl);
  return cacheGetJson_(prefix) !== null;
}

function cacheGetJson_(prefix) {
  var cache = CacheService.getScriptCache();
  var meta = cache.get(prefix + ':meta');
  if (!meta) return null;
  if (meta === '1') return cache.get(prefix);
  if (meta.indexOf('n:') !== 0) return null;

  var parts = parseInt(meta.slice(2), 10);
  if (!parts || parts < 1) return null;

  var json = '';
  for (var i = 0; i < parts; i++) {
    var chunk = cache.get(prefix + ':p' + i);
    if (chunk === null) return null;
    json += chunk;
  }
  return json;
}

function cacheRemoveJson_(prefix) {
  var cache = CacheService.getScriptCache();
  var meta = cache.get(prefix + ':meta');
  cache.remove(prefix + ':meta');
  if (!meta) return;
  if (meta === '1') {
    cache.remove(prefix);
    return;
  }
  if (meta.indexOf('n:') === 0) {
    var parts = parseInt(meta.slice(2), 10) || 0;
    for (var i = 0; i < parts; i++) cache.remove(prefix + ':p' + i);
  }
}

function htmlRedirect_(target, message) {
  var safe = JSON.stringify(target);
  var html = [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    '<base target="_top">',
    '<title>', message, '</title>',
    '<style>',
    'body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;',
    'align-items:center;justify-content:center;min-height:100vh;margin:0;',
    'background:#f0f2ef;color:#1c211e;gap:14px;text-align:center;padding:24px}',
    'a{color:#0f766e;font-weight:600}',
    '</style>',
    '</head><body>',
    '<p>', message, '</p>',
    '<p><a href="', target.replace(/&/g, '&amp;').replace(/"/g, '&quot;'), '" target="_top" rel="noopener">Continuar →</a></p>',
    '<script>',
    '(function(){',
    'var u=', safe, ';',
    'function go(){try{(window.top||window).location.replace(u);}catch(e){window.open(u,"_blank");}}',
    'go();',
    'setTimeout(go,400);',
    '})();',
    '</script>',
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
  var minBytes = Math.max(1, (minMb || 5)) * 1024 * 1024;
  var files = [];
  var seen = {};
  var maxFiles = 200;
  var maxIter = 1200;

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
      files.push(fileToDto_(file, isGoogleNative, false));
    }
  }

  files.sort(function(a, b) { return b.size - a.size; });
  return files;
}

function fileToDto_(file, isGoogleNative, includePath) {
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
  if (includePath) {
    var parents = file.getParents();
    if (parents.hasNext()) {
      try { path = 'Mi unidad / ' + parents.next().getName(); } catch (err) {}
    }
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
 * Ejecutar desde el editor (▶).
 * 1ª vez: aparece barra amarilla "Se requiere autorización" → Revisar permisos → Aceptar Drive
 * 2ª vez: debe mostrar "✓ Drive autorizado" en el Registro
 */
function authorizeDrive() {
  var email = Session.getActiveUser().getEmail() || '(cuenta activa en el editor)';
  Logger.log('Solicitando acceso a Drive para: ' + email);
  Logger.log('Si ves barra amarilla arriba del código → "Revisar permisos" → Aceptar.');

  try {
    var used = DriveApp.getStorageUsed();
    var limit = DriveApp.getStorageLimit();
    var n = 0;
    var it = DriveApp.searchFiles('trashed = false');
    while (it.hasNext() && n < 5) {
      it.next();
      n++;
    }

    Logger.log('✓ Drive autorizado');
    Logger.log('Cuenta: ' + Session.getActiveUser().getEmail());
    Logger.log('Uso: ' + used + ' bytes / límite ' + limit);
    Logger.log('Archivos leídos (muestra): ' + n);
    return true;

  } catch (err) {
    var msg = String(err.message || err);
    Logger.log('✗ ' + msg);
    Logger.log('');
    Logger.log('── Cómo autorizar ──');
    Logger.log('1. Mira ARRIBA del editor (no el Registro): barra amarilla "Se requiere autorización"');
    Logger.log('2. Clic en "Revisar permisos"');
    Logger.log('3. Cuenta @ulpik.com → Avanzado si hace falta → Aceptar permisos de Drive');
    Logger.log('4. Ejecuta authorizeDrive otra vez');
    Logger.log('');
    Logger.log('Si no hay barra amarilla: abre la URL /exec de la App web en el navegador y acepta ahí.');

    try {
      var url = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL).getAuthorizationUrl();
      if (url) Logger.log('Enlace alternativo: ' + url);
    } catch (ignore) {}

    throw new Error('Permisos de Drive pendientes. Sigue los pasos del Registro y vuelve a ejecutar.');
  }
}

function testStatus() {
  Logger.log(doGet({ parameter: { action: 'status', callback: 'cb' } }).getContent());
}

function testScan() {
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
