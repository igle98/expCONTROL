// =========================================================
// monthClose.js — cierre de mes (se puede hacer en cualquier momento).
// Resume previsto vs consumido, lo pendiente de cubrir y el uso de huchas;
// manda los sobrantes (colchón y sin asignar) a la hucha elegida y calcula
// la transferencia neta a la cuenta de ahorro. Ver docs/presupuesto-v2.md §6.
// =========================================================

import * as state  from '../state.js';
import * as sheets from '../sheets.js';
import { el, openModal, closeModal, showToast, setLoading } from '../utils/dom.js';
import { formatCurrency, formatMonth } from '../utils/formatters.js';

/**
 * @param {string} month 'YYYY-MM'
 * @param {() => void} onDone
 */
export function openMonthClose(month, onDone) {
  const s = state.getMonthSummary(month);
  const closed = state.getMonthClose(month);
  const activeHuchas = state.huchas.filter(h => h.status === 'active');

  // ---------- Sobrantes → hucha elegida
  const leftovers = [];   // { label, amount, select }
  const leftoverRow = (label, amount, help, suggestHucha) => {
    if (closed || amount <= 0.004 || activeHuchas.length === 0) return null;
    const def = suggestHucha ? (activeHuchas.find(h => h.name === 'FONDO EMERGENCIA')?.name ?? '') : '';
    const select = el('select', { class: 'modal-select', onchange: refreshTransfer },
      el('option', { value: '' }, 'No apartarlo (se queda en la cuenta del día a día)'),
      ...activeHuchas.map(h => el('option', { value: h.name, selected: h.name === def }, `🐷 ${h.name}`)));
    leftovers.push({ label, amount: _round(amount), select });
    return el('div', { class: 'coverage-source' },
      el('div', { class: 'coverage-line' }, el('span', {}, label), el('b', {}, formatCurrency(amount))),
      el('div', { class: 'muted small' }, help),
      select,
    );
  };

  // ---------- Transferencia neta a la cuenta de ahorro
  const transferEl = el('div', { class: 'close-transfer' });
  function refreshTransfer() {
    if (closed) {
      // Mes cerrado: balance total del mes con la cuenta de ahorro (todo ya registrado)
      const net = _round(s.aportaciones - s.retiradas);
      transferEl.replaceChildren(
        el('div', { class: 'close-transfer-title' }, '🏦 Balance del mes con la cuenta de ahorro',
          el('b', {}, `${net >= 0 ? '+' : '−'}${formatCurrency(Math.abs(net))}`)),
        _line('Aportaciones a huchas', s.aportaciones),
        _line('Gastos pagados con huchas', -s.retiradas),
      );
      return;
    }
    // Lo ya registrado con "Ya la hice" ya se transfirió; aquí va lo que queda por mover
    const extra = leftovers.filter(l => l.select.value).reduce((t, l) => t + l.amount, 0);
    const pendingContrib = s.huchaPlanned.reduce((t, h) => t + Math.max(0, h.planned - h.done), 0);
    // Lo pagado con huchas sale directamente de la cuenta de ahorro: no se resta aquí
    const net = _round(pendingContrib + s.savingsFree + extra);
    transferEl.replaceChildren(...[
      el('div', { class: 'close-transfer-title' },
        Math.abs(net) < 0.005 ? '🏦 No hay nada que mover entre cuentas'
          : '🏦 Transfiere a la cuenta de ahorro',
        Math.abs(net) < 0.005 ? null : el('b', {}, formatCurrency(Math.abs(net)))),
      pendingContrib > 0 ? _line('Aportaciones a huchas sin registrar', pendingContrib, 'is-warn') : null,
      s.savingsFree > 0 ? _line('Ahorro libre previsto', s.savingsFree) : null,
      extra > 0 ? _line('Sobrantes que apartas', extra) : null,
      s.retiradas > 0 ? el('div', { class: 'muted small' },
        `Los ${formatCurrency(s.retiradas)} pagados con huchas ya salieron de la cuenta de ahorro (no cuentan aquí).`) : null,
      s.aportaciones > 0 ? el('div', { class: 'muted small' },
        `Ya registraste ${formatCurrency(s.aportaciones)} de aportaciones este mes (no cuentan aquí).`) : null,
    ].filter(Boolean));
  }

  const over  = s.categories.filter(c => c.planned && c.consumido > c.ajustado + 0.004);
  const under = s.categories.filter(c => c.planned && c.consumido < c.ajustado - 0.004)
    .sort((a, b) => (b.ajustado - b.consumido) - (a.ajustado - a.consumido));
  const unplanned = s.categories.filter(c => !c.planned && c.consumido > 0.004);
  const desviacion = _round(s.consumidoTotal - s.inicialTotal);

  const body = el('div', { class: 'close' }, ...[
    closed ? el('p', { class: 'close-closed' }, `🔒 Mes cerrado el ${new Date(closed.closedAt).toLocaleDateString('es-ES')}.`) : null,

    _section('Resumen',
      _line('Ingresos', s.income),
      _line('Presupuestado (gastos, huchas, inversión…)', s.plannedTotal),
      _line('Gastos: previsto', s.inicialTotal),
      _line('Gastos: consumido del mes', s.consumidoTotal),
      _line('Desviación', desviacion, desviacion > 0 ? 'is-bad' : 'is-good',
        desviacion > 0 ? 'gastaste más de lo previsto' : 'gastaste menos de lo previsto'),
      s.gastadoTotal - s.consumidoTotal > 0.004 ? _line('Además, pagado con huchas', s.gastadoTotal - s.consumidoTotal) : null,
      s.invested > 0 ? _line('Invertido', s.invested) : null,
    ),

    s.pendienteTotal > 0.004 ? _section('⏳ Pendiente de cubrir',
      el('p', { class: 'muted small' },
        'Gasto sin dinero identificado. No se pasa solo al mes siguiente: decide si fue una deuda real, ',
        'dinero de una hucha sin registrar (corrígelo desde el gasto → Financiación) o lo asumes.'),
      ...s.categories.filter(c => c.pendiente > 0.004).map(c => _line(c.budgetKey, c.pendiente, 'is-bad')),
    ) : null,

    over.length ? _section('Te pasaste en',
      ...over.map(c => _line(c.budgetKey, c.consumido - c.ajustado, 'is-bad',
        `${formatCurrency(c.consumido, true)} de ${formatCurrency(c.ajustado, true)}`))) : null,
    unplanned.length ? _section('Fuera de presupuesto',
      ...unplanned.map(c => _line(c.budgetKey, c.consumido, 'is-bad'))) : null,
    under.length ? _section(`Te sobró en (${formatCurrency(under.reduce((t, c) => t + c.ajustado - c.consumido, 0))})`,
      ...under.slice(0, 5).map(_underLine),
      under.length > 5 ? el('details', {},
        el('summary', { class: 'muted small' }, `Ver ${under.length - 5} más`),
        ...under.slice(5).map(_underLine)) : null,
    ) : null,

    (s.retiradasPorHucha.length || s.huchaPlanned.length) ? _section('🐷 Huchas',
      ...s.huchaPlanned.map(h => _line(`Aportación a ${h.name}`, h.planned,
        h.done + 0.004 >= h.planned ? 'is-good' : 'is-warn',
        h.done + 0.004 >= h.planned ? 'registrada' : `registrada ${formatCurrency(h.done, true)}`)),
      ...s.retiradasPorHucha.map(([name, amount]) => _line(`Pagado con ${name}`, -amount)),
    ) : null,

    !closed && (s.reserve.remaining > 0.004 || s.unassigned > 0.004) ? _section('Sobrantes',
      leftoverRow('🛟 Colchón de imprevistos sin usar', s.reserve.remaining,
        `Tenías ${formatCurrency(s.reserve.planned)} y usaste ${formatCurrency(s.reserve.used)}. ¿A qué hucha va?`, true),
      leftoverRow('💶 Dinero sin asignar', s.unassigned, 'Ingresos que no presupuestaste. ¿Lo apartas?', false),
    ) : null,

    transferEl,
  ].filter(Boolean));
  refreshTransfer();

  const footer = el('div', { style: { display: 'contents' } }, ...[
    el('button', { class: 'btn btn-secondary btn-sm', onclick: () => closeModal() }, 'Cerrar ventana'),
    closed
      ? el('button', { class: 'btn btn-secondary btn-sm', onclick: () => _reopen(closed, onDone) }, 'Reabrir mes')
      : el('button', { class: 'btn btn-primary btn-sm', onclick: () => _close(month, s, leftovers, onDone) }, `🔒 Cerrar ${formatMonth(month).split(' ')[0]}`),
  ]);
  openModal(`Cierre de ${formatMonth(month)}`, body, footer);
}

