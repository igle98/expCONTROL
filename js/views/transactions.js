import * as state   from '../state.js';
import * as sheets  from '../sheets.js';
import { getCategoryColor, getCategoryColorAlpha } from '../utils/colors.js';
import { formatCurrency, formatDateShort, formatDateLong } from '../utils/formatters.js';
import { el, openModal, closeModal, showToast, setLoading, show, hide } from '../utils/dom.js';

// =========================================================
// Render principal
// =========================================================

/** Estado de filtro activo */
let _filterCategory = '';

export function render() {
  _populateCategoryFilter();
  _renderList();
}

export function resetFilters() {
  _filterCategory = '';
  const sel = document.getElementById('filter-category');
  if (sel) sel.value = '';
}

// =========================================================
// Filtros
// =========================================================

export function initFilters() {
  const sel = document.getElementById('filter-category');
  if (sel && !sel.dataset.bound) {
    sel.addEventListener('change', (e) => {
      _filterCategory = e.target.value;
      _renderList();
    });
    sel.dataset.bound = '1';
  }
}

function _populateCategoryFilter() {
  const sel = document.getElementById('filter-category');
  if (!sel) return;

  const categories = [...new Set(state.transactions.map(tx => tx.budgetKey).filter(Boolean))].sort();
  const current    = sel.value;

  sel.replaceChildren(
    el('option', { value: '' }, 'Todas las categorías'),
    ...categories.map(cat => {
      const opt = el('option', { value: cat }, cat);
      if (cat === current) opt.selected = true;
      return opt;
    })
  );
  if (current) sel.value = current;
}

// =========================================================
// Lista
// =========================================================

function _renderList() {
  const container = document.getElementById('transactions-list');
  const emptyEl   = document.getElementById('transactions-empty');
  if (!container) return;

  let txs = state.getTransactionsForMonth(state.currentMonth);
  if (_filterCategory) txs = txs.filter(tx => tx.budgetKey === _filterCategory);

  if (txs.length === 0) {
    container.replaceChildren();
    show(emptyEl);
    return;
  }
  hide(emptyEl);

  // Agrupar por fecha para los separadores
  const groups = _groupByDate(txs);
  const fragment = document.createDocumentFragment();

  for (const [date, items] of groups) {
    fragment.appendChild(_dateSeparator(date));
    for (const tx of items) {
      fragment.appendChild(_txItem(tx));
    }
  }

  container.replaceChildren(fragment);
}

function _groupByDate(txs) {
  const map = new Map();
  for (const tx of txs) {
    if (!map.has(tx.date)) map.set(tx.date, []);
    map.get(tx.date).push(tx);
  }
  return map;
}

function _dateSeparator(isoDate) {
  return el('div', { class: 'tx-date-separator' }, formatDateShort(isoDate));
}

function _txItem(tx) {
  const color      = getCategoryColor(tx.budgetKey);
  const colorAlpha = getCategoryColorAlpha(tx.budgetKey, 0.18);

  const item = el('div', { class: 'tx-item', role: 'button', tabindex: '0' },
    el('div', { class: 'tx-category-dot', style: { background: color } }),
    el('div', { class: 'tx-info' },
      el('div', { class: 'tx-merchant' }, tx.merchantNorm || 'Sin nombre'),
      el('div', { class: 'tx-meta' },
        el('span', { class: 'tx-date' }, formatDateShort(tx.date)),
        el('span', {
          class: 'tx-category-badge',
          style: { background: colorAlpha, color },
        }, tx.budgetKey || '—'),
      ),
    ),
    el('div', { class: 'tx-amount' }, formatCurrency(tx.amount)),
  );

  item.addEventListener('click',   () => openEditModal(tx));
  item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') openEditModal(tx); });

  return item;
}

// =========================================================
// Modal editar
// =========================================================

