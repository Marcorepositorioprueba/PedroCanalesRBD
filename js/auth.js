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

    // Track session metrics
    const now = new Date().toISOString();
    const lastLogin = localStorage.getItem('pc_last_login') || 'Primera conexión';
    localStorage.setItem('pc_last_login', now);

    const sessionWithMetrics = {
      ...data,
      session_start: now,
      last_login: lastLogin
    };

    this.setSession(sessionWithMetrics);
    return sessionWithMetrics;
  },

  async logout() {
    const s = this.getSession();
    this.clear(); // limpiar local primero: la UI no debe esperar al backend
    if (s && s.token && typeof API !== 'undefined' && API.logout) {
      try { await API.logout(); } catch (_) { /* no bloqueante */ }
    }
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
  },

  // Helpers de rol (basados en sesión actual)
  getRol() {
    const s = this.getSession();
    return s ? (s.rol || 'operador') : null;
  },
  esAdmin() { return this.getRol() === 'admin'; },
  esLider() { return this.getRol() === 'lider'; },
  esOperador() { return this.getRol() === 'capturista'; },
  // Capturista = lider o capturista (quienes capturan simpatizantes)
  esCapturista() {
    const r = this.getRol();
    return r === 'lider' || r === 'capturista';
  },
  getUsuario() {
    const s = this.getSession();
    return s ? s.usuario : null;
  },
  getNombre() {
    const s = this.getSession();
    return s ? (s.nombre || s.usuario) : null;
  },
  getLiderId() {
    const s = this.getSession();
    return s ? s.lider_id : null;
  }
};