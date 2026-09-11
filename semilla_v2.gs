/**
 * semilla_v2.gs — Inicializador RBD V2 (Pedro Canales · Tulancingo)
 *
 * Usa APP_SALT y _hash() definidos en codigo.gs (mismo proyecto de Apps Script).
 *
 * ORDEN DE EJECUCIÓN (una sola vez, desde el editor):
 *   1. inicializarV2()      → crea/actualiza hojas + admin nuevo (con APP_SALT real)
 *   2. Hoja "_LOCALIDADES_SEED" (A:NOM_MUN B:LOC C:NOM_LOC) con seed_localidades_tulancingo.txt
 *   3. importarLocalidades()
 *   4. limpiarDatosDemo()   → SOLO si el Sheet trae datos del demo (copia del Sheet viejo)
 *
 * Idempotente: se puede correr inicializarV2() más de una vez sin romper nada.
 * ⚠ Edita ADMIN_PASSWORD_V2 antes de ejecutar. El sal real se pone en codigo.gs (APP_SALT).
 */

const ADMIN_USERNAME_V2 = 'pcadmin';
const ADMIN_PASSWORD_V2 = 'CAMBIA_ESTO_PASSWORD_ADMIN';   // ⚠ mínimo 8 caracteres, valor fuerte
const ADMIN_NAME_V2     = 'Administrador';

// ===== CATÁLOGOS (iguales al demo + medios de consentimiento) =====
const CATALOGOS_V2 = {
  perfil: [
    'Líder comunitario','Funcionario público','Empresario',
    'Académico / Educador','Periodista / Comunicador','Líder religioso',
    'Deportista','Productor rural','Comerciante','Artesano'
  ],
  tipo_vinculacion: [
    'Política','Social','Económica','Cultural','Deportiva',
    'Educativa','Religiosa','Productiva'
  ],
  prioridad: ['Alta','Media','Baja'],
  estatus: [
    'Por contactar','En seguimiento','Contactado',
    'Compromiso adquirido','Cerrado'
  ],
  sector: [
    'Jóvenes','Mujeres','Políticos','Empresarial',
    'Educativo','Comunitario','Religioso','Deportivo',
    'Productivo','Cultural','Otros'
  ],
  consentimiento_medio: ['app','verbal','escrito']
};

const MUNICIPIOS_V2 = [[77, 'Tulancingo de Bravo', '077']];

// ===== HELPERS =====
function _crearHojaSiFalta(ss, nombre, headers) {
  let sh = ss.getSheetByName(nombre);
  if (sh) return sh;
  sh = ss.insertSheet(nombre);
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#E8EAED');
  sh.setFrozenRows(1);
  return sh;
}

// Agrega columnas faltantes al final del header (no borra ni renombra)
function _asegurarColumnas(sh, requeridas) {
  const actuales = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
    .map(h => String(h).trim());
  let ultima = actuales.length;
  requeridas.forEach(r => {
    if (actuales.indexOf(r) === -1) {
      sh.getRange(1, ++ultima).setValue(r).setFontWeight('bold').setBackground('#E8EAED');
    }
  });
}