export function openEditModal(tx) {
  const categories = state.budgets.map(b => b.budgetKey);

  // Cuerpo del modal
  const body = el('div', {},
    // Info de la transacción
    el('div', { class: 'modal-tx-info' },
      el('div', {},
        el('div', { class: 'modal-tx-merchant' }, tx.merchantNorm || 'Sin nombre'),
        el('div', { class: 'modal-tx-date' }, formatDateLong(tx.date)),
      ),
    ),
    // Campo fecha
    el('div', { class: 'input-group' },
      el('label', { class: 'input-label', for: 'edit-date' }, 'Fecha'),
      el('input', {
        id:    'edit-date',
        class: 'modal-input',
        type:  'date',
        value: tx.date,
      }),
    ),
    // Campo importe
    el('div', { class: 'input-group' },
      el('label', { class: 'input-label', for: 'edit-amount' }, 'Importe (€)'),
      _inputNumber('edit-amount', tx.amount),
    ),
    // Campo comercio
    el('div', { class: 'input-group' },
      el('label', { class: 'input-label', for: 'edit-merchant' }, 'Comercio'),
      el('input', {
        id:        'edit-merchant',
        class:     'modal-input',
        type:      'text',
        value:     tx.merchantNorm,
        maxlength: '100',
      }),
    ),
    // Campo categoría
    el('div', { class: 'input-group' },
      el('label', { class: 'input-label', for: 'edit-category' }, 'Categoría'),
      el('select', { id: 'edit-category', class: 'modal-select' },
        el('option', { value: '' }, '— Sin categoría —'),
        ...categories.map(cat => {
          const opt = el('option', { value: cat }, cat);
          if (cat === tx.budgetKey) opt.selected = true;
          return opt;
        }),
      ),
    ),
  );

  // Pie del modal
  const footer = el('div', { style: { display: 'contents' } },
    el('button', {
      class:   'btn btn-danger btn-sm',
      onclick: () => _confirmDelete(tx),
    }, 'Eliminar'),
    el('button', {
      class:   'btn btn-secondary btn-sm',
      onclick: () => closeModal(),
    }, 'Cancelar'),
    el('button', {
      class:   'btn btn-primary btn-sm',
      onclick: () => _saveEdit(tx),
    }, 'Guardar'),
  );

  openModal('Editar gasto', body, footer);
}

async function _saveEdit(tx) {
  const date     = document.getElementById('edit-date')?.value || tx.date;
  const amount   = parseFloat(document.getElementById('edit-amount')?.value ?? tx.amount);
  const merchant = document.getElementById('edit-merchant')?.value?.trim() ?? tx.merchantNorm;
  const category = document.getElementById('edit-category')?.value ?? tx.budgetKey;

  if (isNaN(amount) || amount <= 0) {
    showToast('El importe debe ser un número positivo', 'error');
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    showToast('Fecha no válida', 'error');
    return;
  }

  closeModal();
  setLoading(true, 'Guardando cambios…');
  try {
    await sheets.updateTransaction(tx.rowIndex, {
      date,
      amount,
      merchantNorm: merchant,
      budgetKey:    category,
    });
    await sheets.loadTransactions();
    render();
    showToast('Gasto actualizado', 'success');
  } catch (err) {
    showToast(`Error al guardar: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

function _confirmDelete(tx) {
  const body = el('p', { class: 'delete-confirm-text' },
    `¿Eliminar el gasto de `,
    el('strong', {}, formatCurrency(tx.amount)),
    ` en "${tx.merchantNorm || 'Sin nombre'}"? Esta acción no se puede deshacer.`,
  );

  const footer = el('div', { style: { display: 'contents' } },
    el('button', { class: 'btn btn-secondary btn-sm', onclick: () => openEditModal(tx) }, 'Volver'),
    el('button', {
      class:   'btn btn-danger',
      onclick: () => _doDelete(tx),
    }, 'Eliminar definitivamente'),
  );

  openModal('Confirmar eliminación', body, footer);
}

async function _doDelete(tx) {
  closeModal();
  setLoading(true, 'Eliminando gasto…');
  try {
    const sheetId = state.sheetMeta['TRANSACTIONS'];
    await sheets.deleteTransaction(tx.rowIndex, sheetId);
    render();
    showToast('Gasto eliminado', 'success');
  } catch (err) {
    showToast(`Error al eliminar: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

// =========================================================
// Helpers
// =========================================================

function _inputNumber(id, value) {
  return el('input', {
    id,
    class: 'modal-input',
    type:  'number',
    step:  '0.01',
    min:   '0.01',
    value: String(value),
  });
}
