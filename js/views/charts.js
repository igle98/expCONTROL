import * as state from '../state.js';
import * as debts from './debts.js';
import * as future from './future.js';
import { getCategoryColor } from '../utils/colors.js';
import { formatCurrency, formatMonthShort } from '../utils/formatters.js';

let _barChart    = null;
let _donutChart  = null;

// =========================================================
// Render
// =========================================================

export function render() {
  if (!_chartJsReady()) {
    console.warn('[charts] Chart.js no está disponible todavía.');
  } else {
    _renderBarChart();
    _renderDonutChart();
  }
  // Secciones "Me deben" y "Compras futuras" al final
  debts.render();
  future.render();
}

// =========================================================
// Gráfica de barras — evolución mensual (6 meses) fijo/variable
// =========================================================

function _renderBarChart() {
  const canvas = document.getElementById('chart-bar');
  if (!canvas) return;

  const data   = state.getMonthlyTotals(6);
  const labels = data.map(d => formatMonthShort(d.month));

  if (_barChart) { _barChart.destroy(); _barChart = null; }

  _barChart = new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label:           'Variable',
          data:            data.map(d => d.variable),
          backgroundColor: 'rgba(108, 143, 255, 0.75)',
          borderColor:     'rgba(108, 143, 255, 0.9)',
          borderWidth:     1,
          borderRadius:    { topLeft: 0, topRight: 0, bottomLeft: 6, bottomRight: 6 },
          borderSkipped:   false,
        },
        {
          label:           'Fijo',
          data:            data.map(d => d.fixed),
          backgroundColor: 'rgba(156, 136, 255, 0.55)',
          borderColor:     'rgba(156, 136, 255, 0.8)',
          borderWidth:     1,
          borderRadius:    { topLeft: 6, topRight: 6, bottomLeft: 0, bottomRight: 0 },
          borderSkipped:   false,
        },
      ],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display:  true,
          position: 'top',
          labels: { color: '#9ba3c0', font: { size: 11 }, boxWidth: 12, padding: 12, usePointStyle: true },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          grid:    { color: 'rgba(255,255,255,0.05)' },
          ticks:   { color: '#9ba3c0', font: { size: 11 } },
          border:  { color: 'rgba(255,255,255,0.07)' },
        },
        y: {
          stacked: true,
          grid:    { color: 'rgba(255,255,255,0.05)' },
          ticks:   { color: '#9ba3c0', font: { size: 11 }, callback: (v) => formatCurrency(v, true) },
          border:  { color: 'rgba(255,255,255,0.07)' },
        },
      },
    },
  });
}

// =========================================================
// Gráfica de dona — distribución por categoría
// Agrupa todos los gastos fijos en una sola porción
// =========================================================

function _renderDonutChart() {
  const canvas = document.getElementById('chart-donut');
  if (!canvas) return;

  const { fixedTotal, variableEntries } = state.getSpendByCategoryGrouped(state.currentMonth);

  if (_donutChart) { _donutChart.destroy(); _donutChart = null; }

  const entries = variableEntries.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0 && fixedTotal === 0) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const labels = entries.map(([k]) => k);
  const values = entries.map(([, v]) => v);
  const colors = labels.map(k => getCategoryColor(k));

  // Agregar fijos como un solo grupo
  if (fixedTotal > 0) {
    labels.push('Gastos Fijos');
    values.push(fixedTotal);
    colors.push('hsl(260, 50%, 58%)');
  }

  _donutChart = new window.Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data:            values,
        backgroundColor: colors.map(c => c.replace('58%)', '52%, 0.85)')),
        borderColor:     colors.map(c => c.replace('58%)', '58%, 0.6)')),
        borderWidth:     1,
        hoverOffset:     6,
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      cutout:              '65%',
      plugins: {
        legend: {
          display:  true,
          position: 'bottom',
          labels: {
            color:     '#9ba3c0',
            font:      { size: 11 },
            boxWidth:  12,
            padding:   12,
            usePointStyle: true,
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((s, v) => s + v, 0);
              const pct   = Math.round((ctx.parsed / total) * 100);
              return ` ${formatCurrency(ctx.parsed)} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

// =========================================================
// Helpers
// =========================================================

function _chartJsReady() {
  return typeof window !== 'undefined' && window.Chart;
}
