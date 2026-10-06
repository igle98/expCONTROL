// =========================================================
// categories.js — gestión de categorías (BUDGET_KEYS) dentro de Ajustes:
// añadir, editar/renombrar, archivar y eliminar. Renombrar propaga el
// nombre a gastos, comercios aprendidos (MERCHANT_MAP) e histórico.
// =========================================================

import * as state  from '../state.js';
import * as sheets from '../sheets.js';
import { el, openModal, closeModal, showToast, setLoading } from '../utils/dom.js';
import { formatCurrency } from '../utils/formatters.js';
import { getCategoryColor } from '../utils/colors.js';
import { SPECIAL_KEYWORDS } from './addExpense.js';

const ROOT_ID = 'categories-section';

const TYPES = [
  { key: 'Variable', label: 'Variable (presupuesto mensual)' },
  { key: 'Fijo',     label: 'Fijo (recibo con importe y día)' },
];

// =========================================================
// Render
// =========================================================

export function render() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;

  const byName   = (a, b) => a.budgetKey.localeCompare(b.budgetKey);
  const active   = state.allBudgetKeys.filter(c => c.active).sort(byName);
  const archived = state.allBudgetKeys.filter(c => !c.active).sort(byName);
  const txCounts = _countBy(state.transactions);

  const group = (title, cats) => cats.length === 0 ? null :
    el('div', { class: 'cat-group' },
      el('div', { class: 'cat-group-title' }, `${title} (${cats.length})`),
      ...cats.map(c => _row(c, txCounts.get(c.budgetKey) ?? 0)),
    );

  root.replaceChildren(
    el('div', { class: 'settings-card' },
      el('div', { class: 'cat-header' },
        el('span', { class: 'settings-label' }, 'Categorías'),
        el('button', { class: 'btn btn-primary btn-sm', onclick: () => _openAddModal() }, '+ Nueva'),
      ),
      el('p', { class: 'muted small' },
        'Al renombrar una categoría se actualizan también sus gastos y los comercios que ya aprendió la IA.'),
      group('Variables', active.filter(c => c.type !== 'Fijo')),
      group('Fijos',     active.filter(c => c.type === 'Fijo')),
      group('Archivadas', archived),
    ),
  );
}

function _row(c, txCount) {
  const amount = c.type === 'Fijo'
    ? `${formatCurrency(c.fixedAmount, true)}${c.dueDay ? ` · día ${c.dueDay}` : ''}`
    : `${formatCurrency(c.monthlyBudget, true)}/mes`;

  return el('button', {
    type: 'button',
    class: `cat-row${c.active ? '' : ' cat-row-archived'}`,
    onclick: () => _openEditModal(c),
  },
    el('span', { class: 'cat-dot', style: { background: getCategoryColor(c.budgetKey) } }),
    el('span', { class: 'cat-text' },
      el('span', { class: 'cat-name' }, c.budgetKey),
      el('span', { class: 'cat-meta' }, `${amount} · ${txCount} gasto${txCount === 1 ? '' : 's'}`),
    ),
  );
}

// =========================================================
// Formulario compartido (añadir / editar)
// =========================================================

function _formBody(c = null) {
  const type = c?.type === 'Fijo' ? 'Fijo' : 'Variable';
  const numValue = v => (c && v) ? String(v) : '';

  const variableFields = el('div', { class: 'cat-form-fields', 'data-for': 'Variable' },
    _inputGroup('cat-monthly', 'Presupuesto mensual (€)', el('input', {
      id: 'cat-monthly', class: 'modal-input', type: 'number', step: '0.01', min: '0',
      placeholder: '0.00', value: numValue(c?.monthlyBudget),
    })),
  );
  const fixedFields = el('div', { class: 'cat-form-fields cat-form-row', 'data-for': 'Fijo' },
    _inputGroup('cat-fixed', 'Importe fijo (€)', el('input', {
      id: 'cat-fixed', class: 'modal-input', type: 'number', step: '0.01', min: '0',
      placeholder: '0.00', value: numValue(c?.fixedAmount),
    })),
    _inputGroup('cat-due', 'Día de pago', el('input', {
      id: 'cat-due', class: 'modal-input', type: 'number', min: '1', max: '31',
      placeholder: '—', value: numValue(c?.dueDay),
    })),
  );
  const syncTypeFields = (t) => {
    variableFields.classList.toggle('hidden', t !== 'Variable');
    fixedFields.classList.toggle('hidden', t !== 'Fijo');
  };
  syncTypeFields(type);

  const typeSelect = el('select', {
    id: 'cat-type', class: 'modal-select',
    onchange: (e) => syncTypeFields(e.target.value),
  }, ...TYPES.map(t => el('option', { value: t.key, selected: t.key === type }, t.label)));

  return el('div', { class: 'cat-form' },
    _inputGroup('cat-name', 'Nombre', el('input', {
      id: 'cat-name', class: 'modal-input cat-name-input', type: 'text',
      placeholder: 'Ej: SUPERMERCADO', maxlength: '40', autocomplete: 'off',
      value: c?.budgetKey ?? '',
    })),
    c ? _renameHint(c) : null,
    _inputGroup('cat-type', 'Tipo', typeSelect),
    variableFields,
    fixedFields,
    c ? el('label', { class: 'cat-active' },
      el('input', { id: 'cat-active', type: 'checkbox', checked: c.active }),
      el('span', {}, 'Activa. Desmárcala para archivarla: deja de salir en el presupuesto y en la IA, pero conserva sus gastos.'),
    ) : null,
  );
}

