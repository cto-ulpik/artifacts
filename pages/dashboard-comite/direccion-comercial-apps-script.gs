/**
 * DIRECCIÓN COMERCIAL 2026 — Lectura para tablero de comité
 *
 * Spreadsheet: "DIRECCION COMERCIAL 2026"
 * Pegar en Extensiones → Apps Script → Nueva implementación web
 *   Ejecutar como: Yo | Acceso: Cualquier persona
 *
 * Probar: ?action=debug  o  ?semana=6-2026
 */

var SHEETS = {
  ventas: 'VENTAS LEGAL',
  contactados: 'CONTACTADOS LEGAL',
  presupuestos: 'PRESUPUESTOS',
  suscriptores: 'SUSCRIPTORES ULPIK PRIV',
  inscritos: 'INSCRITOS CURSOS',
  ads: 'RESULTADOS ADS',
  facturacion: 'FACTURACION ULPIK PRIV',
  convenio: 'GESTION CONVENIO DISENADORES',
  upsell: 'GESTION UPSELL',
  disc: 'TALLER DISC',
  pi: 'GESTION TEST PI'
};

var MN = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
var META_CONV = 5;

function doGet(e) {
  e = e || {};
  var p = e.parameter || {};
  try {
    if (p.action === 'debug') {
      return jsonOut(p.callback, buildDebugReport());
    }
    var data = buildDashboardData(p.semana || '');
    return jsonOut(p.callback, data);
  } catch (err) {
    return jsonOut(p.callback, { error: String(err.message || err) });
  }
}

function jsonOut(callback, obj) {
  var json = JSON.stringify(obj);
  var cb = callback || '';
  if (cb && /^[a-zA-Z_$][\w$]*$/.test(cb)) {
    return ContentService.createTextOutput(cb + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function buildDebugReport() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = buildDashboardData('');
  return {
    ok: true,
    spreadsheet: ss.getName(),
    semana_actual: data.semana_actual,
    ventas: (data.ventas || []).length,
    ventas_semana: (data.ventas_semana || []).length,
    ventas_semana_monto: (data.ventas_semana || []).reduce(function (s, v) {
      return s + (v.categoria === 'Marcas' ? v.monto : 0);
    }, 0),
    chats: data.chats,
    metas: data.metas,
    educacion: data.educacion,
    priv_stats: data.priv_stats,
    priv_pagos: (data.priv_pagos || []).length,
    ads: (data.ads || []).length,
    convenio: data.convenio,
    pi: data.pi,
    upsell: data.upsell
  };
}

function buildDashboardData(semanaFilter) {
  var ventasAll = readVentas();
  var semanas = buildSemanasList(ventasAll);
  var semanaActual = semanaFilter || (semanas.length ? semanas[semanas.length - 1].semana_id : '');
  var mes = semanaActual ? +semanaActual.split('-')[0] : 0;
  var anio = semanaActual ? +semanaActual.split('-')[1] : 0;

  var ventas = ventasAll.filter(function (v) {
    return !semanaActual || v.semana_id === semanaActual;
  });
  var ventasSemana = filterVentasSemana(ventas, mes, anio);
  var rangoSemana = weekRangeLabel(mes, anio);

  var metas = readPresupuestos(mes, anio);
  var chats = readContactados(mes, anio);
  var educacion = readEducacion(mes, anio);
  var privPagos = readPrivPagos(mes, anio);
  var privStats = readPrivStats(mes, anio, privPagos);
  var ads = readAds(mes, anio);
  var historico = buildHistoricoMensual(ventasAll);
  var evolutivo = buildEvolutivo(ventasAll, readAllPresupuestos());

  return {
    semanas: semanas,
    semana_actual: semanaActual,
    metas: metas,
    ventas: ventas,
    ventas_semana: ventasSemana,
    semana_rango: rangoSemana,
    chats: chats,
    ads: ads,
    educacion: educacion,
    priv_pagos: privPagos,
    priv_stats: privStats,
    evolutivo: evolutivo,
    historico_mensual: historico,
    convenio: readConvenio(),
    disc: readDisc(),
    pi: readPI(),
    upsell: readUpsell()
  };
}

// ── Helpers ───────────────────────────────────────

function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('No existe la pestaña: ' + name);
  return sh;
}

function sheetRows(name) {
  var sh = getSheet(name);
  var vals = sh.getDataRange().getValues();
  if (vals.length < 2) return { headers: {}, rows: [] };
  return { headers: headerMap(vals[0]), rows: vals.slice(1) };
}

function headerMap(row) {
  var m = {};
  row.forEach(function (h, i) {
    if (h !== '' && h !== null) m[normHeader(h)] = i;
  });
  return m;
}

function normHeader(s) {
  return String(s || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').trim();
}

function col(h, names) {
  for (var i = 0; i < names.length; i++) {
    var k = normHeader(names[i]);
    if (h[k] !== undefined) return h[k];
  }
  var keys = Object.keys(h);
  for (var j = 0; j < names.length; j++) {
    var probe = normHeader(names[j]);
    if (probe.length < 4) continue;
    for (var ki = 0; ki < keys.length; ki++) {
      if (keys[ki].indexOf(probe) >= 0 || probe.indexOf(keys[ki]) >= 0) return h[keys[ki]];
    }
  }
  return -1;
}

function numVal(v) {
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  var s = String(v || '').replace(/\$/g, '').replace(/\s/g, '').trim();
  if (!s) return 0;
  if (/\d,\d{3}/.test(s) && /\.\d{1,2}$/.test(s)) {
    s = s.replace(/,/g, '');
  } else if (/\d\.\d{3}/.test(s) && /,\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/\d,\d{1,2}$/.test(s) && s.indexOf('.') === -1) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function parseFechaDDMMYYYY(s) {
  var m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1]);
}

function currentWeekRange(mes, anio) {
  var tz = Session.getScriptTimeZone() || 'America/Guayaquil';
  var now = new Date();
  var todayMo = +Utilities.formatDate(now, tz, 'M');
  var todayY = +Utilities.formatDate(now, tz, 'yyyy');
  var ref = now;
  if (mes && anio && (mes !== todayMo || anio !== todayY)) {
    ref = new Date(anio, mes, 0);
  }
  var dow = ref.getDay();
  var monday = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - ((dow + 6) % 7));
  var sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6, 23, 59, 59, 999);
  return { desde: monday, hasta: sunday };
}

