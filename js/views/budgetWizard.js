// =========================================================
// budgetWizard.js — asistente para preparar el presupuesto de un mes.
// Pasos: 1 Ingresos · 2 Necesarios + electivos mensuales (+ colchón)
//        3 Inversiones · 4 Ahorro y huchas · 5 Resto de electivos.
// Guarda ingresos en INCOME y el plan en PLAN_LINES. Ver docs/presupuesto-v2.md.
// =========================================================

import * as state  from '../state.js';
import * as sheets from '../sheets.js';
import { el, openModal, closeModal, showToast, setLoading } from '../utils/dom.js';
import { formatCurrency, formatMonth } from '../utils/formatters.js';
import { isInvestmentCode } from '../utils/categoryCodes.js';

export const RESERVE_KEY = '@IMPREVISTOS';
export const SAVINGS_KEY = '@AHORRO';

const STEPS = [
  { id: 'income',  title: 'Ingresos' },
  { id: 'needs',   title: 'Necesarios y cuotas' },
  { id: 'inv',     title: 'Inversiones' },
  { id: 'savings', title: 'Ahorro y huchas' },
  { id: 'rest',    title: 'Resto de electivos' },
];

let _w = null;   // estado del asistente abierto

/**
 * Abre el asistente para `month`.
 * @param {string} month 'YYYY-MM'
 * @param {() => void} onSaved
 */
export function openBudgetWizard(month, onSaved) {
  const plan = new Map(state.getPlanLinesForMonth(month).map(l => [l.budgetKey, l.amount]));

  // Ingresos: los del mes o, si no hay, los del último mes con ingresos
  const own = state.getIncomeForMonth(month);
  const prevMonth = own.length ? null : state.getPrevIncomeMonth(month);
  const incomeSource = own.length ? own : prevMonth ? state.getIncomeForMonth(prevMonth) : [];
  const incomes = new Map(incomeSource.map(l => [l.incomeKey, l.amount]));

  // Categorías: activas + las que ya estén en el plan aunque no lo estén
  const cats = state.allBudgetKeys
    .filter(c => c.status === 'active' || plan.has(c.budgetKey))
    .sort((a, b) => a.budgetKey.localeCompare(b.budgetKey));
  const lines = new Map();
  for (const c of cats) {
    const constant = c.type === 'Fijo';
    lines.set(c.budgetKey, {
      included: plan.has(c.budgetKey),
      amount:   plan.get(c.budgetKey) ?? (constant ? c.refAmount : 0),
    });
  }
  const huchaKeys = state.huchas
    .filter(h => h.status === 'active' || plan.has(`${state.HUCHA_PREFIX}${h.name}`))
    .map(h => `${state.HUCHA_PREFIX}${h.name}`);
  for (const key of [RESERVE_KEY, SAVINGS_KEY, ...huchaKeys]) {
    lines.set(key, { included: plan.has(key), amount: plan.get(key) ?? 0 });
  }

  _w = {
    month, onSaved, step: 0, cats, incomes, lines,
    ownPlan: state.getPlanSourceMonth(month) === month,
    incomeFrom: prevMonth,
    prevMonth: state.getPrevMonth(month),
  };
  _render();
}

// =========================================================
// Render
// =========================================================

function _render() {
  const body = el('div', { class: 'wizard' },
    _renderTotals(),
    _renderStepNav(),
    _renderStep(),
  );

  const isLast = _w.step === STEPS.length - 1;
  const footer = el('div', { style: { display: 'contents' } },
    _w.step > 0
      ? el('button', { class: 'btn btn-secondary btn-sm', onclick: () => _go(_w.step - 1) }, '← Atrás')
      : el('button', { class: 'btn btn-secondary btn-sm', onclick: () => closeModal() }, 'Cancelar'),
    isLast
      ? null
      : el('button', { class: 'btn btn-secondary btn-sm', onclick: () => _go(_w.step + 1) }, 'Siguiente →'),
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => _save() }, isLast ? 'Guardar presupuesto' : 'Guardar'),
  );

  openModal(`Presupuesto de ${formatMonth(_w.month)}`, body, footer);
}

function _go(step) {
  _w.step = step;
  _render();
  document.getElementById('modal-body')?.scrollTo(0, 0);
}

function _renderTotals() {
  const node = el('div', { class: 'wizard-totals' });
  const refresh = () => {
    const income = [..._w.incomes.values()].reduce((s, v) => s + (Number(v) || 0), 0);
    let assigned = 0;
    for (const l of _w.lines.values()) if (l.included) assigned += Number(l.amount) || 0;
    const left = income - assigned;
    node.replaceChildren(
      _total('Ingresos', income),
      _total('Asignado', assigned),
      _total('Te quedan', left, left < 0 ? 'is-negative' : left > 0 ? 'is-positive' : ''),
    );
  };
  refresh();
  _w.refreshTotals = refresh;
  return node;
}

