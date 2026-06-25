/**
 * NPS ULPIK — Webhook + lectura para tablero de comité
 *
 * Pegar en el spreadsheet "NPS ULPIK" → Extensiones → Apps Script.
 * Desplegar: Implementar → Nueva implementación → Aplicación web
 *   - Ejecutar como: Yo
 *   - Quién tiene acceso: Cualquier persona
 *
 * Tras actualizar el código, crear NUEVA implementación (no solo guardar).
 */

var SHEET_NAME = 'Respuestas de formulario 1';
var NOTIFY_EMAIL = 'churchill@ulpik.com';

function doGet(e) {
  e = e || {};
  var p = e.parameter || {};

  // Lectura para tablero (JSONP desde GitHub Pages)
  if (p.action === 'read') {
    try {
      var rows = readSurveyData();
      return jsonpOutput(p.callback, { ok: true, rows: rows });
    } catch (err) {
      return jsonpOutput(p.callback, { ok: false, error: String(err.message || err) });
    }
  }

  if (p.data) {
    try {
      var payload = JSON.parse(p.data);
      var secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
      if (secret && payload.token !== secret) {
        throw new Error('Token inválido');
      }
      validatePayload(payload);
      appendSurveyRow(payload);
      return jsonpOutput(p.callback, { ok: true });
    } catch (err) {
      return jsonpOutput(p.callback, { ok: false, error: String(err.message || err) });
    }
  }

  if (p.callback) {
    return jsonpOutput(p.callback, { ok: true, message: 'Webhook NPS ULPIK activo' });
  }
  return jsonOutput({ ok: true, message: 'Webhook NPS ULPIK activo' });
}

function doPost(e) {
  try {
    var payload = parsePayload(e);
    validatePayload(payload);
    appendSurveyRow(payload);
    return jsonOutput({ ok: true });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err.message || err) });
  }
}

function parsePayload(e) {
  var data = null;
  if (e && e.postData && e.postData.contents) {
    try {
      data = JSON.parse(e.postData.contents);
    } catch (err) {
      throw new Error('JSON inválido en POST');
    }
  } else if (e && e.parameter && e.parameter.payload) {
    data = JSON.parse(e.parameter.payload);
  }
  if (!data) {
    throw new Error('Cuerpo POST vacío');
  }
  var secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
  if (secret && data.token !== secret) {
    throw new Error('Token inválido');
  }
  return data;
}

function validatePayload(data) {
  if (!data.email || typeof data.email !== 'string') {
    throw new Error('Falta email');
  }
  if (!data.asesor || typeof data.asesor !== 'string') {
    throw new Error('Falta asesor');
  }
  ['nps', 'claridad', 'velocidad', 'calidad', 'satisfaccion'].forEach(function (key) {
    if (typeof data[key] !== 'number') {
      throw new Error('Falta calificación: ' + key);
    }
  });
}

function appendSurveyRow(data) {
  var sheet = getSheet();
  var tz = Session.getScriptTimeZone() || 'America/Guayaquil';
  var marca = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm:ss');

  var servicio = data.servicio;
  if (!servicio || servicio === 'No especificado') servicio = 'N/A';

  var instagram = data.instagram || '';

  sheet.appendRow([
    marca,
    data.email,
    data.asesor,
    data.nps,
    data.claridad,
    data.velocidad,
    data.calidad,
    data.satisfaccion,
    data.comentario || '',
    servicio,
    instagram
  ]);

  sendSurveyNotification(data, marca);
}

