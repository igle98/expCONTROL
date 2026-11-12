// =========================================================
// addExpense.js — pantalla "Añadir gasto" con clasificación IA
// Reemplaza el bot de Telegram + workflow de n8n.
// =========================================================

import * as state   from '../state.js';
import * as sheets  from '../sheets.js';
import { el, showToast, setLoading } from '../utils/dom.js';
import { formatCurrency, formatDateLong, formatMonth } from '../utils/formatters.js';
import { parseExpense } from '../expense/parser.js';
import { normalizeMerchant } from '../expense/normalizer.js';
import { classifyWithOpenAI, hasOpenAIKey } from '../expense/classifier.js';
import { maybeOpenCoverage } from './coverage.js';

const ROOT_ID = 'view-add-expense';

// Categorías especiales: si el merchant_raw las contiene, se asigna directamente.
export const SPECIAL_KEYWORDS = [
  { keyword: 'imprevisto',  budgetKey: 'IMPREVISTOS',  source: 'imprevisto'  },
  { keyword: 'invitacion',  budgetKey: 'INVITACIONES', source: 'invitacion'  },
  { keyword: 'invitación',  budgetKey: 'INVITACIONES', source: 'invitacion'  },
  { keyword: 'viaje',       budgetKey: 'VIAJES',       source: 'viaje'       },
  { keyword: 'regalo',      budgetKey: 'GIFTS',        source: 'regalo'      },
];

// Fecha con la que se apuntan los gastos. null = por defecto (ver _defaultDate).
// Se mantiene entre gastos para poder meter varios del mismo día/mes seguidos.
let _chosenDate = null;
let _chosenForMonth = null;   // mes seleccionado en la app cuando se eligió

// Gasto dividido: { people (contándote), invited } o null. Solo vale para el siguiente gasto.
let _split = null;
let _splitRefresh = null;     // repinta el resumen del reparto al teclear el importe

/** Persona con la que se apuntan las deudas de un gasto dividido (se puede editar en Deudas) */
const SPLIT_DEBT_PERSON = 'Pendiente de Bizum';

export function render() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;

  // Si se cambia de mes en el selector de la app, la fecha vuelve a la de por defecto
  if (_chosenForMonth !== state.currentMonth) { _chosenDate = null; _chosenForMonth = state.currentMonth; }

  root.replaceChildren(
    _renderForm(),
    el('div', { id: 'add-expense-date', class: 'add-expense-date' }),
    el('div', { id: 'add-expense-split', class: 'add-expense-split' }),
    el('div', { id: 'add-expense-status', class: 'add-expense-status' }),
    el('div', { id: 'add-expense-result', class: 'add-expense-result' }),
  );
  _renderDateRow();
  _renderSplitRow();

  // Aviso si falta API key
  if (!hasOpenAIKey()) {
    _setStatus(
      el('div', { class: 'banner banner-warn' },
        '⚠️ Falta la API key de OpenAI. ',
        el('a', { href: '#', onclick: (e) => { e.preventDefault(); _goSettings(); } }, 'Configurar en Ajustes'),
      ),
    );
  }
}

// =========================================================
// Form
// =========================================================

function _renderForm() {
  const input = el('input', {
    id: 'add-expense-input',
    type: 'text',
    class: 'add-expense-input',
    placeholder: 'Ej: 12.50 mercadona',
    autocomplete: 'off',
    autocapitalize: 'none',
    enterkeyhint: 'send',
    oninput: () => _splitRefresh?.(),
  });

  const btn = el('button', {
    type: 'submit',
    class: 'btn btn-primary',
  }, 'Añadir');

  const form = el('form', {
    class: 'add-expense-form',
    onsubmit: async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      await _processInput(text, () => { input.value = ''; input.focus(); });
    },
  }, input, btn);

  return form;
}

// =========================================================
// Flujo principal
// =========================================================

