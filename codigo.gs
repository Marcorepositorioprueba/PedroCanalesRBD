/**
 * codigo.gs — Backend RBD V2 (Pedro Canales · Tulancingo)
 *
 * V2 (2026-09-10): migración a Sheet nuevo + reporte de observaciones V1:
 *  - Roles reales en servidor: admin / lider (todo por scope, no solo UI)
 *  - Hoja SIMPATIZANTES (ficha simple) + HISTORIAL (diff de cambios)
 *  - Duplicados por teléfono: se guarda como 'Posible duplicado', los resuelve admin
 *  - Soft-delete: estado 'Inactivo' + papelera de admin
 *  - Gestión de usuarios desde la app (alta L-XXX, reset password, bloquear)
 *  - Exportar CSV (admin), logout real, sesiones con rol/lider_id
 *
 * doGet  : ping | catalogos (sin token) — el resto exige token (también acepta POST-style)
 * doPost : todas las acciones (el token viaja en el body JSON)
 * Respuesta siempre JSON: { ok: true, data } | { ok: false, error, code }
 */

const SHEET_ID   = '12VhHRb9yZjWGz4y_1tv5-t02Kb35quQi2lvRVvAWOG8'; // RBD Pedro Canales — Tulancingo (cuenta limpia)
const APP_SALT   = 'CAMBIA_ESTO_GENERA_UNO_ALEATORIO';             // ⚠ Reemplazar por valor aleatorio en el editor de Apps Script
const TTL_ADMIN_MIN    = 60 * 24;      // 24 h
const TTL_LIDER_MIN    = 60 * 24 * 7;  // 7 días

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
  const raw = APP_SALT + ':' + pwd;
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('').toUpperCase();
}

// ===== HELPERS DE AUTORIZACIÓN (el servidor es la autoridad, no la UI) =====
function _exigir(ses, roles) {
  if (!ses) throw new Error('Sesión inválida', 'AUTH');
  if (roles.indexOf(ses.rol) === -1) throw new Error('No autorizado para esta acción');
}
function _exigirAdmin(ses) { _exigir(ses, ['admin']); }
function _esAdmin(ses) { return !!ses && ses.rol === 'admin'; }

// ===== SESIONES (token → {usuario, rol, nombre, lider_id} + expira) =====
function _getSesionesSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName('SESIONES');
  if (!sh) {
    sh = ss.insertSheet('SESIONES');
    sh.getRange(1, 1, 1, 7).setValues([['token','usuario','rol','nombre','lider_id','creado_en','expira_en']])
      .setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function _validarToken(token) {
  if (!token) return null;
  const sh = _getSesionesSheet();
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const iTok = headers.indexOf('token'), iUsr = headers.indexOf('usuario');
  const iRol = headers.indexOf('rol'), iNom = headers.indexOf('nombre');
  const iLid = headers.indexOf('lider_id'), iExp = headers.indexOf('expira_en');
  const now = new Date();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iTok]) === String(token)) {
      if (data[i][iExp] instanceof Date && data[i][iExp] > now) {
        return {
          token: String(token),
          usuario: String(data[i][iUsr]),
          rol: String(data[i][iRol] || 'operador'),
          nombre: String(data[i][iNom] || data[i][iUsr]),
          lider_id: String(data[i][iLid] || '')
        };
      }
      sh.deleteRow(i + 1);
      return null;
    }
  }
  return null;
}

function _crearSesion(ses) {
  const token = Utilities.getUuid().replace(/-/g, '');
  const now = new Date();
  const ttl = (ses.rol === 'admin') ? TTL_ADMIN_MIN : TTL_LIDER_MIN;
  const exp  = new Date(now.getTime() + ttl * 60000);
  _getSesionesSheet().appendRow([token, ses.usuario, ses.rol, ses.nombre, ses.lider_id || '', now, exp]);
  return { token: token, usuario: ses.usuario, rol: ses.rol, nombre: ses.nombre, lider_id: ses.lider_id || '', expira_en: exp.toISOString() };
}

function _borrarSesion(token) {
  const sh = _getSesionesSheet();
  const data = sh.getDataRange().getValues();
  const iTok = data[0].indexOf('token');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iTok]) === String(token)) { sh.deleteRow(i + 1); return true; }
  }
  return false;
}

function _limpiarSesionesExpiradas() {
  const sh = _getSesionesSheet();
  const data = sh.getDataRange().getValues();
  const iExp = data[0].indexOf('expira_en');
  const now = new Date();
  let borradas = 0;
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][iExp] instanceof Date && data[i][iExp] <= now) { sh.deleteRow(i + 1); borradas++; }
  }
  return borradas;
}