function _total(label, amount, cls = '') {
  return el('div', { class: `wizard-total ${cls}` },
    el('span', { class: 'wizard-total-label' }, label),
    el('span', { class: 'wizard-total-amount' }, formatCurrency(amount)),
  );
}

/** Progreso del asistente (se avanza con Siguiente / Atrás) */
function _renderStepNav() {
  return el('div', { class: 'wizard-progress' },
    el('span', { class: 'muted small' }, `Paso ${_w.step + 1} de ${STEPS.length}`),
    el('div', { class: 'wizard-dots' },
      ...STEPS.map((_, i) => el('span', {
        class: `wizard-dot ${i === _w.step ? 'is-current' : i < _w.step ? 'is-done' : ''}`,
      })),
    ),
  );
}

function _renderStep() {
  switch (STEPS[_w.step].id) {
    case 'income':  return _stepIncome();
    case 'needs':   return _stepNeeds();
    case 'inv':     return _stepCategories('Inversiones', 'Dinero que sale cada mes pero no es gasto.',
                      [['Inversión', c => isInvestmentCode(c.code)]]);
    case 'savings': return _stepSavings();
    case 'rest':    return _stepCategories('Resto de electivos',
                      'Ocio, planes y compras ocasionales. Lo que asignes aquí sale de lo que te quede.',
                      [
                        ['Electivo mensual variable', c => c.code === 'EMV'],
                        ['Electivo discontinuo',      c => c.code.startsWith('ED')],
                      ]);
  }
  return null;
}

// ---------- Paso 1: ingresos

function _stepIncome() {
  const keys = state.incomeKeys.filter(k => k.status === 'active' || _w.incomes.has(k.incomeKey));
  const nameInput = el('input', {
    class: 'modal-input', type: 'text', placeholder: 'Nueva categoría de ingreso', maxlength: '40',
  });

  return el('div', { class: 'wizard-step' },
    _stepIntro('Ingresos',
      _w.incomeFrom
        ? `Propuestos a partir de ${formatMonth(_w.incomeFrom)}. Ajusta lo que vayas a cobrar este mes.`
        : 'Lo que vas a cobrar este mes. Es la base de todo lo demás.'),
    el('div', { class: 'plan-editor-group' },
      ...keys.map(k => _amountRow(
        k.incomeKey,
        _w.incomes.get(k.incomeKey) ?? '',
        v => { if (v === '') _w.incomes.delete(k.incomeKey); else _w.incomes.set(k.incomeKey, v); },
      )),
    ),
    el('div', { class: 'wizard-add-row' },
      nameInput,
      el('button', {
        class: 'btn btn-secondary btn-sm',
        onclick: () => _addIncomeKey(nameInput.value),
      }, '+ Añadir'),
    ),
  );
}

async function _addIncomeKey(raw) {
  const name = String(raw ?? '').trim();
  if (!name) { showToast('Escribe un nombre', 'error'); return; }
  if (state.incomeKeys.some(k => k.incomeKey.toLowerCase() === name.toLowerCase())) {
    showToast('Esa categoría ya existe', 'error');
    return;
  }
  setLoading(true, 'Creando categoría…');
  try {
    await sheets.appendIncomeKey(name);
    _render();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error', 5000);
  } finally {
    setLoading(false);
  }
}

// ---------- Paso 2: necesarios + electivos mensuales + colchón

function _stepNeeds() {
  return el('div', { class: 'wizard-step' },
    _stepCategories('Necesarios y cuotas',
      'Primero lo imprescindible y las cuotas mensuales fijas que decides mantener.',
      [
        ['Necesario mensual',     c => c.code.startsWith('NM')],
        ['Necesario discontinuo', c => c.code.startsWith('ND')],
        ['Cuotas electivas',      c => c.code === 'EMC'],
      ]),
    el('div', { class: 'plan-editor-group' },
      el('div', { class: 'cat-group-title' }, 'Colchón'),
      _lineRow(RESERVE_KEY, 'Imprevistos', 'reserva para urgencias'),
    ),
  );
}

// ---------- Paso 4: ahorro (las huchas llegarán en la siguiente fase)

function _stepSavings() {
  const group = (type, title) => {
    const list = state.huchas.filter(h => h.type === type && _w.lines.has(`${state.HUCHA_PREFIX}${h.name}`));
    if (list.length === 0) return null;
    return el('div', { class: 'plan-editor-group' },
      el('div', { class: 'cat-group-title' }, title),
      ...list.map(h => _lineRow(`${state.HUCHA_PREFIX}${h.name}`, h.name, _huchaHint(h))),
    );
  };
  return el('div', { class: 'wizard-step' },
    _stepIntro('Ahorro y huchas',
      'Lo que apartas a la cuenta de ahorro este mes, repartido por huchas. Mejor decidirlo ahora que ahorrar "lo que sobre".'),
    group('objetivo', 'Objetivos'),
    group('provision', 'Provisiones'),
    el('div', { class: 'plan-editor-group' },
      el('div', { class: 'cat-group-title' }, 'Sin hucha concreta'),
      _lineRow(SAVINGS_KEY, 'Ahorro libre', 'a la cuenta de ahorro'),
    ),
  );
}

