/**
 * ULPIK · Pulso del Equipo → Google Sheets
 *
 * 1. Crea una hoja con encabezados en la fila 1:
 *    Timestamp | Semana | Nombre | Score | Carga | Claridad | Motivacion | Sugerencia | Categoria
 * 2. Extensiones → Apps Script → pega este código
 * 3. Cambia SPREADSHEET_ID y SHEET_NAME si aplica
 * 4. Implementar → Nueva implementación → Aplicación web
 *    - Ejecutar como: Yo
 *    - Quién tiene acceso: Cualquier persona
 * 5. Copia la URL /exec y pégala en APPS_SCRIPT_URL del HTML
 */

const SPREADSHEET_ID = 'TU_SPREADSHEET_ID_AQUI';
const SHEET_NAME = 'Pulso';

function getSheet_() {
  const ss = SPREADSHEET_ID === 'TU_SPREADSHEET_ID_AQUI'
    ? SpreadsheetApp.getActiveSpreadsheet()
    : SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  return sheet;
}

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) || '{}';
    const data = JSON.parse(raw);
    const sheet = getSheet_();

    sheet.appendRow([
      data.timestamp || new Date().toISOString(),
      data.semana || '',
      data.nombre || 'Anónimo/a',
      data.score || '',
      data.carga || '',
      data.claridad || '',
      data.motivacion || '',
      data.sugerencia || '',
      data.categoria || ''
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: 'ulpik-pulso-equipo' }))
    .setMimeType(ContentService.MimeType.JSON);
}