function _purgarSesionesDe(usuario) {
  const sh = _getSesionesSheet();
  const data = sh.getDataRange().getValues();
  const iUsr = data[0].indexOf('usuario');
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][iUsr]) === String(usuario)) sh.deleteRow(i + 1);
  }
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

// Folios secuenciales S-001 / L-001 (escanea el máximo real, no getLastRow)
function _siguienteFolio(sh, prefijo, columna) {
  const data = sh.getDataRange().getValues();
  const idx = data[0].indexOf(columna);
  let max = 0;
  const re = new RegExp('^' + prefijo + '-(\\d+)$', 'i');
  for (let i = 1; i < data.length; i++) {
    const m = re.exec(String(data[i][idx] || '').trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return prefijo + '-' + ('00' + (max + 1)).slice(-3);
}

// Teléfono normalizado: solo dígitos, comparar últimos 10
function _normTel(t) {
  const d = String(t || '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

// ===== HISTORIAL (diff de cambios — quién, cuándo, qué cambió) =====
function _getHistorialSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName('HISTORIAL');
  if (!sh) {
    sh = ss.insertSheet('HISTORIAL');
    sh.getRange(1, 1, 1, 9).setValues([['id','entidad','entidad_id','accion','campo','valor_anterior','valor_nuevo','usuario','fecha']])
      .setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function _registrarHistorial(entidad, entidadId, accion, cambios, usuario) {
  const sh = _getHistorialSheet();
  const id = sh.getLastRow(); // header(1) + datos
  const now = new Date();
  if (cambios && cambios.length) {
    const filas = cambios.map((c, i) => [id + i, entidad, String(entidadId), accion, c[0], String(c[1] === undefined || c[1] === null ? '' : c[1]), String(c[2] === undefined || c[2] === null ? '' : c[2]), usuario, now]);
    sh.getRange(sh.getLastRow() + 1, 1, filas.length, 9).setValues(filas);
  } else {
    sh.appendRow([id, entidad, String(entidadId), accion, '', '', '', usuario, now]);
  }
}

// Escritura por header dinámico + diff a HISTORIAL (patrón de _actualizar)
const _CAMPOS_PROTEGIDOS = ['id', 'fecha_creacion', 'creado_por', 'folio', 'lider_usuario', 'lider_id', 'telefono_norm', 'duplicado_de'];
function _diffYActualizar(sh, filaIdx, headers, payload, ses, entidad, entidadId, camposEditables) {
  const cambios = [];
  headers.forEach((h, idx) => {
    const k = String(h);
    if (payload[k] === undefined) return;
    if (_CAMPOS_PROTEGIDOS.indexOf(k) !== -1) return;
    if (camposEditables && camposEditables.indexOf(k) === -1) return;
    const anterior = sh.getRange(filaIdx, idx + 1).getValue();
    let val = payload[k];
    if (val instanceof Date || anterior instanceof Date) {
      if (k.indexOf('fecha') === 0 || k === 'actualizado_en') val = val ? new Date(val) : val;
    }
    const aStr = String(anterior === null ? '' : anterior);
    const nStr = String(val === null ? '' : val);
    if (aStr !== nStr) {
      sh.getRange(filaIdx, idx + 1).setValue(val);
      cambios.push([k, anterior, val]);
    }
  });
  const idxAct = headers.indexOf('actualizado_en');
  if (idxAct !== -1) sh.getRange(filaIdx, idxAct + 1).setValue(new Date());
  if (cambios.length) _registrarHistorial(entidad, entidadId, 'editar', cambios, ses.usuario);
  return cambios;
}

// ===== USUARIOS =====
function _usuariosRows() { return _rowsToObjects(_sh('USUARIOS')); }

function _usuarioPorNombre(usuario) {
  const u = String(usuario || '').trim().toLowerCase();
  return _usuariosRows().find(x => String(x.usuario).trim().toLowerCase() === u) || null;
}

// ===== ACCIÓN: LOGIN =====
function _login(payload) {
  const usuario = String(payload.usuario || '').trim().toLowerCase();
  const pwd     = String(payload.password || '');
  if (!usuario || !pwd) throw new Error('Falta usuario o contraseña');

  _limpiarSesionesExpiradas();
  const u = _usuarioPorNombre(usuario);
  // Mensaje único: no revela si el usuario existe o no
  if (!u || u.activo !== true || String(u.password_hash) !== _hash(pwd)) {
    throw new Error('Usuario o contraseña incorrectos');
  }
  const ses = {
    usuario: String(u.usuario),
    rol: String(u.rol || 'operador'),
    nombre: String(u.nombre || u.usuario),
    lider_id: String(u.lider_id || '')
  };
  const s = _crearSesion(ses);
  _registrarHistorial('USUARIO', ses.usuario, 'login', null, ses.usuario);
  return s;
}

function _logout(ses, token) {
  _borrarSesion(token);
  return { cerrada: true };
}

// ===== ACCIÓN: QUIEN_SOY =====
function _quienSoy(ses) {
  if (!ses) return null;
  return { usuario: ses.usuario, nombre: ses.nombre, rol: ses.rol, lider_id: ses.lider_id };
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

// ============================================================
// ===== SIMPATIZANTES (ficha simple, captura por líder) ======
// ============================================================
const SIM_EDITABLES = ['nombre','telefono','colonia','seccion','observaciones'];

function _crearSim(payload, ses) {
  _exigir(ses, ['admin', 'lider']);
  const req = ['nombre', 'telefono', 'colonia'];
  req.forEach(k => { if (!String(payload[k] || '').trim()) throw new Error('Falta campo requerido: ' + k); });
  if (String(payload.consentimiento || '') !== 'SI') {
    throw new Error('Se requiere el consentimiento de contacto para guardar');
  }

  const telNorm = _normTel(payload.telefono);
  if (!telNorm) throw new Error('Teléfono inválido');

  // Sección electoral: dígitos o NO_CONOCE
  let seccion = 'NO_CONOCE';
  if (payload.seccion && payload.no_conoce !== true && String(payload.seccion) !== 'NO_CONOCE') {
    const sd = String(payload.seccion).replace(/\D/g, '');
    if (sd.length < 3 || sd.length > 5) throw new Error('Sección electoral inválida (3 a 5 dígitos) o marca "No la conoce"');
    seccion = sd;
  }

  const sh = _sh('SIMPATIZANTES');
  const ahora = new Date();

  // Detección de duplicados por teléfono (no bloquea el guardado, no revela datos)
  const sims = _rowsToObjects(sh);
  const dup = sims.find(s =>
    String(s.telefono_norm || '') === telNorm && String(s.estado || '') !== 'Inactivo'
  );

  const folio = _siguienteFolio(sh, 'S', 'folio');
  const estado = dup ? 'Posible duplicado' : 'Activo';

  sh.appendRow([
    sh.getLastRow(), folio,
    String(payload.nombre).trim(),
    String(payload.telefono).trim(),
    telNorm,
    String(payload.colonia).trim(),
    seccion,
    String(payload.observaciones || '').trim(),
    'SI',
    String(payload.consentimiento_medio || 'app'),
    ahora,
    ses.usuario, ses.lider_id || '',
    estado,
    dup ? String(dup.folio) : '',
    ses.usuario, ahora, ahora
  ]);

  _registrarHistorial('SIMPATIZANTE', folio, 'crear', [['nombre', '', payload.nombre]], ses.usuario);
  if (dup) _registrarHistorial('SIMPATIZANTE', folio, 'duplicado_detectado', [['duplicado_de', '', dup.folio]], ses.usuario);

  const out = { folio: folio, estado: estado, duplicado: !!dup };
  return out;
}

function _buscarSim(payload, ses) {
  _exigir(ses, ['admin', 'lider', 'operador']);
  const q       = String(payload.q || '').toLowerCase().trim();
  const colonia = String(payload.colonia || '').trim();
  const seccion = String(payload.seccion || '').trim();
  const estado  = String(payload.estados || 'Activo').trim(); // 'Activo' | 'Inactivo' | 'Posible duplicado' | ''
  const liderF  = String(payload.lider || '').trim();          // filtro admin por líder
  const limit   = Math.min(parseInt(payload.limit || '50', 10), 200);
  const offset  = Math.max(parseInt(payload.offset || '0', 10), 0);

  let sims = _rowsToObjects(_sh('SIMPATIZANTES')).reverse(); // más recientes primero
  if (!_esAdmin(ses)) {
    // Líder: SOLO lo suyo, y nunca ve duplicados pendientes (eso es de admin)
    sims = sims.filter(s => String(s.lider_usuario || '') === String(ses.usuario));
    sims = sims.filter(s => String(s.estado || '') !== 'Posible duplicado');
  }
  sims = sims.filter(s => {
    if (estado !== '' && String(s.estado || '') !== estado) return false;
    if (q) {
      const hay = [s.nombre, s.colonia, s.seccion, s.observaciones].join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    if (colonia && String(s.colonia || '').trim() !== colonia) return false;
    if (seccion) {
      const ss_ = String(s.seccion || '');
      if (seccion === 'NO_CONOCE' ? ss_ !== 'NO_CONOCE' : ss_ !== seccion) return false;
    }
    if (_esAdmin(ses) && liderF && String(s.lider_usuario || '') !== liderF) return false;
    return true;
  });

  return { total: sims.length, limit: limit, offset: offset, resultados: sims.slice(offset, offset + limit) };
}

function _obtenerSim(payload, ses) {
  _exigir(ses, ['admin', 'lider', 'operador']);
  const folio = String(payload.folio || '').trim();
  if (!folio) throw new Error('Falta folio');

  const sims = _rowsToObjects(_sh('SIMPATIZANTES'));
  const sim = sims.find(s => String(s.folio || '').trim() === folio);
  if (!sim) throw new Error('Simpatizante no encontrado');
  if (!_esAdmin(ses) && String(sim.lider_usuario || '') !== String(ses.usuario)) {
    throw new Error('No autorizado'); // aislamiento entre líderes
  }
  if (!_esAdmin(ses) && String(sim.estado || '') === 'Posible duplicado') {
    throw new Error('No autorizado');
  }

  const out = { simpatizante: sim };
  if (_esAdmin(ses)) {
    out.historial = _rowsToObjects(_getHistorialSheet())
      .filter(h => h.entidad === 'SIMPATIZANTE' && String(h.entidad_id) === folio)
      .reverse();
  }
  return out;
}

function _actualizarSim(payload, ses) {
  _exigir(ses, ['admin', 'lider']);
  const folio = String(payload.folio || '').trim();
  if (!folio) throw new Error('Falta folio');

  const sh = _sh('SIMPATIZANTES');
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const iFol = headers.indexOf('folio');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iFol]).trim() === folio) {
      if (!_esAdmin(ses) && String(data[i][headers.indexOf('lider_usuario')]) !== String(ses.usuario)) {
        throw new Error('No autorizado');
      }
      // Si cambia el teléfono, revalidar formato (no re-cheque duplicados: admin lo resuelve)
      if (payload.telefono !== undefined && !_normTel(payload.telefono)) throw new Error('Teléfono inválido');
      const cambios = _diffYActualizar(sh, i + 1, headers, payload, ses, 'SIMPATIZANTE', folio, SIM_EDITABLES);
      return { folio: folio, actualizado: true, cambios: cambios.length };
    }
  }
  throw new Error('Simpatizante no encontrado');
}

function _cambiarEstadoSim(payload, ses) {
  _exigir(ses, ['admin', 'lider']);
  const folio = String(payload.folio || '').trim();
  const nuevo = String(payload.estado || '').trim();
  if (!folio || ['Activo', 'Inactivo'].indexOf(nuevo) === -1) {
    throw new Error('Falta folio o estado inválido (Activo/Inactivo)');
  }

  const sh = _sh('SIMPATIZANTES');
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const iFol = headers.indexOf('folio'), iEst = headers.indexOf('estado');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iFol]).trim() === folio) {
      const esDueno = String(data[i][headers.indexOf('lider_usuario')]) === String(ses.usuario);
      if (!_esAdmin(ses) && !esDueno) throw new Error('No autorizado');
      // Líder puede inactivar lo suyo; reactivar/recuperar SOLO admin
      if (!_esAdmin(ses) && nuevo === 'Activo' && String(data[i][iEst]) === 'Inactivo') {
        throw new Error('No autorizado: solo administración puede recuperar registros');
      }
      const anterior = data[i][iEst];
      sh.getRange(i + 1, iEst + 1).setValue(nuevo);
      const idxAct = headers.indexOf('actualizado_en');
      if (idxAct !== -1) sh.getRange(i + 1, idxAct + 1).setValue(new Date());
      _registrarHistorial('SIMPATIZANTE', folio, nuevo === 'Inactivo' ? 'inactivar' : 'recuperar', [['estado', anterior, nuevo]], ses.usuario);
      return { folio: folio, estado: nuevo };
    }
  }
  throw new Error('Simpatizante no encontrado');
}

