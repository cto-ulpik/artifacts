// ════════════════════════════════════════════════════════════
//  APPS SCRIPT — Pulso del Equipo Ulpik → Google Sheets + OpenAI
//  Sheet: https://docs.google.com/spreadsheets/d/14Ubs_VXX_DLa86exaL4XslvCfY7XTKthER4CpYQBmpE
//
//  Acciones via ?action=
//    save      → guarda una respuesta
//    get_all   → devuelve todas las respuestas
//    classify  → categoriza sugerencia (OpenAI)
//    observe   → observaciones del período (OpenAI)
//    feedback  → recomendación individual al enviar (OpenAI)
//    chat      → Apoyo Comercial David (OpenAI, system + userMsg)
//    (sin action) → ping
//
//  SETUP OpenAI:
//  1. ⚙ Proyecto > Configuración > Propiedades del script:
//       OPENAI_API_KEY  = sk-...
//       OPENAI_MODEL    = gpt-4o-mini   (opcional)
//  2. Implementar > Nueva implementación > Aplicación web
//       Ejecutar como: Yo | Acceso: Cualquier persona
//  3. Autorizar OpenAI (OBLIGATORIO tras cada deploy nuevo):
//       Ejecutar testOpenAIAuth() desde el editor → Aceptar permisos
//       (sin esto, la Web App falla con "No cuentas con permiso UrlFetchApp.fetch")
//  4. Probar: testChat() → testFeedback() → testObtenerTodas()
// ════════════════════════════════════════════════════════════

const SHEET_NAME = 'Respuestas';
const DEFAULT_MODEL = 'gpt-4o-mini';
const CATEGORIAS = ['PROCESOS', 'COMUNICACIÓN', 'CARGA DE TRABAJO', 'AMBIENTE', 'SIN SUGERENCIA'];

const HEADERS = [
  'Timestamp', 'Semana ISO', 'Nombre', 'Score Bienestar',
  'Carga de Trabajo', 'Claridad de Rol', 'Motivación',
  'Sugerencia', 'Categoría IA', 'ID Respuesta'
];

const CAMPO_MAP = [
  'timestamp', 'semana', 'nombre', 'score',
  'carga', 'claridad', 'motivacion',
  'sugerencia', 'categoria', 'id'
];

// ════════════════════════════════════════════════════════════
//  HTTP — router principal
// ════════════════════════════════════════════════════════════

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'ping';

    if (action === 'save') {
      guardarRespuesta(parsePayload_(e));
      return jsonResponse({ status: 'ok' }, e);
    }

    if (action === 'get_all') {
      return jsonResponse({ status: 'ok', data: obtenerTodas() }, e);
    }

    if (action === 'classify') {
      return jsonResponse(clasificarSugerencia_(parsePayload_(e)), e);
    }

    if (action === 'observe') {
      return jsonResponse(generarObservaciones_(parsePayload_(e)), e);
    }

    if (action === 'feedback') {
      return jsonResponse(generarFeedback_(parsePayload_(e)), e);
    }

    if (action === 'chat') {
      return jsonResponse(chatComercial_(parsePayload_(e)), e);
    }

    return jsonResponse({ status: 'ok', message: 'Pulso Ulpik API activa ✓' }, e);

  } catch (err) {
    logError(err.toString(), stringifyEvent_(e));
    return jsonResponse({ status: 'error', message: err.toString() }, e);
  }
}

function doPost(e) {
  return doGet(e);
}

function parsePayload_(e) {
  if (!e) {
    throw new Error('Sin evento HTTP. Usa testGuardar() o testFeedback() desde el editor.');
  }
  if (e.parameter && e.parameter.payload) {
    try {
      return JSON.parse(decodeURIComponent(e.parameter.payload));
    } catch (err) {
      return JSON.parse(e.parameter.payload);
    }
  }
  if (e.postData && e.postData.contents) {
    return JSON.parse(e.postData.contents);
  }
  throw new Error('Petición vacía. Envía el campo "payload" con el JSON.');
}