function _renameHint(c) {
  const txCount = _countBy(state.transactions).get(c.budgetKey) ?? 0;
  const mmCount = _countBy([...state.merchantMap.values()]).get(c.budgetKey) ?? 0;
  const keywords = _keywordsFor(c.budgetKey);
  return el('p', { class: 'muted small' },
    `Si cambias el nombre se actualizarán ${txCount} gastos y ${mmCount} comercios aprendidos.`,
    keywords.length
      ? ` Ojo: la palabra clave ${keywords.map(k => `«${k}»`).join(', ')} apunta a esta categoría por nombre y dejará de funcionar si la renombras.`
      : null,
  );
}

/** Lee y valida el formulario. Devuelve null (con toast) si hay error. */
function _readForm(current = null) {
  const budgetKey = _normalizeName(document.getElementById('cat-name')?.value);
  const type      = document.getElementById('cat-type')?.value === 'Fijo' ? 'Fijo' : 'Variable';
  const monthly   = _readNumber('cat-monthly');
  const fixed     = _readNumber('cat-fixed');
  const dueDay    = _readNumber('cat-due');
  const activeBox = document.getElementById('cat-active');

  if (!budgetKey) { showToast('Indica un nombre', 'error'); return null; }
  if (!/^[\p{L}0-9_]+$/u.test(budgetKey)) {
    showToast('Usa solo letras, números y guiones bajos', 'error');
    return null;
  }
  const clash = state.allBudgetKeys.some(b =>
    b.budgetKey === budgetKey && b.budgetKey !== current?.budgetKey);
  if (clash) {
    showToast(`Ya existe una categoría ${budgetKey}. Para unirlas, elimina una y mueve sus gastos a la otra.`, 'error', 5000);
    return null;
  }
  if ([monthly, fixed].some(v => Number.isNaN(v) || v < 0)) {
    showToast('Importe inválido', 'error');
    return null;
  }
  if (Number.isNaN(dueDay) || (dueDay !== '' && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31))) {
    showToast('Día de pago inválido (1–31)', 'error');
    return null;
  }

  return {
    budgetKey,
    type,
    monthlyBudget: monthly,
    fixedAmount:   fixed,
    dueDay,
    active:        activeBox ? activeBox.checked : true,
  };
}

// =========================================================
// Modal — Añadir
// =========================================================

function _openAddModal() {
  const footer = el('div', { style: { display: 'contents' } },
    el('button', { class: 'btn btn-secondary btn-sm', onclick: () => closeModal() }, 'Cancelar'),
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => _saveNew() }, 'Añadir'),
  );
  openModal('Nueva categoría', _formBody(), footer);
  setTimeout(() => document.getElementById('cat-name')?.focus(), 50);
}

async function _saveNew() {
  const cat = _readForm();
  if (!cat) return;

  closeModal();
  await _run('Guardando…', async () => {
    await sheets.appendBudgetKey(cat);
    return `Categoría ${cat.budgetKey} añadida`;
  });
}

// =========================================================
// Modal — Editar
// =========================================================

function _openEditModal(c) {
  const footer = el('div', { style: { display: 'contents' } },
    el('button', { class: 'btn btn-danger btn-sm', onclick: () => _openDeleteModal(c) }, 'Eliminar'),
    el('button', { class: 'btn btn-secondary btn-sm', onclick: () => closeModal() }, 'Cancelar'),
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => _saveEdit(c) }, 'Guardar'),
  );
  openModal(`Editar ${c.budgetKey}`, _formBody(c), footer);
}

async function _saveEdit(c) {
  const cat = _readForm(c);
  if (!cat) return;

  closeModal();
  const renamed = cat.budgetKey !== c.budgetKey;
  await _run(renamed ? 'Renombrando…' : 'Guardando cambios…', async () => {
    const res = await sheets.updateBudgetKey(c, cat);
    return renamed
      ? `${c.budgetKey} → ${cat.budgetKey}: ${res.transactions} gastos y ${res.merchants} comercios actualizados`
      : 'Cambios guardados';
  });
}

