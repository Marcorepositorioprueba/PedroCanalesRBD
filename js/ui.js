/**
 * ui.js — helpers: toasts, loading, badges
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
  }
};