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
  // Con déficit: cubrir lo que falta. Sin déficit: pago opcional con hucha de lo no cubierto aún.
  const target = shortfall > 0 ? shortfall : uncovered;
  const rows = [];                                        // { input, max, source }
  const footerInfo = el('div', { class: 'coverage-summary' });

  const refresh = () => {
    const covered = rows.reduce((s, r) => s + (Number(r.input.value) || 0), 0);
    const pending = _round(target - covered);
    footerInfo.replaceChildren(...[      // replaceChildren pintaría los null como texto
      el('span', {}, `Cubierto ${formatCurrency(covered)} de ${formatCurrency(target)}`),
      shortfall > 0
        ? el('span', { class: pending > 0 ? 'coverage-pending' : 'coverage-ok' },
            pending > 0 ? ` · quedan ${formatCurrency(pending)} pendientes` : ' · cubierto ✓')
        : null,
    ].filter(Boolean));
  };

  const amountInput = (max) => {
    const input = el('input', {
      class: 'modal-input plan-editor-amount', type: 'number', inputmode: 'decimal',
      step: '0.01', min: '0', max: String(max), placeholder: '0', oninput: refresh,
    });
    return input;
  };

  const useButton = (input, max) => el('button', {
    type: 'button', class: 'btn btn-secondary btn-sm',
    onclick: () => {
      const others = rows.filter(r => r.input !== input).reduce((s, r) => s + (Number(r.input.value) || 0), 0);
      input.value = String(_round(Math.max(0, Math.min(max(), target - others))));
      refresh();
    },
  }, 'Usar');

  // ---------- Fuentes
  const sources = {
    hucha: () => {
      if (!cat.allowsHucha && cat.code[0] !== 'N') return null;
      const active = state.huchas.filter(h => h.status === 'active');
      if (active.length === 0) return null;
      // Preselección: la última usada con esta categoría o, si no, la vinculada con más saldo
      const linked = state.getHuchasForCategory(tx.budgetKey)
        .sort((a, b) => state.getHuchaBalance(b.name) - state.getHuchaBalance(a.name));
      const linkedNames = new Set(linked.map(h => h.name));
      const last = state.getLastHuchaForCategory(tx.budgetKey) ?? linked[0]?.name ?? null;
      const lastType = active.find(h => h.name === last)?.type;
      let type = lastType ?? (cat.code[0] === 'N' ? 'provision' : 'objetivo');

      const huchaSelect = el('select', { class: 'modal-select', onchange: () => { input.max = String(balanceOf()); refresh(); } });
      const balanceOf = () => Math.max(0, state.getHuchaBalance(huchaSelect.value));
      const fillHuchas = () => {
        // Las vinculadas a la categoría primero
        const list = active.filter(h => h.type === type)
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
      const input = amountInput(balanceOf());
      rows.push({ input, max: balanceOf, source: () => ({ source: `HUCHA:${huchaSelect.value}`, kind: 'retirada' }) });
      return _sourceRow('🐷 Hucha', 'Sale de lo ahorrado para esto.',
        el('div', { class: 'coverage-hucha-pick' }, typeSelect, huchaSelect), input, useButton(input, balanceOf));
    },

    move: () => {
      if (shortfall <= 0) return null;
      const options = state.getBudgetKeysForMonth(tx.month)
        .filter(b => b.budgetKey !== tx.budgetKey)
        .map(b => ({ key: b.budgetKey, left: state.getCategoryStatus(tx.month, b.budgetKey).disponible }))
        .filter(o => o.left > 0)
        .sort((a, b) => b.left - a.left);
      if (options.length === 0) return null;
      const select = el('select', { class: 'modal-select', onchange: () => { input.max = String(maxOf()); refresh(); } },
        el('option', { value: '' }, 'Elige de qué categoría…'),
        ...options.map(o => el('option', { value: o.key }, `${o.key} (le quedan ${formatCurrency(o.left, true)})`)));
      const maxOf = () => options.find(o => o.key === select.value)?.left ?? 0;
      const input = amountInput(0);
      rows.push({ input, max: maxOf, source: () => select.value ? { source: `CAT:${select.value}`, kind: 'cobertura' } : null });
      return _sourceRow('↔️ Mover de otra categoría', 'Le quitas a otra lo que no vas a gastar. Tú eliges cuál.',
        select, input, useButton(input, maxOf));
    },

    unassigned: () => {
      if (shortfall <= 0) return null;
      const free = state.getUnassigned(tx.month);
      if (free <= 0) return null;
      const input = amountInput(free);
      rows.push({ input, max: () => free, source: () => ({ source: 'SIN_ASIGNAR', kind: 'cobertura' }) });
      return _sourceRow('💶 Dinero sin asignar', `Te quedan ${formatCurrency(free)} de este mes sin presupuestar.`,
        null, input, useButton(input, () => free));
    },

    reserve: () => {
      if (shortfall <= 0) return null;
      const { remaining } = state.getReserveStatus(tx.month);
      if (remaining <= 0) return null;
      const input = amountInput(remaining);
      rows.push({ input, max: () => remaining, source: () => ({ source: 'IMPREVISTOS', kind: 'cobertura' }) });
      return _sourceRow('🛟 Colchón de imprevistos', `Quedan ${formatCurrency(remaining)}.` +
        (elective ? ' Es un gasto electivo: úsalo solo si de verdad es una urgencia.' : ''),
        null, input, useButton(input, () => remaining));
    },
  };

  // Orden: en electivos el colchón va siempre el último y nunca viene marcado
  const order = elective
    ? ['move', 'unassigned', 'hucha', 'reserve']
    : ['hucha', 'reserve', 'move', 'unassigned'];
  const sourceNodes = order.map(k => sources[k]()).filter(Boolean);

  const head = shortfall > 0
    ? el('p', {}, 'Te pasas ', el('b', {}, formatCurrency(shortfall)), ` en ${tx.budgetKey}`,
        ` (presupuesto del mes ${formatCurrency(status.ajustado)}, consumido ${formatCurrency(status.consumido)}). ¿De dónde sale?`)
    : target > 0
      ? el('p', {}, `${formatCurrency(tx.amount)} en ${tx.budgetKey} caben en el presupuesto del mes.`,
          cat.allowsHucha ? ' ¿Quieres pagar una parte con alguna hucha?' : '')
      : el('p', {}, 'Este gasto ya está cubierto del todo.');

  const body = el('div', { class: 'coverage' },
    head,
    existing.length > 0 ? _existingBlock(existing, onDone) : null,
    elective && shortfall > 0
      ? el('p', { class: 'muted small' }, 'Antes de tirar del colchón, decide qué otro gasto sacrificas.')
      : null,
    ...(target <= 0 ? [] : sourceNodes.length ? sourceNodes
        : [el('p', { class: 'muted small' }, 'No hay ninguna fuente disponible ahora mismo.')]),
    target > 0 ? footerInfo : null,
  );
  refresh();

  const footer = el('div', { style: { display: 'contents' } },
    el('button', { class: 'btn btn-secondary btn-sm', onclick: () => { closeModal(); onDone?.(); } },
      manual ? 'Cerrar' : shortfall > 0 ? 'Dejar pendiente' : 'No, del mes'),
    target > 0
      ? el('button', { class: 'btn btn-primary btn-sm', onclick: () => _confirm(tx, rows, target, onDone) }, 'Confirmar')
      : null,
  );
  openModal(manual ? 'De dónde salió el dinero' : shortfall > 0 ? 'Cubrir el exceso' : 'Pagar con hucha', body, footer);
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

async function _confirm(tx, rows, target, onDone) {
  const moves = [];
  let total = 0;
  for (const r of rows) {
    const amount = _round(Number(r.input.value) || 0);
    if (amount <= 0) continue;
    const src = r.source();
    if (!src) { showToast('Elige la categoría de la que mover el dinero', 'error'); return; }
    if (amount > _round(r.max()) + 0.001) {
      showToast(`No hay tanto disponible en ${src.source.replace(/^(HUCHA|CAT):/, '')}`, 'error');
      return;
    }
    total += amount;
    moves.push({ date: _today(), month: tx.month, txId: tx.txId, amount, ...src, note: tx.description ?? '' });
  }
  if (_round(total) > _round(target) + 0.001) {
    showToast(`Estás cubriendo más de ${formatCurrency(target)}`, 'error');
    return;
  }
  closeModal();
  if (moves.length === 0) { onDone?.(); return; }

  setLoading(true, 'Guardando…');
  try {
    await sheets.appendFunding(moves);
    showToast('Cobertura guardada', 'success');
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