function weekRangeLabel(mes, anio) {
  var range = currentWeekRange(mes, anio);
  var tz = Session.getScriptTimeZone() || 'America/Guayaquil';
  var d1 = Utilities.formatDate(range.desde, tz, 'dd/MM/yyyy');
  var d2 = Utilities.formatDate(range.hasta, tz, 'dd/MM/yyyy');
  return d1 + ' – ' + d2;
}

function filterVentasSemana(ventas, mes, anio) {
  var range = currentWeekRange(mes, anio);
  return ventas.filter(function (v) {
    var d = parseFechaDDMMYYYY(v.fecha);
    if (!d) return false;
    return d >= range.desde && d <= range.hasta;
  });
}

function mesAnioFromRow(h, r) {
  var iMy = col(h, ['mes y ano', 'mes y año']);
  if (iMy >= 0) {
    var my = String(r[iMy] || '').trim();
    var m1 = my.match(/^(\d{1,2})-(\d{4})$/);
    if (m1) return (+m1[1]) + '-' + m1[2];
  }
  var iA = col(h, ['ano', 'año']);
  var iM = col(h, ['mes']);
  var y = iA >= 0 ? +r[iA] : 0;
  var mo = iM >= 0 ? +r[iM] : 0;
  if (y && mo) return mo + '-' + y;
  return '';
}

function labelFromKey(k) {
  var p = k.split('-');
  return (MN[+p[0]] || p[0]) + ' ' + p[1];
}

function badgeFromKey(k) {
  var p = k.split('-');
  return (MN[+p[0]] || p[0]).toUpperCase() + ' ' + p[1];
}

