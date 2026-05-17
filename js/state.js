// =========================================================
// State — store en memoria centralizado
// Todos los valores son leídos/escritos desde aquí.
// Las vistas solo leen; solo sheets.js escribe.
// =========================================================

/** @type {Transaction[]} */
export let transactions = [];

/** @type {Budget[]} */
export let budgets = [];

/** @type {Array} */
export let budgetHistory = [];

/** @type {Object.<string, number>} sheetName → numeric sheetId */
export let sheetMeta = {};

/** @type {Map<string, MerchantMapEntry>} merchant_norm → entrada cacheada */
export let merchantMap = new Map();

/** @type {Debt[]} */
export let debts = [];

/** Mes activo en formato 'YYYY-MM' */
export let currentMonth = _thisMonth();

// =========================================================
// Setters
// =========================================================

export function setTransactions(rows) { transactions = rows; }
export function setBudgets(rows)      { budgets = rows; }
export function setSheetMeta(meta)    { sheetMeta = meta; }
export function setBudgetHistory(rows) { budgetHistory = rows; }
export function setCurrentMonth(m)    { currentMonth = m; }
export function setMerchantMap(map)   { merchantMap = map; }
export function upsertMerchantMap(entry) {
  if (!entry?.merchantNorm) return;
  merchantMap.set(entry.merchantNorm, entry);
}
export function setDebts(rows)        { debts = rows; }

// =========================================================
// Queries derivadas — DEBTS
// =========================================================

/**
 * Agrupa las deudas por persona (normalizada en minúsculas para agrupar).
 * Solo cuenta las que tienen status === 'pending' para el total.
 * Filtro por estado opcional ('pending' | 'paid' | 'cancelled' | 'all').
 * @param {string} statusFilter
 * @returns {Array<{personKey: string, personLabel: string, items: Debt[], totalPending: number}>}
 */
export function getDebtsByPerson(statusFilter = 'pending') {
  const groups = new Map();
  for (const d of debts) {
    if (statusFilter !== 'all' && d.status !== statusFilter) continue;
    const key = (d.person || 'sin nombre').trim().toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, {
        personKey:    key,
        personLabel:  _titleCase(d.person || 'Sin nombre'),
        items:        [],
        totalPending: 0,
      });
    }
    const g = groups.get(key);
    g.items.push(d);
    if (d.status === 'pending') g.totalPending += d.amount;
  }
  // Ordenar items de cada persona por fecha desc
  for (const g of groups.values()) {
    g.items.sort((a, b) => b.dateCreated.localeCompare(a.dateCreated));
  }
  // Ordenar grupos por deuda pendiente desc
  return [...groups.values()].sort((a, b) => b.totalPending - a.totalPending);
}

/** Total pendiente de cobrar */
export function getTotalPendingDebts() {
  return debts
    .filter(d => d.status === 'pending')
    .reduce((s, d) => s + d.amount, 0);
}

function _titleCase(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/\b\p{L}/gu, c => c.toUpperCase());
}

/**
 * Devuelve los budget keys a usar para un mes dado.
 * - Mes actual → state.budgets (BUDGET_KEYS activos en vivo)
 * - Mes pasado con histórico → datos de budgetHistory para ese mes
 * - Mes pasado sin histórico → fallback a state.budgets
 */
export function getBudgetKeysForMonth(month) {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (month >= thisMonth) return budgets;
  const historyRows = budgetHistory.filter(r => r.month === month);
  if (historyRows.length === 0) return budgets;
  return historyRows.map(r => ({
    budgetKey:     r.budgetKey,
    type:          r.type,
    monthlyBudget: r.monthlyBudget,
    fixedAmount:   r.fixedAmount,
    dueDay:        r.dueDay,
  }));
}

// =========================================================
// Queries derivadas (sin caché — siempre calculan en fresco)
// =========================================================

