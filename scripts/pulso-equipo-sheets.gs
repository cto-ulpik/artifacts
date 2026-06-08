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
//  doPost — recibe el JSON del formulario
// ════════════════════════════════════════════════════════════
function doPost(e) {
  try {
    // Parsear el body JSON
    const payload = JSON.parse(e.postData.contents);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);

    // Crear hoja si no existe
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow(HEADERS);
      // Dar formato al encabezado
      const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
      headerRange.setBackground('#FF5A1F');
      headerRange.setFontColor('#FFFFFF');
      headerRange.setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    // Calcular semana ISO desde el timestamp
    const semanaISO = calcularSemanaISO(new Date(payload.timestamp));

    // Agregar fila
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

    // Auto-ajustar columnas
    sheet.autoResizeColumns(1, HEADERS.length);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    // Registrar error en una hoja de logs
    logError(err.toString(), e?.postData?.contents || '');

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
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
function testManual() {
  const fakeEvent = {
    postData: {
      contents: JSON.stringify({
        id: Date.now(),
        timestamp: new Date().toISOString(),
        nombre: 'Test Usuario',
        score: 8,
        carga: 'Alta pero bien',
        claridad: 'Sí siempre',
        motivacion: 'Muy motivado/a',
        sugerencia: 'Prueba de integración',
        categoria: 'PROCESOS'
      })
    }
  };
  const result = doPost(fakeEvent);
  Logger.log(result.getContent());
}