async function _close(month, s, leftovers, onDone) {
  const chosen = leftovers.filter(l => l.select.value);
  // Las aportaciones previstas que aún no se registraron van en la transferencia del cierre
  const pending = s.huchaPlanned.filter(h => h.planned - h.done > 0.004);
  const parts = [
    ...pending.map(h => `${formatCurrency(h.planned - h.done)} de aportación a ${h.name}`),
    ...chosen.map(l => `${formatCurrency(l.amount)} de sobrante a ${l.select.value}`),
  ];
  const text = parts.length ? `Se registrará: ${parts.join(', ')}. ¿Cerrar el mes?` : '¿Cerrar el mes?';
  if (!confirm(text)) return;

  closeModal();
  setLoading(true, 'Cerrando mes…');
  try {
    const date = `${month}-${String(_lastDay(month)).padStart(2, '0')}`;
    await sheets.appendFunding([
      ...pending.map(h => ({
        date, month, source: `HUCHA:${h.name}`, amount: _round(h.planned - h.done), kind: 'aportacion',
        note: `presupuesto ${month} (al cerrar)`,
      })),
      ...chosen.map(l => ({
        date, month, source: `HUCHA:${l.select.value}`, amount: l.amount, kind: 'aportacion',
        note: `cierre ${month}: ${l.label.replace(/^\S+\s/, '')}`,
      })),
    ]);
    await sheets.saveMonthClose(month,
      `consumido ${_round(s.consumidoTotal)} de ${_round(s.inicialTotal)} · pendiente ${_round(s.pendienteTotal)} · ` +
      `huchas +${_round(s.aportaciones + pending.reduce((t, h) => t + h.planned - h.done, 0) + chosen.reduce((t, l) => t + l.amount, 0))} −${_round(s.retiradas)}`);
    showToast(`${formatMonth(month)} cerrado 🔒`, 'success');
    onDone?.();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error', 5000);
  } finally {
    setLoading(false);
  }
}

async function _reopen(closed, onDone) {
  if (!confirm('¿Reabrir el mes? Las aportaciones que se hicieron al cerrarlo se mantienen (puedes ajustarlas desde la hucha).')) return;
  closeModal();
  setLoading(true, 'Reabriendo…');
  try {
    await sheets.deleteMonthClose(closed.rowIndex);
    showToast('Mes reabierto', 'success');
    onDone?.();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error', 5000);
  } finally {
    setLoading(false);
  }
}

function _underLine(c) {
  return _line(c.budgetKey, c.ajustado - c.consumido, 'is-good',
    `${formatCurrency(c.consumido, true)} de ${formatCurrency(c.ajustado, true)}`);
}

function _section(title, ...children) {
  return el('div', { class: 'close-section' },
    el('div', { class: 'cat-group-title' }, title),
    ...children.filter(Boolean));
}

function _line(label, amount, cls = '', hint = '') {
  return el('div', { class: `coverage-line ${cls}` },
    el('span', {}, label, hint ? el('span', { class: 'muted small' }, ` · ${hint}`) : null),
    el('b', {}, formatCurrency(amount)),
  );
}

function _lastDay(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function _round(n) { return Math.round(n * 100) / 100; }
