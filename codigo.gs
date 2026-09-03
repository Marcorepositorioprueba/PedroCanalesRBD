/**
 * codigo.gs — Backend MVT V1
 * - doGet:  login | catalogos | buscar | obtener
 * - doPost: crear | actualizar | seguimiento | logout
 * - Token simple en hoja SESIONES (token → usuario + expira)
 */

const SHEET_ID  = '1RsxYFnJtY5l3nJCxgwjgDW4N0p85eGaFRc9m9_tZwnQ'; // RBD Pedro Canales — Tulancingo
const SESION_TTL_MIN = 60 * 24 * 7; // 7 días

// ===== HELPERS DE RESPUESTA =====
function _ok(data) {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, data: data })
  ).setMimeType(ContentService.MimeType.JSON);
}
function _err(msg, code) {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: false, error: msg, code: code || 'ERR' })
  ).setMimeType(ContentService.MimeType.JSON);
}
function _hash(pwd) {
  const raw = 'PC_TULA_2026:' + pwd;
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('').toUpperCase();
}

// ===== SESIONES =====
function _getSesionesSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName('SESIONES');
  if (!sh) {
    sh = ss.insertSheet('SESIONES');
    sh.getRange(1,1,1,4).setValues([['token','usuario','creado_en','expira_en']])
      .setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function _validarToken(token) {
  if (!token) return null;
  const sh = _getSesionesSheet();
  const data = sh.getDataRange().getValues();
  const now = new Date();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === token) {
      if (new Date(data[i][3]) > now) return data[i][1];
      sh.deleteRow(i + 1);
      return null;
    }
  }
  return null;
}

function _crearSesion(usuario) {
  const token = Utilities.getUuid().replace(/-/g, '');
  const now = new Date();
  const exp  = new Date(now.getTime() + SESION_TTL_MIN * 60000);
  _getSesionesSheet().appendRow([token, usuario, now, exp]);
  return { token: token, usuario: usuario, expira_en: exp.toISOString() };
}

function _borrarSesion(token) {
  const sh = _getSesionesSheet();
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === token) { sh.deleteRow(i + 1); return true; }
  }
  return false;
}

// ===== HOJAS =====
function _sh(nombre) { return SpreadsheetApp.openById(SHEET_ID).getSheetByName(nombre); }

function _rowsToObjects(sh) {
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[String(h).trim()] = row[i]);
    return obj;
  });
}

// ===== ACCIÓN: LOGIN =====
function _login(payload) {
  const usuario = String(payload.usuario || '').trim().toLowerCase();
  const pwd     = String(payload.password || '');
  if (!usuario || !pwd) throw new Error('Falta usuario o contraseña');

  const sh = _sh('USUARIOS');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const u = String(data[i][1]).trim().toLowerCase();
    const activo = data[i][5];
    if (u === usuario && activo === true) {
      if (data[i][2] === _hash(pwd)) {
        return _crearSesion(data[i][1]);
      }
      throw new Error('Contraseña incorrecta');
    }
  }
  throw new Error('Usuario no encontrado o inactivo');
}

// ===== ACCIÓN: CATALOGOS =====
function _catalogos() {
  const muns   = _rowsToObjects(_sh('MUNICIPIOS'));
  const locs   = _rowsToObjects(_sh('LOCALIDADES'));
  const cats   = _rowsToObjects(_sh('CATALOGOS'));
  const catsByTipo = {};
  cats.forEach(c => {
    if (!catsByTipo[c.tipo]) catsByTipo[c.tipo] = [];
    catsByTipo[c.tipo].push(c.valor);
  });
  return { municipios: muns, localidades: locs, catalogos: catsByTipo };
}

