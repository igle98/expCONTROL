// =========================================================
// coverage.js — cubrir un gasto que no cabe en su categoría
// (o pagarlo con hucha). Regla: el gasto ya está registrado; aquí solo se
// decide de dónde sale el dinero. Lo que no se cubra queda pendiente y visible.
// Ver docs/presupuesto-v2.md §5.
// =========================================================

import * as state  from '../state.js';
import * as sheets from '../sheets.js';
import { el, openModal, closeModal, showToast, setLoading } from '../utils/dom.js';
import { formatCurrency } from '../utils/formatters.js';
import { isElectiveCode } from '../utils/categoryCodes.js';

/**
 * Abre el diálogo de cobertura si hace falta. Devuelve false si no hay nada que decidir.
 * @param {{txId:string, month:string, budgetKey:string, amount:number, description?:string}} tx
 * @param {() => void} [onDone]
 */
export function maybeOpenCoverage(tx, onDone) {
  const ctx = _context(tx);
  if (!ctx) return false;
  if (ctx.shortfall <= 0 && !ctx.cat.allowsHucha) return false;
  _open(tx, ctx, onDone, false);
  return true;
}

/**
 * Abre siempre el diálogo para un gasto ya registrado (desde la lista de gastos):
 * enseña cómo se financió y permite añadir o quitar fuentes.
 */
export function openCoverageForTx(tx, onDone) {
  const ctx = _context(tx);
  if (!ctx) {
    showToast('Este gasto no admite financiación (sin categoría o inversión)', 'info');
    return;
  }
  _open(tx, ctx, onDone, true);
}

/** Categoría, situación del mes y lo que queda por cubrir de este gasto */
function _context(tx) {
  if (state.catalogFormat !== 'v2' || !tx?.txId) return null;
  const cat = state.allBudgetKeys.find(c => c.budgetKey === tx.budgetKey);
  if (!cat || cat.code === 'INV') return null;
  const status   = state.getCategoryStatus(tx.month, tx.budgetKey);
  const existing = state.getTxCoverage(tx.txId);
  const covered  = existing.reduce((s, f) => s + f.amount, 0);
  const uncovered = Math.max(0, tx.amount - covered);
  const shortfall = _round(Math.min(uncovered, Math.max(0, -status.disponible)));
  return { cat, status, existing, uncovered: _round(uncovered), shortfall };
}