function jsonResponse(obj, e) {
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

function stringifyEvent_(e) {
  if (!e) return '';
  if (e.parameter && e.parameter.payload) return e.parameter.payload;
  if (e.postData && e.postData.contents) return e.postData.contents;
  return '';
}

// ════════════════════════════════════════════════════════════
//  Google Sheets
// ════════════════════════════════════════════════════════════

function guardarRespuesta(payload) {
  const sheet = getOrCreateSheet();
  const semana = payload.semana || calcularSemanaISO(new Date(payload.timestamp || new Date()));
  sheet.appendRow([
    payload.timestamp  || new Date().toISOString(),
    semana,
    payload.nombre     || 'Anónimo/a',
    payload.score      || '',
    payload.carga      || '',
    payload.claridad   || '',
    payload.motivacion || '',
    payload.sugerencia || '',
    payload.categoria  || '',
    payload.id         || ''
  ]);
  sheet.autoResizeColumns(1, HEADERS.length);
}

function obtenerTodas() {
  const sheet = getOrCreateSheet();
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];

  return rows.slice(1).map(function(row) {
    const obj = {};
    CAMPO_MAP.forEach(function(campo, i) {
      let val = row[i];
      if (val instanceof Date) val = val.toISOString();
      if (campo === 'score' || campo === 'id') val = Number(val) || val;
      obj[campo] = val;
    });
    return obj;
  }).filter(function(r) { return r.timestamp; });
}

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    const hr = sheet.getRange(1, 1, 1, HEADERS.length);
    hr.setBackground('#FF5A1F');
    hr.setFontColor('#FFFFFF');
    hr.setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
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
//  OpenAI — observaciones del período (Diagnóstico General)
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
  return { status: 'ok', observaciones: parseObservaciones_(raw) };
}

// ════════════════════════════════════════════════════════════
//  OpenAI — feedback individual al enviar pulso (score ≤ 5)
// ════════════════════════════════════════════════════════════

function generarFeedback_(payload) {
  const score = Number(payload && payload.score);
  if (!score || score < 1 || score > 10) {
    throw new Error('Score inválido para feedback.');
  }

  const prompt = [
    'Eres coach de bienestar laboral en Ulpik, una legaltech en Ecuador.',
    'Un empleado acaba de enviar su pulso semanal. Escribe un mensaje breve, empático y práctico para ESA persona.',
    'Basa tu respuesta en las 4 dimensiones del pulso (bienestar, carga, claridad, motivación).',
    'No uses nombre. Tono cercano y humano, no corporativo. Español de Ecuador.',
    'Si el bienestar es 5 o menos, valida lo que siente y ofrece 1-2 acciones concretas y realizables esta semana.',
    '',
    'BIENESTAR (1-10): ' + score,
    'Carga de trabajo: ' + String(payload.carga || ''),
    'Claridad de rol: ' + String(payload.claridad || ''),
    'Motivación: ' + String(payload.motivacion || ''),
    String(payload.sugerencia || '').trim()
      ? 'Sugerencia opcional del empleado: ' + String(payload.sugerencia).trim()
      : 'Sin sugerencia escrita.',
    '',
    'Responde ÚNICAMENTE JSON:',
    '{"mensaje":"1-2 oraciones de validación empática","recomendacion":"1-3 oraciones con acciones concretas para esta semana"}'
  ].join('\n');

  const raw = callOpenAI_(prompt, 350, true);
  return { status: 'ok', feedback: parseFeedback_(raw) };
}

// ════════════════════════════════════════════════════════════
//  OpenAI — Apoyo Comercial David (chat con system + user)
// ════════════════════════════════════════════════════════════

function chatComercial_(payload) {
  const userMsg = String(payload.userMsg || payload.user || '').trim();
  if (!userMsg) throw new Error('Falta el mensaje del usuario.');

  let system;
  if (payload.system) {
    system = String(payload.system).trim();
  } else {
    const sub = String(payload.sub || '').trim();
    if (!sub) throw new Error('Falta la instrucción (sub).');
    system = buildComercialSystem_(sub);
  }

  const text = callOpenAIChat_(system, userMsg, Number(payload.maxTokens) || 4000);
  return { status: 'ok', text: text };
}

function buildComercialSystem_(sub) {
  return [
    'Actúa como copiloto comercial experto de ULPIK (registro de marcas en Ecuador), apoyando al ASESOR en su venta por WhatsApp/chat.',
    'Básate EXCLUSIVAMENTE en el Playbook. No inventes datos, precios ni garantías fuera del Playbook.',
    'Tono confiado, cálido y comercial. Responde en español.',
    '',
    PLAYBOOK_COMERCIAL_MESSY,
    '',
    '=== PLAYBOOK ===',
    PLAYBOOK_COMERCIAL,
    '',
    '=== TU TAREA ===',
    sub,
    '',
    'Devuelve ÚNICAMENTE el objeto JSON pedido. Sin texto antes ni después, sin markdown, sin backticks.',
    'REGLA CRÍTICA: dentro de los VALORES de texto NUNCA uses comilla doble ("); para citar usa comillas simples o «».',
    'No uses saltos de línea dentro de un valor. Esto es OBLIGATORIO para que el JSON sea válido.'
  ].join('\n');
}

