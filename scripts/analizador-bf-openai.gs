// ════════════════════════════════════════════════════════════
//  APPS SCRIPT — Analizador BF Ulpik → OpenAI (proxy seguro)
//
//  La API key NUNCA va en GitHub Pages; solo en Propiedades del script.
//
//  SETUP:
//  1. script.google.com → Nuevo proyecto → pegar este código
//  2. ⚙ Proyecto > Configuración del proyecto > Propiedades del script:
//       OPENAI_API_KEY  = sk-...
//       OPENAI_MODEL    = gpt-4o-mini   (opcional; default gpt-4o-mini)
//  3. Implementar > Nueva implementación > Aplicación web
//       Ejecutar como: Yo
//       Quién tiene acceso: Cualquier persona
//  4. Copiar URL /exec → APPS_SCRIPT_URL en ULPIK_Analizador_BF.html
//  5. Probar: ejecutar testManual() y revisar Registro de ejecución
// ════════════════════════════════════════════════════════════

const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_PAYLOAD_CHARS = 8000;

// ════════════════════════════════════════════════════════════
//  Entrada HTTP
// ════════════════════════════════════════════════════════════

function doGet(e) {
  try {
    if (e && e.parameter && e.parameter.action === 'analyze') {
      return analizarSigno_(parsePayload_(e));
    }
    return jsonResponse_({
      status: 'ok',
      message: 'Analizador BF Ulpik API activa ✓'
    });
  } catch (err) {
    return jsonResponse_({ status: 'error', message: err.toString() });
  }
}

function doPost(e) {
  try {
    return analizarSigno_(parsePayload_(e));
  } catch (err) {
    logError_(err.toString(), stringifyEvent_(e));
    return jsonResponse_({ status: 'error', message: err.toString() });
  }
}

// ════════════════════════════════════════════════════════════
//  Análisis
// ════════════════════════════════════════════════════════════

function analizarSigno_(payload) {
  const datos = validarDatos_(payload);
  const prompt = buildPrompt_(datos);
  const rawText = callOpenAI_(prompt);
  const dictamen = parseDictamen_(rawText);

  return jsonResponse_({
    status: 'ok',
    data: dictamen
  });
}

function validarDatos_(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload inválido. Envía JSON con marca, clase y prod.');
  }

  const marca = String(payload.marca || '').trim();
  const clase = String(payload.clase || '').trim();
  const prod = String(payload.prod || '').trim();

  if (!marca || !clase || !prod) {
    throw new Error('Faltan campos obligatorios: marca, clase, prod.');
  }

  if (marca.length > 300 || prod.length > 3000) {
    throw new Error('Texto demasiado largo en denominación o productos/servicios.');
  }

  return {
    marca: marca,
    clase: clase,
    tipo: String(payload.tipo || '').trim(),
    prod: prod,
    logo: String(payload.logo || '').trim(),
    grafico: String(payload.grafico || '').trim()
  };
}

function buildPrompt_(d) {
  return [
    'Eres un abogado especialista en propiedad intelectual ecuatoriana con amplia experiencia en SENADI.',
    'Analiza el siguiente signo distintivo y emite un dictamen de preregistrabilidad conforme a la',
    'Ley de Propiedad Intelectual del Ecuador, la Decisión 486 de la Comunidad Andina, y los criterios',
    'aplicados por SENADI.',
    '',
    'DATOS DEL SIGNO:',
    '- Denominación: ' + d.marca,
    '- Clase(s) NIZA: ' + d.clase,
    '- Tipo de signo: ' + (d.tipo || 'No especificado'),
    '- Productos/servicios: ' + d.prod,
    '- Logotipo: ' + (d.logo || 'No especificado'),
    d.grafico ? '- Descripción elementos gráficos: ' + d.grafico : '',
    '',
    'INSTRUCCIONES:',
    'Analiza los siguientes criterios y emite tu dictamen. Responde ÚNICAMENTE con un objeto JSON',
    'con esta estructura exacta, sin texto adicional, sin markdown, sin explicaciones fuera del JSON:',
    '',
    '{',
    '  "veredicto": "ROJO" | "AMARILLO" | "VERDE",',
    '  "titulo": "Título corto del dictamen (máx 12 palabras)",',
    '  "impedimentos_absolutos": ["lista de impedimentos absolutos detectados, o array vacío"],',
    '  "debilidades": ["lista de debilidades marcarias detectadas, o array vacío"],',
    '  "analisis": "Análisis detallado de 3-5 párrafos: (1) evaluación de distintividad, (2) impedimentos detectados con fundamento jurídico específico, (3) riesgos de confundibilidad si aplica, (4) recomendación para el abogado revisor. Usa lenguaje técnico-jurídico claro.",',
    '  "recomendacion_cliente": "Mensaje breve (2-3 oraciones) para comunicar al cliente, en tono profesional pero accesible."',
    '}',
    '',
    'CRITERIOS A EVALUAR:',
    'ROJO (impedimento absoluto) si: denominación genérica/descriptiva sin distintividad, topónimos ecuatorianos (cantones, provincias, parroquias, ciudades), emblemas o banderas institucionales, denominaciones de origen protegidas, signos engañosos o contrarios al orden público.',
    'AMARILLO (debilidad marcaria) si: único diferenciador es apellido común o término débil, combinación de términos débiles sin fantasía, término extranjero directamente traducible a expresión descriptiva en español, marca notoria conocida con denominación similar, elemento gráfico que imita figuras genéricas del sector.',
    'VERDE si: signo con distintividad suficiente y sin impedimentos detectables a priori.',
    '',
    'Considera que "Importadora", "Distribuidora", "Servicios", "Centro" son términos débiles por sí solos.',
    'Apellidos como diferenciador único tienen fuerza marcaria limitada.',
    'Analiza cada componente del signo por separado y luego el conjunto.'
  ].filter(Boolean).join('\n');
}

