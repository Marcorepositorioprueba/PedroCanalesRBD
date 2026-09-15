/**
 * api.js — capa de llamadas al backend Apps Script (V2)
 * Todo viaja por POST con el token en el body JSON (nunca en la query string),
 * excepto `catalogos` y `ping` que son públicos.
 */
const API = {
  _req(action, payload, publico) {
    if (typeof API_URL === 'undefined' || !API_URL) {
      return Promise.reject(new Error('Falta API_URL en js/config.js'));
    }
    const body = Object.assign({}, payload || {});

    // Token: leer de Auth si existe (en login no hay sesión aún)
    if (!publico && typeof Auth !== 'undefined' && Auth && typeof Auth.getToken === 'function') {
      const token = Auth.getToken();
      if (token) body.token = token;
    }

    const url = API_URL + '?action=' + encodeURIComponent(action);

    console.log('[api]', 'POST', action);

    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // simple request: sin pre-flight
      body: JSON.stringify(body)
    })
      .then(r => r.text())
      .then(text => {
        let j;
        try { j = JSON.parse(text); }
        catch (_) { throw new Error('Respuesta no es JSON: ' + text.substring(0, 100)); }
        if (!j || j.ok === false) {
          // Si el backend dice "AUTH", sesión inválida → limpiar local y forzar re-login
          if (j && j.code === 'AUTH' && typeof Auth !== 'undefined' && Auth && Auth.clear) {
            Auth.clear();
            // Redirigir a login si no estamos ya ahí
            if (!/index\.html$/.test(location.pathname)) {
              window.location.replace('index.html');
            }
          }
          throw new Error((j && j.error) || 'Error del servidor');
        }
        return j.data;
      })
      .catch(err => {
        // Errores de red: fetch() rechaza con TypeError
        if (err && (err.name === 'TypeError' || /Failed to fetch|NetworkError/i.test(err.message || ''))) {
          throw new Error('Sin conexión. Verifica tu red e intenta de nuevo.');
        }
        throw err;
      });
  },

  // ---- Sesión ----
  login(usuario, password) { return API._req('login', { usuario: usuario, password: password }); },
  logout()                 { return API._req('logout', {}); },
  catalogos()              { return API._req('catalogos', {}, true); },
  quienSoy()               { return API._req('quien_soy', {}); },

  // ---- Simpatizantes (ficha simple) ----
  crearSim(datos)          { return API._req('crear_simpatizante', datos); },
  buscarSim(filtros)       { return API._req('buscar_simpatizantes', filtros); },
  obtenerSim(folio)        { return API._req('obtener_simpatizante', { folio: folio }); },
  actualizarSim(datos)     { return API._req('actualizar_simpatizante', datos); },
  cambiarEstadoSim(datos)  { return API._req('cambiar_estado_sim', datos); },
  duplicadosListar()       { return API._req('duplicados_listar', {}); },
  duplicadoResolver(datos) { return API._req('duplicado_resolver', datos); },

  // ---- Usuarios (admin) ----
  usuariosListar()         { return API._req('usuarios_listar', {}); },
  usuarioCrear(datos)      { return API._req('usuario_crear', datos); },
  usuarioPassword(datos)   { return API._req('usuario_password', datos); },
  usuarioBloquear(datos)   { return API._req('usuario_bloquear', datos); },
  resetContrasenasMasivo() { return API._req('reset_contrasenas_masivo', {}); },
  cambiarPassword(datos)   { return API._req('cambiar_password', datos); },
  statsAdmin()             { return API._req('stats_admin', {}); },
  statsSecciones()         { return API._req('stats_secciones', {}); },

  // ---- Admin ----
  exportar(filtros)        { return API._req('exportar', filtros); },
  historial(filtros)       { return API._req('historial', filtros); },

  // ---- Ficha líder/actor territorial (REGISTROS) ----
  crear(datos)             { return API._req('crear', datos); },
  buscar(filtros)          { return API._req('buscar', filtros); },
  obtener(id)              { return API._req('obtener', { id: id }); },
  seguimiento(datos)       { return API._req('seguimiento', datos); },
  actualizar(datos)        { return API._req('actualizar', datos); }
};