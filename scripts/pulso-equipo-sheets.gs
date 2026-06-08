// ════════════════════════════════════════════════════════════
//  APPS SCRIPT — Pulso del Equipo Ulpik → Google Sheets
//  Pegar este código en: Extensions > Apps Script del Sheet
//  https://docs.google.com/spreadsheets/d/14Ubs_VXX_DLa86exaL4XslvCfY7XTKthER4CpYQBmpE
// ════════════════════════════════════════════════════════════

const SHEET_NAME = 'Respuestas';  // Nombre de la hoja destino

// ── Encabezados (se crean automáticamente la primera vez) ──
const HEADERS = [
  'Timestamp',
  'Semana ISO',
  'Nombre',
  'Score Bienestar',
  'Carga de Trabajo',
  'Claridad de Rol',
  'Motivación',
  'Sugerencia',
  'Categoría IA',
  'ID Respuesta'
];

// ════════════════════════════════════════════════════════════
//  doPost — recibe el JSON del formulario (NO ejecutar doPost a mano)
//  Para probar: ejecutar testManual() desde el editor
// ════════════════════════════════════════════════════════════
function doPost(e) {
  try {
    const payload = parsePayload_(e);
    guardarRespuesta_(payload);
    return jsonResponse_({ status: 'ok' });
  } catch (err) {
    logError(err.toString(), stringifyEvent_(e));
    return jsonResponse_({ status: 'error', message: err.toString() });
  }
}

/** Lee JSON desde form-urlencoded (payload=...) o body text/plain */
function parsePayload_(e) {
  if (!e) {
    throw new Error('Sin evento HTTP. No ejecutes doPost directamente: usa testManual().');
  }
  if (e.parameter && e.parameter.payload) {
    return JSON.parse(e.parameter.payload);
  }
  if (e.postData && e.postData.contents) {
    return JSON.parse(e.postData.contents);
  }
  throw new Error('Petición vacía. Envía el campo "payload" con el JSON.');
}

function guardarRespuesta_(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setBackground('#FF5A1F');
    headerRange.setFontColor('#FFFFFF');
    headerRange.setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  const semanaISO = calcularSemanaISO(new Date(payload.timestamp || new Date()));

  sheet.appendRow([
    payload.timestamp || new Date().toISOString(),
    semanaISO,
    payload.nombre || 'Anónimo/a',
    payload.score || '',
    payload.carga || '',
    payload.claridad || '',
    payload.motivacion || '',
    payload.sugerencia || '',
    payload.categoria || '',
    payload.id || ''
  ]);

  sheet.autoResizeColumns(1, HEADERS.length);
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function stringifyEvent_(e) {
  if (!e) return '';
  if (e.parameter && e.parameter.payload) return e.parameter.payload;
  if (e.postData && e.postData.contents) return e.postData.contents;
  return '';
}

// ════════════════════════════════════════════════════════════
//  doGet — ping de prueba (útil para verificar que está vivo)
// ════════════════════════════════════════════════════════════
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'Pulso Ulpik API activa ✓' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ════════════════════════════════════════════════════════════
//  Helpers
// ════════════════════════════════════════════════════════════

function calcularSemanaISO(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const wn = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${d.getFullYear()}-W${String(wn).padStart(2, '0')}`;
}

function logError(errorMsg, payload) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let logSheet = ss.getSheetByName('Logs');
    if (!logSheet) {
      logSheet = ss.insertSheet('Logs');
      logSheet.appendRow(['Timestamp', 'Error', 'Payload']);
    }
    logSheet.appendRow([new Date().toISOString(), errorMsg, payload]);
  } catch (e) {
    // Si incluso el log falla, no hacer nada
  }
}

// ════════════════════════════════════════════════════════════
//  Función de prueba manual (ejecutar desde el editor)
// ════════════════════════════════════════════════════════════
function datosPrueba_() {
  return {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    nombre: 'Test Usuario',
    score: 8,
    carga: 'Alta pero bien',
    claridad: 'Sí siempre',
    motivacion: 'Muy motivado/a',
    sugerencia: 'Prueba de integración',
    categoria: 'PROCESOS'
  };
}

/** Simula POST con JSON en postData (curl / clientes antiguos) */
function testManual() {
  const result = doPost({
    postData: { contents: JSON.stringify(datosPrueba_()) }
  });
  Logger.log(result.getContent());
}

/** Simula POST desde GitHub Pages (form-urlencoded payload=...) */
function testManualWeb() {
  const result = doPost({
    parameter: { payload: JSON.stringify(datosPrueba_()) }
  });
  Logger.log(result.getContent());
}