// ===== INICIALIZADOR V2 =====
function inicializarV2() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Hojas base (existen en la copia del demo; se crean si falta algo)
  _crearHojaSiFalta(ss, 'REGISTROS', [
    'id','fecha_creacion','municipio','localidad','nombre','organizacion',
    'perfil','tipo_vinculacion','que_aporta','prioridad','motivo_prioridad',
    'proximo_paso','fecha_seguimiento','estatus','observaciones',
    'creado_por','actualizado_en','problemas_identificados'
  ]);
  _crearHojaSiFalta(ss, 'MUNICIPIOS',  ['id','nombre','clave']);
  _crearHojaSiFalta(ss, 'LOCALIDADES', ['id','municipio_id','nombre','clave']);
  _crearHojaSiFalta(ss, 'CATALOGOS',   ['tipo','valor','orden']);
  _crearHojaSiFalta(ss, 'SEGUIMIENTOS',[
    'id','registro_id','fecha','estatus_anterior','estatus_nuevo',
    'proximo_paso','observaciones','usuario'
  ]);

  // USUARIOS: ampliar con lider_id + fecha_alta (conserva usuarios existentes)
  const shUsr = _crearHojaSiFalta(ss, 'USUARIOS',
    ['id','usuario','password_hash','nombre','rol','activo','created_at','lider_id','fecha_alta']);
  _asegurarColumnas(shUsr, ['lider_id', 'fecha_alta']);

  // SESIONES v2 (7 columnas): si existe la vieja de 4, se reemplaza (tokens desechables)
  const shSes = ss.getSheetByName('SESIONES');
  if (shSes && shSes.getLastColumn() < 7) ss.deleteSheet(shSes);
  _crearHojaSiFalta(ss, 'SESIONES',
    ['token','usuario','rol','nombre','lider_id','creado_en','expira_en']);

  // SIMPATIZANTES (ficha simple del PDF) — recrear si headers no coinciden
  const SIM_HEADERS = ['id','folio','nombre','telefono','telefono_norm','colonia',
    'seccion','observaciones','consentimiento','consentimiento_medio',
    'consentimiento_fecha','lider_usuario','lider_id','estado',
    'duplicado_de','creado_por','fecha_creacion','actualizado_en'];
  const shSim = ss.getSheetByName('SIMPATIZANTES');
  if (shSim) {
    const hh = shSim.getRange(1, 1, 1, Math.max(shSim.getLastColumn(), 1)).getValues()[0]
      .map(h => String(h).trim());
    const igual = SIM_HEADERS.length === hh.length && SIM_HEADERS.every((h, i) => h === hh[i]);
    if (!igual) ss.deleteSheet(shSim);
  }
  _crearHojaSiFalta(ss, 'SIMPATIZANTES', SIM_HEADERS);

  // HISTORIAL (diff de cambios)
  const shHis = ss.getSheetByName('HISTORIAL');
  if (shHis && shHis.getLastColumn() !== 9) ss.deleteSheet(shHis);
  _crearHojaSiFalta(ss, 'HISTORIAL', ['id','entidad','entidad_id','accion','campo','valor_anterior','valor_nuevo','usuario','fecha']);

  // Municipio único
  const shMun = ss.getSheetByName('MUNICIPIOS');
  if (shMun.getLastRow() < 2) {
    shMun.getRange(2, 1, MUNICIPIOS_V2.length, 3).setValues(MUNICIPIOS_V2);
  }

  // Catálogos: agregar solo los tipos que falten (idempotente)
  const shCat = ss.getSheetByName('CATALOGOS');
  const catsActuales = {};
  if (shCat.getLastRow() > 1) {
    shCat.getRange(2, 1, shCat.getLastRow() - 1, 1).getValues()
      .forEach(r => catsActuales[String(r[0]).trim()] = true);
  }
  const catNuevos = [];
  for (const tipo in CATALOGOS_V2) {
    if (catsActuales[tipo]) continue;
    CATALOGOS_V2[tipo].forEach((v, i) => catNuevos.push([tipo, v, i + 1]));
  }
  if (catNuevos.length) {
    shCat.getRange(shCat.getLastRow() + 1, 1, catNuevos.length, 3).setValues(catNuevos);
  }

  // Admin: crear o actualizar (re-hash con el APP_SALT actual de codigo.gs)
  const shU = ss.getSheetByName('USUARIOS');
  const uData = shU.getDataRange().getValues();
  let adminFila = -1;
  for (let i = 1; i < uData.length; i++) {
    if (String(uData[i][1]).trim().toLowerCase() === ADMIN_USERNAME_V2.toLowerCase()) { adminFila = i; break; }
  }
  if (adminFila === -1) {
    shU.appendRow([
      shU.getLastRow(), ADMIN_USERNAME_V2, _hash(ADMIN_PASSWORD_V2),
      ADMIN_NAME_V2, 'admin', true, new Date(), '', new Date()
    ]);
  } else {
    shU.getRange(adminFila + 1, 3).setValue(_hash(ADMIN_PASSWORD_V2)); // password_hash
    shU.getRange(adminFila + 1, 5).setValue('admin');                  // rol
    shU.getRange(adminFila + 1, 6).setValue(true);                     // activo
  }

  const nombres = ss.getSheets().map(s => s.getName());
  Logger.log('inicializarV2 OK. Hojas: ' + nombres.join(', '));
  SpreadsheetApp.getUi().alert(
    '✓ Inicialización V2 completa',
    'Hojas: ' + nombres.length + ' → ' + nombres.join(', ') +
    '\nAdmin: ' + ADMIN_USERNAME_V2 + ' (password con el sal actual de codigo.gs)' +
    '\n\nSIGUIENTE:' +
    '\n1. cargarLocalidadesIntegradas() — carga las 80 localidades sin pegar nada' +
    '\n2. limpiarDatosDemo() — si el Sheet trae datos del demo',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// ===== IMPORTAR LOCALIDADES (mismo formato del demo) =====
function importarLocalidades() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tmp = ss.getSheetByName('_LOCALIDADES_SEED');
  if (!tmp) throw new Error(
    'No existe la hoja "_LOCALIDADES_SEED".\n' +
    'Créala con 3 columnas (A: NOM_MUN, B: LOC, C: NOM_LOC) y pega los datos de seed_localidades_tulancingo.txt\n' +
    'O mejor: ejecuta cargarLocalidadesIntegradas() que ya trae las 80 de Tulancingo embebidas.'
  );

  const munMap = {};
  MUNICIPIOS_V2.forEach(m => munMap[String(m[1]).trim()] = m[0]);

  const data = tmp.getDataRange().getValues();
  if (data.length < 2) throw new Error('La hoja temporal está vacía.');
  const header = data[0].map(h => String(h).trim().toUpperCase());
  if (header[0] !== 'NOM_MUN' || header[1] !== 'LOC' || header[2] !== 'NOM_LOC') {
    throw new Error('Headers incorrectos. Deben ser: NOM_MUN | LOC | NOM_LOC');
  }

  const rows = [];
  let skipped = 0;
  for (let i = 1; i < data.length; i++) {
    const nomMun = data[i][0], loc = data[i][1], nomLoc = data[i][2];
    if (!String(nomLoc).trim()) { skipped++; continue; }
    const nombreMun = String(nomMun).trim() || 'Tulancingo de Bravo';
    const munId = munMap[nombreMun];
    if (!munId) { skipped++; continue; }
    const clave = String(loc).trim() || String(rows.length + 1).padStart(4, '0');
    rows.push([rows.length + 1, munId, String(nomLoc).trim(), clave]);
  }

  if (rows.length === 0) throw new Error('No se insertaron filas. Verifica los nombres de municipio.');

  const shLoc = ss.getSheetByName('LOCALIDADES');
  // Reemplaza datos (conserva headers) para que sea re-ejecutable
  if (shLoc.getLastRow() > 1) shLoc.deleteRows(2, shLoc.getLastRow() - 1);
  shLoc.getRange(2, 1, rows.length, 4).setValues(rows);

  SpreadsheetApp.getUi().alert(
    '✓ Localidades importadas',
    'Insertadas: ' + rows.length + '\nOmitidas: ' + skipped +
    '\n\nYa puedes borrar la hoja "_LOCALIDADES_SEED".',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// ===== LIMPIAR DATOS DEL DEMO =====
// Borra FILAS de datos (nunca headers ni hojas) del Sheet copiado del demo:
// REGISTROS, SEGUIMIENTOS, SIMPATIZANTES, HISTORIAL, SESIONES y USUARIOS.
// MUNICIPIOS, LOCALIDADES y CATALOGOS se conservan. Re-crea el admin.
// EJECUTAR UNA VEZ, solo si el Sheet viene de la copia del demo.
function limpiarDatosDemo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  ['REGISTROS','SEGUIMIENTOS','SIMPATIZANTES','HISTORIAL','SESIONES'].forEach(nombre => {
    const sh = ss.getSheetByName(nombre);
    if (sh && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  });

  // USUARIOS: borrar todos (incluye usuarios demo) y re-crear solo el admin
  const shU = ss.getSheetByName('USUARIOS');
  if (shU && shU.getLastRow() > 1) shU.deleteRows(2, shU.getLastRow() - 1);
  shU.appendRow([
    shU.getLastRow(), ADMIN_USERNAME_V2, _hash(ADMIN_PASSWORD_V2),
    ADMIN_NAME_V2, 'admin', true, new Date(), '', new Date()
  ]);

  SpreadsheetApp.getUi().alert(
    '✓ Datos del demo eliminados',
    'Se limpiaron: REGISTROS, SEGUIMIENTOS, SIMPATIZANTES, HISTORIAL, SESIONES, USUARIOS.\n' +
    'Admin recreado: ' + ADMIN_USERNAME_V2 + '\n' +
    'Se conservaron: MUNICIPIOS, LOCALIDADES, CATALOGOS.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
// ===== LOCALIDADES EMBEBIDAS (80 de Tulancingo de Bravo — seed_localidades_tulancingo.txt) =====
// Carga directa sin pegar nada en el Sheet. Idempotente (reemplaza datos, conserva headers).
function cargarLocalidadesIntegradas() {
  const NOMBRES = [
    'Tulancingo', 'Jaltepec', 'Parque Urbano Napateco', 'Javier Rojo Gómez', 'Santa Ana Hueytlalpan',
    'Rincones de la Hacienda', 'Santa María Asunción', 'Ahuehuetitla', 'La Lagunilla', 'Viveros de la Loma',
    'Fraccionamiento del Magisterio Tulancinguense', 'San Antonio Farías', 'Napateco', 'San Nicolás el Chico [Rancho]', 'Tepalzingo',
    'Carlos Salinas de Gortari [Fraccionamiento]', 'Ejido el Paraíso', 'San Nicolás Cebolletas', 'Santa María el Chico', 'Pedregal de San Francisco',
    'Colonia 2 de Agosto', 'Ejido Mimila', 'Acocul Guadalupe', 'Huajomulco', 'San Felipe [Colonia]',
    'Lomas del Pedregal [Colonia]', 'Sultepec', 'San Vicente', 'San Nicolás el Grande', 'El Abra',
    'Zototlán', 'San Vidal', 'Buenos Aires (Ejido Ahuehuetitla) [Colonia]', 'Axatempa', 'Acocul la Palma',
    'San Francisco', 'Otontepec', 'Las Colmenas', 'Ejido Santiago Caltengo', 'Francisco Villa Napateco',
    'Laguna del Cerrito', 'La Raya', 'Tollancingo', 'Santiago Caltengo (Buenos Aires)', 'Emiliano Zapata [Colonia]',
    'San Rafael Loma Bonita (Ejido Santa Ana Hueytlalpan)', 'Pozas Encantadas', 'Los Álamos', 'Guadalupe [Colonia]', 'Santa Fe [Colonia]',
    'Atlalpan', 'Ejido Jaltepec', 'Ejido San Dionisio', 'Ejido Huapalcalco', 'La Presa de Santa Ana',
    'San Francisco Huatengo', 'San Rafael el Jagüey (Ejido Santa Ana Hueytlalpan)', 'San Rafael Loma Bonita (Ejido Tulancingo)', 'San Rafael el Jagüey (Ejido Santa María Asunción)', 'Ejido Santa Ana Hueytlalpan',
    'San Rafael los Teteles', 'Lomas de Tulancingo', 'Ojo de Agua', 'Huitititla', 'Ejido Jaltepec',
    'Ejido Tulancingo', 'Ejido Zapotlán de Allende', 'Las Piletas', 'Agua Escondida', 'San Pablo',
    'Buenos Aires [Rancho]', 'Ejido Huapalcalco', 'Ejido Huapalcalco (Las Ánimas)', 'Los Laureles', 'La Presa (Minas de Metilatla)',
    'San Cayetano', 'San Isidro [Rancho]', 'Chimilpa', 'Santa Isabel [Rancho]', 'Parte Alta de Cuauhtémoc'
  ];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shLoc = ss.getSheetByName('LOCALIDADES');
  if (shLoc.getLastRow() > 1) shLoc.deleteRows(2, shLoc.getLastRow() - 1);
  const rows = NOMBRES.map((n, i) => [i + 1, 77, n, String(i + 1).padStart(4, '0')]);
  shLoc.getRange(2, 1, rows.length, 4).setValues(rows);
  SpreadsheetApp.getUi().alert('✓ Localidades cargadas', 'Insertadas: ' + rows.length + ' (Tulancingo de Bravo)', SpreadsheetApp.getUi().ButtonSet.OK);
}