// ===== ACCIÓN: CREAR REGISTRO =====
function _crear(payload, usuario) {
  const req = ['municipio','nombre','problemas_identificados'];
  req.forEach(k => { if (!payload[k]) throw new Error('Falta campo requerido: ' + k); });

  const sh = _sh('REGISTROS');
  const lastId = sh.getLastRow(); // header(1) + datos
  const id = lastId; // siguiente id
  const ahora = new Date();

  const fila = [
    id, ahora,
    payload.municipio   || '',
    payload.localidad   || '',
    payload.nombre      || '',
    payload.organizacion|| '',
    payload.perfil      || '',
    payload.tipo_vinculacion || '',
    payload.que_aporta  || '',
    payload.prioridad   || '',
    payload.motivo_prioridad || '',
    payload.proximo_paso|| '',
    payload.fecha_seguimiento ? new Date(payload.fecha_seguimiento) : '',
    payload.estatus     || 'Por contactar',
    payload.observaciones || '',
    usuario,
    ahora,
    payload.problemas_identificados || ''
  ];
  sh.appendRow(fila);
  return { id: id, creado_en: ahora.toISOString() };
}

// ===== ACCIÓN: BUSCAR =====
function _buscar(payload) {
  const q      = String(payload.q || '').toLowerCase().trim();
  const mun    = String(payload.municipio || '').trim();
  const loc    = String(payload.localidad || '').trim();
  const perfil = String(payload.perfil || '').trim();
  const prio   = String(payload.prioridad || '').trim();
  const est    = String(payload.estatus || '').trim();
  const limit  = Math.min(parseInt(payload.limit || '50', 10), 200);
  const offset = Math.max(parseInt(payload.offset || '0', 10), 0);

  const regs = _rowsToObjects(_sh('REGISTROS')).reverse(); // más recientes primero
  const filtrados = regs.filter(r => {
    if (q) {
      const haystack = [r.nombre, r.organizacion, r.que_aporta, r.motivo_prioridad,
                        r.proximo_paso, r.observaciones].join(' ').toLowerCase();
      if (haystack.indexOf(q) === -1) return false;
    }
    if (mun    && String(r.municipio||'').trim()    !== mun)    return false;
    if (loc    && String(r.localidad||'').trim()    !== loc)    return false;
    if (perfil && String(r.perfil||'').trim()       !== perfil) return false;
    if (prio   && String(r.prioridad||'').trim()    !== prio)   return false;
    if (est    && String(r.estatus||'').trim()      !== est)    return false;
    return true;
  });
  return {
    total: filtrados.length,
    limit: limit, offset: offset,
    resultados: filtrados.slice(offset, offset + limit)
  };
}

// ===== ACCIÓN: OBTENER (ficha individual) =====
function _obtener(payload) {
  const id = parseInt(payload.id || '0', 10);
  if (!id) throw new Error('Falta id');

  const regs = _rowsToObjects(_sh('REGISTROS'));
  const reg  = regs.find(r => parseInt(r.id,10) === id);
  if (!reg) throw new Error('Registro no encontrado');

  // seguimientos
  const segs = _rowsToObjects(_sh('SEGUIMIENTOS')).filter(
    s => parseInt(s.registro_id,10) === id
  ).reverse();

  return { registro: reg, seguimientos: segs };
}

// ===== ACCIÓN: SEGUIMIENTO =====
function _seguimiento(payload, usuario) {
  const id = parseInt(payload.registro_id || '0', 10);
  if (!id) throw new Error('Falta registro_id');

  const regs = _sh('REGISTROS').getDataRange().getValues();
  const headers = regs[0];
  const idxId   = headers.indexOf('id');
  const idxEst  = headers.indexOf('estatus');
  const idxAct  = headers.indexOf('actualizado_en');

  let rowFound = -1, estatusAnterior = '';
  for (let i = 1; i < regs.length; i++) {
    if (parseInt(regs[i][idxId],10) === id) {
      rowFound = i + 1;
      estatusAnterior = String(regs[i][idxEst] || '');
      break;
    }
  }
  if (rowFound === -1) throw new Error('Registro no encontrado');

  const estatusNuevo = payload.estatus_nuevo || estatusAnterior;
  const shSeg = _sh('SEGUIMIENTOS');
  const segId = shSeg.getLastRow();
  shSeg.appendRow([
    segId, id, new Date(), estatusAnterior, estatusNuevo,
    payload.proximo_paso || '', payload.observaciones || '', usuario
  ]);

  // Actualizar REGISTROS
  const now = new Date();
  const shReg = _sh('REGISTROS');
  if (estatusNuevo) shReg.getRange(rowFound, idxEst + 1).setValue(estatusNuevo);
  shReg.getRange(rowFound, idxAct + 1).setValue(now);

  return { seguimiento_id: segId, estatus_anterior: estatusAnterior, estatus_nuevo: estatusNuevo };
}