async function _processInput(text, onDone) {
  _clearResult();
  _setStatus(el('p', { class: 'muted' }, 'Procesando…'));

  let parsed, normalized;
  try {
    parsed = parseExpense(text);
    normalized = normalizeMerchant(parsed.merchant_raw);
  } catch (err) {
    _setStatus(el('p', { class: 'banner banner-error' }, '❌ ' + err.message));
    return;
  }

  // Fecha: la escrita en el texto ("ayer", "28 de octubre") manda; si no, la del selector
  const evt = { ...parsed, ...normalized, date: parsed.explicitDate ? parsed.date : _effectiveDate() };
  if (state.getMonthClose(evt.date.slice(0, 7))) {
    showToast(`Ojo: ${formatMonth(evt.date.slice(0, 7))} está cerrado. El gasto se apunta igual; reabre el cierre si quieres que cuente en él.`, 'info', 6000);
  }

  // 1) Special keywords → categoría directa, sin IA
  const special = _matchSpecial(evt.merchant_raw);
  if (special) {
    const cleanedRaw = _stripKeyword(evt.merchant_raw, special.keyword);
    const renorm = normalizeMerchant(cleanedRaw || evt.merchant_raw);
    const fixed = {
      ...evt,
      merchant_raw: cleanedRaw || evt.merchant_raw,
      description:  cleanedRaw || evt.description,
      merchant_norm: renorm.merchant_norm,
      merchant_base: renorm.merchant_base,
    };
    await _confirmAndSave(fixed, {
      budgetKey:    special.budgetKey,
      confidence:   1,
      source:       special.source,
      saveToMap:    false,
    }, onDone);
    return;
  }

  // 2) Lookup en MERCHANT_MAP
  // (solo si su categoría sigue activa: las pausadas/archivadas no se sugieren)
  const cached = state.merchantMap.get(evt.merchant_norm);
  if (cached?.budgetKey && state.budgets.some(b => b.budgetKey === cached.budgetKey)) {
    await _confirmAndSave(evt, {
      budgetKey:    cached.budgetKey,
      confidence:   cached.confidenceLast || 1,
      source:       'map',
      saveToMap:    false,
    }, onDone);
    return;
  }

  // 3) Clasificación con OpenAI
  if (!hasOpenAIKey()) {
    _setStatus(el('p', { class: 'banner banner-error' },
      '❌ No conozco este comercio y falta la API key de OpenAI. Configúrala en Ajustes.'));
    return;
  }

  _setStatus(el('p', { class: 'muted' }, '🤖 Consultando IA…'));

  const budgetKeys = state.budgets.map(b => b.budgetKey);
  let suggestion;
  try {
    suggestion = await classifyWithOpenAI({
      merchant_raw:  evt.merchant_raw,
      merchant_base: evt.merchant_base,
      description:   evt.description,
      amount:        evt.amount,
      currency:      evt.currency,
      date:          evt.date,
      budget_keys:   budgetKeys,
    });
  } catch (err) {
    _setStatus(el('p', { class: 'banner banner-error' }, '❌ ' + err.message));
    return;
  }

  _renderSuggestion(evt, suggestion, onDone);
}

// =========================================================
// Diálogo de sugerencia (botones [Confirmar] [Elegir otra])
// =========================================================

function _renderSuggestion(evt, suggestion, onDone) {
  _setStatus(null);

  const card = el('div', { class: 'suggestion-card' },
    el('div', { class: 'suggestion-header' },
      '🤖 No conozco este comercio aún.',
    ),
    el('div', { class: 'suggestion-body' },
      el('p', {}, `Gasto: `, el('b', {}, formatCurrency(evt.amount)), ` ➡️ ${evt.merchant_raw}`),
      el('p', {}, 'Sugerencia: ', el('b', {}, suggestion.budget_key_suggested),
        ` (conf: ${suggestion.confidence.toFixed(2)})`),
    ),
    el('div', { class: 'suggestion-actions' },
      el('button', {
        class: 'btn btn-primary',
        onclick: () => _confirmAndSave(evt, {
          budgetKey:  suggestion.budget_key_suggested,
          confidence: suggestion.confidence,
          source:     'ai',
          saveToMap:  true,
        }, onDone),
      }, '👍 Confirmar'),
      el('button', {
        class: 'btn btn-secondary',
        onclick: () => _renderCategoryPicker(evt, suggestion, onDone),
      }, '🔁 Elegir otra'),
    ),
  );

  _setResult(card);
}

