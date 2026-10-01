// =========================================================
// future.js — sección "Compras y pagos futuros" embebida en charts view
// CRUD sobre la pestaña FUTURE de Google Sheets.
// =========================================================

import * as state  from '../state.js';
import * as sheets from '../sheets.js';
import { el, openModal, closeModal, showToast, setLoading } from '../utils/dom.js';
import { formatCurrency, formatDateShort, formatMonth } from '../utils/formatters.js';

const ROOT_ID = 'future-section';

const STATUSES = [
  { key: 'wanted',    label: 'Deseado'      },
  { key: 'committed', label: 'Comprometido' },
  { key: 'bought',    label: 'Comprado'     },
  { key: 'cancelled', label: 'Cancelado'    },
];

const PRIORITIES = [
  { key: 'high',   label: 'Alta'  },
  { key: 'medium', label: 'Media' },
  { key: 'low',    label: 'Baja'  },
];

// Filtro activo (persistido en memoria)
let _filterStatus = 'open';

export function render() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;

  const groups = state.getFutureByMonth(_filterStatus);
  const totals = state.getFutureTotals();

  root.replaceChildren(
    _renderHeader(totals),
    _renderFilterChips(),
    _renderGroups(groups),
    _renderAddButton(),
  );
}

// =========================================================
// Header
// =========================================================

function _renderHeader(totals) {
  return el('div', { class: 'debts-header' },
    el('div', { class: 'debts-title' },
      el('span', { class: 'debts-icon' }, '🗓️'),
      el('span', {}, 'Compras futuras'),
    ),
    el('div', { class: 'future-totals' },
      el('div', { class: 'future-total' }, formatCurrency(totals.open)),
      totals.committed > 0
        ? el('div', { class: 'future-total-sub' }, `${formatCurrency(totals.committed)} comprometido`)
        : null,
    ),
  );
}

function _renderFilterChips() {
  const chips = [
    { key: 'open',      label: 'Pendientes'    },
    { key: 'wanted',    label: 'Deseados'      },
    { key: 'committed', label: 'Comprometidos' },
    { key: 'bought',    label: 'Comprados'     },
    { key: 'cancelled', label: 'Cancelados'    },
    { key: 'all',       label: 'Todos'         },
  ];
  return el('div', { class: 'debts-filters' },
    ...chips.map(c =>
      el('button', {
        class: `chip ${_filterStatus === c.key ? 'chip-active' : ''}`,
        onclick: () => { _filterStatus = c.key; render(); },
      }, c.label)
    ),
  );
}

// =========================================================
// Lista agrupada por mes
// =========================================================

function _renderGroups(groups) {
  if (groups.length === 0) {
    return el('div', { class: 'debts-empty' },
      el('p', {}, _emptyText()),
    );
  }

  const container = el('div', { class: 'debts-list' });
  for (const g of groups) {
    container.appendChild(_renderGroup(g));
  }
  return container;
}

function _emptyText() {
  switch (_filterStatus) {
    case 'open':      return 'No tienes compras previstas.';
    case 'bought':    return 'Aún no has marcado nada como comprado.';
    case 'cancelled': return 'No has cancelado ninguna compra.';
    case 'all':       return 'No hay compras futuras registradas.';
    default:          return 'No hay nada con este estado.';
  }
}

function _renderGroup(g) {
  const isPast = g.month && g.month < _thisMonth();
  const header = el('div', { class: 'debt-group-header future-group-header' },
    el('div', { class: 'debt-person-info' },
      el('div', { class: 'debt-person-name future-month-name' },
        g.month ? _capitalize(formatMonth(g.month)) : 'Sin fecha'),
      el('div', { class: 'debt-person-meta' },
        `${g.items.length} ${g.items.length === 1 ? 'elemento' : 'elementos'}`,
        isPast ? ' · mes pasado' : '',
      ),
    ),
    el('div', { class: 'debt-group-total future-group-total' }, formatCurrency(g.total)),
  );

  const list = el('div', { class: 'debt-items' });
  for (const f of g.items) {
    list.appendChild(_renderItem(f));
  }
  return el('div', { class: 'debt-group' }, header, list);
}