function normAsesor(s) {
  var low = String(s || '').toLowerCase().trim();
  if (!low) return '';
  if (low.indexOf('martin') >= 0 || low.indexOf('martín') >= 0) return 'Martín';
  if (low.indexOf('javier') >= 0) return 'Javier';
  if (low.indexOf('nela') >= 0 || low.indexOf('marianela') >= 0) return 'Nela';
  if (low.indexOf('clau') >= 0 || low.indexOf('claudia') >= 0) return 'Clau';
  if (low.indexOf('andrea') >= 0) return 'Andrea';
  if (low.indexOf('esteban') >= 0 || low.indexOf('estebitan') >= 0) return 'Esteban';
  if (low.indexOf('pablo') >= 0 || low.indexOf('pablito') >= 0) return 'Pablo';
  if (low.indexOf('bea') >= 0) return 'Bea';
  if (low.indexOf('david') >= 0) return 'David';
  return String(s).split('(')[0].trim();
}

function formatFecha(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    var tz = Session.getScriptTimeZone() || 'America/Guayaquil';
    return Utilities.formatDate(v, tz, 'dd/MM/yyyy');
  }
  var s = String(v || '').trim();
  var m = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
  if (m) {
    var y = m[3] || new Date().getFullYear();
    return ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2) + '/' + y;
  }
  return s;
}

function isSi(v) {
  return /^s[ií]$/i.test(String(v || '').trim());
}

function matchMesAnio(key, mes, anio) {
  if (!mes || !anio) return true;
  return key === (mes + '-' + anio);
}

// ── VENTAS LEGAL ──────────────────────────────────

function readVentas() {
  var data = sheetRows(SHEETS.ventas);
  var h = data.headers, out = [];
  var iFecha = col(h, ['fecha', 'fecha venta', 'fecha de venta', 'fecha prode']);
  var iAsesor = col(h, ['asesor', 'responsable', 'vendedor', 'responsable producci']);
  var iCat = col(h, ['categoria', 'categoría', 'categoria venta', 'tipo']);
  var iProd = col(h, ['producto', 'servicio', 'detalle producto', 'detalle']);
  var iMonto = col(h, ['monto', 'valor', 'total', 'precio', 'facturacion', 'facturación', 'importe', 'valor venta', 'monto venta', 'facturado', 'subtotal', 'venta neta', 'venta total']);
  if (iMonto < 0 && iProd >= 0) iMonto = iProd + 1;
  if (iMonto < 0) iMonto = 8;

  data.rows.forEach(function (r) {
    var monto = numVal(r[iMonto]);
    var asesor = iAsesor >= 0 ? normAsesor(r[iAsesor]) : '';
    if (!monto && !asesor) return;
    var key = mesAnioFromRow(h, r);
    if (!key && iFecha >= 0) {
      var fd = formatFecha(r[iFecha]);
      var fm = fd.match(/\/(\d{1,2})\/(\d{4})$/);
      if (fm) key = (+fm[1]) + '-' + fm[2];
    }
    out.push({
      semana_id: key,
      fecha: iFecha >= 0 ? formatFecha(r[iFecha]) : '',
      asesor: asesor,
      categoria: iCat >= 0 ? String(r[iCat] || '').trim() : 'Marcas',
      producto: iProd >= 0 ? String(r[iProd] || '').trim() : '—',
      monto: Math.round(monto * 100) / 100
    });
  });
  return out;
}

function buildSemanasList(ventas) {
  var keys = {};
  ventas.forEach(function (v) { if (v.semana_id) keys[v.semana_id] = true; });
  return Object.keys(keys).sort(function (a, b) {
    var pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return pa[1] !== pb[1] ? pa[1] - pb[1] : pa[0] - pb[0];
  }).map(function (k) {
    return { semana_id: k, label: labelFromKey(k), badge: badgeFromKey(k) };
  });
}

function buildHistoricoMensual(ventas) {
  var map = {};
  ventas.forEach(function (v) {
    if (!v.semana_id) return;
    if (!map[v.semana_id]) map[v.semana_id] = { legal: 0, edu: 0, priv: 0 };
    map[v.semana_id].legal += v.monto;
  });
  var eduAll = readAllEducacion();
  Object.keys(eduAll).forEach(function (k) {
    if (!map[k]) map[k] = { legal: 0, edu: 0, priv: 0 };
    map[k].edu = eduAll[k].monto;
  });
  var privAll = readAllPrivFacturacion();
  Object.keys(privAll).forEach(function (k) {
    if (!map[k]) map[k] = { legal: 0, edu: 0, priv: 0 };
    map[k].priv = privAll[k];
  });
  return Object.keys(map).sort(function (a, b) {
    var pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return pa[1] !== pb[1] ? pa[1] - pb[1] : pa[0] - pb[0];
  }).map(function (k) {
  return {
      label: labelFromKey(k),
      legal: Math.round(map[k].legal * 100) / 100,
      edu: Math.round(map[k].edu * 100) / 100,
      priv: Math.round(map[k].priv * 100) / 100
    };
  });
}