function _open(tx, ctx, onDone, manual) {
  const { cat, status, existing, uncovered, shortfall } = ctx;
  const elective = isElectiveCode(cat.code);
  // Lo que cabía en el presupuesto del mes de la categoría antes de este gasto
  const fitsInBudget = _round(uncovered - shortfall);
  const activeHuchas = state.huchas.filter(h => h.status === 'active');
  const canHucha = (cat.allowsHucha || cat.code[0] === 'N') && activeHuchas.length > 0;

  let hucha = null;             // { input, max, source } — paga parte o todo el gasto
  const monthRows = [];         // fuentes del mes para el déficit: { input, max, source }
  const H = () => hucha ? (Number(hucha.input.value) || 0) : 0;
  const M = () => monthRows.reduce((s, r) => s + (Number(r.input.value) || 0), 0);
  // Déficit: lo que no cabe en el presupuesto de la categoría tras usar la hucha
  const deficit = () => _round(Math.max(0, shortfall - H()));

  const breakdown = el('div', { class: 'coverage-breakdown' });
  const deficitBlock = el('div', { class: 'coverage-deficit' });
  const deficitHead = el('p', { class: 'coverage-deficit-head' });

  const refresh = () => {
    const h = Math.min(H(), uncovered);
    const fromBudget = _round(Math.min(uncovered - h, fitsInBudget));
    const d = deficit();
    const pending = _round(Math.max(0, d - M()));
    breakdown.replaceChildren(...[
      canHucha ? _line('🐷 De hucha', h) : null,
      _line(`📅 Del presupuesto de ${tx.budgetKey}`, fromBudget,
        `te quedaban ${formatCurrency(Math.max(0, fitsInBudget), true)}`),
      d > 0 ? _line('➕ Otras fuentes del mes', Math.min(M(), d)) : null,
      d > 0 && pending > 0 ? _line('⏳ Pendiente de cubrir', pending, null, 'coverage-pending') : null,
    ].filter(Boolean));
    deficitBlock.classList.toggle('hidden', d <= 0);
    deficitHead.replaceChildren('Te faltan ', el('b', {}, formatCurrency(d)), ' del mes. ¿De dónde salen?');
  };

  const amountInput = () => el('input', {
    class: 'modal-input plan-editor-amount', type: 'number', inputmode: 'decimal',
    step: '0.01', min: '0', placeholder: '0', oninput: refresh,
  });

  // ---------- Hucha: hasta el gasto entero
  const huchaNode = (() => {
    if (!canHucha) return null;
    const linked = state.getHuchasForCategory(tx.budgetKey)
      .sort((a, b) => state.getHuchaBalance(b.name) - state.getHuchaBalance(a.name));
    const linkedNames = new Set(linked.map(h => h.name));
    // Preselección: la última usada con esta categoría o, si no, la vinculada con más saldo
    const last = state.getLastHuchaForCategory(tx.budgetKey) ?? linked[0]?.name ?? null;
    let type = activeHuchas.find(h => h.name === last)?.type ?? (cat.code[0] === 'N' ? 'provision' : 'objetivo');

    const huchaSelect = el('select', { class: 'modal-select', onchange: refresh });
    const balanceOf = () => Math.max(0, state.getHuchaBalance(huchaSelect.value));
    const fillHuchas = () => {
      const list = activeHuchas.filter(h => h.type === type)     // las vinculadas primero
        .sort((a, b) => Number(linkedNames.has(b.name)) - Number(linkedNames.has(a.name)));
      huchaSelect.replaceChildren(...list.map(h =>
        el('option', { value: h.name, selected: h.name === last },
          `${linkedNames.has(h.name) ? '★ ' : ''}${h.name} (${formatCurrency(state.getHuchaBalance(h.name), true)})`)));
    };
    const typeSelect = el('select', {
      class: 'modal-select',
      onchange: (e) => { type = e.target.value; fillHuchas(); refresh(); },
    },
      el('option', { value: 'provision', selected: type === 'provision' }, 'Provisión'),
      el('option', { value: 'objetivo',  selected: type === 'objetivo'  }, 'Objetivo'),
    );
    fillHuchas();
    const input = amountInput();
    const max = () => Math.min(balanceOf(), uncovered);
    hucha = { input, max, source: () => ({ source: `HUCHA:${huchaSelect.value}`, kind: 'retirada' }) };
    const use = el('button', {
      type: 'button', class: 'btn btn-secondary btn-sm',
      onclick: () => { input.value = String(_round(max())); refresh(); },
    }, 'Todo lo posible');
    return _sourceRow('🐷 ¿Cuánto pagas con hucha?',
      'Dinero que ya tenías apartado: no cuenta contra el presupuesto del mes.',
      el('div', { class: 'coverage-hucha-pick' }, typeSelect, huchaSelect), input, use);
  })();

  // ---------- Fuentes del mes para el déficit
  const monthSource = (title, help, picker, max, source) => {
    const input = amountInput();
    monthRows.push({ input, max, source });
    const use = el('button', {
      type: 'button', class: 'btn btn-secondary btn-sm',
      onclick: () => {
        const others = monthRows.filter(r => r.input !== input).reduce((s, r) => s + (Number(r.input.value) || 0), 0);
        input.value = String(_round(Math.max(0, Math.min(max(), deficit() - others))));
        refresh();
      },
    }, 'Usar');
    return _sourceRow(title, help, picker, input, use);
  };

  const monthSources = {
    move: () => {
      const options = state.getBudgetKeysForMonth(tx.month)
        .filter(b => b.budgetKey !== tx.budgetKey)
        .map(b => ({ key: b.budgetKey, left: state.getCategoryStatus(tx.month, b.budgetKey).disponible }))
        .filter(o => o.left > 0)
        .sort((a, b) => b.left - a.left);
      if (options.length === 0) return null;
      const select = el('select', { class: 'modal-select', onchange: refresh },
        el('option', { value: '' }, 'Elige de qué categoría…'),
        ...options.map(o => el('option', { value: o.key }, `${o.key} (le quedan ${formatCurrency(o.left, true)})`)));
      return monthSource('↔️ Mover de otra categoría', 'Le quitas a otra lo que no vas a gastar. Tú eliges cuál.',
        select, () => options.find(o => o.key === select.value)?.left ?? 0,
        () => select.value ? { source: `CAT:${select.value}`, kind: 'cobertura' } : null);
    },
    unassigned: () => {
      const free = state.getUnassigned(tx.month);
      if (free <= 0) return null;
      return monthSource('💶 Dinero sin asignar', `Te quedan ${formatCurrency(free)} de este mes sin presupuestar.`,
        null, () => free, () => ({ source: 'SIN_ASIGNAR', kind: 'cobertura' }));
    },
    reserve: () => {
      const { remaining } = state.getReserveStatus(tx.month);
      if (remaining <= 0) return null;
      return monthSource('🛟 Colchón de imprevistos', `Quedan ${formatCurrency(remaining)}.` +
        (elective ? ' Es un gasto electivo: úsalo solo si de verdad es una urgencia.' : ''),
        null, () => remaining, () => ({ source: 'IMPREVISTOS', kind: 'cobertura' }));
    },
  };
  // En electivos el colchón va siempre el último y nunca viene marcado
  const order = elective ? ['move', 'unassigned', 'reserve'] : ['reserve', 'move', 'unassigned'];
  const monthNodes = shortfall > 0 ? order.map(k => monthSources[k]()).filter(Boolean) : [];
  deficitBlock.append(...[
    deficitHead,
    elective ? el('p', { class: 'muted small' }, 'Antes de tirar del colchón, decide qué otro gasto sacrificas.') : null,
    ...(monthNodes.length ? monthNodes : [el('p', { class: 'muted small' }, 'No hay ninguna fuente del mes disponible: quedará pendiente.')]),
  ].filter(Boolean));

  const head = el('p', {}, el('b', {}, `${tx.description || tx.budgetKey} · ${formatCurrency(tx.amount)}`),
    ` en ${tx.budgetKey}.`,
    uncovered <= 0 ? ' Ya está cubierto del todo.' : '');

  const body = el('div', { class: 'coverage' }, ...[
    head,
    existing.length > 0 ? _existingBlock(existing, onDone) : null,
    uncovered > 0 ? huchaNode : null,
    uncovered > 0 ? breakdown : null,
    uncovered > 0 && shortfall > 0 ? deficitBlock : null,
  ].filter(Boolean));
  refresh();

  const footer = el('div', { style: { display: 'contents' } }, ...[
    el('button', { class: 'btn btn-secondary btn-sm', onclick: () => { closeModal(); onDone?.(); } },
      manual ? 'Cerrar' : canHucha ? 'Todo del mes' : 'Dejar pendiente'),
    uncovered > 0
      ? el('button', { class: 'btn btn-primary btn-sm', onclick: () => _confirm(tx, hucha, monthRows, ctx, onDone) }, 'Confirmar')
      : null,
  ].filter(Boolean));
  openModal(manual ? 'De dónde salió el dinero' : canHucha ? '¿Cómo lo pagas?' : 'Cubrir el exceso', body, footer);
}