function _renderItem(f) {
  const isOpen    = state.FUTURE_OPEN_STATUSES.includes(f.status);
  const isOverdue = isOpen && _isOverdue(f.date);

  const item = el('div', {
    class: `debt-item future-status-${f.status} ${isOverdue ? 'future-overdue' : ''}`,
    role: 'button',
    tabindex: '0',
    onclick: () => _openEditModal(f),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') _openEditModal(f); },
  },
    el('div', { class: 'debt-item-main' },
      el('div', { class: 'debt-item-reason' }, f.concept || '(sin concepto)'),
      el('div', { class: 'debt-item-meta' },
        el('span', { class: `future-badge future-priority-${f.priority}` }, _label(PRIORITIES, f.priority)),
        el('span', { class: `future-badge future-badge-${f.status}` }, _label(STATUSES, f.status)),
        f.date.length === 10 ? el('span', {}, formatDateShort(f.date)) : null,
        isOverdue ? el('span', { class: 'future-overdue-label' }, '· atrasado') : null,
      ),
    ),
    el('div', { class: 'debt-item-amount' }, formatCurrency(f.amount)),
  );
  return item;
}

function _renderAddButton() {
  return el('div', { class: 'debts-actions' },
    el('button', {
      class: 'btn btn-primary debts-add-btn',
      onclick: () => _openAddModal(),
    }, '+ Añadir compra futura'),
  );
}

// =========================================================
// Formulario compartido (añadir / editar)
// =========================================================

function _formBody(f = null) {
  const month = f?.date ? f.date.slice(0, 7) : _nextMonth();
  const day   = f?.date?.length === 10 ? String(Number(f.date.slice(8, 10))) : '';

  return el('div', {},
    _inputGroup('future-concept', 'Concepto', el('input', {
      id: 'future-concept', class: 'modal-input', type: 'text',
      placeholder: 'Ej: Seguro del coche', maxlength: '100', autocomplete: 'off',
      value: f?.concept ?? '',
    })),
    _inputGroup('future-amount', 'Importe estimado (€)', el('input', {
      id: 'future-amount', class: 'modal-input', type: 'number',
      step: '0.01', min: '0.01', placeholder: '0.00',
      value: f ? String(f.amount) : '',
    })),
    el('div', { class: 'future-date-row' },
      _inputGroup('future-month', 'Mes', el('input', {
        id: 'future-month', class: 'modal-input', type: 'month', value: month,
      })),
      _inputGroup('future-day', 'Día (opcional)', el('input', {
        id: 'future-day', class: 'modal-input', type: 'number',
        min: '1', max: '31', placeholder: '—', value: day,
      })),
    ),
    _inputGroup('future-priority', 'Prioridad',
      _select('future-priority', PRIORITIES, f?.priority ?? 'medium')),
    _inputGroup('future-status', 'Estado',
      _select('future-status', STATUSES, f?.status ?? 'wanted')),
    _inputGroup('future-notes', 'Notas (opcional)', el('input', {
      id: 'future-notes', class: 'modal-input', type: 'text',
      placeholder: 'Tienda, enlace, plazos…', maxlength: '200',
      value: f?.notes ?? '',
    })),
  );
}

/** Lee y valida el formulario. Devuelve null (con toast) si hay error. */
function _readForm() {
  const concept  = document.getElementById('future-concept')?.value?.trim() ?? '';
  const amount   = parseFloat(document.getElementById('future-amount')?.value);
  const month    = document.getElementById('future-month')?.value?.trim() ?? '';
  const dayRaw   = document.getElementById('future-day')?.value?.trim() ?? '';
  const priority = document.getElementById('future-priority')?.value || 'medium';
  const status   = document.getElementById('future-status')?.value || 'wanted';
  const notes    = document.getElementById('future-notes')?.value?.trim() ?? '';

  if (!concept) { showToast('Indica el concepto', 'error'); return null; }
  if (isNaN(amount) || amount <= 0) { showToast('Importe inválido', 'error'); return null; }
  if (!/^\d{4}-\d{2}$/.test(month)) { showToast('Mes inválido (AAAA-MM)', 'error'); return null; }

  let date = month;
  if (dayRaw) {
    const day = Number(dayRaw);
    const [y, m] = month.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    if (!Number.isInteger(day) || day < 1 || day > daysInMonth) {
      showToast(`Día inválido (1–${daysInMonth})`, 'error');
      return null;
    }
    date = `${month}-${String(day).padStart(2, '0')}`;
  }

  return { concept, amount, date, priority, status, notes };
}

