// =========================================================
// debts.js — sección "Me deben dinero" embebida en charts view
// CRUD sobre la pestaña DEBTS de Google Sheets.
// =========================================================

import * as state  from '../state.js';
import * as sheets from '../sheets.js';
import { el, openModal, closeModal, showToast, setLoading } from '../utils/dom.js';
import { formatCurrency, formatDateShort } from '../utils/formatters.js';

const ROOT_ID = 'debts-section';

// Filtro activo (persistido en memoria)
let _filterStatus = 'pending';
// Set de personKeys expandidas
const _expanded = new Set();

export function render() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;

  const groups = state.getDebtsByPerson(_filterStatus);
  const totalPending = state.getTotalPendingDebts();

  root.replaceChildren(
    _renderHeader(totalPending),
    _renderFilterChips(),
    _renderGroups(groups),
    _renderAddButton(),
  );
}

// =========================================================
// Header
// =========================================================

function _renderHeader(totalPending) {
  return el('div', { class: 'debts-header' },
    el('div', { class: 'debts-title' },
      el('span', { class: 'debts-icon' }, '💰'),
      el('span', {}, 'Me deben'),
    ),
    el('div', { class: 'debts-total' }, formatCurrency(totalPending)),
  );
}

function _renderFilterChips() {
  const chips = [
    { key: 'pending',   label: 'Pendientes' },
    { key: 'paid',      label: 'Pagadas'    },
    { key: 'cancelled', label: 'Canceladas' },
    { key: 'all',       label: 'Todas'      },
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
// Lista de grupos (personas)
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
    case 'pending':   return 'No te debe dinero nadie 🎉';
    case 'paid':      return 'Aún no hay deudas cobradas.';
    case 'cancelled': return 'No has cancelado ninguna deuda.';
    default:          return 'No hay deudas registradas.';
  }
}

function _renderGroup(g) {
  const expanded = g.items.length === 1 || _expanded.has(g.personKey);
  const totalLabel = g.totalPending > 0
    ? formatCurrency(g.totalPending)
    : `${g.items.length} ${g.items.length === 1 ? 'deuda' : 'deudas'}`;

  const header = el('div', {
    class: `debt-group-header ${expanded ? 'expanded' : ''}`,
    onclick: () => {
      if (g.items.length <= 1) return;
      if (_expanded.has(g.personKey)) _expanded.delete(g.personKey);
      else _expanded.add(g.personKey);
      render();
    },
  },
    el('div', { class: 'debt-person' },
      el('span', { class: 'debt-person-avatar' }, _initials(g.personLabel)),
      el('div', { class: 'debt-person-info' },
        el('div', { class: 'debt-person-name' }, g.personLabel),
        el('div', { class: 'debt-person-meta' },
          `${g.items.length} ${g.items.length === 1 ? 'deuda' : 'deudas'}`,
        ),
      ),
    ),
    el('div', { class: 'debt-group-total' }, totalLabel),
  );

  const group = el('div', { class: 'debt-group' }, header);

  if (expanded) {
    const list = el('div', { class: 'debt-items' });
    for (const d of g.items) {
      list.appendChild(_renderDebtItem(d));
    }
    group.appendChild(list);
  }

  return group;
}

function _renderDebtItem(d) {
  const ageDays = _daysSince(d.dateCreated);
  const isOld   = d.status === 'pending' && ageDays >= 30;
  const isVeryOld = d.status === 'pending' && ageDays >= 60;

  const statusClass = `debt-status-${d.status}`;
  const ageClass    = isVeryOld ? 'age-very-old' : isOld ? 'age-old' : '';

  const item = el('div', {
    class: `debt-item ${statusClass} ${ageClass}`,
    role: 'button',
    tabindex: '0',
    onclick: () => _openEditModal(d),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') _openEditModal(d); },
  },
    el('div', { class: 'debt-item-main' },
      el('div', { class: 'debt-item-reason' }, d.reason || '(sin motivo)'),
      el('div', { class: 'debt-item-meta' },
        el('span', { class: 'debt-item-date' }, formatDateShort(d.dateCreated)),
        ageDays >= 0 && d.status === 'pending'
          ? el('span', { class: 'debt-item-age' }, ` · ${_ageLabel(ageDays)}`)
          : null,
        d.status === 'paid'
          ? el('span', { class: 'debt-item-badge debt-badge-paid' }, '✓ Pagada')
          : null,
        d.status === 'cancelled'
          ? el('span', { class: 'debt-item-badge debt-badge-cancelled' }, '✕ Cancelada')
          : null,
      ),
    ),
    el('div', { class: 'debt-item-amount' }, formatCurrency(d.amount)),
  );
  return item;
}

