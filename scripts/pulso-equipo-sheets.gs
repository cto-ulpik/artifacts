// ════════════════════════════════════════════════════════════
//  APPS SCRIPT — Pulso del Equipo Ulpik → Google Sheets + OpenAI
//  Pegar en: Extensions > Apps Script del Sheet
//  https://docs.google.com/spreadsheets/d/14Ubs_VXX_DLa86exaL4XslvCfY7XTKthER4CpYQBmpE
//
//  SETUP OpenAI:
//  1. ⚙ Proyecto > Configuración del proyecto > Propiedades del script:
//       OPENAI_API_KEY  = sk-...
//       OPENAI_MODEL    = gpt-4o-mini   (opcional)
//  2. Implementar > Nueva implementación > Aplicación web
//       Ejecutar como: Yo
//       Quién tiene acceso: Cualquier persona
//  3. Copiar URL /exec → APPS_SCRIPT_URL en pulso-equipo-ulpik.html
//  4. Probar: ejecutar testConfig() y testObserve()
// ════════════════════════════════════════════════════════════

const SHEET_NAME = 'Respuestas';
const DEFAULT_MODEL = 'gpt-4o-mini';
const CATEGORIAS = ['PROCESOS', 'COMUNICACIÓN', 'CARGA DE TRABAJO', 'AMBIENTE', 'SIN SUGERENCIA'];

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
//  HTTP
// ════════════════════════════════════════════════════════════

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || '';

    if (action === 'get_all') {
      return respond_({ status: 'ok', data: getAllRespuestas_() }, e);
    }
    if (action === 'save') {
      guardarRespuesta_(parsePayload_(e));
      return respond_({ status: 'ok' }, e);
    }
    if (action === 'classify') {
      return respond_(clasificarSugerencia_(parsePayload_(e)), e);
    }
    if (action === 'observe') {
      return respond_(generarObservaciones_(parsePayload_(e)), e);
    }

    return respond_({ status: 'ok', message: 'Pulso Ulpik API activa ✓' }, e);
  } catch (err) {
    logError(err.toString(), stringifyEvent_(e));
    return respond_({ status: 'error', message: err.toString() }, e);
  }
}

function doPost(e) {
  try {
    guardarRespuesta_(parsePayload_(e));
    return respond_({ status: 'ok' }, e);
  } catch (err) {
    logError(err.toString(), stringifyEvent_(e));
    return respond_({ status: 'error', message: err.toString() }, e);
  }
}

function respond_(obj, e) {
  const text = JSON.stringify(obj);
  const cb = e && e.parameter && e.parameter.callback;
  if (cb && /^[a-zA-Z_$][\w$]*$/.test(cb)) {
    return ContentService
      .createTextOutput(cb + '(' + text + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);
}

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

// ════════════════════════════════════════════════════════════
//  Google Sheets
// ════════════════════════════════════════════════════════════

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

function getAllRespuestas_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow(), HEADERS.length).getValues();
  return rows.map(function(row) {
    return {
      timestamp: row[0] ? new Date(row[0]).toISOString() : '',
      semana: String(row[1] || ''),
      nombre: String(row[2] || 'Anónimo/a'),
      score: Number(row[3]) || 0,
      carga: String(row[4] || ''),
      claridad: String(row[5] || ''),
      motivacion: String(row[6] || ''),
      sugerencia: String(row[7] || ''),
      categoria: String(row[8] || ''),
      id: row[9] || ''
    };
  }).filter(function(r) { return r.id || r.score; });
}

// ════════════════════════════════════════════════════════════
//  OpenAI — clasificar sugerencia
// ════════════════════════════════════════════════════════════