// =========================================================
// Modal — Eliminar
// =========================================================

function _openDeleteModal(c) {
  const txCount = _countBy(state.transactions).get(c.budgetKey) ?? 0;
  const mmCount = _countBy([...state.merchantMap.values()]).get(c.budgetKey) ?? 0;
  const others  = state.budgets
    .filter(b => b.budgetKey !== c.budgetKey)
    .sort((a, b) => a.budgetKey.localeCompare(b.budgetKey));

  // Con gastos hay que elegir destino; sin gastos se puede olvidar lo aprendido
  const options = [
    txCount === 0
      ? el('option', { value: '' },
          mmCount > 0 ? `— Ninguna: olvidar los ${mmCount} comercios aprendidos —` : '— Ninguna —')
      : el('option', { value: '', disabled: true, selected: true }, 'Elige una categoría…'),
    ...others.map(b => el('option', { value: b.budgetKey }, b.budgetKey)),
  ];
  const targetSelect = el('select', { id: 'cat-delete-target', class: 'modal-select' }, ...options);
  const needsTarget  = txCount > 0 || mmCount > 0;

  const body = el('div', { class: 'cat-form' },
    el('p', { class: 'delete-confirm-text' },
      '¿Eliminar ', el('strong', {}, c.budgetKey), '? ',
      txCount > 0
        ? `Tiene ${txCount} gastos y ${mmCount} comercios aprendidos.`
        : mmCount > 0 ? `No tiene gastos, pero sí ${mmCount} comercios aprendidos.` : 'No tiene gastos.',
    ),
    needsTarget ? _inputGroup('cat-delete-target', 'Mover sus gastos y comercios a', targetSelect) : null,
    el('p', { class: 'muted small' },
      'El histórico de presupuesto de meses pasados se conserva. Si solo quieres dejar de usarla, mejor archívala (desmarca "Activa").'),
    _keywordsFor(c.budgetKey).length
      ? el('p', { class: 'muted small' },
          `La palabra clave ${_keywordsFor(c.budgetKey).map(k => `«${k}»`).join(', ')} dejará de funcionar.`)
      : null,
  );

  const footer = el('div', { style: { display: 'contents' } },
    el('button', { class: 'btn btn-secondary btn-sm', onclick: () => _openEditModal(c) }, 'Volver'),
    el('button', { class: 'btn btn-danger', onclick: () => _doDelete(c, needsTarget ? targetSelect.value : '', txCount) }, 'Eliminar'),
  );
  openModal('Eliminar categoría', body, footer);
}

async function _doDelete(c, targetKey, txCount) {
  const target = state.allBudgetKeys.find(b => b.budgetKey === targetKey) ?? null;
  if (txCount > 0 && !target) {
    showToast('Elige a qué categoría mover sus gastos', 'error');
    return;
  }

  closeModal();
  await _run('Eliminando…', async () => {
    const res = await sheets.deleteBudgetKey(c.budgetKey, target);
    return target
      ? `${c.budgetKey} eliminada: ${res.transactions} gastos y ${res.merchants} comercios movidos a ${target.budgetKey}`
      : `${c.budgetKey} eliminada`;
  });
}

// =========================================================
// Helpers
// =========================================================

/** Ejecuta un cambio, recarga los datos afectados y re-renderiza. */
async function _run(loadingText, action) {
  setLoading(true, loadingText);
  try {
    const message = await action();
    await Promise.all([
      sheets.loadBudgetKeys(),
      sheets.loadTransactions(),
      sheets.loadMerchantMap(),
      sheets.loadBudgetHistory(),
    ]);
    render();
    showToast(message, 'success', 4000);
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error', 5000);
  } finally {
    setLoading(false);
  }
}

/** Map budgetKey → nº de elementos (transacciones o entradas de MERCHANT_MAP) */
function _countBy(items) {
  const map = new Map();
  for (const it of items) map.set(it.budgetKey, (map.get(it.budgetKey) ?? 0) + 1);
  return map;
}

function _keywordsFor(budgetKey) {
  return [...new Set(SPECIAL_KEYWORDS.filter(s => s.budgetKey === budgetKey).map(s => s.source))];
}

/** "supermercado conjunto" → "SUPERMERCADO_CONJUNTO" */
function _normalizeName(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

/** '' si está vacío, NaN si no es número */
function _readNumber(id) {
  const raw = document.getElementById(id)?.value?.trim() ?? '';
  return raw === '' ? '' : Number(raw);
}

function _inputGroup(id, label, input) {
  return el('div', { class: 'input-group' },
    el('label', { class: 'input-label', for: id }, label),
    input,
  );
}