// ===== DUPLICADOS (bandeja de admin) =====
function _duplicadosListar(ses) {
  _exigirAdmin(ses);
  const sims = _rowsToObjects(_sh('SIMPATIZANTES'));
  const pendientes = sims.filter(s => String(s.estado || '') === 'Posible duplicado');
  return pendientes.map(p => ({
    nuevo: p,
    existente: sims.find(s => String(s.folio) === String(p.duplicado_de)) || null
  }));
}

function _duplicadoResolver(payload, ses) {
  _exigirAdmin(ses);
  const folio = String(payload.folio || '').trim();
  const res = String(payload.resolucion || '').trim(); // 'aceptar' | 'descartar'
  if (!folio || ['aceptar', 'descartar'].indexOf(res) === -1) {
    throw new Error('Falta folio o resolución inválida (aceptar/descartar)');
  }
  const estado = res === 'aceptar' ? 'Activo' : 'Inactivo';
  const sh = _sh('SIMPATIZANTES');
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const iFol = headers.indexOf('folio'), iEst = headers.indexOf('estado');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iFol]).trim() === folio && String(data[i][iEst]) === 'Posible duplicado') {
      sh.getRange(i + 1, iEst + 1).setValue(estado);
      _registrarHistorial('SIMPATIZANTE', folio, 'resolver_duplicado', [['estado', 'Posible duplicado', estado]], ses.usuario);
      return { folio: folio, estado: estado };
    }
  }
  throw new Error('Duplicado no encontrado o ya resuelto');
}