function _renderCategoryPicker(evt, suggestion, onDone) {
  // Filtrar gastos fijos que ya tengan transacción este mes
  // (no se van a repetir, así que ensucian la lista).
  const month = evt.date.slice(0, 7);
  const paidFixedKeys = new Set();
  for (const tx of state.transactions) {
    if (tx.month !== month) continue;
    paidFixedKeys.add(tx.budgetKey);
  }
  const candidates = state.budgets.filter(b => {
    if (b.type !== 'Fijo') return true;
    return !paidFixedKeys.has(b.budgetKey);
  });

  const buttons = candidates.map(b =>
    el('button', {
      class: 'btn btn-chip',
      onclick: () => _confirmAndSave(evt, {
        budgetKey:  b.budgetKey,
        confidence: suggestion?.confidence ?? 0,
        source:     b.budgetKey === suggestion?.budget_key_suggested ? 'ai' : 'manual',
        saveToMap:  true,
      }, onDone),
    }, b.budgetKey),
  );

  const card = el('div', { class: 'suggestion-card' },
    el('div', { class: 'suggestion-header' },
      `🔃 Elige una categoría para ${formatCurrency(evt.amount)} — ${evt.merchant_raw}`),
    el('div', { class: 'category-picker' }, ...buttons),
  );

  _setResult(card);
}

// =========================================================
// Persistencia
// =========================================================

async function _confirmAndSave(evt, decision, onDone) {
  // Ocio sin dividir: preguntar si ibas con más gente ("Solo yo" = un toque)
  if (!_split && _isOcio(decision.budgetKey)) {
    _askSplit(evt, decision, onDone);
    return;
  }
  await _saveExpense(evt, decision, onDone, _split);
}

