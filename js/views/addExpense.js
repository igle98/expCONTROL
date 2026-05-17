// =========================================================
// addExpense.js — pantalla "Añadir gasto" con clasificación IA
// Reemplaza el bot de Telegram + workflow de n8n.
// =========================================================

import * as state   from '../state.js';
import * as sheets  from '../sheets.js';
import { el, showToast, setLoading } from '../utils/dom.js';
import { formatCurrency } from '../utils/formatters.js';
import { parseExpense } from '../expense/parser.js';
import { normalizeMerchant } from '../expense/normalizer.js';
import { classifyWithOpenAI, hasOpenAIKey } from '../expense/classifier.js';

const ROOT_ID = 'view-add-expense';

// Categorías especiales: si el merchant_raw las contiene, se asigna directamente.
const SPECIAL_KEYWORDS = [
  { keyword: 'imprevisto',  budgetKey: 'IMPREVISTOS',  source: 'imprevisto'  },
  { keyword: 'invitacion',  budgetKey: 'INVITACIONES', source: 'invitacion'  },
  { keyword: 'invitación',  budgetKey: 'INVITACIONES', source: 'invitacion'  },
  { keyword: 'viaje',       budgetKey: 'VIAJES',       source: 'viaje'       },
  { keyword: 'regalo',      budgetKey: 'GIFTS',        source: 'regalo'      },
];

export function render() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;

  root.replaceChildren(
    _renderForm(),
    el('div', { id: 'add-expense-status', class: 'add-expense-status' }),
    el('div', { id: 'add-expense-result', class: 'add-expense-result' }),
  );

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
    placeholder: 'Ej: 12.50 mercadona ayer',
    autocomplete: 'off',
    autocapitalize: 'none',
    enterkeyhint: 'send',
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

  const evt = { ...parsed, ...normalized };

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
  const cached = state.merchantMap.get(evt.merchant_norm);
  if (cached?.budgetKey) {
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
  setLoading(true, 'Guardando…');
  try {
    const budget = state.budgets.find(b => b.budgetKey === decision.budgetKey);
    const type = budget?.type ?? '';
    const tsIngest = new Date().toISOString();
    const txId = `${Date.now()}-${evt.merchant_base || evt.merchant_norm || 'unknown'}`;

    await sheets.appendTransaction({
      txId,
      tsIngest,
      month:        evt.date.slice(0, 7),
      date:         evt.date,
      amount:       evt.amount,
      currency:     evt.currency,
      merchantRaw:  evt.merchant_raw,
      merchantNorm: evt.merchant_norm,
      merchantBase: evt.merchant_base,
      description:  evt.description,
      budgetKey:    decision.budgetKey,
      type,
      confidence:   decision.confidence,
      merchantMapSource: decision.source,
    });

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
    const summary = _buildSummary(evt, decision, type, budget);
    showToast(summary, 'success', 4500);

    _clearResult();
    _setStatus(null);
    if (typeof onDone === 'function') onDone();
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
  return SPECIAL_KEYWORDS.find(s => lower.includes(s.keyword)) || null;
}

function _stripKeyword(text, keyword) {
  return text
    .replace(new RegExp(`\\b${keyword}\\b`, 'gi'), '')
    .replace(/\s+/g, ' ')
    .trim();
}