// ============================================================
// ===== USUARIOS (gestión desde panel admin) =================
// ============================================================
function _usuariosListar(ses) {
  _exigirAdmin(ses);
  const sims = _rowsToObjects(_sh('SIMPATIZANTES'));
  return _usuariosRows().map(u => ({
    usuario: String(u.usuario),
    nombre: String(u.nombre || ''),
    rol: String(u.rol || ''),
    activo: u.activo === true,
    lider_id: String(u.lider_id || ''),
    created_at: u.created_at,
    simpatizantes: sims.filter(s => String(s.lider_usuario) === String(u.usuario) && String(s.estado) !== 'Inactivo').length
  }));
}

function _usuarioCrear(payload, ses) {
  _exigirAdmin(ses);
  const usuario = String(payload.usuario || '').trim().toLowerCase();
  const nombre  = String(payload.nombre || '').trim();
  const rol     = String(payload.rol || 'lider').trim();
  const pwd     = String(payload.password || '');
  if (!usuario || !nombre || !pwd) throw new Error('Falta usuario, nombre o contraseña');
  if (pwd.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
  if (['lider', 'admin', 'operador'].indexOf(rol) === -1) throw new Error('Rol inválido');
  if (_usuarioPorNombre(usuario)) throw new Error('El usuario ya existe');

  const sh = _sh('USUARIOS');
  const headers = sh.getDataRange().getValues()[0];
  const iId  = headers.indexOf('id');
  const iLid = headers.indexOf('lider_id');
  const iAlt = headers.indexOf('fecha_alta');
  const id   = sh.getLastRow(); // header(1) + datos
  const ahora = new Date();
  const liderId = rol === 'lider' ? _siguienteFolio(sh, 'L', 'lider_id') : '';

  const fila = new Array(headers.length).fill('');
  fila[iId] = id;
  fila[headers.indexOf('usuario')] = usuario;
  fila[headers.indexOf('password_hash')] = _hash(pwd);
  fila[headers.indexOf('nombre')] = nombre;
  fila[headers.indexOf('rol')] = rol;
  fila[headers.indexOf('activo')] = true;
  fila[headers.indexOf('created_at')] = ahora;
  if (iLid !== -1) fila[iLid] = liderId;
  if (iAlt !== -1) fila[iAlt] = ahora;
  sh.appendRow(fila);

  _registrarHistorial('USUARIO', usuario, 'alta_usuario', [['rol', '', rol], ['lider_id', '', liderId]], ses.usuario);
  return { usuario: usuario, nombre: nombre, rol: rol, lider_id: liderId };
}

function _usuarioPassword(payload, ses) {
  _exigirAdmin(ses);
  const usuario = String(payload.usuario || '').trim().toLowerCase();
  const pwd     = String(payload.password || '');
  if (!usuario || pwd.length < 8) throw new Error('Usuario o contraseña nueva inválida (mínimo 8 caracteres)');
  const u = _usuarioPorNombre(usuario);
  if (!u) throw new Error('Usuario no encontrado');

  const sh = _sh('USUARIOS');
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const iUsr = headers.indexOf('usuario'), iHash = headers.indexOf('password_hash');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iUsr]).trim().toLowerCase() === usuario) {
      sh.getRange(i + 1, iHash + 1).setValue(_hash(pwd));
      _registrarHistorial('USUARIO', usuario, 'cambio_password', null, ses.usuario);
      return { usuario: usuario, reset: true };
    }
  }
  throw new Error('Usuario no encontrado');
}