async function _saveExpense(evt, decision, onDone, split) {
  if (split && !_validSplit(split)) return;
  setLoading(true, 'Guardando…');
  try {
    const budget = state.budgets.find(b => b.budgetKey === decision.budgetKey);
    const type = budget?.type ?? '';
    const tsIngest = new Date().toISOString();
    const base = evt.merchant_base || evt.merchant_norm || 'unknown';
    const txId = `${Date.now()}-${base}`;
    const parts = split ? _splitParts(evt.amount, split) : null;
    const tx = (fields) => sheets.appendTransaction({
      tsIngest,
      month:        evt.date.slice(0, 7),
      date:         evt.date,
      currency:     evt.currency,
      merchantRaw:  evt.merchant_raw,
      merchantNorm: evt.merchant_norm,
      merchantBase: evt.merchant_base,
      ...fields,
    });

    // Mi parte (o el gasto entero si no se divide)
    await tx({
      txId,
      amount:       parts ? parts.mine : evt.amount,
      description:  parts ? `${evt.description} (mi parte de ${split.people})` : evt.description,
      budgetKey:    decision.budgetKey,
      type,
      confidence:   decision.confidence,
      merchantMapSource: decision.source,
    });

    // Lo de los invitados → INVITACIONES
    let invTxId = null;
    if (parts?.invited > 0) {
      const invKey = state.allBudgetKeys.some(c => c.budgetKey === 'INVITACIONES') ? 'INVITACIONES' : decision.budgetKey;
      invTxId = `${Date.now()}-inv-${base}`;
      await tx({
        txId:         invTxId,
        amount:       parts.invited,
        description:  `${evt.description} (invito a ${split.invited})`,
        budgetKey:    invKey,
        type:         state.allBudgetKeys.find(c => c.budgetKey === invKey)?.type ?? type,
        confidence:   1,
        merchantMapSource: 'split',
      });
    }

    // Lo que te devolverán por Bizum → Me deben
    const owers = split ? split.people - 1 - split.invited : 0;
    if (parts?.owed > 0) {
      await sheets.appendDebt({
        id: `${Date.now()}-bizum`, person: SPLIT_DEBT_PERSON, amount: parts.owed,
        reason: `${evt.description || evt.merchant_norm} (${owers} ${owers === 1 ? 'persona' : 'personas'})`,
        dateCreated: evt.date, status: 'pending', datePaid: '', notes: '',
      });
      await sheets.loadDebts();
    }

    if (decision.saveToMap) {
      await sheets.appendMerchantMap({
        merchantNorm:   evt.merchant_norm,
        budgetKey:      decision.budgetKey,
        type,
        firstSeen:      tsIngest,
        lastSeen:       tsIngest,
        confidenceLast: decision.confidence,
        source:         decision.source,
      });
    }

    // Recargar transactions para refrescar gráficas/listas
    await sheets.loadTransactions();

    // Mensaje de éxito (con remaining si es Variable)
    const summary = parts
      ? `✅ ${formatCurrency(evt.amount)} dividido: tu parte ${formatCurrency(parts.mine)} → ${decision.budgetKey}` +
        (parts.invited > 0 ? ` · invitas ${formatCurrency(parts.invited)}` : '') +
        (parts.owed > 0 ? ` · te deben ${formatCurrency(parts.owed)} (en Deudas)` : '')
      : _buildSummary(evt, decision, type, budget);
    showToast(summary, 'success', 5000);

    _split = null;
    _renderSplitRow();
    _clearResult();
    _setStatus(null);
    if (typeof onDone === 'function') onDone();

    // Si no cabe en su categoría (o admite hucha), decidir de dónde sale el dinero
    const saved = state.transactions.find(t => t.txId === txId);
    const inv = invTxId ? state.transactions.find(t => t.txId === invTxId) : null;
    const coverInv = () => { if (inv) maybeOpenCoverage(inv); };
    if (!maybeOpenCoverage(saved, coverInv)) coverInv();
  } catch (err) {
    showToast('Error al guardar: ' + err.message, 'error', 5000);
    _setStatus(el('p', { class: 'banner banner-error' }, '❌ ' + err.message));
  } finally {
    setLoading(false);
  }
}

function _buildSummary(evt, decision, type, budget) {
  const head = `✅ ${formatCurrency(evt.amount)} ${evt.merchant_norm} → ${decision.budgetKey}`;
  if (type === 'Variable' && budget?.monthlyBudget > 0) {
    const month = evt.date.slice(0, 7);
    const spent = state.getSpendByMonthAndKey(month, decision.budgetKey);
    const remaining = budget.monthlyBudget - spent;
    return `${head}\nGastado: ${formatCurrency(spent)} de ${formatCurrency(budget.monthlyBudget)} · Restante: ${formatCurrency(remaining)}`;
  }
  return head;
}

// =========================================================
// Selector de fecha
// =========================================================

/** Fecha por defecto: hoy; si en la app está seleccionado un mes pasado, su último día */
function _defaultDate() {
  const today = _iso(new Date());
  const month = state.currentMonth;
  if (!month || month >= today.slice(0, 7)) return today;
  // Mes pasado ya cerrado: lo normal es estar apuntando gastos de hoy, no de ese mes
  if (state.getMonthClose(month)) return today;
  const [y, m] = month.split('-').map(Number);
  return _iso(new Date(y, m, 0));
}

function _effectiveDate() {
  return _chosenDate ?? _defaultDate();
}