// ===== ACCIÓN: QUIEN_SOY (devuelve rol/nombre del usuario logueado) =====
function _quienSoy(usuario) {
  if (!usuario) return null;
  const sh = _sh('USUARIOS');
  const data = sh.getDataRange().getValues();
  const u = String(usuario).trim().toLowerCase();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim().toLowerCase() === u && data[i][5] === true) {
      return {
        usuario: String(data[i][1]),
        nombre:  String(data[i][3] || data[i][1]),
        rol:     String(data[i][4] || 'operador')
      };
    }
  }
  return null;
}

// ===== ACCIÓN: ACTUALIZAR =====
function _actualizar(payload) {
  const id = parseInt(payload.id || '0', 10);
  if (!id) throw new Error('Falta id');

  const sh = _sh('REGISTROS');
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  for (let i = 1; i < data.length; i++) {
    if (parseInt(data[i][0],10) === id) {
      headers.forEach((h, idx) => {
        if (payload[String(h)] !== undefined && h !== 'id' && h !== 'fecha_creacion') {
          let val = payload[String(h)];
          if (h === 'fecha_seguimiento' && val) val = new Date(val);
          sh.getRange(i + 1, idx + 1).setValue(val);
        }
      });
      sh.getRange(i + 1, headers.indexOf('actualizado_en') + 1).setValue(new Date());
      return { id: id, actualizado: true };
    }
  }
  throw new Error('Registro no encontrado');
}

// ===== ROUTERS =====
function _routing(action, payload, usuario) {
  switch (action) {
    case 'login':       return _login(payload);
    case 'catalogos':   return _catalogos();
    case 'crear':       return _crear(payload, usuario);
    case 'buscar':      return _buscar(payload);
    case 'obtener':     return _obtener(payload);
    case 'seguimiento': return _seguimiento(payload, usuario);
    case 'actualizar':  return _actualizar(payload);
    case 'quien_soy':   return _quienSoy(usuario);
    default: throw new Error('Acción no soportada: ' + action);
  }
}

function doGet(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};
    const action = String(params.action || '');
    if (!action) return _err('Falta action');
    const payload = params;
    delete payload.action;
    let usuario = null;
    if (action !== 'login') {
      usuario = _validarToken(String(params.token || ''));
      if (!usuario) return _err('Sesión inválida o expirada', 'AUTH');
      delete payload.token;
    }
    const data = _routing(action, payload, usuario);
    return _ok(data);
  } catch (err) {
    return _err(err.message || String(err));
  }
}

function doPost(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};
    const action = String(params.action || '');
    if (!action) return _err('Falta action');
    let body = {};
    try {
      if (e && e.postData && e.postData.contents) {
        body = JSON.parse(e.postData.contents);
      }
    } catch (_) {}
    // El token viene en el body JSON (no en query string en POST)
    const token = body.token || params.token || '';
    const payload = Object.assign({}, body);
    delete payload.action;
    let usuario = null;
    if (action !== 'login') {
      usuario = _validarToken(String(token));
      if (!usuario) return _err('Sesión inválida o expirada', 'AUTH');
      delete payload.token;
    }
    const data = _routing(action, payload, usuario);
    return _ok(data);
  } catch (err) {
    return _err(err.message || String(err));
  }
}

// Helper para pruebas desde el editor
function _testLogin() {
  Logger.log(JSON.stringify(_login({ usuario: 'marco', password: 'admin01' })));
}