function _usuarioBloquear(payload, ses) {
  _exigirAdmin(ses);
  const usuario = String(payload.usuario || '').trim().toLowerCase();
  const activo  = payload.activo === true;
  if (!usuario) throw new Error('Falta usuario');
  if (usuario === String(ses.usuario).toLowerCase()) throw new Error('No puedes bloquear tu propia cuenta');
  const u = _usuarioPorNombre(usuario);
  if (!u) throw new Error('Usuario no encontrado');

  const sh = _sh('USUARIOS');
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const iUsr = headers.indexOf('usuario'), iAct = headers.indexOf('activo');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iUsr]).trim().toLowerCase() === usuario) {
      sh.getRange(i + 1, iAct + 1).setValue(activo);
      if (!activo) _purgarSesionesDe(usuario); // bloquear corta sesiones vivas
      _registrarHistorial('USUARIO', usuario, activo ? 'desbloqueo' : 'bloqueo', [['activo', u.activo, activo]], ses.usuario);
      return { usuario: usuario, activo: activo };
    }
  }
  throw new Error('Usuario no encontrado');
}

function _cambiarPassword(payload, ses) {
  _exigir(ses, ['admin', 'lider', 'operador']);
  const actual = String(payload.password_actual || '');
  const nueva  = String(payload.password_nueva || '');
  if (nueva.length < 8) throw new Error('La nueva contraseña debe tener al menos 8 caracteres');
  const u = _usuarioPorNombre(ses.usuario);
  if (!u || String(u.password_hash) !== _hash(actual)) throw new Error('La contraseña actual no es correcta');

  const sh = _sh('USUARIOS');
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const iUsr = headers.indexOf('usuario'), iHash = headers.indexOf('password_hash');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iUsr]).trim().toLowerCase() === String(ses.usuario).toLowerCase()) {
      sh.getRange(i + 1, iHash + 1).setValue(_hash(nueva));
      _registrarHistorial('USUARIO', ses.usuario, 'cambio_password', null, ses.usuario);
      return { cambiado: true };
    }
  }
  throw new Error('Usuario no encontrado');
}