function _renderDateRow() {
  const slot = document.getElementById('add-expense-date');
  if (!slot) return;
  const date = _effectiveDate();
  const today = _iso(new Date());
  const yesterday = _iso(new Date(Date.now() - 86400000));
  const now = new Date();
  const prevMonthDate = _iso(new Date(now.getFullYear(), now.getMonth(), 0));   // último día del mes pasado
  const month = date.slice(0, 7);
  const isOtherMonth = month !== today.slice(0, 7);
  const closed = state.getMonthClose(month);

  const set = (value) => { _chosenDate = value; _chosenForMonth = state.currentMonth; _renderDateRow(); };
  const chip = (label, value, active) => el('button', {
    type: 'button', class: `chip ${active ? 'chip-active' : ''}`, onclick: () => set(value),
  }, label);

  slot.replaceChildren(...[
    el('div', { class: 'add-expense-date-row' },
      el('input', {
        type: 'date', class: 'modal-input add-expense-date-input', value: date, max: today,
        onchange: (e) => { if (e.target.value) set(e.target.value); },
      }),
      chip('Hoy', today, date === today),
      chip('Ayer', yesterday, date === yesterday),
      chip(`Mes pasado (${formatMonth(prevMonthDate.slice(0, 7)).split(' ')[0]})`, prevMonthDate, month === prevMonthDate.slice(0, 7)),
    ),
    isOtherMonth ? el('p', { class: 'add-expense-date-note' },
      `📅 Se apuntará el ${formatDateLong(date)}: cuenta para el presupuesto, el colchón y las huchas de `,
      el('b', {}, formatMonth(month)), '.') : null,
    closed ? el('p', { class: 'add-expense-date-note is-closed' },
      `🔒 ${formatMonth(month)} está cerrado. Puedes apuntarlo igual, pero para que cuente en el cierre tendrás que reabrirlo.`) : null,
  ].filter(Boolean));
}

function _iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// =========================================================
// Gasto dividido (pagas tú, invitas a algunos y otros te hacen Bizum)
// =========================================================

function _isOcio(budgetKey) {
  return String(budgetKey ?? '').toUpperCase().startsWith('OCIO');
}

function _r2(n) { return Math.round(n * 100) / 100; }

/** Reparto: tu parte, lo de los invitados y lo que te deben (los céntimos sueltos van a tu parte) */
function _splitParts(total, split) {
  const per = total / split.people;
  const invited = _r2(per * split.invited);
  const owed = _r2(per * (split.people - 1 - split.invited));
  return { mine: _r2(total - invited - owed), invited, owed };
}

function _validSplit(split) {
  if (!(split.people >= 2)) { showToast('Para dividir tenéis que ser al menos 2', 'error'); return false; }
  if (split.invited < 0 || split.invited > split.people - 1) {
    showToast(`Como mucho puedes invitar a ${split.people - 1}`, 'error');
    return false;
  }
  return true;
}

function _currentAmount() {
  try { return parseExpense(document.getElementById('add-expense-input')?.value ?? '').amount; } catch { return null; }
}

/** Campos "Somos" / "Invito a" con el reparto en vivo */
function _splitEditor(split, getTotal) {
  const summary = el('div', { class: 'split-summary' });
  const refresh = () => {
    const total = getTotal();
    const valid = split.people >= 2 && split.invited >= 0 && split.invited <= split.people - 1;
    if (!valid) {
      summary.replaceChildren(el('span', { class: 'split-warn' },
        split.people < 2 ? 'Tenéis que ser al menos 2' : `Como mucho puedes invitar a ${split.people - 1}`));
      return;
    }
    const owers = split.people - 1 - split.invited;
    if (!(total > 0)) {
      summary.replaceChildren(`Tu parte 1/${split.people}` +
        (split.invited ? ` · invitas ${split.invited}` : '') + (owers ? ` · te deben ${owers}` : ''));
      return;
    }
    const p = _splitParts(total, split);
    summary.replaceChildren(...[
      el('span', {}, 'Tu parte ', el('b', {}, formatCurrency(p.mine))),
      p.invited > 0 ? el('span', {}, ' · Invitaciones ', el('b', {}, formatCurrency(p.invited))) : null,
      p.owed > 0 ? el('span', {}, ` · Te deben (${owers}) `, el('b', {}, formatCurrency(p.owed))) : null,
    ].filter(Boolean));
  };
  const num = (label, key, min) => {
    const input = el('input', {
      type: 'number', inputmode: 'numeric', min, step: '1', class: 'modal-input split-input', value: String(split[key]),
      oninput: () => { split[key] = Math.floor(Number(input.value) || 0); refresh(); },
    });
    return el('label', { class: 'split-field' }, el('span', {}, label), input);
  };
  refresh();
  return { node: el('div', { class: 'split-editor' },
    el('div', { class: 'split-fields' }, num('Somos (contándote)', 'people', '2'), num('Invito a', 'invited', '0')),
    summary), refresh };
}