function clasificarSugerencia_(payload) {
  const texto = String((payload && (payload.texto || payload.sugerencia)) || '').trim();
  if (texto.length < 5) {
    return { status: 'ok', categoria: 'SIN SUGERENCIA' };
  }

  const prompt = [
    'Clasifica esta sugerencia de un empleado de Ulpik (legaltech Ecuador) en UNA categoría exacta:',
    'PROCESOS, COMUNICACIÓN, CARGA DE TRABAJO, AMBIENTE, SIN SUGERENCIA.',
    'Responde SOLO con JSON: {"categoria":"..."}',
    '',
    'Sugerencia: "' + texto + '"'
  ].join('\n');

  const raw = callOpenAI_(prompt, 80, true);
  let parsed;
  try {
    parsed = JSON.parse(String(raw).replace(/```json|```/g, '').trim());
  } catch (e) {
    const cat = String(raw).trim().toUpperCase();
    parsed = { categoria: CATEGORIAS.indexOf(cat) >= 0 ? cat : 'SIN SUGERENCIA' };
  }

  const categoria = String(parsed.categoria || '').trim().toUpperCase();
  return {
    status: 'ok',
    categoria: CATEGORIAS.indexOf(categoria) >= 0 ? categoria : 'SIN SUGERENCIA'
  };
}

// ════════════════════════════════════════════════════════════
//  OpenAI — observaciones del período
// ════════════════════════════════════════════════════════════

function generarObservaciones_(payload) {
  if (!payload || !payload.stats) {
    throw new Error('Payload inválido para observaciones.');
  }

  const stats = payload.stats;
  const periodo = payload.periodo || {};
  const respuestas = Array.isArray(payload.respuestas) ? payload.respuestas : [];
  const sugerencias = Array.isArray(payload.sugerencias) ? payload.sugerencias : [];
  const categorias = payload.categorias || {};

  if (Number(stats.total) === 0) {
    return {
      status: 'ok',
      observaciones: {
        resumen: 'No hay respuestas registradas en este período. Invita al equipo a completar el pulso semanal.',
        senales_positivas: [],
        senales_alerta: [],
        acciones_recomendadas: ['Enviar recordatorio del check-in semanal al equipo.']
      }
    };
  }

  const prompt = [
    'Eres consultor de clima laboral para Ulpik, una legaltech en Ecuador.',
    'Analiza el pulso del equipo y escribe observaciones claras para la dirección (Sofía / liderazgo).',
    'Sé concreto, empático y accionable. No inventes datos. Usa español de Ecuador.',
    '',
    'PERÍODO: ' + (periodo.label || periodo.clave || '—') + ' (' + (periodo.tipo || 'semana') + ')',
    'ESTADÍSTICAS:',
    '- Respuestas: ' + stats.total,
    '- Promedio bienestar: ' + (stats.promedio != null ? stats.promedio + '/10' : '—'),
    '- Con sugerencia escrita: ' + (stats.conSugerencia || 0),
    '- Carga desbordante: ' + (stats.desbordados || 0),
    '- Sin claridad de rol: ' + (stats.sinClaridad || 0),
    '- Muy motivados: ' + (stats.muyMotivados || 0),
    '',
    'DISTRIBUCIÓN DE RESPUESTAS (anonimizado):',
    JSON.stringify(respuestas.slice(0, 30)),
    '',
    'SUGERENCIAS (anonimizado):',
    sugerencias.length ? JSON.stringify(sugerencias.slice(0, 10)) : 'Ninguna',
    '',
    'CATEGORÍAS IA:',
    JSON.stringify(categorias),
    '',
    'Responde ÚNICAMENTE JSON válido con esta estructura:',
    '{',
    '  "resumen": "2-3 oraciones con el diagnóstico general del período",',
    '  "senales_positivas": ["hasta 3 bullets"],',
    '  "senales_alerta": ["hasta 3 bullets, vacío si no hay alertas"],',
    '  "acciones_recomendadas": ["hasta 3 acciones concretas para la próxima semana"]',
    '}'
  ].join('\n');

  const raw = callOpenAI_(prompt, 900, true);
  const observaciones = parseObservaciones_(raw);
  return { status: 'ok', observaciones: observaciones };
}

