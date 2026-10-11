import * as state from '../state.js';
import { getCategoryColor } from '../utils/colors.js';
import { formatCurrency, calcPercent, formatMonth } from '../utils/formatters.js';
import { el, show, hide } from '../utils/dom.js';
import { saveBudgetSnapshot } from '../sheets.js';
import { isInvestmentCode } from '../utils/categoryCodes.js';
import { openPlanEditor } from './planEditor.js';

let _lastSnapshotMonth = null;

// =========================================================
// Render
// =========================================================

export function render() {
  const container = document.getElementById('budgets-container');
  const emptyEl   = document.getElementById('budgets-empty');
  if (!container) return;

  const month    = state.currentMonth;
  const spendMap = state.getSpendByCategory(month);
  const budgets  = state.getBudgetKeysForMonth(month);

  const isV2 = state.catalogFormat === 'v2';
  _renderToolbar(month, isV2);

  // Formato anterior: foto mensual en BUDGET_HISTORY. En v2 el plan de cada mes ya vive en PLAN_LINES.
  const _now = new Date();
  const _thisMonth = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}`;
  if (!isV2 && month === _thisMonth && budgets.length > 0 && _lastSnapshotMonth !== month) {
    _lastSnapshotMonth = month;
    saveBudgetSnapshot(month, budgets, spendMap).catch(err => {
      console.warn('[BudgetHistory] No se pudo guardar snapshot:', err.message);
      _lastSnapshotMonth = null;
    });
  }

  if (budgets.length === 0) {
    container.replaceChildren();
    show(emptyEl);
    return;
  }
  hide(emptyEl);

  // Separar por tipo (las inversiones van aparte: no son gasto)
  const investments = budgets.filter(b => isInvestmentCode(b.code));
  const variables   = budgets.filter(b => b.type !== 'Fijo');
  const fijos       = budgets.filter(b => b.type === 'Fijo' && !isInvestmentCode(b.code));

  const varSpent    = variables.reduce((s, b) => s + (spendMap.get(b.budgetKey) ?? 0), 0);
  const varBudget   = variables.reduce((s, b) => s + b.monthlyBudget, 0);
  const fixedSpent  = fijos.reduce((s, b) => s + (spendMap.get(b.budgetKey) ?? 0), 0);
  const fixedBudget = fijos.reduce((s, b) => s + b.fixedAmount, 0);

  // Ordenación dentro de cada bloque
  const varSorted = [...variables].sort((a, b) => {
    const pA = _pct(spendMap.get(a.budgetKey) ?? 0, a.monthlyBudget);
    const pB = _pct(spendMap.get(b.budgetKey) ?? 0, b.monthlyBudget);
    return pB - pA;
  });

  const fixSorted = [...fijos].sort((a, b) => {
    const aDay = a.dueDay || 0;
    const bDay = b.dueDay || 0;
    if (aDay === 0 && bDay !== 0) return -1;
    if (aDay !== 0 && bDay === 0) return 1;
    if (aDay !== bDay) return aDay - bDay;
    const aPaid = (spendMap.get(a.budgetKey) ?? 0) > 0 ? 1 : 0;
    const bPaid = (spendMap.get(b.budgetKey) ?? 0) > 0 ? 1 : 0;
    return aPaid - bPaid;
  });

  // Dos columnas: Variables (izq) y Fijos (dcha).
  // En móvil se apilan; en iPad/PC quedan lado a lado.
  const varColumn = el('div', { class: 'budget-column budget-column-variables' },
    _summaryCard('Gastos Variables', varSpent, varBudget, true),
    el('div', { class: 'budget-cards-grid' },
      ...varSorted.map(b => _variableCard(b, spendMap.get(b.budgetKey) ?? 0)),
    ),
  );

  const fixColumn = el('div', { class: 'budget-column budget-column-fixed' },
    _summaryCard('Gastos Fijos', fixedSpent, fixedBudget, false),
    el('div', { class: 'budget-cards-grid' },
      ...fixSorted.map(b => _fixedCard(b, spendMap.get(b.budgetKey) ?? 0)),
    ),
    investments.length > 0 ? _summaryCard('Inversión (no es gasto)',
      investments.reduce((s, b) => s + (spendMap.get(b.budgetKey) ?? 0), 0),
      investments.reduce((s, b) => s + b.fixedAmount, 0), false) : null,
    investments.length > 0 ? el('div', { class: 'budget-cards-grid' },
      ...investments.map(b => _fixedCard(b, spendMap.get(b.budgetKey) ?? 0)),
    ) : null,
    isV2 ? _outOfBudgetCard(budgets, spendMap) : null,
  );

  container.replaceChildren(varColumn, fixColumn);
}

// =========================================================
// Barra superior (v2): editar el presupuesto del mes
// =========================================================

function _renderToolbar(month, isV2) {
  const bar = document.getElementById('budgets-toolbar');
  if (!bar) return;
  if (!isV2) { bar.replaceChildren(); return; }

  const source = state.getPlanSourceMonth(month);
  const reserve = state.getPlanSpecial(month, '@IMPREVISTOS');
  bar.replaceChildren(
    el('div', { class: 'budgets-toolbar-info muted small' },
      source === month ? `Presupuesto de ${formatMonth(month)}`
        : source ? `Sin presupuesto propio: se usa el de ${formatMonth(source)}`
        : 'Este mes no tiene presupuesto',
      reserve ? ` · imprevistos ${formatCurrency(reserve, true)}` : '',
    ),
    el('button', {
      class: 'btn btn-secondary btn-sm',
      onclick: () => openPlanEditor(month, () => render()),
    }, '✏️ Editar presupuesto'),
  );
}

/** Gasto del mes en categorías que no están en el presupuesto */
function _outOfBudgetCard(budgets, spendMap) {
  const planned = new Set(budgets.map(b => b.budgetKey));
  const invKeys = state.getInvestmentKeys();
  const extra = [...spendMap.entries()]
    .filter(([key, amount]) => !planned.has(key) && !invKeys.has(key) && amount > 0)
    .sort((a, b) => b[1] - a[1]);
  if (extra.length === 0) return null;
  return el('div', { class: 'budget-summary-card budget-out-of-plan' },
    el('div', { class: 'budget-total-label' }, 'Fuera de presupuesto'),
    ...extra.map(([key, amount]) => el('div', { class: 'budget-out-of-plan-row' },
      el('span', {}, key), el('span', {}, formatCurrency(amount, true)))),
  );
}

// =========================================================
// Resumen (Variables / Fijos)
// =========================================================

function _summaryCard(label, spent, budget, showBar) {
  const children = [
    el('div', { class: 'budget-total-label' }, label),
    el('div', { class: 'budget-total-amounts' },
      el('span', { class: 'budget-total-spent' }, formatCurrency(spent)),
      el('span', { class: 'budget-total-sep' }, '/'),
      el('span', { class: 'budget-total-budget' }, formatCurrency(budget)),
    ),
  ];

  if (showBar && budget > 0) {
    const pct      = _pct(spent, budget);
    const cls      = pct > 100 ? 'progress-red' : 'progress-green';
    const barWidth = Math.min(pct, 100);
    children.push(
      el('div', { class: 'budget-total-bar' },
        el('div', {
          class: `budget-total-bar-fill budget-progress-bar ${cls}`,
          style: { width: `${barWidth}%` },
        }),
      ),
    );
  }

  return el('div', { class: 'budget-summary-card' }, ...children);
}

// =========================================================
// Tarjeta Variable (con barra de progreso)
// =========================================================

function _variableCard(budget, spent) {
  const { budgetKey, monthlyBudget } = budget;
  const pct      = _pct(spent, monthlyBudget);
  const isOver   = pct > 100;
  const cls      = isOver ? 'progress-red' : 'progress-green';
  const barWidth = isOver ? 100 : pct;
  const color    = getCategoryColor(budgetKey);
  const pctLabel = isOver ? `${pct}% (+${pct - 100}%)` : `${pct}%`;
  const pctCls   = isOver ? 'pct-red' : 'pct-green';

  return el('div', { class: 'budget-card' },
    el('div', { class: 'budget-card-header' },
      el('div', { class: 'budget-card-name' },
        el('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: color, display: 'inline-block', flexShrink: '0' } }),
        el('span', {}, budgetKey),
      ),
      el('div', { class: 'budget-card-amounts' },
        el('span', { class: 'spent' }, formatCurrency(spent, true)),
        el('span', {}, ` / ${formatCurrency(monthlyBudget, true)}`),
      ),
    ),
    el('div', { class: 'budget-progress-track' },
      el('div', {
        class: `budget-progress-bar ${cls}`,
        style: { width: `${barWidth}%` },
      }),
    ),
    el('div', { class: `budget-card-percent ${pctCls}` }, pctLabel),
  );
}

// =========================================================
// Tarjeta Fijo (sin barra, con badge PAGADO y día de pago)
// =========================================================

function _fixedCard(budget, spent) {
  const { budgetKey, fixedAmount, dueDay } = budget;
  const color = getCategoryColor(budgetKey);
  const isPaid = spent > 0;

  const rightSide = el('div', { class: 'budget-fixed-right' },
    el('div', { class: 'budget-card-amounts' },
      el('span', { class: 'spent' }, formatCurrency(fixedAmount, true)),
    ),
    isPaid
      ? el('span', { class: 'badge-paid' }, 'PAGADO')
      : el('span', { class: 'badge-pending' }, `Día ~${dueDay}`),
  );

  return el('div', { class: 'budget-card budget-card-fixed' },
    el('div', { class: 'budget-card-header' },
      el('div', { class: 'budget-card-name' },
        el('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: color, display: 'inline-block', flexShrink: '0' } }),
        el('span', {}, budgetKey),
      ),
      rightSide,
    ),
    !isPaid && dueDay
      ? el('div', { class: 'budget-fixed-due' }, `Pago aprox. día ${dueDay}`)
      : null,
  );
}

// =========================================================
// Separador de sección
// =========================================================

function _sectionLabel(text) {
  return el('div', { class: 'budget-section-label' }, text);
}

// =========================================================
// Helpers
// =========================================================

function _pct(spent, budget) {
  if (!budget || budget === 0) return spent > 0 ? 100 : 0;
  return Math.round((spent / budget) * 100);
}
