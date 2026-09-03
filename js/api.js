/**
 * api.js — capa de llamadas al backend Apps Script
 * El token se lee dinámicamente desde Auth en cada llamada (Auth debe existir antes de llamar)
 */
const API = {
  _req(action, payload, method) {
    if (typeof API_URL === 'undefined' || !API_URL) {
      return Promise.reject(new Error('Falta API_URL en js/config.js'));
    }
    const usePost = (method || 'GET') === 'POST';
    const body = Object.assign({}, payload || {});

    // Token: leer de Auth si existe (en login no hay sesión aún)
    if (typeof Auth !== 'undefined' && Auth && typeof Auth.getToken === 'function') {
      const token = Auth.getToken();
      if (token) body.token = token;
    }

    const qs = Object.keys(body)
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(body[k]))
      .join('&');
    const url = API_URL + '?action=' + encodeURIComponent(action) + '&' + qs;

    const opts = usePost
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(body)
        }
      : { method: 'GET' };

    console.log('[api]', method || 'GET', action);

    return fetch(url, opts)
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

  login(usuario, password) {
    return this._req('login', { usuario: usuario, password: password });
  },
  catalogos()              { return this._req('catalogos', {}); },
  crear(datos)             { return this._req('crear', datos, 'POST'); },
  buscar(filtros)          { return this._req('buscar', filtros); },
  obtener(id)              { return this._req('obtener', { id: id }); },
  seguimiento(datos)       { return this._req('seguimiento', datos, 'POST'); },
  actualizar(datos)        { return this._req('actualizar', datos, 'POST'); },
  quienSoy()               { return this._req('quien_soy', {}); }
};