// ===== EXPORTAR CSV (admin) =====
function _exportar(payload, ses) {
  _exigirAdmin(ses);
  const res = _buscarSim(payload, ses); // reutiliza filtros (lider, colonia, seccion, estados)
  const headers = ['folio','nombre','telefono','colonia','seccion','observaciones','consentimiento',
                   'consentimiento_medio','lider_usuario','lider_id','estado','fecha_creacion'];
  const esc = v => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
  const lineas = [headers.join(',')];
  res.resultados.forEach(r => lineas.push(headers.map(h => esc(r[h])).join(',')));
  return { csv: lineas.join('\r\n'), total: res.total };
}

// ===== HISTORIAL (consulta admin) =====
function _historial(payload, ses) {
  _exigirAdmin(ses);
  const entidad = String(payload.entidad || '').trim();
  const id      = String(payload.entidad_id || '').trim();
  return _rowsToObjects(_getHistorialSheet()).reverse().filter(h => {
    if (entidad && h.entidad !== entidad) return false;
    if (id && String(h.entidad_id) !== id) return false;
    return true;
  }).slice(0, 500);
}

// ===== RESET DE DATOS (admin, guarda manual) =====
function _borrarDatosDemo(ses, payload) {
  _exigirAdmin(ses);
  if (!payload || payload.confirmar !== 'BORRAR') {
    throw new Error('Confirmación requerida: enviar confirmar = "BORRAR"');
  }
  ['REGISTROS', 'SEGUIMIENTOS', 'SIMPATIZANTES', 'HISTORIAL', 'SESIONES'].forEach(nombre => {
    const sh = _sh(nombre);
    if (!sh) return;
    const last = sh.getLastRow();
    if (last > 1) sh.deleteRows(2, last - 1);
  });
  return { limpiadas: ['REGISTROS','SEGUIMIENTOS','SIMPATIZANTES','HISTORIAL','SESIONES'] };
}