/** Botón "Dividir gasto" bajo la fecha (para cualquier categoría) */
function _renderSplitRow() {
  const slot = document.getElementById('add-expense-split');
  if (!slot) return;
  _splitRefresh = null;
  if (!_split) {
    slot.replaceChildren(el('button', {
      type: 'button', class: 'chip', onclick: () => { _split = { people: 2, invited: 0 }; _renderSplitRow(); },
    }, '👥 Dividir gasto'));
    return;
  }
  const editor = _splitEditor(_split, _currentAmount);
  _splitRefresh = editor.refresh;
  slot.replaceChildren(el('div', { class: 'split-panel' },
    el('div', { class: 'split-panel-head' },
      el('b', {}, '👥 Gasto dividido'),
      el('button', { type: 'button', class: 'chip', onclick: () => { _split = null; _renderSplitRow(); } }, '✕ No dividir')),
    editor.node,
    el('p', { class: 'muted small split-help' },
      'Apunta el total que pagaste. Lo de los invitados va a INVITACIONES y lo que te devolverán, a Deudas.'),
  ));
}

/** Gasto de ocio sin dividir: ¿ibas con más gente? */
function _askSplit(evt, decision, onDone) {
  _setStatus(null);
  const split = { people: 2, invited: 0 };
  const editor = _splitEditor(split, () => evt.amount);
  _setResult(el('div', { class: 'suggestion-card' },
    el('div', { class: 'suggestion-header' }, `🍻 ${formatCurrency(evt.amount)} en ${decision.budgetKey}: ¿ibas con más gente?`),
    el('div', { class: 'suggestion-body' }, editor.node),
    el('div', { class: 'suggestion-actions' },
      el('button', { class: 'btn btn-secondary', onclick: () => _saveExpense(evt, decision, onDone, null) }, '🙋 Solo yo'),
      el('button', { class: 'btn btn-primary', onclick: () => _saveExpense(evt, decision, onDone, split) }, '👥 Dividir y guardar'),
    ),
  ));
}

// =========================================================
// Helpers de UI
// =========================================================

function _setStatus(node) {
  const slot = document.getElementById('add-expense-status');
  if (slot) slot.replaceChildren(...(node ? [node] : []));
}

function _setResult(node) {
  const slot = document.getElementById('add-expense-result');
  if (slot) slot.replaceChildren(...(node ? [node] : []));
}

function _clearResult() { _setResult(null); }

function _goSettings() {
  document.querySelector('.nav-btn[data-nav="settings"]')?.click();
}

// =========================================================
// Special keywords
// =========================================================

function _matchSpecial(merchantRaw) {
  const lower = (merchantRaw || '').toLowerCase();
  // Solo si la categoría sigue activa (p.ej. no se ha renombrado ni archivado)
  return SPECIAL_KEYWORDS.find(s =>
    lower.includes(s.keyword) && state.budgets.some(b => b.budgetKey === s.budgetKey),
  ) || null;
}

function _stripKeyword(text, keyword) {
  return text
    .replace(new RegExp(`\\b${keyword}\\b`, 'gi'), '')
    .replace(/\s+/g, ' ')
    .trim();
}