function readSurveyData() {
  var sheet = getSheet();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var tz = Session.getScriptTimeZone() || 'America/Guayaquil';
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!r[2] && !r[1] && (r[3] === '' || r[3] === null || r[3] === undefined)) continue;

    var marcaRaw = r[0];
    var marca = marcaRaw instanceof Date
      ? Utilities.formatDate(marcaRaw, tz, 'dd/MM/yyyy HH:mm:ss')
      : String(marcaRaw || '');
    var parsed = parseMarcaTemporal(marcaRaw instanceof Date ? marcaRaw : marca);

    rows.push({
      marca: marca,
      fecha_str: parsed.iso,
      mes: parsed.mes,
      email: String(r[1] || ''),
      asesor: String(r[2] || ''),
      nps: numCol(r[3]),
      claridad: numCol(r[4]),
      velocidad: numCol(r[5]),
      calidad: numCol(r[6]),
      satisfaccion: numCol(r[7]),
      comentario: String(r[8] || ''),
      servicio: String(r[9] || 'N/A'),
      instagram: String(r[10] || '')
    });
  }
  return rows;
}

function parseMarcaTemporal(marca) {
  if (marca instanceof Date) {
    var tz = Session.getScriptTimeZone() || 'America/Guayaquil';
    var iso = Utilities.formatDate(marca, tz, 'yyyy-MM-dd');
    return { iso: iso, mes: iso.substring(0, 7) };
  }
  var s = String(marca || '').trim();
  var isoM = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoM) {
    return { iso: isoM[1] + '-' + isoM[2] + '-' + isoM[3], mes: isoM[1] + '-' + isoM[2] };
  }
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) {
    return { iso: '', mes: '' };
  }
  var d = +m[1], mo = +m[2], y = +m[3];
  var iso = y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
  return { iso: iso, mes: y + '-' + ('0' + mo).slice(-2) };
}

function numCol(v) {
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

function sendSurveyNotification(data, marca) {
  try {
    var avg = ((data.nps + data.claridad + data.velocidad + data.calidad + data.satisfaccion) / 5).toFixed(1);
    var tituloUrl = 'https://ia.ulpik.com/titulo/?email=' + encodeURIComponent(data.email || '');
    var subject = 'Nueva encuesta de satisfacción — ' + data.email;
    var body =
      'Alguien acaba de completar la encuesta de satisfacción en ia.ulpik.com/satisfaccion.\n\n' +
      'Correo del respondiente: ' + data.email + '\n' +
      'Fecha: ' + marca + '\n' +
      'Asesor: ' + data.asesor + '\n' +
      'Servicio: ' + (data.servicio || 'N/A') + '\n' +
      'Promedio: ' + avg + '/10\n' +
      'NPS: ' + data.nps + ' | Claridad: ' + data.claridad + ' | Velocidad: ' + data.velocidad +
      ' | Calidad: ' + data.calidad + ' | Satisfacción: ' + data.satisfaccion + '\n\n' +
      'Comentario:\n' + (data.comentario || '(sin comentario)') + '\n\n' +
      'Enviar título de concesión (correo precargado):\n' + tituloUrl + '\n\n' +
      '— Encuesta NPS Ulpik (automático)';

    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: subject,
      body: body,
      name: 'Encuesta Ulpik'
    });
  } catch (err) {
    Logger.log('No se pudo enviar correo a ' + NOTIFY_EMAIL + ': ' + err);
  }
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error('No existe la pestaña: ' + SHEET_NAME);
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

function authorizeMail() {
  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: 'Autorización — Encuesta Ulpik',
    body: 'Si recibes este correo, el script ya puede notificar nuevas encuestas.',
    name: 'Encuesta Ulpik'
  });
  Logger.log('Correo de autorización enviado a ' + NOTIFY_EMAIL);
}

function testAppendRow() {
  appendSurveyRow({
    email: 'prueba@ulpik.com',
    asesor: 'Esteban Maldonado',
    nps: 10,
    claridad: 9,
    velocidad: 8,
    calidad: 9,
    satisfaccion: 10,
    comentario: 'Prueba desde Apps Script',
    servicio: 'Registro de marca',
    instagram: '@ulpik_test'
  });
  Logger.log('Fila de prueba agregada.');
}

function testReadData() {
  var rows = readSurveyData();
  Logger.log('Filas leídas: ' + rows.length);
  if (rows.length) Logger.log(JSON.stringify(rows[rows.length - 1]));
}