function _line(label, amount, hint = null, cls = '') {
  return el('div', { class: `coverage-line ${cls}` },
    el('span', {}, label, hint ? el('span', { class: 'muted small' }, ` · ${hint}`) : null),
    el('b', {}, formatCurrency(amount)),
  );
}

/** Financiación ya registrada de este gasto, con opción de quitarla */
function _existingBlock(existing, onDone) {
  const label = s => s === 'IMPREVISTOS' ? 'Colchón de imprevistos' : s === 'SIN_ASIGNAR' ? 'Dinero sin asignar'
    : s.startsWith('HUCHA:') ? `Hucha ${s.slice(6)}` : s.startsWith('CAT:') ? `Movido de ${s.slice(4)}` : s;
  return el('div', { class: 'coverage-source' },
    el('div', { class: 'coverage-source-title' }, 'Ya financiado'),
    ...existing.map(f => el('div', { class: 'hucha-move' },
      el('span', {}, label(f.source)), el('span', {}, formatCurrency(f.amount)))),
    el('button', {
      type: 'button', class: 'btn btn-secondary btn-sm',
      onclick: async () => {
        if (!confirm('¿Quitar esta financiación? El gasto vuelve a contar entero contra el presupuesto del mes.')) return;
        closeModal();
        setLoading(true, 'Quitando…');
        try {
          await sheets.deleteFunding(existing.map(f => f.rowIndex));
          showToast('Financiación quitada', 'success');
        } catch (err) {
          showToast(`Error: ${err.message}`, 'error', 5000);
        } finally {
          setLoading(false);
          onDone?.();
        }
      },
    }, 'Quitar financiación'),
  );
}

function _sourceRow(title, help, picker, input, useBtn) {
  return el('div', { class: 'coverage-source' },
    el('div', { class: 'coverage-source-title' }, title),
    el('div', { class: 'muted small' }, help),
    picker,
    el('div', { class: 'coverage-amount-row' }, input, useBtn),
  );
}

async function _confirm(tx, hucha, monthRows, ctx, onDone) {
  const { uncovered, shortfall } = ctx;
  const moves = [];
  const add = (r, amount) => {
    const src = r.source();
    if (!src) { showToast('Elige la categoría de la que mover el dinero', 'error'); return false; }
    if (amount > _round(r.max()) + 0.001) {
      showToast(`No hay tanto disponible en ${src.source.replace(/^(HUCHA|CAT):/, '')}`, 'error');
      return false;
    }
    moves.push({ date: _today(), month: tx.month, txId: tx.txId, amount, ...src, note: tx.description ?? '' });
    return true;
  };

  // 1. Hucha: hasta el gasto entero (lo no cubierto aún)
  const h = hucha ? _round(Number(hucha.input.value) || 0) : 0;
  if (h > uncovered + 0.001) { showToast(`Con la hucha puedes cubrir como mucho ${formatCurrency(uncovered)}`, 'error'); return; }
  if (h > 0 && !add(hucha, h)) return;

  // 2. Fuentes del mes: solo para el déficit que queda tras la hucha
  const deficit = _round(Math.max(0, shortfall - h));
  if (deficit > 0) {
    let total = 0;
    for (const r of monthRows) {
      const amount = _round(Number(r.input.value) || 0);
      if (amount <= 0) continue;
      total += amount;
      if (!add(r, amount)) return;
    }
    if (_round(total) > deficit + 0.001) {
      showToast(`Solo faltan ${formatCurrency(deficit)} del mes`, 'error');
      return;
    }
  }

  closeModal();
  if (moves.length === 0) { onDone?.(); return; }

  setLoading(true, 'Guardando…');
  try {
    await sheets.appendFunding(moves);
    showToast('Financiación guardada', 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error', 5000);
  } finally {
    setLoading(false);
    onDone?.();
  }
}

function _round(n) { return Math.round(n * 100) / 100; }

function _today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
