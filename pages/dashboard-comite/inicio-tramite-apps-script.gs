/**
 * INICIO DE TRÁMITE ULPIK — Lectura para tablero de comité
 *
 * Spreadsheet: "Ulpik - ¿Cómo fue tu proceso de compra con Ulpik? (Respuestas)"
 * Pestaña: "Respuestas de formulario 1"
 *
 * Pegar en ese spreadsheet → Extensiones → Apps Script.
 * Desplegar: Implementar → Nueva implementación → Aplicación web
 *   - Ejecutar como: Yo
 *   - Quién tiene acceso: Cualquier persona
 *
 * Probar: ?action=read  o  ?action=debug
 */

var SHEET_NAME = 'Respuestas de formulario 1';
var SHEET_NAME_ALT = 'Form_Responses';

function doGet(e) {
  e = e || {};
  var p = e.parameter || {};

  if (p.action === 'read') {
    try {
      var rows = readSurveyData();
      return jsonpOutput(p.callback, { ok: true, rows: rows });
    } catch (err) {
      return jsonpOutput(p.callback, { ok: false, error: String(err.message || err) });
    }
  }

  if (p.action === 'debug') {
    try {
      return jsonpOutput(p.callback, buildDebugReport());
    } catch (err) {
      return jsonpOutput(p.callback, { ok: false, error: String(err.message || err) });
    }
  }

  if (p.callback) {
    return jsonpOutput(p.callback, { ok: true, message: 'Lectura inicio de trámite ULPIK activa' });
  }
  return jsonOutput({ ok: true, message: 'Lectura inicio de trámite ULPIK activa' });
}

function toMarcaDate(raw) {
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw;
  if (typeof raw === 'number' && raw > 0) {
    return new Date(Math.round((raw - 25569) * 86400 * 1000));
  }
  var s = String(raw || '').trim();
  if (!s) return null;
  // "7/3/2026 12:58:40" → split espacio → split "/" → [día, mes, año]
  var datePart = s.split(/\s+/)[0];
  if (datePart.indexOf('/') !== -1) {
    var bits = datePart.split('/');
    if (bits.length >= 3) {
      var d = +bits[0], mo = +bits[1], y = +bits[2];
      if (d && mo && y) return new Date(y, mo - 1, d);
    }
  }
  var parsed = new Date(s);
  if (!isNaN(parsed.getTime()) && /\d{4}/.test(s)) return parsed;
  return null;
}

function parseMarcaTemporal(marca) {
  var d = marca instanceof Date ? marca : toMarcaDate(marca);
  if (d && !isNaN(d.getTime())) {
    var tz = Session.getScriptTimeZone() || 'America/Guayaquil';
    var iso = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    var mesNum = iso.substring(5, 7);
    var anio = iso.substring(0, 4);
    return { iso: iso, mes: anio + '-' + mesNum, anio: anio, mesNum: mesNum };
  }
  return { iso: '', mes: '', anio: '', mesNum: '' };
}

function readSurveyData() {
  var sheet = getSheet();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var tz = Session.getScriptTimeZone() || 'America/Guayaquil';
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!r[1] && !r[2] && (r[3] === '' || r[3] === null || r[3] === undefined)) continue;

    var marcaDate = toMarcaDate(r[0]);
    var marca = marcaDate
      ? Utilities.formatDate(marcaDate, tz, 'dd/MM/yyyy HH:mm:ss')
      : String(r[0] || '');
    var parsed = marcaDate ? parseMarcaTemporal(marcaDate) : parseMarcaTemporal(marca);

    rows.push({
      marca: marca,
      fecha_str: String(parsed.iso || ''),
      mes: String(parsed.mes || ''),
      anio: String(parsed.anio || ''),
      mes_num: String(parsed.mesNum || ''),
      email: String(r[1] || ''),
      servicio: String(r[2] || ''),
      facilidad: numCol(r[3]),
      claridad: numCol(r[4]),
      dificultad: String(r[5] || ''),
      atencion: numCol(r[6]),
      acompanado: String(r[7] || ''),
      recomendacion: numCol(r[8]),
      cliente_recurrente: String(r[9] || ''),
      facturacion: String(r[10] || ''),
      asesor: String(r[11] || ''),
      comentario: String(r[12] || ''),
      nota_interna: String(r[13] || '')
    });
  }
  return rows;
}

function buildDebugReport() {
  var sheet = getSheet();
  var values = sheet.getDataRange().getValues();
  var rawSample = values.length > 1 ? values[values.length - 1][0] : null;
  var rows = readSurveyData();
  var byMonth = {};
  var sinFecha = 0;
  rows.forEach(function (r) {
    if (r.mes) byMonth[r.mes] = (byMonth[r.mes] || 0) + 1;
    else sinFecha++;
  });
  return {
    ok: true,
    sheet: sheet.getName(),
    total: rows.length,
    sin_fecha: sinFecha,
    por_mes: byMonth,
    raw_tipo: rawSample === null ? 'vacío' : Object.prototype.toString.call(rawSample),
    raw_muestra: rawSample === null ? null : String(rawSample).substring(0, 80),
    ultimas_3: rows.slice(-3).map(function (r) {
      return {
        marca: r.marca,
        anio: r.anio,
        mes_num: r.mes_num,
        asesor: r.asesor,
        recomendacion: r.recomendacion
      };
    })
  };
}

function numCol(v) {
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheetByName(SHEET_NAME_ALT);
  if (!sheet) {
    throw new Error('No existe la pestaña: ' + SHEET_NAME + ' ni ' + SHEET_NAME_ALT);
  }
  return sheet;
}

function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonpOutput(callback, obj) {
  var cb = callback || 'callback';
  return ContentService
    .createTextOutput(cb + '(' + JSON.stringify(obj) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function testReadData() {
  var report = buildDebugReport();
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}