/** Transacciones del mes indicado, orden inverso (más reciente primero) */
export function getTransactionsForMonth(month) {
  return transactions
    .filter(tx => tx.month === month)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Map de budgetKey → importe total gastado en el mes */
export function getSpendByCategory(month) {
  const map = new Map();
  for (const tx of transactions) {
    if (tx.month !== month) continue;
    map.set(tx.budgetKey, (map.get(tx.budgetKey) ?? 0) + tx.amount);
  }
  return map;
}

/** Gasto del mes para una categoría concreta (variable: cuánto se ha gastado) */
export function getSpendByMonthAndKey(month, budgetKey) {
  let total = 0;
  for (const tx of transactions) {
    if (tx.month === month && tx.budgetKey === budgetKey) total += tx.amount;
  }
  return total;
}

/** Gasto total del mes */
export function getTotalSpend(month) {
  return transactions
    .filter(tx => tx.month === month)
    .reduce((s, tx) => s + tx.amount, 0);
}

/** Gasto por día de la semana actual (lunes-domingo) */
export function getWeeklySpend() {
  const today = new Date();
  const monday = _startOfWeek(today);
  const days = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const iso = _toISODate(d);
    const total = transactions
      .filter(tx => tx.date === iso)
      .reduce((s, tx) => s + tx.amount, 0);
    days.push({ date: iso, label: _shortWeekDay(d), total });
  }
  return days;
}

/** Set de budgetKeys que son de tipo "Fijo" */
export function getFixedKeys() {
  return new Set(budgets.filter(b => b.type === 'Fijo').map(b => b.budgetKey));
}

/** Top N comercios del mes por importe total (solo gastos variables) */
export function getTopMerchants(month, n = 5) {
  const fixedKeys = getFixedKeys();
  const map = new Map();
  for (const tx of transactions) {
    if (tx.month !== month) continue;
    if (fixedKeys.has(tx.budgetKey)) continue;
    const key = tx.merchantNorm || 'Desconocido';
    map.set(key, (map.get(key) ?? 0) + tx.amount);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([merchant, total]) => ({ merchant, total }));
}

/** Totales por mes para los últimos N meses, separados en fijo y variable */
export function getMonthlyTotals(n = 6) {
  const fixedKeys = getFixedKeys();
  const months = [];
  const base = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    months.push(_toMonthKey(d));
  }
  return months.map(m => {
    let fixed = 0, variable = 0;
    for (const tx of transactions) {
      if (tx.month !== m) continue;
      if (fixedKeys.has(tx.budgetKey)) fixed += tx.amount;
      else variable += tx.amount;
    }
    return { month: m, fixed, variable, total: fixed + variable };
  });
}

/** Gasto por categoría del mes, separando fijo y variable para charts */
export function getSpendByCategoryGrouped(month) {
  const fixedKeys = getFixedKeys();
  const spendMap = getSpendByCategory(month);
  let fixedTotal = 0;
  const variableEntries = [];
  for (const [key, amount] of spendMap) {
    if (fixedKeys.has(key)) {
      fixedTotal += amount;
    } else {
      variableEntries.push([key, amount]);
    }
  }
  return { fixedTotal, variableEntries };
}

/** Mes anterior en formato 'YYYY-MM' */
export function getPrevMonth(month) {
  const [y, mo] = month.split('-').map(Number);
  const d = new Date(y, mo - 2, 1);
  return _toMonthKey(d);
}

/** Mes siguiente en formato 'YYYY-MM' */
export function getNextMonth(month) {
  const [y, mo] = month.split('-').map(Number);
  const d = new Date(y, mo, 1);
  return _toMonthKey(d);
}

/** Lista de meses presentes en las transacciones, ordenados desc */
export function getAvailableMonths() {
  const set = new Set(transactions.map(tx => tx.month));
  return [...set].sort((a, b) => b.localeCompare(a));
}

// =========================================================
// Helpers internos
// =========================================================

function _thisMonth() {
  return _toMonthKey(new Date());
}

function _toMonthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function _toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _startOfWeek(d) {
  const day = d.getDay(); // 0=dom
  const diff = (day === 0 ? -6 : 1 - day);
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday;
}

const SHORT_DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
function _shortWeekDay(d) {
  return SHORT_DAYS[(d.getDay() + 6) % 7]; // lunes=0
}