function _renderAddButton() {
  return el('div', { class: 'debts-actions' },
    el('button', {
      class: 'btn btn-primary debts-add-btn',
      onclick: () => _openAddModal(),
    }, '+ Añadir deuda'),
  );
}

// =========================================================
// Modal — Añadir
// =========================================================

function _openAddModal() {
  const today = _todayIso();

  const body = el('div', {},
    _inputGroup('debt-person-input', 'Persona', el('input', {
      id: 'debt-person-input', class: 'modal-input', type: 'text',
      placeholder: 'Ej: Juan', maxlength: '50', autocomplete: 'off',
    })),
    _inputGroup('debt-amount-input', 'Importe (€)', el('input', {
      id: 'debt-amount-input', class: 'modal-input', type: 'number',
      step: '0.01', min: '0.01', placeholder: '0.00',
    })),
    _inputGroup('debt-reason-input', 'Motivo', el('input', {
      id: 'debt-reason-input', class: 'modal-input', type: 'text',
      placeholder: 'Ej: Cena del sábado', maxlength: '100',
    })),
    _inputGroup('debt-date-input', 'Fecha', el('input', {
      id: 'debt-date-input', class: 'modal-input', type: 'date', value: today,
    })),
    _inputGroup('debt-notes-input', 'Notas (opcional)', el('input', {
      id: 'debt-notes-input', class: 'modal-input', type: 'text',
      placeholder: 'Bizum / Efectivo / …', maxlength: '200',
    })),
  );

  const footer = el('div', { style: { display: 'contents' } },
    el('button', { class: 'btn btn-secondary btn-sm', onclick: () => closeModal() }, 'Cancelar'),
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => _saveNewDebt() }, 'Añadir'),
  );

  openModal('Nueva deuda', body, footer);
  setTimeout(() => document.getElementById('debt-person-input')?.focus(), 50);
}

