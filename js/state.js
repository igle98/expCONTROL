// =========================================================
// State — store en memoria centralizado
// Todos los valores son leídos/escritos desde aquí.
// Las vistas solo leen; solo sheets.js escribe.
// =========================================================

import { isInvestmentCode } from './utils/categoryCodes.js';

/** @type {Transaction[]} */
export let transactions = [];

/** @type {Budget[]} */
export let budgets = [];

/** @type {Array} Todas las categorías de BUDGET_KEYS (activas, pausadas y archivadas) */
export let allBudgetKeys = [];

/**
 * Formato del catálogo en el Sheet:
 * 'legacy' = antes de la migración v2 (importes en BUDGET_KEYS) · 'v2' = importes en PLAN_LINES
 */
export let catalogFormat = 'legacy';

/** @type {Array<{rowIndex:number, month:string, budgetKey:string, amount:number, note:string}>} */
export let planLines = [];

/** @type {Array<{incomeKey:string, status:string}>} Categorías de ingreso */
export let incomeKeys = [];

/** @type {Array<{rowIndex:number, month:string, incomeKey:string, amount:number, note:string}>} */
export let incomeLines = [];

/** @type {Array} */
export let budgetHistory = [];

/** @type {Object.<string, number>} sheetName → numeric sheetId */
export let sheetMeta = {};

/** @type {Map<string, MerchantMapEntry>} merchant_norm → entrada cacheada */
export let merchantMap = new Map();

/** @type {Debt[]} */
export let debts = [];

/** @type {FutureItem[]} */
export let futureItems = [];

/** Mes activo en formato 'YYYY-MM' */
export let currentMonth = _thisMonth();

// =========================================================
// Setters
// =========================================================

export function setTransactions(rows) { transactions = rows; }
export function setBudgets(rows)      { budgets = rows; }
export function setAllBudgetKeys(rows, format = 'legacy') {
  allBudgetKeys = rows;
  catalogFormat = format;
  _rebuildBudgets();
}
export function setPlanLines(rows)    { planLines = rows; _rebuildBudgets(); }
export function setIncome(keys, lines) { incomeKeys = keys; incomeLines = lines; }
export function setSheetMeta(meta)    { sheetMeta = meta; }
export function setBudgetHistory(rows) { budgetHistory = rows; }
export function setCurrentMonth(m)    { currentMonth = m; }
export function setMerchantMap(map)   { merchantMap = map; }
export function upsertMerchantMap(entry) {
  if (!entry?.merchantNorm) return;
  merchantMap.set(entry.merchantNorm, entry);
}
export function setDebts(rows)        { debts = rows; }
export function setFutureItems(rows)  { futureItems = rows; }

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

// =========================================================
// Queries derivadas — FUTURE (compras y pagos futuros)
// =========================================================

/** Estados que siguen "vivos" (aún no comprados ni cancelados) */
export const FUTURE_OPEN_STATUSES = ['wanted', 'committed'];

const _PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

/**
 * Agrupa las compras futuras por mes ('YYYY-MM'), en orden cronológico.
 * Dentro de cada mes: prioridad (alta → baja) y luego fecha.
 * @param {string} statusFilter  'open' | 'wanted' | 'committed' | 'bought' | 'cancelled' | 'all'
 * @returns {Array<{month: string, items: FutureItem[], total: number}>}
 */
export function getFutureByMonth(statusFilter = 'open') {
  const groups = new Map();
  for (const f of futureItems) {
    if (statusFilter === 'open' && !FUTURE_OPEN_STATUSES.includes(f.status)) continue;
    if (statusFilter !== 'open' && statusFilter !== 'all' && f.status !== statusFilter) continue;
    const month = f.date.slice(0, 7);
    if (!groups.has(month)) groups.set(month, { month, items: [], total: 0 });
    const g = groups.get(month);
    g.items.push(f);
    g.total += f.amount;
  }
  for (const g of groups.values()) {
    g.items.sort((a, b) =>
      (_PRIORITY_ORDER[a.priority] ?? 1) - (_PRIORITY_ORDER[b.priority] ?? 1)
      || a.date.localeCompare(b.date));
  }
  // Sin fecha ('') va al final
  return [...groups.values()].sort((a, b) =>
    (a.month || '9999').localeCompare(b.month || '9999'));
}

/** Totales previstos: todo lo pendiente y solo lo comprometido */
export function getFutureTotals() {
  let open = 0, committed = 0;
  for (const f of futureItems) {
    if (!FUTURE_OPEN_STATUSES.includes(f.status)) continue;
    open += f.amount;
    if (f.status === 'committed') committed += f.amount;
  }
  return { open, committed };
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
  if (catalogFormat === 'v2') return _budgetsFromPlan(month);
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

/** Gasto total del mes (sin inversiones) */
export function getTotalSpend(month) {
  const invKeys = getInvestmentKeys();
  return transactions
    .filter(tx => tx.month === month && !invKeys.has(tx.budgetKey))
    .reduce((s, tx) => s + tx.amount, 0);
}

/** Total invertido en un mes, o en todos los meses que empiecen por `prefix` (p.ej. '2026') */
export function getInvestedTotal(prefix) {
  const invKeys = getInvestmentKeys();
  return transactions
    .filter(tx => tx.month.startsWith(prefix) && invKeys.has(tx.budgetKey))
    .reduce((s, tx) => s + tx.amount, 0);
}

/** Gasto por día de la semana actual (lunes-domingo) */
export function getWeeklySpend() {
  const today = new Date();
  const monday = _startOfWeek(today);
  const invKeys = getInvestmentKeys();
  const days = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const iso = _toISODate(d);
    const total = transactions
      .filter(tx => tx.date === iso && !invKeys.has(tx.budgetKey))
      .reduce((s, tx) => s + tx.amount, 0);
    days.push({ date: iso, label: _shortWeekDay(d), total });
  }
  return days;
}

