/**
 * SEGUIMIENTO DE MARCA — Proxy API UPK (evita CORS desde GitHub Pages)
 *
 * pi.ulpik.com devuelve Access-Control-Allow-Origin malformado (", *")
 * y el navegador bloquea fetch directo. Este script consulta server-side.
 *
 * SETUP:
 * 1. script.google.com → Nuevo proyecto → pegar este código
 * 2. Implementar → Nueva implementación → Aplicación web
 *      Ejecutar como: Yo
 *      Quién tiene acceso: Cualquier persona
 * 3. Copiar URL /exec → PROXY_URL en Seguimiento de Marca.html
 * 4. Probar: ?action=brand&upk=8N66LY
 */

var PI_BRAND_API = 'https://pi.ulpik.com/api/brand/upk';

function doGet(e) {
  e = e || {};
  var p = e.parameter || {};

  if (p.action === 'brand') {
    try {
      var data = fetchBrandFromPi_(p.upk);
      return jsonpOutput(p.callback, data);
    } catch (err) {
      return jsonpOutput(p.callback, { ok: false, message: String(err.message || err) });
    }
  }

  if (p.action === 'debug') {
    return jsonpOutput(p.callback, { ok: true, message: 'Proxy Seguimiento Marca activo', api: PI_BRAND_API });
  }

  return jsonOutput({
    ok: true,
    message: 'Proxy Seguimiento Marca activo. Usa ?action=brand&upk=CODIGO'
  });
}

function fetchBrandFromPi_(upk) {
  var code = String(upk || '').trim().toUpperCase().replace(/^UPK[-_\s]*/i, '');
  if (!code) throw new Error('Código UPK requerido');

  var url = PI_BRAND_API + '/' + encodeURIComponent(code);
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  var status = res.getResponseCode();
  var text = res.getContentText() || '';

  if (status >= 400) {
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error('HTTP ' + status + ': ' + text.slice(0, 200));
    }
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('Respuesta no JSON del servidor: ' + text.slice(0, 200));
  }
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonpOutput(callback, obj) {
  var json = JSON.stringify(obj);
  if (callback && /^[a-zA-Z_$][\w.$]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonOutput(obj);
}

function testBrand() {
  Logger.log(JSON.stringify(fetchBrandFromPi_('8N66LY')));
}