// ============================================================
// ===== REGISTROS (ficha de líder / actor territorial) =======
// ============================================================
function _crear(payload, ses) {
  _exigir(ses, ['admin', 'lider']);
  const req = ['municipio', 'nombre', 'problemas_identificados'];
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
    ses.usuario,
    ahora,
    payload.problemas_identificados || ''
  ];
  sh.appendRow(fila);
  _registrarHistorial('REGISTRO', id, 'crear', [['nombre', '', payload.nombre]], ses.usuario);
  return { id: id, creado_en: ahora.toISOString() };
}

function _buscar(payload, ses) {
  _exigir(ses, ['admin', 'lider', 'operador']);
  const q      = String(payload.q || '').toLowerCase().trim();
  const mun    = String(payload.municipio || '').trim();
  const loc    = String(payload.localidad || '').trim();
  const perfil = String(payload.perfil || '').trim();
  const prio   = String(payload.prioridad || '').trim();
  const est    = String(payload.estatus || '').trim();
  const limit  = Math.min(parseInt(payload.limit || '50', 10), 200);
  const offset = Math.max(parseInt(payload.offset || '0', 10), 0);

  let regs = _rowsToObjects(_sh('REGISTROS')).reverse(); // más recientes primero
  if (!_esAdmin(ses)) {
    // Líder / operador: solo lo suyo
    regs = regs.filter(r => String(r.creado_por || '') === String(ses.usuario));
  }
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

function _obtener(payload, ses) {
  _exigir(ses, ['admin', 'lider', 'operador']);
  const id = parseInt(payload.id || '0', 10);
  if (!id) throw new Error('Falta id');

  const regs = _rowsToObjects(_sh('REGISTROS'));
  const reg  = regs.find(r => parseInt(r.id,10) === id);
  if (!reg) throw new Error('Registro no encontrado');
  if (!_esAdmin(ses) && String(reg.creado_por || '') !== String(ses.usuario)) {
    throw new Error('No autorizado');
  }

  // seguimientos
  const segs = _rowsToObjects(_sh('SEGUIMIENTOS')).filter(
    s => parseInt(s.registro_id,10) === id
  ).reverse();

  const out = { registro: reg, seguimientos: segs };
  if (_esAdmin(ses)) {
    out.historial = _rowsToObjects(_getHistorialSheet())
      .filter(h => h.entidad === 'REGISTRO' && String(h.entidad_id) === String(id))
      .reverse();
  }
  return out;
}

function _seguimiento(payload, ses) {
  _exigir(ses, ['admin', 'lider']);
  const id = parseInt(payload.registro_id || '0', 10);
  if (!id) throw new Error('Falta registro_id');

  const regs = _sh('REGISTROS').getDataRange().getValues();
  const headers = regs[0];
  const idxId   = headers.indexOf('id');
  const idxEst  = headers.indexOf('estatus');
  const idxAct  = headers.indexOf('actualizado_en');
  const idxProp = headers.indexOf('creado_por');

  let rowFound = -1, estatusAnterior = '';
  for (let i = 1; i < regs.length; i++) {
    if (parseInt(regs[i][idxId],10) === id) {
      if (!_esAdmin(ses) && idxProp !== -1 && String(regs[i][idxProp]) !== String(ses.usuario)) {
        throw new Error('No autorizado');
      }
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
    payload.proximo_paso || '', payload.observaciones || '', ses.usuario
  ]);

  // Actualizar REGISTROS
  const now = new Date();
  const shReg = _sh('REGISTROS');
  if (estatusNuevo) shReg.getRange(rowFound, idxEst + 1).setValue(estatusNuevo);
  shReg.getRange(rowFound, idxAct + 1).setValue(now);
  _registrarHistorial('REGISTRO', id, 'seguimiento', [['estatus', estatusAnterior, estatusNuevo]], ses.usuario);

  return { seguimiento_id: segId, estatus_anterior: estatusAnterior, estatus_nuevo: estatusNuevo };
}

function _actualizar(payload, ses) {
  _exigir(ses, ['admin', 'lider']);
  const id = parseInt(payload.id || '0', 10);
  if (!id) throw new Error('Falta id');

  const sh = _sh('REGISTROS');
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idxProp = headers.indexOf('creado_por');
  for (let i = 1; i < data.length; i++) {
    if (parseInt(data[i][0],10) === id) {
      if (!_esAdmin(ses) && idxProp !== -1 && String(data[i][idxProp]) !== String(ses.usuario)) {
        throw new Error('No autorizado');
      }
      headers.forEach((h, idx) => {
        const k = String(h);
        if (payload[k] !== undefined && k !== 'id' && k !== 'fecha_creacion' && k !== 'creado_por') {
          let val = payload[k];
          if (k === 'fecha_seguimiento' && val) val = new Date(val);
          const anterior = sh.getRange(i + 1, idx + 1).getValue();
          if (String(anterior) !== String(val)) {
            sh.getRange(i + 1, idx + 1).setValue(val);
            _registrarHistorial('REGISTRO', id, 'editar', [[k, anterior, val]], ses.usuario);
          }
        }
      });
      sh.getRange(i + 1, headers.indexOf('actualizado_en') + 1).setValue(new Date());
      return { id: id, actualizado: true };
    }
  }
  throw new Error('Registro no encontrado');
}

// ===== ROUTER =====
function _routing(action, payload, ses, token) {
  switch (action) {
    // ---- Sesión ----
    case 'login':       return _login(payload);
    case 'logout':      return _logout(ses, token);
    case 'catalogos':   return _catalogos();
    case 'quien_soy':   return _quienSoy(ses);
    // ---- Simpatizantes (ficha simple) ----
    case 'crear_simpatizante':     return _crearSim(payload, ses);
    case 'buscar_simpatizantes':   return _buscarSim(payload, ses);
    case 'obtener_simpatizante':   return _obtenerSim(payload, ses);
    case 'actualizar_simpatizante':return _actualizarSim(payload, ses);
    case 'cambiar_estado_sim':     return _cambiarEstadoSim(payload, ses);
    case 'duplicados_listar':      return _duplicadosListar(ses);
    case 'duplicado_resolver':     return _duplicadoResolver(payload, ses);
    // ---- Usuarios (admin) ----
    case 'usuarios_listar':  return _usuariosListar(ses);
    case 'usuario_crear':    return _usuarioCrear(payload, ses);
    case 'usuario_password': return _usuarioPassword(payload, ses);
    case 'usuario_bloquear': return _usuarioBloquear(payload, ses);
    case 'cambiar_password': return _cambiarPassword(payload, ses);
    // ---- Admin ----
    case 'exportar':         return _exportar(payload, ses);
    case 'historial':        return _historial(payload, ses);
    case 'borrar_datos_demo':return _borrarDatosDemo(ses, payload);
    // ---- Ficha líder/actor territorial (REGISTROS) ----
    case 'crear':       return _crear(payload, ses);
    case 'buscar':      return _buscar(payload, ses);
    case 'obtener':     return _obtener(payload, ses);
    case 'seguimiento': return _seguimiento(payload, ses);
    case 'actualizar':  return _actualizar(payload, ses);
    default: throw new Error('Acción no soportada: ' + action);
  }
}

function doGet(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};
    const action = String(params.action || '');
    if (!action) return _err('Falta action');
    const payload = Object.assign({}, params);
    delete payload.action;

    // Solo ping y catalogos son públicos; el resto exige token
    if (action !== 'ping' && action !== 'catalogos') {
      const ses = _validarToken(String(params.token || ''));
      if (!ses) return _err('Sesión inválida o expirada', 'AUTH');
      delete payload.token;
      const data = _routing(action, payload, ses, String(params.token || ''));
      return _ok(data);
    }
    if (action === 'ping') return _ok({ version: 'v2', ts: new Date().toISOString() });
    return _ok(_catalogos());
  } catch (err) {
    Logger.log('doGet error: ' + (err && err.stack ? err.stack : String(err)));
    return _err(err.message || 'Error interno');
  }
}

function doPost(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};
    let action = String(params.action || params.e_action || '');
    let body = {};
    try {
      if (e && e.postData && e.postData.contents) {
        body = JSON.parse(e.postData.contents);
      }
    } catch (_) {}
    if (!action) action = String(body.action || '');
    if (!action) return _err('Falta action');

    const token = String(body.token || params.token || '');
    const payload = Object.assign({}, body);
    delete payload.action;
    delete payload.token;

    if (action !== 'login') {
      const ses = _validarToken(token);
      if (!ses) return _err('Sesión inválida o expirada', 'AUTH');
      const data = _routing(action, payload, ses, token);
      return _ok(data);
    }
    return _ok(_routing(action, payload, null, ''));
  } catch (err) {
    Logger.log('doPost error: ' + (err && err.stack ? err.stack : String(err)));
    return _err(err.message || 'Error interno');
  }
}