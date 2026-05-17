// =========================================================
// Formateadores de datos para visualización
// =========================================================

const CURRENCY_FMT = new Intl.NumberFormat('es-ES', {
  style:    'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const CURRENCY_COMPACT_FMT = new Intl.NumberFormat('es-ES', {
  style:    'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Formatea importe como moneda: "1.234,56 €"
 * @param {number} amount
 * @param {boolean} [compact=false]  Sin decimales si es >= 1000
 */
export function formatCurrency(amount, compact = false) {
  if (compact && Math.abs(amount) >= 1000) {
    return CURRENCY_COMPACT_FMT.format(amount);
  }
  return CURRENCY_FMT.format(amount);
}

/**
 * Fecha corta: "15 mar" (para lista de transacciones)
 * @param {string} isoDate  'YYYY-MM-DD'
 */
export function formatDateShort(isoDate) {
  if (!isoDate) return '';
  const d = _parseISO(isoDate);
  if (!d) return isoDate;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

/**
 * Fecha larga: "lunes, 15 de marzo de 2026"
 * @param {string} isoDate
 */
export function formatDateLong(isoDate) {
  if (!isoDate) return '';
  const d = _parseISO(isoDate);
  if (!d) return isoDate;
  return d.toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

/**
 * Mes legible: "marzo 2026"
 * @param {string} monthKey  'YYYY-MM'
 */
export function formatMonth(monthKey) {
  if (!monthKey) return '';
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
}

/**
 * Mes corto: "mar. 2026"
 * @param {string} monthKey  'YYYY-MM'
 */
export function formatMonthShort(monthKey) {
  if (!monthKey) return '';
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' });
}

/**
 * Porcentaje: 73
 * @param {number} value
 * @param {number} total
 * @returns {number}
 */
export function calcPercent(value, total) {
  if (!total || total === 0) return 0;
  return Math.round((value / total) * 100);
}

// =========================================================
// Helpers
// =========================================================

/** Parsea 'YYYY-MM-DD' a Date evitando desfase de timezone */
function _parseISO(isoDate) {
  const parts = isoDate.split('-').map(Number);
  if (parts.length < 3) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}
