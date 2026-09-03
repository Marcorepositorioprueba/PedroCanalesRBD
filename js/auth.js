/**
 * auth.js — login, logout, sesión en localStorage
 */
const Auth = {
  KEY: 'pc_session_v1',

  getSession() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || 'null'); }
    catch (_) { return null; }
  },
  getToken()  { const s = this.getSession(); return s ? s.token : null; },
  setSession(s) { localStorage.setItem(this.KEY, JSON.stringify(s)); },
  clear() { localStorage.removeItem(this.KEY); },

  async login(usuario, password) {
    const data = await API.login(usuario, password);
    if (!data || !data.token) throw new Error('Login no devolvió token');
    this.setSession(data);
    return data;
  },

  logout() {
    const s = this.getSession();
    if (s && s.token) {
      // No bloqueante: el token en backend expira solo
      const url = (typeof API_URL !== 'undefined' ? API_URL : '') +
                  '?action=logout&token=' + encodeURIComponent(s.token);
      if (url) {
        fetch(url).catch(() => {}).finally(() => this.clear());
        return;
      }
    }
    this.clear();
  },

  require() {
    const s = this.getSession();
    if (!s || !s.token) {
      return null;
    }
    // Validar formato: solo tokens reales (UUID hex 32 chars)
    if (!/^[0-9a-f]{32}$/i.test(s.token)) {
      this.clear();
      return null;
    }
    // Validación de expiración delegada al backend.
    // Si está expirada, el backend devuelve code=AUTH y api.js limpia/redirige.
    return s;
  }
};