function buildEvolutivo(ventas, presupuestos) {
  var map = {};
  ventas.forEach(function (v) {
    if (!v.semana_id) return;
    map[v.semana_id] = (map[v.semana_id] || 0) + v.monto;
  });
  return Object.keys(map).sort(function (a, b) {
    var pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return pa[1] !== pb[1] ? pa[1] - pb[1] : pa[0] - pb[0];
  }).map(function (k) {
    return {
      semana_id: k,
      label: labelFromKey(k),
      ingresos: Math.round(map[k] * 100) / 100,
      meta: presupuestos[k] ? presupuestos[k].meta_marcas : 0
    };
  });
}

// ── PRESUPUESTOS ──────────────────────────────────

function readAllPresupuestos() {
  var data = sheetRows(SHEETS.presupuestos);
  var h = data.headers, out = {};
  var iSem = col(h, ['presupuesto semanal marcas', 'presupuesto semanal']);
  var iMen = col(h, ['presupuesto mensual marcas']);
  var iEdu = col(h, ['presupuesto mensual educacion', 'presupuesto mensual educación']);
  data.rows.forEach(function (r) {
    var key = mesAnioFromRow(h, r);
    if (!key) return;
    out[key] = {
      meta_marcas: iSem >= 0 ? numVal(r[iSem]) : (iMen >= 0 ? numVal(r[iMen]) : 0),
      meta_edu: iEdu >= 0 ? numVal(r[iEdu]) : 0
    };
  });
  return out;
}

function readPresupuestos(mes, anio) {
  var all = readAllPresupuestos();
  var key = mes + '-' + anio;
  var p = all[key] || { meta_marcas: 0, meta_edu: 0 };
  return {
    meta_marcas: p.meta_marcas || 0,
    meta_edu: p.meta_edu || 0,
    meta_conv: META_CONV
  };
}

// ── CONTACTADOS LEGAL ─────────────────────────────

function readContactados(mes, anio) {
  var data = sheetRows(SHEETS.contactados);
  var h = data.headers, chats = {};
  var iResp = col(h, ['responsable', 'asesor']);
  var iChats = col(h, ['clientes atendidos', 'chats', 'clientes']);
  data.rows.forEach(function (r) {
    var key = mesAnioFromRow(h, r);
    if (!matchMesAnio(key, mes, anio)) return;
    var resp = iResp >= 0 ? normAsesor(r[iResp]) : '';
    var n = iChats >= 0 ? numVal(r[iChats]) : 0;
    if (!resp) return;
    chats[resp] = (chats[resp] || 0) + n;
  });
  return chats;
}

// ── EDUCACIÓN ─────────────────────────────────────

function readEducacion(mes, anio) {
  var data = sheetRows(SHEETS.inscritos);
  var h = data.headers;
  var iValor = col(h, ['valor pagado', 'valor']);
  var iCurso = col(h, ['curso', 'producto']);
  var iMedio = col(h, ['medio de pago', 'medio pago']);
  var monto = 0, inscritos = 0, downsell = 0, upsell = 0, becas = 0;
  var producto = '—';
  var prodCount = {};

  data.rows.forEach(function (r) {
    var key = mesAnioFromRow(h, r);
    if (!matchMesAnio(key, mes, anio)) return;
    inscritos++;
    monto += iValor >= 0 ? numVal(r[iValor]) : 0;
    var c = iCurso >= 0 ? String(r[iCurso] || '').trim() : '';
    if (c) prodCount[c] = (prodCount[c] || 0) + 1;
    var medio = iMedio >= 0 ? String(r[iMedio] || '').toLowerCase() : '';
    if (medio.indexOf('diferido') >= 0) downsell++;
    if (medio.indexOf('upsell') >= 0) upsell++;
    if (medio.indexOf('beca') >= 0) becas++;
  });

  var top = Object.keys(prodCount).sort(function (a, b) { return prodCount[b] - prodCount[a]; });
  if (top.length) producto = top[0];

  return {
    producto: producto,
    monto: Math.round(monto * 100) / 100,
    inscritos: inscritos,
    downsell: downsell,
    upsell: upsell,
    becas: becas
  };
}