function parseObservaciones_(rawText) {
  const clean = String(rawText).replace(/```json|```/g, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch (e) {
    throw new Error('La IA no devolvió JSON válido.');
  }

  return {
    resumen: String(parsed.resumen || '').trim(),
    senales_positivas: Array.isArray(parsed.senales_positivas) ? parsed.senales_positivas : [],
    senales_alerta: Array.isArray(parsed.senales_alerta) ? parsed.senales_alerta : [],
    acciones_recomendadas: Array.isArray(parsed.acciones_recomendadas) ? parsed.acciones_recomendadas : []
  };
}

function callOpenAI_(prompt, maxTokens, jsonMode) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('OPENAI_API_KEY');

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY no configurada. Ve a Configuración del proyecto > Propiedades del script.');
  }

  const model = props.getProperty('OPENAI_MODEL') || DEFAULT_MODEL;
  const body = {
    model: model,
    messages: [
      { role: 'system', content: 'Respondes en español. Eres conciso y útil para liderazgo de equipos.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.4,
    max_tokens: maxTokens || 800
  };

  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const bodyText = response.getContentText();
  let bodyParsed;

  try {
    bodyParsed = JSON.parse(bodyText);
  } catch (e) {
    throw new Error('Respuesta inválida de OpenAI (HTTP ' + code + ').');
  }

  if (code !== 200) {
    const msg = (bodyParsed.error && bodyParsed.error.message) ? bodyParsed.error.message : bodyText;
    throw new Error('OpenAI error ' + code + ': ' + msg);
  }

  const content = bodyParsed.choices && bodyParsed.choices[0] && bodyParsed.choices[0].message
    ? bodyParsed.choices[0].message.content
    : '';

  if (!content) {
    throw new Error('OpenAI devolvió una respuesta vacía.');
  }

  return content;
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
  return d.getFullYear() + '-W' + String(wn).padStart(2, '0');
}

function logError(errorMsg, payload) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let logSheet = ss.getSheetByName('Logs');
    if (!logSheet) {
      logSheet = ss.insertSheet('Logs');
      logSheet.appendRow(['Timestamp', 'Error', 'Payload']);
    }
    logSheet.appendRow([new Date().toISOString(), errorMsg, String(payload).slice(0, 500)]);
  } catch (e) {
    // ignore
  }
}

function stringifyEvent_(e) {
  if (!e) return '';
  if (e.parameter && e.parameter.payload) return e.parameter.payload;
  if (e.postData && e.postData.contents) return e.postData.contents;
  return '';
}

// ════════════════════════════════════════════════════════════
//  Pruebas manuales
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
    sugerencia: 'Mejorar la comunicación entre áreas en proyectos urgentes',
    categoria: 'COMUNICACIÓN'
  };
}

function testManual() {
  const result = doPost({
    postData: { contents: JSON.stringify(datosPrueba_()) }
  });
  Logger.log(result.getContent());
}

function testManualWeb() {
  const result = doGet({
    parameter: {
      action: 'save',
      payload: JSON.stringify(datosPrueba_())
    }
  });
  Logger.log(result.getContent());
}

function testClassify() {
  const result = doGet({
    parameter: {
      action: 'classify',
      payload: JSON.stringify({ texto: 'Necesitamos mejorar los procesos de onboarding' })
    }
  });
  Logger.log(result.getContent());
}

function testObserve() {
  const result = doGet({
    parameter: {
      action: 'observe',
      payload: JSON.stringify({
        periodo: { tipo: 'semana', label: 'Semana de prueba', clave: '2026-W22' },
        stats: {
          total: 4,
          promedio: 7.2,
          conSugerencia: 2,
          desbordados: 1,
          sinClaridad: 1,
          muyMotivados: 2
        },
        respuestas: [
          { score: 8, carga: 'Manejable', claridad: 'Sí siempre', motivacion: 'Muy motivado/a' },
          { score: 6, carga: 'Desbordante', claridad: 'A veces', motivacion: 'Regular' }
        ],
        sugerencias: [
          { texto: 'Más claridad en prioridades', categoria: 'COMUNICACIÓN' }
        ],
        categorias: { COMUNICACIÓN: 1, PROCESOS: 0 }
      })
    }
  });
  Logger.log(result.getContent());
}

function testConfig() {
  const key = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  Logger.log(key ? 'OPENAI_API_KEY configurada ✓' : 'Falta OPENAI_API_KEY en Propiedades del script');
}