/** Set de budgetKeys que son de tipo "Fijo" (incluye pausadas y archivadas) */
export function getFixedKeys() {
  return new Set(allBudgetKeys.filter(b => b.type === 'Fijo').map(b => b.budgetKey));
}

/** Set de budgetKeys de inversión (código INV): no cuentan como gasto */
export function getInvestmentKeys() {
  return new Set(allBudgetKeys.filter(b => isInvestmentCode(b.code)).map(b => b.budgetKey));
}

/** Top N comercios del mes por importe total (solo gastos variables) */
export function getTopMerchants(month, n = 5) {
  const fixedKeys = getFixedKeys();
  const map = new Map();
  for (const tx of transactions) {
    if (tx.month !== month) continue;
    if (fixedKeys.has(tx.budgetKey)) continue;   // incluye inversiones
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
  const invKeys   = getInvestmentKeys();
  const months = [];
  const base = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    months.push(_toMonthKey(d));
  }
  return months.map(m => {
    let fixed = 0, variable = 0;
    for (const tx of transactions) {
      if (tx.month !== m || invKeys.has(tx.budgetKey)) continue;
      if (fixedKeys.has(tx.budgetKey)) fixed += tx.amount;
      else variable += tx.amount;
    }
    return { month: m, fixed, variable, total: fixed + variable };
  });
}

/** Gasto por categoría del mes, separando fijo y variable para charts */
export function getSpendByCategoryGrouped(month) {
  const fixedKeys = getFixedKeys();
  const invKeys   = getInvestmentKeys();
  const spendMap = getSpendByCategory(month);
  let fixedTotal = 0;
  const variableEntries = [];
  for (const [key, amount] of spendMap) {
    if (invKeys.has(key)) continue;
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
// Plan mensual (catálogo v2)
// =========================================================

/**
 * Mes cuyo plan aplica a `month`: el propio si tiene líneas; si no, el último
 * mes anterior con plan (el presupuesto "se arrastra" hasta que se cambie).
 * @returns {string|null}
 */
export function getPlanSourceMonth(month) {
  let best = null;
  for (const l of planLines) {
    if (l.month <= month && (best === null || l.month > best)) best = l.month;
  }
  return best;
}

/** Líneas del plan aplicable a `month` (incluye las especiales '@…') */
export function getPlanLinesForMonth(month) {
  const source = getPlanSourceMonth(month);
  return source ? planLines.filter(l => l.month === source) : [];
}

/** Ingresos registrados en el propio mes */
export function getIncomeForMonth(month) {
  return incomeLines.filter(l => l.month === month);
}

/** Último mes anterior a `month` con ingresos (para proponerlos de nuevo), o null */
export function getPrevIncomeMonth(month) {
  let best = null;
  for (const l of incomeLines) {
    if (l.month < month && (best === null || l.month > best)) best = l.month;
  }
  return best;
}

/** Total presupuestado del mes (todas las líneas del plan, incluidas las especiales) */
export function getPlannedTotal(month) {
  return getPlanLinesForMonth(month).reduce((s, l) => s + l.amount, 0);
}

/** Importe de una línea especial del plan (p.ej. '@IMPREVISTOS') para el mes */
export function getPlanSpecial(month, key) {
  return getPlanLinesForMonth(month).find(l => l.budgetKey === key)?.amount ?? 0;
}

/** Presupuestos del mes en el formato que esperan las vistas */
function _budgetsFromPlan(month) {
  const catalog = new Map(allBudgetKeys.map(c => [c.budgetKey, c]));
  return getPlanLinesForMonth(month)
    .filter(l => !l.budgetKey.startsWith('@'))
    .map(l => _withAmount(catalog.get(l.budgetKey) ?? { budgetKey: l.budgetKey, type: 'Variable', code: '' }, l.amount));
}

function _withAmount(cat, amount) {
  const fixed = cat.type === 'Fijo';
  return {
    budgetKey:     cat.budgetKey,
    code:          cat.code,
    type:          cat.type,
    monthlyBudget: fixed ? 0 : amount,
    fixedAmount:   fixed ? amount : 0,
    dueDay:        cat.dueDay ?? 0,
  };
}

/**
 * state.budgets = categorías activas (las que se ofrecen al clasificar), con
 * el importe del plan del mes en curso o 0 si no están presupuestadas.
 */
function _rebuildBudgets() {
  if (catalogFormat !== 'v2') {
    budgets = allBudgetKeys.filter(b => b.active).map(({ active, ...b }) => b);
    return;
  }
  const amounts = new Map(getPlanLinesForMonth(_thisMonth()).map(l => [l.budgetKey, l.amount]));
  budgets = allBudgetKeys
    .filter(c => c.status === 'active')
    .map(c => _withAmount(c, amounts.get(c.budgetKey) ?? 0));
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