function readAllEducacion() {
  var data = sheetRows(SHEETS.inscritos);
  var h = data.headers;
  var iValor = col(h, ['valor pagado', 'valor']);
  var out = {};
  data.rows.forEach(function (r) {
    var key = mesAnioFromRow(h, r);
    if (!key) return;
    if (!out[key]) out[key] = { monto: 0, inscritos: 0 };
    out[key].monto += iValor >= 0 ? numVal(r[iValor]) : 0;
    out[key].inscritos++;
  });
  return out;
}

// ── ULPIK PRIV ────────────────────────────────────

function readPrivPagos(mes, anio) {
  var data = sheetRows(SHEETS.facturacion);
  var h = data.headers, out = [];
  var iNombre = col(h, ['nombre', 'nombre del afiliado', 'cliente']);
  var iFecha = col(h, ['fecha de venta', 'fecha venta', 'fecha de conf']);
  var iMonto = col(h, ['valor que has recibido', 'facturacion bruta', 'facturación bruta', 'precio del producto', 'precio total', 'precio de la of']);
  var iCuota = col(h, ['pago recurrent', 'pago recurrente', 'numero de la', 'número de la']);

  function montoFromRow(r) {
    if (iMonto >= 0) {
      var v = numVal(r[iMonto]);
      if (v) return v;
    }
    return numVal(r[58]) || numVal(r[52]) || numVal(r[11]) || numVal(r[13]);
  }

  data.rows.forEach(function (r) {
    var key = mesAnioFromRow(h, r);
    if (!matchMesAnio(key, mes, anio)) return;
    var monto = montoFromRow(r);
    if (!monto && !iNombre) return;
    out.push({
      nombre: iNombre >= 0 ? String(r[iNombre] || '').trim() : '—',
      fecha: iFecha >= 0 ? formatFecha(r[iFecha]) : '',
      monto: Math.round(monto * 100) / 100,
      cuota: iCuota >= 0 ? numVal(r[iCuota]) : 1
    });
  });
  return out;
}

function readAllPrivFacturacion() {
  var pagos = {};
  var data = sheetRows(SHEETS.facturacion);
  var h = data.headers;
  var iMonto = col(h, ['valor que has recibido', 'facturacion bruta', 'facturación bruta']);
  data.rows.forEach(function (r) {
    var key = mesAnioFromRow(h, r);
    if (!key) return;
    var m = iMonto >= 0 ? numVal(r[iMonto]) : (numVal(r[58]) || numVal(r[52]));
    pagos[key] = (pagos[key] || 0) + m;
  });
  Object.keys(pagos).forEach(function (k) {
    pagos[k] = Math.round(pagos[k] * 100) / 100;
  });
  return pagos;
}

function readPrivStats(mes, anio, pagos) {
  var data = sheetRows(SHEETS.suscriptores);
  var h = data.headers;
  var iEst = col(h, ['estatus', 'estado']);
  var iCancel = col(h, ['cancelacion', 'cancelación']);
  var activos = 0, retraso = 0, churn = 0;

  data.rows.forEach(function (r) {
    var est = iEst >= 0 ? String(r[iEst] || '').toLowerCase() : '';
    if (est.indexOf('activo') >= 0) activos++;
    else if (est.indexOf('retraso') >= 0) retraso++;

    var churnInPeriod = false;
    if (iCancel >= 0 && r[iCancel]) {
      var fd = formatFecha(r[iCancel]);
      var fm = fd.match(/\/(\d{1,2})\/(\d{4})$/);
      if (fm && (!mes || !anio || (+fm[1] === mes && +fm[2] === anio))) churnInPeriod = true;
    } else if ((est.indexOf('cancel') >= 0 || est.indexOf('baja') >= 0) && (!mes || !anio)) {
      churnInPeriod = true;
    }
    if (churnInPeriod) churn++;
  });

  var totalPriv = pagos.reduce(function (s, p) { return s + p.monto; }, 0);
  var adsPriv = readAdsPriv(mes, anio);
  return {
    activos: activos,
    retraso: retraso,
    habiles: pagos.length,
    churn: churn,
    gasto: adsPriv.gasto,
    conv_wpp: adsPriv.conv,
    alcance: adsPriv.alcance,
    sem1_monto: totalPriv
  };
}