var PLAYBOOK_COMERCIAL_MESSY = 'Los textos pueden venir pegados tal cual desde un CRM con ruido (horas, [Audio], <Multimedia omitido>, emojis, líneas sin etiqueta). Infiere quién habla: el ASESOR representa a ULPIK (manda precios, garantía, link de pago, datos bancarios); el CLIENTE pregunta precio, da el nombre de su marca u objeta. Ignora el ruido; no te bases en audios/multimedia que no puedes leer.';

var PLAYBOOK_COMERCIAL = [
  'PLAYBOOK DE VENTAS ULPIK v2.0 — Referencia única.',
  'LAS 6 FASES: 1. APERTURA (saludo + nombre + pregunta abierta). 2. DESCUBRIMIENTO (nombre, rubro producto/servicio, logo, antigüedad, "botón rojo"). 3. PROPUESTA (conector dolor->solución + precio anclado $620->$480 + garantía + pregunta binaria con NOMBRE DE LA MARCA). 4. MANEJO DE DUDAS (validar + responder + reforzar garantía). 5. PAGO (datos según método). 6. POST-VENTA (confirmar + encuesta + búsqueda fonética 48h).',
  'REGLA UNIVERSAL #1: CADA mensaje del asesor termina en PREGUNTA. RITMO: llegar a la propuesta antes del mensaje #4.',
  'BOTÓN ROJO: "Perfecto [Nombre], ¿por qué busca registrar su marca? ¿Tal vez por seguridad o por formalizar? Esto no cambia nada en el proceso, es solo para entenderle 100% personalizado."',
  'PROPUESTA compacta: conector dolor->solución (eco verbal) + "$620 normal, promo TODO en $480" + garantía (si damos luz verde en la búsqueda fonética y no se registra, devolvemos el 100%) + pregunta de cierre con [Marca].',
  'Conectores: seguridad->proteger lo construido/evitar copias; formalidad->respaldo legal, facturación, contratos; inversión grande->blindar la inversión y el branding; exportar/franquiciar->escalar/licenciar; redes/Amazon->reclamar marca en plataformas; marca propia->activo que se vende/hereda; susto->prioridad legal.',
  'CIERRE RÁPIDO (al ver señal de compra): "Perfecto [Nombre], para iniciar ¿le gustaría hacerlo con transferencia o con tarjeta?". Si ninguno: PayPal/débito/cripto. Tiempos: 6-9 meses con seguimiento semanal.',
  'OBJECIONES (semáforo: ROJO me detengo y escucho; AMARILLO empatizo sin contradecir; VERDE avanzo con pregunta). Validar -> responder -> cerrar en pregunta. Las 7:',
  '1. ¿Es seguro/estafa? -> remoto desde 2020, casos Daniel Pintado (medallista olímpico), Caro Sánchez (Masterchef), Deportivo Cuenca; ofrecer videollamada.',
  '2. ¿Y si no sale registrada/me devuelven? -> garantía por luces.',
  '3. Está caro/hay más barato -> los $480 incluyen TODO (tasa SENADI $208, asesoría 6-9 meses, vigilancia 10 años, garantía); los baratos cobran la tasa aparte.',
  '4. Tengo que pensarlo -> ~1500 marcas/mes en Ecuador, protección solo desde el registro; ¿qué duda puntual le frena?',
  '5. Consultarlo con socio/familia -> enviar resumen para compartir + agendar día de retoma y reservar la promo.',
  '6. ¿2 pagos? -> diferido 3 y 6 meses sin intereses (Datafast) o hasta 12 con intereses (Payphone).',
  '7. Luz amarilla/riesgo -> 50-65% se registra en la mayoría + cubrimos oposición sin costo; sugerir término distintivo.',
  'GARANTÍA POR LUCES: Verde (70-100%) si no se registra devolvemos 100%. Amarilla (50-65%) la mayoría se registra + cubrimos oposición. Roja (0-45%) asesoramos para hacerla registrable + regalamos otra búsqueda fonética.',
  'PAGO: TARJETA -> link https://ulpik.com/marca/ (Datafast hasta 6 meses sin intereses, o Payphone). TRANSFERENCIA -> Banco Pichincha ahorros 2209097624 / Produbanco corriente 27059026109, IK SAS BIC RUC 0195112436001. Siempre cerrar pidiendo comprobante + datos de facturación + pregunta.',
  'POST-VENTA: tras el pago en <2 min: confirmación + encuesta + 3 preguntas (denominación, productos/servicios, logotipo).',
  'SEGUIMIENTO (cierra el 80%): 24-48h recordatorio + garantía; 3-5 días reactivación con dato ~1500 marcas/mes + invitación a llamada; 1-2 semanas renovación/videollamada 10 min. RECONTACTO: NO repetir el pitch; reconocer la conversación previa. Mínimo 5 toques.',
  'PALABRAS PROHIBIDAS -> alternativa: "te garantizo el registro"->"altas probabilidades según la búsqueda fonética"; "tu marca quedará registrada"->"vamos a gestionar el registro ante el SENADI"; "100% seguro"->"100% respaldado: si damos luz verde y no se registra, devolvemos el 100%". El SENADI es la única autoridad; NUNCA prometer el registro.',
  'MATA LA VENTA: afirmación sin pregunta; precio antes de descubrir; olvidar el nombre; repetir pitch a recontacto; debatir objeción; prometer llamada y no llegar; prometer el registro; abandonar tras un visto.',
  'PRUEBA SOCIAL: +1000 marcas registradas; remoto desde 2020; casos Daniel Pintado, Caro Sánchez, Deportivo Cuenca.'
].join('\n');

