import * as state from '../state.js';
import { getCategoryColor } from '../utils/colors.js';
import { formatCurrency, formatMonth } from '../utils/formatters.js';
import { el } from '../utils/dom.js';

// =========================================================
// Render
// =========================================================

export function render() {
  const container = document.getElementById('reports-content');
  if (!container) return;

  const month     = state.currentMonth;
  const prevMonth = state.getPrevMonth(month);

  container.replaceChildren(
    _sectionWeek(),
    _sectionComparison(month, prevMonth),
    _sectionTopMerchants(month),
  );
}

// =========================================================
// Sección 1: Semana actual por día
// =========================================================

function _sectionWeek() {
  const days = state.getWeeklySpend();
  const max  = Math.max(...days.map(d => d.total), 1);

  const rows = days.map(day => {
    const width = Math.round((day.total / max) * 100);
    return el('div', { class: 'week-day-row' },
      el('div', { class: 'week-day-label' }, day.label),
      el('div', { class: 'week-day-bar-track' },
        el('div', {
          class: 'week-day-bar-fill',
          style: { width: day.total > 0 ? `${width}%` : '0%' },
        }),
      ),
      el('div', { class: 'week-day-amount' },
        day.total > 0 ? formatCurrency(day.total) : '—',
      ),
    );
  });

  return el('div', { class: 'report-section' },
    el('div', { class: 'report-section-title' }, 'Semana actual'),
    ...rows,
  );
}

// =========================================================
// Sección 2: Comparativa mes actual vs mes anterior
// =========================================================

function _sectionComparison(month, prevMonth) {
  const spendCurrent  = state.getSpendByCategory(month);
  const spendPrev     = state.getSpendByCategory(prevMonth);

  // Unión de todas las categorías presentes en ambos meses
  const allKeys = [...new Set([...spendCurrent.keys(), ...spendPrev.keys()])].sort();

  if (allKeys.length === 0) {
    return el('div', { class: 'report-section' },
      el('div', { class: 'report-section-title' }, `${formatMonth(month)} vs ${formatMonth(prevMonth)}`),
      el('p', { style: { color: 'var(--text-muted)', fontSize: 'var(--text-sm)' } }, 'Sin datos'),
    );
  }

  const rows = allKeys.map(key => {
    const curr  = spendCurrent.get(key) ?? 0;
    const prev  = spendPrev.get(key)    ?? 0;
    const delta = curr - prev;
    const color = getCategoryColor(key);

    const deltaEl = _deltaChip(delta);

    return el('div', { class: 'compare-row' },
      el('div', { class: 'compare-category', style: { color } }, key),
      el('div', { class: 'compare-amount' }, curr > 0 ? formatCurrency(curr) : '—'),
      deltaEl,
    );
  });

  // Totales del mes
  const totalCurr = [...spendCurrent.values()].reduce((s, v) => s + v, 0);
  const totalPrev = [...spendPrev.values()].reduce((s, v)  => s + v, 0);
  const totalDelta = totalCurr - totalPrev;

  const totalRow = el('div', {
    class: 'compare-row',
    style: { borderTop: '1px solid var(--border)', marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)', fontWeight: '600' },
  },
    el('div', { class: 'compare-category', style: { color: 'var(--text-primary)' } }, 'TOTAL'),
    el('div', { class: 'compare-amount', style: { color: 'var(--text-primary)' } }, formatCurrency(totalCurr)),
    _deltaChip(totalDelta),
  );

  return el('div', { class: 'report-section' },
    el('div', { class: 'report-section-title' },
      `${formatMonth(month)} vs ${formatMonth(prevMonth)}`,
    ),
    ...rows,
    totalRow,
  );
}

function _deltaChip(delta) {
  if (Math.abs(delta) < 0.01) {
    return el('div', { class: 'compare-delta delta-eq' }, '=');
  }
  const sign = delta > 0 ? '+' : '';
  const cls  = delta > 0 ? 'delta-up' : 'delta-down';
  return el('div', { class: `compare-delta ${cls}` }, `${sign}${formatCurrency(Math.abs(delta), true)}`);
}

// =========================================================
// Sección 3: Top 5 comercios del mes
// =========================================================

function _sectionTopMerchants(month) {
  const top = state.getTopMerchants(month, 5);

  if (top.length === 0) {
    return el('div', { class: 'report-section' },
      el('div', { class: 'report-section-title' }, 'Top comercios'),
      el('p', { style: { color: 'var(--text-muted)', fontSize: 'var(--text-sm)' } }, 'Sin datos'),
    );
  }

  const rows = top.map(({ merchant, total }, i) =>
    el('div', { class: 'top-merchant-row' },
      el('div', { class: 'top-merchant-rank' }, String(i + 1)),
      el('div', { class: 'top-merchant-name' }, merchant),
      el('div', { class: 'top-merchant-amount' }, formatCurrency(total)),
    )
  );

  return el('div', { class: 'report-section' },
    el('div', { class: 'report-section-title' }, `Top comercios — ${formatMonth(month)}`),
    ...rows,
  );
}