function readAdsPriv(mes, anio) {
  var data = sheetRows(SHEETS.ads);
  var h = data.headers;
  var iCamp = col(h, ['nombre de la campana', 'nombre de la campaña', 'campana']);
  var iGasto = col(h, ['importe gastado', 'importe gastado (usd)', 'gasto']);
  var iConv = col(h, ['conversaciones con mensajes iniciadas', 'conv wpp', 'conversiones']);
  var iAlc = col(h, ['alcance']);
  var gasto = 0, conv = 0, alcance = 0;
  data.rows.forEach(function (r) {
    var key = mesAnioFromRow(h, r);
    if (!matchMesAnio(key, mes, anio)) return;
    var camp = iCamp >= 0 ? String(r[iCamp] || '').toLowerCase() : '';
    if (camp.indexOf('priv') < 0 && camp.indexOf('ulpik priv') < 0) return;
    gasto += iGasto >= 0 ? numVal(r[iGasto]) : 0;
    conv += iConv >= 0 ? numVal(r[iConv]) : 0;
    alcance += iAlc >= 0 ? numVal(r[iAlc]) : 0;
  });
  return { gasto: gasto, conv: conv, alcance: alcance };
}

// ── ADS ───────────────────────────────────────────

function readAds(mes, anio) {
  var data = sheetRows(SHEETS.ads);
  var h = data.headers, out = [];
  var iDia = col(h, ['dia', 'día', 'fecha']);
  var iGasto = col(h, ['importe gastado', 'importe gastado (usd)', 'gasto']);
  var iConv = col(h, ['conversaciones con mensajes iniciadas', 'conv wpp']);
  var iClics = col(h, ['clics en el enlace', 'clics enlace', 'clics']);
  var iAlc = col(h, ['alcance']);
  var iCamp = col(h, ['nombre de la campana', 'nombre de la campaña']);

  data.rows.forEach(function (r) {
    var key = mesAnioFromRow(h, r);
    if (!matchMesAnio(key, mes, anio)) return;
    var camp = iCamp >= 0 ? String(r[iCamp] || '').toLowerCase() : '';
    if (camp.indexOf('priv') >= 0) return;
    var gasto = iGasto >= 0 ? numVal(r[iGasto]) : 0;
    var conv = iConv >= 0 ? numVal(r[iConv]) : 0;
    var clics = iClics >= 0 ? numVal(r[iClics]) : 0;
    var alcance = iAlc >= 0 ? numVal(r[iAlc]) : 0;
    if (!gasto && !conv && !clics) return;
    var fecha = '';
    if (iDia >= 0) {
      var raw = r[iDia];
      if (raw instanceof Date) fecha = formatFecha(raw);
      else fecha = String(raw).substring(0, 10);
    }
    out.push({
      fecha: fecha,
      gasto: gasto,
      conv_wpp: conv,
      clics: clics,
      alcance: alcance,
      campana: iCamp >= 0 ? String(r[iCamp] || '') : ''
    });
  });
  return out;
}

// ── CONVENIO / UPSELL / DISC / PI ─────────────────

function readConvenio() {
  var data = sheetRows(SHEETS.convenio);
  var h = data.headers;
  var iCont = col(h, ['contactados', 'contacto']);
  var iResp = col(h, ['respuestas', 'respondieron']);
  var iLlam = col(h, ['llamadas cerrad', 'llamadas', 'llamadas cerradas']);
  var iConv = col(h, ['convenios', 'convenio']);
  var iFecha = col(h, ['fecha']);
  var contactados = 0, respondieron = 0, llamadas = 0, convenios = 0;
  var ultimaDate = null;

  data.rows.forEach(function (r) {
    var c = iCont >= 0 ? String(r[iCont] || '').trim() : '';
    if (c) contactados++;
    if (iResp >= 0 && isSi(r[iResp])) respondieron++;
    if (iLlam >= 0 && isSi(r[iLlam])) llamadas++;
    if (iConv >= 0) {
      var cv = String(r[iConv] || '').toLowerCase();
      if (isSi(cv) || cv.indexOf('proceso') >= 0) convenios++;
    }
    if (iFecha >= 0 && r[iFecha]) {
      var fd = parseFechaDDMMYYYY(formatFecha(r[iFecha]));
      if (fd && !isNaN(fd.getTime()) && (!ultimaDate || fd > ultimaDate)) ultimaDate = fd;
    }
  });

  return {
    contactados: contactados,
    respondieron: respondieron,
    llamadas: llamadas,
    convenios: convenios,
    ultima_gestion: ultimaDate ? formatFecha(ultimaDate) : ''
  };
}