// =========================================================
// Modal — Añadir
// =========================================================

function _openAddModal() {
  const footer = el('div', { style: { display: 'contents' } },
    el('button', { class: 'btn btn-secondary btn-sm', onclick: () => closeModal() }, 'Cancelar'),
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => _saveNew() }, 'Añadir'),
  );
  openModal('Nueva compra futura', _formBody(), footer);
  setTimeout(() => document.getElementById('future-concept')?.focus(), 50);
}

async function _saveNew() {
  const fields = _readForm();
  if (!fields) return;

  const slug = fields.concept.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'compra';
  const id = `${Date.now()}-${slug}`;

  closeModal();
  setLoading(true, 'Guardando…');
  try {
    await sheets.appendFuture({ id, ...fields, dateUpdated: _todayIso() });
    await sheets.loadFuture();
    render();
    showToast('Compra futura añadida', 'success');
  } catch (err) {
    showToast(`Error al guardar: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

// =========================================================
// Modal — Editar
// =========================================================

function _openEditModal(f) {
  const footer = el('div', { style: { display: 'contents' } },
    el('button', { class: 'btn btn-danger btn-sm', onclick: () => _confirmDelete(f) }, 'Eliminar'),
    el('button', { class: 'btn btn-secondary btn-sm', onclick: () => closeModal() }, 'Cancelar'),
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => _saveEdit(f) }, 'Guardar'),
  );
  openModal('Editar compra futura', _formBody(f), footer);
}

async function _saveEdit(f) {
  const fields = _readForm();
  if (!fields) return;

  closeModal();
  setLoading(true, 'Guardando cambios…');
  try {
    await sheets.updateFuture(f.rowIndex, { ...fields, dateUpdated: _todayIso() });
    await sheets.loadFuture();
    render();
    showToast(fields.status === 'bought' ? '¡Comprado! 🛍️' : 'Cambios guardados', 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

function _confirmDelete(f) {
  const body = el('p', { class: 'delete-confirm-text' },
    `¿Eliminar "${f.concept}" (`,
    el('strong', {}, formatCurrency(f.amount)),
    `)? Esta acción no se puede deshacer.`,
  );
  const footer = el('div', { style: { display: 'contents' } },
    el('button', { class: 'btn btn-secondary btn-sm', onclick: () => _openEditModal(f) }, 'Volver'),
    el('button', { class: 'btn btn-danger', onclick: () => _doDelete(f) }, 'Eliminar'),
  );
  openModal('Confirmar eliminación', body, footer);
}

async function _doDelete(f) {
  closeModal();
  setLoading(true, 'Eliminando…');
  try {
    await sheets.deleteFuture(f.rowIndex);
    render();
    showToast('Eliminado', 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

// =========================================================
// Helpers
// =========================================================

function _inputGroup(id, label, input) {
  return el('div', { class: 'input-group' },
    el('label', { class: 'input-label', for: id }, label),
    input,
  );
}

function _select(id, options, selected) {
  return el('select', { id, class: 'modal-select' },
    ...options.map(o => el('option', { value: o.key, selected: o.key === selected }, o.label)),
  );
}

function _label(options, key) {
  return options.find(o => o.key === key)?.label ?? key;
}

/** Atrasado: día concreto ya pasado, o mes completo ya pasado */
function _isOverdue(date) {
  if (!date) return false;
  if (date.length === 10) return date < _todayIso();
  return date < _thisMonth();
}

function _capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function _todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _thisMonth() {
  return _todayIso().slice(0, 7);
}

function _nextMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