function callOpenAI_(prompt) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('OPENAI_API_KEY');

  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY no configurada. Ve a Configuración del proyecto > Propiedades del script.'
    );
  }

  const model = props.getProperty('OPENAI_MODEL') || DEFAULT_MODEL;

  const response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify({
      model: model,
      messages: [
        {
          role: 'system',
          content: 'Eres un abogado experto en marcas ecuatorianas. Respondes únicamente JSON válido.'
        },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 2000
    }),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const bodyText = response.getContentText();
  let body;

  try {
    body = JSON.parse(bodyText);
  } catch (e) {
    throw new Error('Respuesta inválida de OpenAI (HTTP ' + code + ').');
  }

  if (code !== 200) {
    const msg = (body.error && body.error.message) ? body.error.message : bodyText;
    throw new Error('OpenAI error ' + code + ': ' + msg);
  }

  const content = body.choices && body.choices[0] && body.choices[0].message
    ? body.choices[0].message.content
    : '';

  if (!content) {
    throw new Error('OpenAI devolvió una respuesta vacía.');
  }

  return content;
}

function parseDictamen_(rawText) {
  const clean = String(rawText).replace(/```json|```/g, '').trim();
  let parsed;

  try {
    parsed = JSON.parse(clean);
  } catch (e) {
    throw new Error('La IA no devolvió JSON válido. Intente nuevamente.');
  }

  const veredictos = ['ROJO', 'AMARILLO', 'VERDE'];
  if (veredictos.indexOf(parsed.veredicto) === -1) {
    throw new Error('Dictamen con veredicto inválido: ' + parsed.veredicto);
  }

  return {
    veredicto: parsed.veredicto,
    titulo: String(parsed.titulo || '').trim(),
    impedimentos_absolutos: Array.isArray(parsed.impedimentos_absolutos)
      ? parsed.impedimentos_absolutos
      : [],
    debilidades: Array.isArray(parsed.debilidades) ? parsed.debilidades : [],
    analisis: String(parsed.analisis || '').trim(),
    recomendacion_cliente: String(parsed.recomendacion_cliente || '').trim()
  };
}

// ════════════════════════════════════════════════════════════
//  Helpers HTTP
// ════════════════════════════════════════════════════════════

function parsePayload_(e) {
  if (!e) {
    throw new Error('Sin evento HTTP. No ejecutes doPost directamente: usa testManual().');
  }

  let raw = '';

  if (e.parameter && e.parameter.payload) {
    raw = e.parameter.payload;
  } else if (e.postData && e.postData.contents) {
    raw = e.postData.contents;
  } else {
    throw new Error('Petición vacía. Envía el campo "payload" con el JSON del signo.');
  }

  if (raw.length > MAX_PAYLOAD_CHARS) {
    throw new Error('Payload demasiado grande.');
  }

  return JSON.parse(raw);
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

function logError_(errorMsg, payload) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return;

    let logSheet = ss.getSheetByName('Logs BF');
    if (!logSheet) {
      logSheet = ss.insertSheet('Logs BF');
      logSheet.appendRow(['Timestamp', 'Error', 'Payload']);
    }
    logSheet.appendRow([new Date().toISOString(), errorMsg, String(payload).slice(0, 500)]);
  } catch (e) {
    // Proyecto standalone sin Sheet vinculado: ignorar
  }
}

// ════════════════════════════════════════════════════════════
//  Pruebas manuales (editor Apps Script)
// ════════════════════════════════════════════════════════════

function datosPrueba_() {
  return {
    marca: 'Pisos & Techo Importadora Barreno',
    clase: '6, 19, 35',
    tipo: 'Mixto (denominativo + logotipo)',
    prod: 'Productos de construcción, teja española, materiales para instalación de teja',
    logo: 'Sí',
    grafico: 'Casa estilizada en azul y blanco, sin emblemas institucionales'
  };
}

/** Simula POST JSON en postData */
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

/** Verifica que la key esté configurada (no llama a OpenAI) */
function testConfig() {
  const key = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  Logger.log(key ? 'OPENAI_API_KEY configurada ✓' : 'Falta OPENAI_API_KEY en Propiedades del script');
}
