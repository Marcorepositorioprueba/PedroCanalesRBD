/**
 * diagnostico.gs — Para pegar TEMPORALMENTE en Apps Script y ejecutar.
 * NO reemplaza semilla.gs; es solo para ver el estado real del Sheet.
 */

function diagnostico() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const nombres = sheets.map(s => s.getName());

  Logger.log('==== DIAGNÓSTICO ====');
  Logger.log('ID del Sheet activo: ' + ss.getId());
  Logger.log('URL: ' + ss.getUrl());
  Logger.log('Total de hojas: ' + sheets.length);
  Logger.log('Nombres: ' + JSON.stringify(nombres));

  const esperadas = ['REGISTROS','MUNICIPIOS','LOCALIDADES','USUARIOS','CATALOGOS','SEGUIMIENTOS'];
  for (const n of esperadas) {
    const sh = ss.getSheetByName(n);
    if (sh) {
      Logger.log(`  ${n}: OK (${sh.getLastRow()} filas, ${sh.getLastColumn()} cols)`);
    } else {
      Logger.log(`  ${n}: FALTA`);
    }
  }

  // Verificar usuario
  const us = ss.getSheetByName('USUARIOS');
  if (us && us.getLastRow() >= 2) {
    const fila = us.getRange(2, 1, 1, 7).getValues()[0];
    Logger.log('Usuario creado: ' + JSON.stringify(fila));
  }

  Logger.log('==== FIN ====');
  return JSON.stringify({total: sheets.length, nombres, url: ss.getUrl()}, null, 2);
}