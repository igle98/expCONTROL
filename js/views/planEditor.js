// =========================================================
// planEditor.js — editor simple del presupuesto de un mes (PLAN_LINES).
// Puente hasta el asistente de presupuesto (fase 2): permite elegir qué
// categorías entran en el mes y con cuánto, sin tocar el Sheet.
// =========================================================

import * as state  from '../state.js';
import * as sheets from '../sheets.js';
import { el, openModal, closeModal, showToast, setLoading } from '../utils/dom.js';
import { formatCurrency, formatMonth } from '../utils/formatters.js';
import { isInvestmentCode } from '../utils/categoryCodes.js';

const RESERVE_KEY = '@IMPREVISTOS';

/**
 * Abre el editor para `month`. Parte del plan propio del mes o, si no tiene,
 * del último plan anterior (el que se está arrastrando).
 * @param {string} month 'YYYY-MM'
 * @param {() => void} onSaved
 */
export function openPlanEditor(month, onSaved) {
  const current = new Map(state.getPlanLinesForMonth(month).map(l => [l.budgetKey, l.amount]));
  const cats = state.allBudgetKeys
    .filter(c => c.status === 'active' || current.has(c.budgetKey))
    .sort((a, b) => a.budgetKey.localeCompare(b.budgetKey));

  const rows = [];   // { key, group, checkbox, input }
  const totalEl = el('div', { class: 'plan-editor-total' });

  const makeRow = (key, label, group, amount, included, hint) => {
    const checkbox = el('input', { type: 'checkbox', checked: included, onchange: () => _updateTotal() });
    const input = el('input', {
      class: 'modal-input plan-editor-amount', type: 'number', step: '0.01', min: '0',
      value: amount ? String(amount) : '', placeholder: '0',
      oninput: () => { if (input.value !== '') checkbox.checked = true; _updateTotal(); },
    });
    rows.push({ key, group, checkbox, input });
    return el('label', { class: 'plan-editor-row' },
      checkbox,
      el('span', { class: 'plan-editor-name' }, label, hint ? el('span', { class: 'muted small' }, ` ${hint}`) : null),
      input,
    );
  };

  const groupOf = c => isInvestmentCode(c.code) ? 'inv' : c.type === 'Fijo' ? 'fixed' : 'variable';
  const section = (title, group) => {
    const items = cats.filter(c => groupOf(c) === group);
    if (items.length === 0) return null;
    return el('div', { class: 'plan-editor-group' },
      el('div', { class: 'cat-group-title' }, title),
      ...items.map(c => makeRow(
        c.budgetKey, c.budgetKey, group,
        current.get(c.budgetKey) ?? (group !== 'variable' ? c.refAmount : 0),
        current.has(c.budgetKey),
        c.code,
      )),
    );
  };

  function _updateTotal() {
    const sums = { fixed: 0, variable: 0, inv: 0, reserve: 0 };
    for (const r of rows) if (r.checkbox.checked) sums[r.group] += Number(r.input.value) || 0;
    const total = sums.fixed + sums.variable + sums.inv + sums.reserve;
    totalEl.replaceChildren(
      el('b', {}, `Total ${formatCurrency(total)}`),
      el('span', { class: 'muted small' },
        ` · fijos ${formatCurrency(sums.fixed, true)} · variables ${formatCurrency(sums.variable, true)}` +
        ` · inversión ${formatCurrency(sums.inv, true)} · imprevistos ${formatCurrency(sums.reserve, true)}`),
    );
  }

  const ownPlan = state.getPlanSourceMonth(month) === month;
  const body = el('div', { class: 'plan-editor' },
    el('p', { class: 'muted small' }, ownPlan
      ? 'Marca las categorías que entran este mes y su importe.'
      : 'Este mes aún no tiene presupuesto propio: se parte del último que tenías. Al guardar se crea el de este mes.'),
    totalEl,
    el('div', { class: 'plan-editor-group' },
      el('div', { class: 'cat-group-title' }, 'Reserva'),
      makeRow(RESERVE_KEY, 'Imprevistos (colchón del mes)', 'reserve', current.get(RESERVE_KEY) ?? 0, current.has(RESERVE_KEY)),
    ),
    section('Fijos', 'fixed'),
    section('Variables', 'variable'),
    section('Inversión', 'inv'),
  );
  _updateTotal();

  const footer = el('div', { style: { display: 'contents' } },
    el('button', { class: 'btn btn-secondary btn-sm', onclick: () => closeModal() }, 'Cancelar'),
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => _save(month, rows, onSaved) }, 'Guardar'),
  );
  openModal(`Presupuesto de ${formatMonth(month)}`, body, footer);
}

async function _save(month, rows, onSaved) {
  const lines = [];
  for (const r of rows) {
    if (!r.checkbox.checked) continue;
    const amount = Number(r.input.value) || 0;
    if (amount < 0) { showToast(`Importe inválido en ${r.key}`, 'error'); return; }
    lines.push({ budgetKey: r.key, amount, note: 'manual' });
  }

  closeModal();
  setLoading(true, 'Guardando presupuesto…');
  try {
    await sheets.savePlanForMonth(month, lines);
    showToast(`Presupuesto de ${formatMonth(month)} guardado`, 'success');
    onSaved?.();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error', 5000);
  } finally {
    setLoading(false);
  }
}