function callOpenAIChat_(systemMsg, userMsg, maxTokens) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('OPENAI_API_KEY');

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY no configurada. Ve a Configuración del proyecto > Propiedades del script.');
  }

  const model = props.getProperty('OPENAI_MODEL') || DEFAULT_MODEL;

  const response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userMsg }
      ],
      temperature: 0.4,
      max_tokens: maxTokens || 4000
    }),
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

function parseFeedback_(rawText) {
  const clean = String(rawText).replace(/```json|```/g, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch (e) {
    throw new Error('La IA no devolvió JSON válido.');
  }
  return {
    mensaje: String(parsed.mensaje || '').trim(),
    recomendacion: String(parsed.recomendacion || '').trim()
  };
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

function logError(errorMsg, payloadStr) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let logSheet = ss.getSheetByName('Logs');
    if (!logSheet) {
      logSheet = ss.insertSheet('Logs');
      logSheet.appendRow(['Timestamp', 'Error', 'Payload']);
    }
    logSheet.appendRow([new Date().toISOString(), errorMsg, String(payloadStr).slice(0, 500)]);
  } catch (e) { /* silencioso */ }
}

// ════════════════════════════════════════════════════════════
//  Pruebas manuales (editor Apps Script)
// ════════════════════════════════════════════════════════════

function testGuardar() {
  guardarRespuesta({
    id: Date.now(),
    timestamp: new Date().toISOString(),
    semana: calcularSemanaISO(new Date()),
    nombre: 'Test',
    score: 9,
    carga: 'Manejable',
    claridad: 'Sí siempre',
    motivacion: 'Muy motivado/a',
    sugerencia: 'Test ok',
    categoria: 'PROCESOS'
  });
  Logger.log('Guardado OK');
}

function testObtenerTodas() {
  Logger.log(JSON.stringify(obtenerTodas()));
}

function testConfig() {
  const key = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  Logger.log(key ? 'OPENAI_API_KEY configurada ✓' : 'Falta OPENAI_API_KEY en Propiedades del script');
}

/** Ejecutar una vez tras desplegar: fuerza la autorización de UrlFetchApp (OpenAI). */
function testOpenAIAuth() {
  const key = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  if (!key) throw new Error('Falta OPENAI_API_KEY en Propiedades del script');
  const response = UrlFetchApp.fetch('https://api.openai.com/v1/models', {
    method: 'get',
    headers: { Authorization: 'Bearer ' + key },
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  Logger.log('OpenAI auth test — HTTP ' + code);
  if (code >= 400) {
    Logger.log(response.getContentText().slice(0, 300));
    throw new Error('OpenAI respondió ' + code + '. Revisa la API key.');
  }
  Logger.log('UrlFetchApp autorizado ✓ — ya puedes usar la Web App');
}

function testClassify() {
  const result = doGet({
    parameter: {
      action: 'classify',
      payload: encodeURIComponent(JSON.stringify({ texto: 'Necesitamos mejorar los procesos de onboarding' }))
    }
  });
  Logger.log(result.getContent());
}

function testFeedback() {
  const result = doGet({
    parameter: {
      action: 'feedback',
      payload: encodeURIComponent(JSON.stringify({
        score: 4,
        carga: 'Desbordante',
        claridad: 'A veces',
        motivacion: 'Regular',
        sugerencia: ''
      }))
    }
  });
  Logger.log(result.getContent());
}

function testChat() {
  const result = doGet({
    parameter: {
      action: 'chat',
      payload: encodeURIComponent(JSON.stringify({
        sub: 'Responde solo JSON: {"ok":true,"msg":"hola"}',
        userMsg: 'Di hola en el campo msg'
      }))
    }
  });
  Logger.log(result.getContent());
}

function testObserve() {
  const result = doGet({
    parameter: {
      action: 'observe',
      payload: encodeURIComponent(JSON.stringify({
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
        categorias: { 'COMUNICACIÓN': 1, 'PROCESOS': 0 }
      }))
    }
  });
  Logger.log(result.getContent());
}