function readUpsell() {
  var data = sheetRows(SHEETS.upsell);
  var h = data.headers, rows = data.rows;
  var iApr = col(h, ['aprobadas', 'aprobada']);
  var iProc = col(h, ['en proceso', 'proceso']);
  var iNeg = col(h, ['negadas', 'negada']);
  var iEst = col(h, ['estado', 'estatus']);
  var iFecha = col(h, ['fecha', 'ultima gestion']);

  if (iApr >= 0 && rows.length && typeof rows[0][iApr] === 'number' && rows.length === 1) {
    return {
      aprobadas: numVal(rows[0][iApr]),
      en_proceso: iProc >= 0 ? numVal(rows[0][iProc]) : 0,
      negadas: iNeg >= 0 ? numVal(rows[0][iNeg]) : 0,
      estado: iEst >= 0 ? String(rows[0][iEst] || '—') : '—',
      ultima_gestion: iFecha >= 0 ? formatFecha(rows[0][iFecha]) : '—'
    };
  }

  var aprobadas = 0, enProceso = 0, negadas = 0;
  var iVenta = col(h, ['venta', 'venta cerrada']);
  rows.forEach(function (r) {
    if (iVenta >= 0 && String(r[iVenta] || '').toUpperCase().indexOf('VENTA') >= 0) aprobadas++;
    else if (iProc >= 0 && String(r[iProc] || '').toLowerCase().indexOf('proceso') >= 0) enProceso++;
    else negadas++;
  });
  return {
    aprobadas: aprobadas,
    en_proceso: enProceso,
    negadas: negadas,
    estado: rows.length ? 'Activo' : 'Sin datos',
    ultima_gestion: '—'
  };
}

function readDisc() {
  var data = sheetRows(SHEETS.disc);
  var h = data.headers, map = {};
  var iMes = col(h, ['mes']);
  var iPres = col(h, ['se presento', 'se presentó', 'presento']);
  var iVenta = col(h, ['venta cerrada', 'ventas', 'venta']);

  data.rows.forEach(function (r) {
    var mo = iMes >= 0 ? String(+r[iMes] || r[iMes]) : mesAnioFromRow(h, r).split('-')[0];
    if (!mo) return;
    if (!map[mo]) map[mo] = { mes: mo, presentados: 0, ventas: 0 };
    map[mo].agendados = (map[mo].agendados || 0) + 1;
    if (iPres >= 0 && isSi(r[iPres])) map[mo].presentados++;
    if (iVenta >= 0 && isSi(r[iVenta])) map[mo].ventas++;
  });
  return Object.keys(map).map(function (k) { return map[k]; });
}

function readPI() {
  var data = sheetRows(SHEETS.pi);
  var h = data.headers, rows = data.rows;
  var iEst = col(h, ['contactado', 'estado', 'venta', 'respuesta']);
  var leads = rows.length, contactados = 0, respondieron = 0, negociacion = 0, ventas = 0;

  rows.forEach(function (r) {
    var s = iEst >= 0 ? String(r[iEst] || '').toUpperCase() : 'CONTACTADO';
    if (s.indexOf('CONTACTADO') >= 0) contactados++;
    if (s.indexOf('RESPOND') >= 0) respondieron++;
    if (s.indexOf('NEGOC') >= 0) negociacion++;
    if (s.indexOf('VENTA') >= 0) ventas++;
  });

  return {
    leads: leads,
    contactados: contactados,
    respondieron: respondieron,
    negociacion: negociacion,
    ventas_cerradas: ventas
  };
}

function testReadData() {
  var report = buildDebugReport();
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}
