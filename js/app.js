// =========================================================
// app.js — Entry point
// Orquesta auth, carga de datos, router y navegación.
// =========================================================

import { initAuth, getToken, signOut } from './auth.js';
import * as sheets  from './sheets.js';
import * as state   from './state.js';
import { setLoading, showToast, show, hide } from './utils/dom.js';
import { formatMonth } from './utils/formatters.js';

import * as viewTransactions from './views/transactions.js';
import * as viewBudgets      from './views/budgets.js';
import * as viewReports      from './views/reports.js';
import * as viewCharts       from './views/charts.js';
import * as viewAddExpense   from './views/addExpense.js';
import * as viewSettings     from './views/settings.js';

// =========================================================
// Bootstraping
// =========================================================

document.addEventListener('DOMContentLoaded', () => {
  _registerSW();
  _setupLoginButton();
  _setupSignOut();
  _setupNav();
  _setupMonthPicker();
  viewTransactions.initFilters();

  // Inicializa GIS — si ya hay token válido en sessionStorage, llama onSignedIn
  initAuth(_onSignedIn, _onSignedOut);
});

// =========================================================
// Auth callbacks
// =========================================================

async function _onSignedIn() {
  hide(document.getElementById('login-error'));
  hide(document.getElementById('screen-login'));

  setLoading(true, 'Cargando datos…');

  try {
    await sheets.loadSheetMeta();
    await sheets.loadAll();
    _showApp();
  } catch (err) {
    setLoading(false);
    _showLoginError(`No se pudieron cargar los datos: ${err.message}`);
    show(document.getElementById('screen-login'));
  }
}

function _onSignedOut(reason) {
  setLoading(false);
  show(document.getElementById('screen-login'));
  hide(document.getElementById('screen-app'));
  if (reason && reason !== 'popup_closed_by_user') {
    _showLoginError('Sesión cerrada. Vuelve a iniciar sesión.');
  }
}

function _showLoginError(msg) {
  const err = document.getElementById('login-error');
  if (!err) return;
  err.textContent = msg;
  show(err);
}

function _showApp() {
  setLoading(false);
  show(document.getElementById('screen-app'));
  _updateMonthLabel();
  _switchView('transactions');
}

// =========================================================
// Login button
// =========================================================

function _setupLoginButton() {
  const btn = document.getElementById('btn-login');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    hide(document.getElementById('login-error'));
    try {
      // getToken abre popup si no hay token guardado
      await getToken();
      // El callback de initAuth se encargará del resto
    } catch (err) {
      if (err.message !== 'popup_closed_by_user') {
        _showLoginError(`Error al iniciar sesión: ${err.message}`);
      }
    }
  });
}

function _setupSignOut() {
  document.getElementById('btn-signout')?.addEventListener('click', () => {
    signOut();
    _onSignedOut();
  });
}

// =========================================================
// Navegación entre vistas
// =========================================================

const VIEW_TITLES = {
  transactions:  'Transacciones',
  budgets:       'Presupuesto',
  reports:       'Reportes',
  charts:        'Gráficas',
  'add-expense': 'Añadir gasto',
  settings:      'Ajustes',
};

function _setupNav() {
  // Botones inferiores + cualquier elemento con data-nav (p.ej. icono de Ajustes en header)
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      const viewName = btn.dataset.nav;
      if (viewName) _switchView(viewName);
    });
  });
}

function _switchView(viewName) {
  // Ocultar todas las vistas
  document.querySelectorAll('.view').forEach(v => {
    v.classList.add('hidden');
    v.classList.remove('active');
  });

  // Mostrar la activa
  const target = document.getElementById(`view-${viewName}`);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
  }

  // Actualizar nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.nav === viewName);
  });

  // Actualizar título del header
  const titleEl = document.getElementById('header-title');
  if (titleEl) titleEl.textContent = VIEW_TITLES[viewName] ?? viewName;

  // Renderizar la vista
  _renderView(viewName);
}

function _renderView(viewName) {
  switch (viewName) {
    case 'transactions': viewTransactions.render(); break;
    case 'budgets':      viewBudgets.render();      break;
    case 'reports':      viewReports.render();      break;
    case 'charts':       viewCharts.render();       break;
    case 'add-expense':  viewAddExpense.render();   break;
    case 'settings':     viewSettings.render();     break;
  }
}

// =========================================================
// Selector de mes
// =========================================================

function _setupMonthPicker() {
  const toggleBtn = document.getElementById('btn-month-picker');
  const dropdown  = document.getElementById('month-picker-dropdown');
  const prevBtn   = document.getElementById('btn-month-prev');
  const nextBtn   = document.getElementById('btn-month-next');

  toggleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown?.classList.toggle('hidden');
  });

  // Cerrar al pulsar fuera
  document.addEventListener('click', (e) => {
    if (!dropdown?.contains(e.target) && e.target !== toggleBtn) {
      dropdown?.classList.add('hidden');
    }
  });

  prevBtn?.addEventListener('click', () => {
    state.setCurrentMonth(state.getPrevMonth(state.currentMonth));
    _updateMonthLabel();
    _rerenderActiveView();
  });

  nextBtn?.addEventListener('click', () => {
    const next = state.getNextMonth(state.currentMonth);
    // No ir más allá del mes actual
    const now  = _thisMonth();
    if (next <= now) {
      state.setCurrentMonth(next);
      _updateMonthLabel();
      _rerenderActiveView();
    }
  });
}

function _updateMonthLabel() {
  const label = document.getElementById('month-picker-label');
  if (label) label.textContent = formatMonth(state.currentMonth);
}

function _rerenderActiveView() {
  const active = document.querySelector('.view.active');
  if (!active) return;
  const viewName = active.dataset.view;
  if (viewName) _renderView(viewName);
}

// =========================================================
// Service Worker
// =========================================================

function _registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('[SW] No se pudo registrar:', err.message);
    });
  }
}

// =========================================================
// Helpers
// =========================================================

function _thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
