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
import { CODES, STATUSES, isInvestmentCode } from '../utils/categoryCodes.js';

const ROOT_ID = 'categories-section';

// =========================================================
// Render
// =========================================================

export function render() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;

  if (state.catalogFormat !== 'v2') {
    root.replaceChildren(
      el('div', { class: 'settings-card' },
        el('span', { class: 'settings-label' }, 'Categorías'),
        el('p', { class: 'muted small' },
          'La gestión de categorías estará disponible cuando apliques la migración a presupuesto v2.'),
      ),
    );
    return;
  }

  const byName   = (a, b) => a.budgetKey.localeCompare(b.budgetKey);
  const active   = state.allBudgetKeys.filter(c => c.status === 'active').sort(byName);
  const txCounts = _countBy(state.transactions);
  const withStatus = s => state.allBudgetKeys.filter(c => c.status === s).sort(byName);

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
      group('Necesarias', active.filter(c => c.code[0] === 'N')),
      group('Electivas',  active.filter(c => c.code[0] === 'E')),
      group('Inversión',  active.filter(c => isInvestmentCode(c.code))),
      group('Pausadas',   withStatus('paused')),
      group('Archivadas', withStatus('archived')),
    ),
  );
}

function _row(c, txCount) {
  const amount = [
    c.code,
    c.refAmount ? formatCurrency(c.refAmount, true) : null,
    c.dueDay ? `día ${c.dueDay}` : null,
    c.allowsHucha ? 'hucha' : null,
  ].filter(Boolean).join(' · ');

  return el('button', {
    type: 'button',
    class: `cat-row${c.status === 'active' ? '' : ' cat-row-archived'}`,
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
  const numValue = v => (c && v) ? String(v) : '';
  const code = c?.code ?? 'EMV';

  const codeSelect = el('select', { id: 'cat-code', class: 'modal-select' },
    ...CODES.map(o => el('option', { value: o.code, selected: o.code === code }, `${o.code} · ${o.label}`)));
  const statusSelect = el('select', { id: 'cat-status', class: 'modal-select' },
    ...STATUSES.map(o => el('option', { value: o.key, selected: o.key === (c?.status ?? 'active') }, o.label)));

  return el('div', { class: 'cat-form' },
    _inputGroup('cat-name', 'Nombre', el('input', {
      id: 'cat-name', class: 'modal-input cat-name-input', type: 'text',
      placeholder: 'Ej: SUPERMERCADO', maxlength: '40', autocomplete: 'off',
      value: c?.budgetKey ?? '',
    })),
    c ? _renameHint(c) : null,
    _inputGroup('cat-code', 'Clasificación', codeSelect),
    el('div', { class: 'cat-form-fields cat-form-row' },
      _inputGroup('cat-ref', 'Importe habitual (€)', el('input', {
        id: 'cat-ref', class: 'modal-input', type: 'number', step: '0.01', min: '0',
        placeholder: 'opcional', value: numValue(c?.refAmount),
      })),
      _inputGroup('cat-due', 'Día de pago', el('input', {
        id: 'cat-due', class: 'modal-input', type: 'number', min: '1', max: '31',
        placeholder: '—', value: numValue(c?.dueDay),
      })),
    ),
    el('label', { class: 'cat-active' },
      el('input', { id: 'cat-hucha', type: 'checkbox', checked: Boolean(c?.allowsHucha) }),
      el('span', {}, 'Permite pagar con hucha'),
    ),
    c ? _inputGroup('cat-status', 'Estado', statusSelect) : null,
    c ? el('p', { class: 'muted small' },
      'Pausada: deja de sugerirse hasta que la reactives. Archivada: no se sugiere nunca, pero sus gastos se conservan en las estadísticas.') : null,
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
  const code      = document.getElementById('cat-code')?.value ?? 'EMV';
  const refAmount = _readNumber('cat-ref');
  const dueDay    = _readNumber('cat-due');
  const status    = document.getElementById('cat-status')?.value ?? 'active';

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
  if (Number.isNaN(refAmount) || refAmount < 0) {
    showToast('Importe inválido', 'error');
    return null;
  }
  if (Number.isNaN(dueDay) || (dueDay !== '' && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31))) {
    showToast('Día de pago inválido (1–31)', 'error');
    return null;
  }

  return {
    budgetKey,
    code,
    allowsHucha: Boolean(document.getElementById('cat-hucha')?.checked),
    refAmount,
    dueDay,
    status,
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
      'El histórico de presupuesto de meses pasados se conserva. Si solo quieres dejar de usarla, mejor archívala o páusala (campo "Estado").'),
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
      sheets.loadPlanLines(),
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