/** Saldo de la hucha y, si tiene objetivo con fecha, lo que haría falta al mes */
function _huchaHint(h) {
  const balance = state.getHuchaBalance(h.name);
  const parts = [`saldo ${formatCurrency(balance, true)}`];
  if (h.target > 0) {
    const missing = h.target - balance;
    if (missing <= 0) parts.push('objetivo cumplido');
    else if (/^\d{4}-\d{2}$/.test(h.targetDate) && h.targetDate >= _w.month) {
      const [y1, m1] = _w.month.split('-').map(Number);
      const [y2, m2] = h.targetDate.split('-').map(Number);
      const months = (y2 - y1) * 12 + (m2 - m1) + 1;
      parts.push(`sugerido ${formatCurrency(missing / months, true)}/mes`);
    } else {
      parts.push(`faltan ${formatCurrency(missing, true)}`);
    }
  }
  return parts.join(' · ');
}

// ---------- Pasos de categorías

function _stepCategories(title, intro, groups) {
  const sections = groups.map(([label, test]) => {
    const items = _w.cats.filter(test);
    if (items.length === 0) return null;
    return el('div', { class: 'plan-editor-group' },
      el('div', { class: 'cat-group-title' }, label),
      ...items.map(c => _lineRow(c.budgetKey, c.budgetKey, _hint(c))),
    );
  });
  return el('div', { class: 'wizard-step' }, _stepIntro(title, intro), ...sections);
}

/** Pista bajo cada categoría: lo gastado el mes anterior */
function _hint(c) {
  const spent = state.getSpendByMonthAndKey(_w.prevMonth, c.budgetKey);
  return spent > 0 ? `${formatMonth(_w.prevMonth).split(' ')[0]}: ${formatCurrency(spent, true)}` : '';
}

function _stepIntro(title, text) {
  return el('div', { class: 'wizard-intro' },
    el('div', { class: 'wizard-step-title' }, `${_w.step + 1}. ${title}`),
    el('p', { class: 'muted small' }, text),
  );
}

// =========================================================
// Filas
// =========================================================

/** Fila de categoría/línea del plan: casilla + importe */
function _lineRow(key, label, hint) {
  const line = _w.lines.get(key);
  const checkbox = el('input', {
    type: 'checkbox', checked: line.included,
    onchange: () => { line.included = checkbox.checked; _w.refreshTotals(); },
  });
  const input = el('input', {
    class: 'modal-input plan-editor-amount', type: 'number', inputmode: 'decimal', step: '0.01', min: '0',
    value: line.amount ? String(line.amount) : '', placeholder: '0',
    oninput: () => {
      line.amount = input.value === '' ? 0 : Number(input.value);
      if (input.value !== '' && !line.included) { line.included = true; checkbox.checked = true; }
      _w.refreshTotals();
    },
  });
  return el('label', { class: 'plan-editor-row' },
    checkbox,
    el('span', { class: 'plan-editor-name' },
      label,
      hint ? el('span', { class: 'plan-editor-hint' }, hint) : null,
    ),
    input,
  );
}

/** Fila de ingreso: solo importe (vacío = no se cobra este mes) */
function _amountRow(label, value, onChange) {
  const input = el('input', {
    class: 'modal-input plan-editor-amount', type: 'number', inputmode: 'decimal', step: '0.01', min: '0',
    value: value === '' ? '' : String(value), placeholder: '0',
    oninput: () => { onChange(input.value === '' ? '' : Number(input.value)); _w.refreshTotals(); },
  });
  return el('label', { class: 'plan-editor-row plan-editor-row-income' },
    el('span', { class: 'plan-editor-name' }, label),
    input,
  );
}

// =========================================================
// Guardar
// =========================================================

async function _save() {
  const incomeLines = [..._w.incomes.entries()]
    .filter(([, amount]) => Number(amount) > 0)
    .map(([incomeKey, amount]) => ({ incomeKey, amount: Number(amount) }));
  const planLines = [..._w.lines.entries()]
    .filter(([, l]) => l.included)
    .map(([budgetKey, l]) => ({ budgetKey, amount: Number(l.amount) || 0, note: 'asistente' }));

  if ([...incomeLines, ...planLines].some(l => l.amount < 0)) {
    showToast('Hay importes negativos', 'error');
    return;
  }

  const { month, onSaved } = _w;
  closeModal();
  setLoading(true, 'Guardando presupuesto…');
  try {
    await sheets.saveIncomeForMonth(month, incomeLines);
    await sheets.savePlanForMonth(month, planLines);
    showToast(`Presupuesto de ${formatMonth(month)} guardado`, 'success');
    onSaved?.();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error', 5000);
  } finally {
    setLoading(false);
  }
}