async function _saveNewDebt() {
  const person = document.getElementById('debt-person-input')?.value?.trim() ?? '';
  const amount = parseFloat(document.getElementById('debt-amount-input')?.value);
  const reason = document.getElementById('debt-reason-input')?.value?.trim() ?? '';
  const date   = document.getElementById('debt-date-input')?.value || _todayIso();
  const notes  = document.getElementById('debt-notes-input')?.value?.trim() ?? '';

  if (!person) { showToast('Indica la persona', 'error'); return; }
  if (isNaN(amount) || amount <= 0) { showToast('Importe inválido', 'error'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { showToast('Fecha inválida', 'error'); return; }

  const slug = person.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'deuda';
  const id = `${Date.now()}-${slug}`;

  closeModal();
  setLoading(true, 'Guardando deuda…');
  try {
    await sheets.appendDebt({
      id, person, amount, reason,
      dateCreated: date, status: 'pending', datePaid: '', notes,
    });
    await sheets.loadDebts();
    render();
    showToast('Deuda registrada', 'success');
  } catch (err) {
    showToast(`Error al guardar: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

// =========================================================
// Modal — Editar
// =========================================================

function _openEditModal(d) {
  const body = el('div', {},
    _inputGroup('debt-edit-person', 'Persona', el('input', {
      id: 'debt-edit-person', class: 'modal-input', type: 'text', value: d.person, maxlength: '50',
    })),
    _inputGroup('debt-edit-amount', 'Importe (€)', el('input', {
      id: 'debt-edit-amount', class: 'modal-input', type: 'number',
      step: '0.01', min: '0.01', value: String(d.amount),
    })),
    _inputGroup('debt-edit-reason', 'Motivo', el('input', {
      id: 'debt-edit-reason', class: 'modal-input', type: 'text',
      value: d.reason, maxlength: '100',
    })),
    _inputGroup('debt-edit-date', 'Fecha', el('input', {
      id: 'debt-edit-date', class: 'modal-input', type: 'date', value: d.dateCreated,
    })),
    _inputGroup('debt-edit-notes', 'Notas', el('input', {
      id: 'debt-edit-notes', class: 'modal-input', type: 'text',
      value: d.notes, maxlength: '200',
    })),
    d.status !== 'pending'
      ? el('div', { class: 'debt-edit-status-note' },
          `Estado actual: ${_statusLabel(d.status)}${d.datePaid ? ` el ${formatDateShort(d.datePaid)}` : ''}`)
      : null,
  );

  // Acciones del footer dependen del estado
  const footerChildren = [];
  footerChildren.push(
    el('button', { class: 'btn btn-danger btn-sm', onclick: () => _confirmDelete(d) }, 'Eliminar'),
  );
  if (d.status === 'pending') {
    footerChildren.push(
      el('button', { class: 'btn btn-secondary btn-sm', onclick: () => _markCancelled(d) }, 'Cancelar deuda'),
      el('button', { class: 'btn btn-success btn-sm', onclick: () => _markPaid(d) }, '✓ Cobrada'),
    );
  } else {
    footerChildren.push(
      el('button', { class: 'btn btn-secondary btn-sm', onclick: () => _markPending(d) }, 'Reabrir'),
    );
  }
  footerChildren.push(
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => _saveEdit(d) }, 'Guardar'),
  );

  const footer = el('div', { style: { display: 'contents' } }, ...footerChildren);
  openModal('Editar deuda', body, footer);
}

async function _saveEdit(d) {
  const person = document.getElementById('debt-edit-person')?.value?.trim() ?? d.person;
  const amount = parseFloat(document.getElementById('debt-edit-amount')?.value ?? d.amount);
  const reason = document.getElementById('debt-edit-reason')?.value?.trim() ?? d.reason;
  const date   = document.getElementById('debt-edit-date')?.value || d.dateCreated;
  const notes  = document.getElementById('debt-edit-notes')?.value?.trim() ?? d.notes;

  if (!person) { showToast('Indica la persona', 'error'); return; }
  if (isNaN(amount) || amount <= 0) { showToast('Importe inválido', 'error'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { showToast('Fecha inválida', 'error'); return; }

  closeModal();
  setLoading(true, 'Guardando cambios…');
  try {
    await sheets.updateDebt(d.rowIndex, {
      person, amount, reason, dateCreated: date, notes,
    });
    await sheets.loadDebts();
    render();
    showToast('Deuda actualizada', 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

async function _markPaid(d) {
  closeModal();
  setLoading(true, 'Marcando como cobrada…');
  try {
    await sheets.updateDebt(d.rowIndex, { status: 'paid', datePaid: _todayIso() });
    await sheets.loadDebts();
    render();
    showToast(`Cobrado a ${d.person} 💸`, 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

async function _markCancelled(d) {
  closeModal();
  setLoading(true, 'Cancelando deuda…');
  try {
    await sheets.updateDebt(d.rowIndex, { status: 'cancelled', datePaid: _todayIso() });
    await sheets.loadDebts();
    render();
    showToast('Deuda cancelada (perdonada)', 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

async function _markPending(d) {
  closeModal();
  setLoading(true, 'Reabriendo deuda…');
  try {
    await sheets.updateDebt(d.rowIndex, { status: 'pending', datePaid: '' });
    await sheets.loadDebts();
    render();
    showToast('Deuda marcada como pendiente', 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

function _confirmDelete(d) {
  const body = el('p', { class: 'delete-confirm-text' },
    `¿Eliminar la deuda de `,
    el('strong', {}, formatCurrency(d.amount)),
    ` con "${d.person}"? Esta acción no se puede deshacer.`,
  );
  const footer = el('div', { style: { display: 'contents' } },
    el('button', { class: 'btn btn-secondary btn-sm', onclick: () => _openEditModal(d) }, 'Volver'),
    el('button', { class: 'btn btn-danger', onclick: () => _doDelete(d) }, 'Eliminar'),
  );
  openModal('Confirmar eliminación', body, footer);
}

async function _doDelete(d) {
  closeModal();
  setLoading(true, 'Eliminando…');
  try {
    let sheetId = state.sheetMeta['DEBTS'];
    // Si la pestaña DEBTS se creó después del login, sheetMeta aún no la conoce.
    if (sheetId === undefined || sheetId === null) {
      await sheets.loadSheetMeta();
      sheetId = state.sheetMeta['DEBTS'];
    }
    if (sheetId === undefined || sheetId === null) {
      throw new Error('No se encontró la pestaña DEBTS. ¿Está creada en la hoja?');
    }
    await sheets.deleteDebt(d.rowIndex, sheetId);
    render();
    showToast('Deuda eliminada', 'success');
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

function _initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s[0]?.toUpperCase() || '')
    .join('') || '?';
}

function _daysSince(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return -1;
  const [y, m, d] = isoDate.split('-').map(Number);
  const then = new Date(y, m - 1, d);
  const now  = new Date();
  const diff = Math.floor((now - then) / 86400000);
  return diff;
}

function _ageLabel(days) {
  if (days <= 0)     return 'hoy';
  if (days === 1)    return 'ayer';
  if (days < 7)      return `hace ${days} días`;
  if (days < 30)     return `hace ${Math.floor(days / 7)} sem.`;
  if (days < 365)    return `hace ${Math.floor(days / 30)} meses`;
  return `hace ${Math.floor(days / 365)} año(s)`;
}

function _todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _statusLabel(status) {
  return { pending: 'Pendiente', paid: 'Pagada', cancelled: 'Cancelada' }[status] || status;
}
