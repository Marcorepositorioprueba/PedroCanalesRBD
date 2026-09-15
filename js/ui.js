/**
 * ui.js — helpers: toasts, loading, badges, charts, progress, quality
 */
const UI = {
  toast(msg, tipo) {
    const t = document.createElement('div');
    t.className = 'toast ' + (tipo || '');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, 2500);
  },

  loading(btn, on) {
    if (!btn) return;
    if (on) {
      btn.dataset.txt = btn.textContent;
      btn.disabled = true;
      btn.classList.add('btn-loading');
      btn.textContent = 'Guardando...';
    } else {
      btn.disabled = false;
      btn.classList.remove('btn-loading');
      btn.textContent = btn.dataset.txt || 'Guardar';
    }
  },

  badge(text, tipo) {
    const s = document.createElement('span');
    s.className = 'badge ' + (tipo || '');
    s.textContent = text;
    return s;
  },

  badgeParaPrioridad(p) {
    return ({
      'Alta': 'prio-alta',
      'Media': 'prio-media',
      'Baja': 'prio-baja'
    })[p] || '';
  },

  badgeParaEstatus(e) {
    return ({
      'Por contactar': 'est-pendiente',
      'En seguimiento': 'est-seguimiento',
      'Contactado': 'est-contactado',
      'Compromiso adquirido': 'est-compromiso',
      'Cerrado': 'est-cerrado',
      'Inactivo': 'est-inactivo'
    })[e] || '';
  },

  emptyState(msg) {
    return '<div class="empty">' + msg + '</div>';
  },

  // ===== NUEVOS HELPERS =====

  // Progress Ring SVG (para operador)
  // value: actual, max: meta (ej. 50)
  // Returns: { ringEl, textEl, setValue(v) }
  progressRing(containerId, value, max) {
    const ring = document.getElementById(containerId);
    if (!ring) return null;
    const r = 42; // radio
    const circ = 2 * Math.PI * r; // 264
    const prog = ring.querySelector('.ring-prog');
    const text = ring.querySelector('.ring-text b') || ring.querySelector('.ring-text');
    const pct = Math.min(value / max, 1);
    const offset = circ * (1 - pct);
    if (prog) {
      prog.style.strokeDasharray = circ;
      prog.style.strokeDashoffset = offset;
    }
    if (text) text.textContent = value;
    ring.dataset.value = value;
    ring.dataset.max = max;
    ring.setAttribute('aria-label', `Progreso ${value} de ${max}`);
    return {
      setValue(v) {
        const pct2 = Math.min(v / max, 1);
        const off = circ * (1 - pct2);
        if (prog) prog.style.strokeDashoffset = off;
        if (text) text.textContent = v;
        ring.dataset.value = v;
        ring.setAttribute('aria-label', `Progreso ${v} de ${max}`);
      }
    };
  },

  // Calidad de un registro individual (simpatizante)
  // Devuelve: { score: 0-4, nivel: 'alta'|'media'|'baja', detalles: {...} }
  calcularCalidadSim(r) {
    let score = 0;
    const detalles = {
      telefono: false,
      seccion: false,
      observaciones: false,
      consentimientoEscrito: false
    };
    // 1. Teléfono válido (10 dígitos)
    const tel = String(r.telefono || '').replace(/\D/g, '');
    if (tel.length === 10) { score++; detalles.telefono = true; }
    // 2. Sección electoral capturada (no NO_CONOCE)
    if (r.seccion && String(r.seccion) !== 'NO_CONOCE') { score++; detalles.seccion = true; }
    // 3. Observaciones no vacías
    if (r.observaciones && r.observaciones.trim()) { score++; detalles.observaciones = true; }
    // 4. Consentimiento = "Escrito" (vs Verbal/App)
    if (String(r.consentimiento_medio || '').toLowerCase() === 'escrito') { score++; detalles.consentimientoEscrito = true; }

    let nivel = 'baja';
    if (score === 4) nivel = 'alta';
    else if (score >= 3) nivel = 'media';
    return { score, nivel, detalles };
  },

  // Badge de calidad para tablas
  qualityBadge(nivel) {
    const s = document.createElement('span');
    s.className = 'badge-calidad ' + nivel;
    s.textContent = nivel.charAt(0).toUpperCase() + nivel.slice(1);
    return s;
  },

  // Render Chart.js genérico
  // type: 'bar' | 'doughnut' | 'line'
  // canvasId: id del canvas
  // data: { labels: [], datasets: [] }
  // options: Chart.js options
  renderChart(canvasId, type, data, options = {}) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    // Destruir chart previo si existe
    if (ctx.chart) ctx.chart.destroy();
    const Chart = window.Chart;
    if (!Chart) {
      console.warn('Chart.js no cargado');
      return null;
    }
    const defaultOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: type !== 'bar', position: 'bottom', labels: { font: { size: 11 } } },
        tooltip: { padding: 8, titleFont: { size: 12 }, bodyFont: { size: 11 } }
      }
    };
    const mergedOptions = this._deepMerge(defaultOptions, options);
    ctx.chart = new Chart(ctx, { type, data, options: mergedOptions });
    return ctx.chart;
  },

  _deepMerge(target, source) {
    const out = { ...target };
    for (const k of Object.keys(source)) {
      if (source[k] && typeof source[k] === 'object' && !Array.isArray(source[k])) {
        out[k] = this._deepMerge(target[k] || {}, source[k]);
      } else {
        out[k] = source[k];
      }
    }
    return out;
  },

  // Colores para gráficos
  chartColors: {
    primary: '#4B0B8A',
    primaryLight: '#6B2BB5',
    success: '#2E7D5B',
    warn: '#C8923A',
    danger: '#B33A3A',
    muted: '#9A9A9A',
    border: '#E5DCEF',
    bgDeco: '#F5F0FB',
    // Gradientes para barras
    gradAlta: 'rgba(46, 125, 91, 0.85)',
    gradMedia: 'rgba(200, 146, 58, 0.85)',
    gradBaja: 'rgba(179, 58, 58, 0.85)',
    gradPrimary: 'rgba(75, 11, 138, 0.85)'
  }
};