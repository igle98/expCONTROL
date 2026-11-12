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

/** @type {Array<{name:string, type:string, status:string, target:number, targetDate:string, note:string}>} */
export let huchas = [];
/** ¿La pestaña HUCHAS existe ya en el Sheet? (si no, `huchas` son las de serie) */
export let huchasSaved = false;

/** @type {Array<{date:string, month:string, txId:string, source:string, amount:number, kind:string, note:string}>} */
export let funding = [];

/** @type {Array<{rowIndex:number, month:string, closedAt:string, summary:string}>} */
export let monthCloses = [];

/** Cuentas bancarias: [{ name, main, status, items:string[], note, rowIndex }] */
export let accounts = [];

/** Transferencias hechas entre cuentas: [{ month, date, from, to, amount, note, rowIndex }] */
export let transfers = [];

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
export function setHuchas(rows, saved) { huchas = rows; huchasSaved = saved; }
export function setFunding(rows)      { funding = rows; }
export function setMonthCloses(rows)  { monthCloses = rows; }
export function setAccounts(rows)     { accounts = rows; }
export function setTransfers(rows)    { transfers = rows; }
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

/**
 * Transacciones del mes, más reciente primero. Dentro del mismo día, la última
 * registrada primero (las filas se añaden al final del Sheet: mayor fila = más reciente).
 */
export function getTransactionsForMonth(month) {
  return transactions
    .filter(tx => tx.month === month)
    .sort((a, b) => b.date.localeCompare(a.date) || b.rowIndex - a.rowIndex);
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

/** Set de budgetKeys que son de tipo "Fijo" (incluye pausadas y archivadas) */
export function getFixedKeys() {
  return new Set(allBudgetKeys.filter(b => b.type === 'Fijo').map(b => b.budgetKey));
}

/** Set de budgetKeys de inversión (código INV): no cuentan como gasto */
export function getInvestmentKeys() {
  return new Set(allBudgetKeys.filter(b => isInvestmentCode(b.code)).map(b => b.budgetKey));
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

/**
 * Líneas del plan aplicable a `month` (incluye las especiales '@…').
 * Las reposiciones (@REPONER:…) son de su mes: no se arrastran a los siguientes.
 */
export function getPlanLinesForMonth(month) {
  const source = getPlanSourceMonth(month);
  if (!source) return [];
  return planLines.filter(l => l.month === source && (source === month || !l.budgetKey.startsWith(REFILL_PREFIX)));
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

// =========================================================
// Huchas y cobertura de gastos (FUNDING)
// =========================================================
// Convenciones de FUNDING (importes siempre positivos):
//   source 'HUCHA:<n>' + kind 'aportacion' → entra dinero en la hucha
//   source 'HUCHA:<n>' + kind 'retirada'   → sale para pagar el gasto tx_id
//   source 'HUCHA:<n>' + kind 'ajuste'     → saldo inicial/corrección (puede ser negativo)
//   source 'HUCHA:<n>' + kind 'descarte'   → reposición pendiente descartada (no cambia el saldo)
//   source 'IMPREVISTOS' | 'SIN_ASIGNAR' | 'CAT:<key>' + kind 'cobertura' → cubre parte del gasto tx_id

export const HUCHA_PREFIX = '@HUCHA:';
/** Línea del plan para reponer a una hucha lo que se sacó para tapar excesos */
export const REFILL_PREFIX = '@REPONER:';

/** Saldo actual de una hucha */
export function getHuchaBalance(name) {
  const src = `HUCHA:${name}`;
  let balance = 0;
  for (const f of funding) {
    if (f.source !== src) continue;
    if (f.kind === 'descarte') continue;
    if (f.kind === 'retirada') balance -= f.amount;
    else balance += f.amount;          // aportacion, ajuste
  }
  return Math.round(balance * 100) / 100;
}

/** Aportación prevista en el plan del mes para una hucha (normal + reposición) */
export function getHuchaPlanned(month, name) {
  return getPlanLinesForMonth(month)
    .filter(l => l.budgetKey === `${HUCHA_PREFIX}${name}` || l.budgetKey === `${REFILL_PREFIX}${name}`)
    .reduce((s, l) => s + l.amount, 0);
}

/**
 * ¿Esta retirada hay que reponerla? Sí cuando la hucha pagó un gasto de una categoría
 * que NO está vinculada a ella (p. ej. FONDO EMERGENCIA tapando un exceso de SUPERMERCADO).
 * Pagar regalos con NAVIDADES es su uso normal y no se repone.
 */
export function isRefillWithdrawal(f) {
  if (f.kind !== 'retirada' || !f.txId || !f.source.startsWith('HUCHA:')) return false;
  const tx = transactions.find(t => t.txId === f.txId);
  if (!tx) return false;
  const hucha = huchas.find(h => h.name === f.source.slice(6));
  return !hucha?.categories?.includes(tx.budgetKey);
}

/**
 * Lo que queda por reponer a una hucha con movimientos anteriores a `beforeMonth`.
 * Orden cronológico: cada retirada "de emergencia" suma; cualquier aportación posterior resta.
 * @returns {{amount:number, months:string[]}} months = meses de las retiradas aún sin reponer
 */
export function getHuchaRefillDue(name, beforeMonth) {
  const src = `HUCHA:${name}`;
  const moves = funding
    .filter(f => f.source === src && f.month < beforeMonth && ['aportacion', 'retirada', 'ajuste', 'descarte'].includes(f.kind))
    .sort((a, b) => (a.date || `${a.month}-01`).localeCompare(b.date || `${b.month}-01`));
  let due = 0;
  let months = [];
  let categories = [];      // categorías de los gastos que provocan la reposición (para explicarla)
  for (const f of moves) {
    // Repone: cualquier aportación, un ajuste de saldo al alza o descartarla a mano
    if (f.kind === 'aportacion' || f.kind === 'descarte' || (f.kind === 'ajuste' && f.amount > 0)) {
      due = Math.max(0, due - f.amount);
      if (due < 0.005) { due = 0; months = []; categories = []; }
    } else if (isRefillWithdrawal(f)) {
      due += f.amount;
      if (!months.includes(f.month)) months.push(f.month);
      const key = transactions.find(t => t.txId === f.txId)?.budgetKey;
      if (key && !categories.includes(key)) categories.push(key);
    }
  }
  return { amount: Math.round(due * 100) / 100, months, categories };
}

/** Huchas activas con algo pendiente de reponer antes de `beforeMonth` */
export function getRefillsDue(beforeMonth) {
  return huchas.filter(h => h.status === 'active')
    .map(h => ({ name: h.name, ...getHuchaRefillDue(h.name, beforeMonth) }))
    .filter(r => r.amount > 0);
}

/** Aportación ya registrada (hecha) en el mes para una hucha */
export function getHuchaContributed(month, name) {
  return funding
    .filter(f => f.month === month && f.source === `HUCHA:${name}` && f.kind === 'aportacion')
    .reduce((s, f) => s + f.amount, 0);
}

/** Movimientos de una hucha, más reciente primero */
export function getHuchaMoves(name) {
  return funding.filter(f => f.source === `HUCHA:${name}`)
    .sort((a, b) => (b.date || b.month).localeCompare(a.date || a.month));
}

/** Coberturas (incluidas retiradas de hucha) de un gasto */
export function getTxCoverage(txId) {
  return funding.filter(f => f.txId === txId && (f.kind === 'cobertura' || f.kind === 'retirada'));
}

/**
 * Situación de una categoría en un mes. Distingue tres cosas:
 *  - gastado: todo lo gastado (lo que cuentan estadísticas y gráficas)
 *  - deHucha: la parte pagada con huchas (dinero apartado en meses anteriores)
 *  - consumido = gastado − deHucha: lo que sale de los ingresos de este mes
 * y el presupuesto del mes:
 *  - inicial (plan) · ajustado = inicial + dinero del mes recibido (colchón, sin asignar,
 *    otras categorías) − lo cedido a otras categorías. Las huchas NO amplían el presupuesto.
 *  - disponible = ajustado − consumido
 */
export function getCategoryStatus(month, budgetKey) {
  const inicial = getPlanLinesForMonth(month).find(l => l.budgetKey === budgetKey)?.amount ?? 0;
  const txIds = new Set(transactions.filter(t => t.month === month && t.budgetKey === budgetKey).map(t => t.txId));
  let received = 0, given = 0, deHucha = 0;
  const sources = new Map();       // dinero del mes recibido, por fuente
  const huchaSources = new Map();  // pagado con huchas, por hucha
  for (const f of funding) {
    if (f.month !== month) continue;
    if (f.kind === 'cobertura' && f.source === `CAT:${budgetKey}`) given += f.amount;
    if (!f.txId || !txIds.has(f.txId)) continue;
    if (f.kind === 'retirada') {
      deHucha += f.amount;
      huchaSources.set(f.source, (huchaSources.get(f.source) ?? 0) + f.amount);
    } else if (f.kind === 'cobertura') {
      received += f.amount;
      sources.set(f.source, (sources.get(f.source) ?? 0) + f.amount);
    }
  }
  const gastado   = getSpendByMonthAndKey(month, budgetKey);
  const consumido = gastado - deHucha;
  const ajustado  = inicial + received - given;
  return { inicial, ajustado, gastado, deHucha, consumido, disponible: ajustado - consumido,
           received, given, sources, huchaSources };
}

/** Huchas activas vinculadas a una categoría de gasto */
export function getHuchasForCategory(budgetKey) {
  return huchas.filter(h => h.status === 'active' && h.categories?.includes(budgetKey));
}

/** Colchón de imprevistos del mes: previsto, usado y lo que queda */
export function getReserveStatus(month) {
  const planned = getPlanLinesForMonth(month).find(l => l.budgetKey === '@IMPREVISTOS')?.amount ?? 0;
  const used = funding
    .filter(f => f.month === month && f.kind === 'cobertura' && f.source === 'IMPREVISTOS')
    .reduce((s, f) => s + f.amount, 0);
  return { planned, used, remaining: planned - used };
}

/** Dinero del mes sin asignar: ingresos − presupuestado − lo ya usado para cubrir gastos */
export function getUnassigned(month) {
  const income = getIncomeForMonth(month).reduce((s, l) => s + l.amount, 0);
  const used = funding
    .filter(f => f.month === month && f.kind === 'cobertura' && f.source === 'SIN_ASIGNAR')
    .reduce((s, f) => s + f.amount, 0);
  return income - getPlannedTotal(month) - used;
}

/** Última hucha usada para pagar gastos de una categoría (para preseleccionarla) */
export function getLastHuchaForCategory(budgetKey) {
  const txIds = new Set(transactions.filter(t => t.budgetKey === budgetKey).map(t => t.txId));
  const last = funding
    .filter(f => f.kind === 'retirada' && f.source.startsWith('HUCHA:') && txIds.has(f.txId))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return last ? last.source.slice('HUCHA:'.length) : null;
}

/** Cierre del mes (o null si está abierto) */
export function getMonthClose(month) {
  return monthCloses.find(c => c.month === month) ?? null;
}

/**
 * Resumen de cierre de un mes: categorías (previsto vs consumido), déficits pendientes,
 * huchas (aportaciones y retiradas), sobrantes y transferencia neta a la cuenta de ahorro.
 */
export function getMonthSummary(month) {
  const invKeys = getInvestmentKeys();
  const planned = new Map(getPlanLinesForMonth(month)
    .filter(l => !l.budgetKey.startsWith('@')).map(l => [l.budgetKey, l.amount]));
  const keys = new Set([...planned.keys(), ...getSpendByCategory(month).keys()]);

  const categories = [...keys].filter(k => !invKeys.has(k)).map(key => {
    const st = getCategoryStatus(month, key);
    return {
      budgetKey: key, planned: planned.has(key), inicial: st.inicial, ajustado: st.ajustado,
      gastado: st.gastado, deHucha: st.deHucha, consumido: st.consumido,
      pendiente: Math.max(0, -st.disponible), sobrante: Math.max(0, st.disponible),
    };
  }).filter(c => c.inicial > 0 || c.gastado > 0)
    .sort((a, b) => (b.consumido - b.ajustado) - (a.consumido - a.ajustado));

  const income = getIncomeForMonth(month).reduce((s, l) => s + l.amount, 0);
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const moves = funding.filter(f => f.month === month && f.source.startsWith('HUCHA:'));

  const huchaNames = new Set(getPlanLinesForMonth(month)
    .filter(l => l.budgetKey.startsWith(HUCHA_PREFIX) || l.budgetKey.startsWith(REFILL_PREFIX))
    .map(l => l.budgetKey.slice(l.budgetKey.indexOf(':') + 1)));
  const huchaPlanned = [...huchaNames].map(name =>
    ({ name, planned: getHuchaPlanned(month, name), done: getHuchaContributed(month, name) }));

  const aportaciones = sum(moves.filter(f => f.kind === 'aportacion'), f => f.amount);
  const retiradas    = sum(moves.filter(f => f.kind === 'retirada'), f => f.amount);

  return {
    month,
    income,
    plannedTotal: getPlannedTotal(month),
    categories,
    inicialTotal:   sum(categories, c => c.inicial),
    consumidoTotal: sum(categories, c => c.consumido),
    gastadoTotal:   sum(categories, c => c.gastado),
    pendienteTotal: sum(categories, c => c.pendiente),
    invested:       getInvestedTotal(month),
    reserve:        getReserveStatus(month),
    unassigned:     getUnassigned(month),
    savingsFree:    getPlanSpecial(month, '@AHORRO'),
    huchaPlanned,
    aportaciones,
    retiradas,
    retiradasPorHucha: [...moves.filter(f => f.kind === 'retirada')
      .reduce((m, f) => m.set(f.source.slice(6), (m.get(f.source.slice(6)) ?? 0) + f.amount), new Map())],
  };
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

// =========================================================
// Cuentas bancarias y transferencias del mes
// =========================================================
// Cada cuenta (no principal) guarda en `items` lo que vive en ella:
//   'CAT:<budget_key>'  categoría de gasto o inversión que se paga desde ella
//   'HUCHA:<nombre>'    hucha cuyo dinero está en ella (incluye su reposición)
//   'INC:<income_key>'  ingreso que entra en ella
//   '@AHORRO' | '@IMPREVISTOS'
// Lo que no esté en ninguna vive en la cuenta principal.

/** Clave de cuenta para una línea del plan */
export function planItemKey(budgetKey) {
  if (budgetKey.startsWith(HUCHA_PREFIX))  return `HUCHA:${budgetKey.slice(HUCHA_PREFIX.length)}`;
  if (budgetKey.startsWith(REFILL_PREFIX)) return `HUCHA:${budgetKey.slice(REFILL_PREFIX.length)}`;
  if (budgetKey.startsWith('@')) return budgetKey;
  return `CAT:${budgetKey}`;
}

export function getActiveAccounts() {
  return accounts.filter(a => a.status === 'active');
}

/** Cuenta principal: la marcada o, si no hay ninguna marcada, la primera activa */
export function getMainAccount() {
  const act = getActiveAccounts();
  return act.find(a => a.main) ?? act[0] ?? null;
}

/** Nombre de la cuenta donde vive un item (o null si no hay cuentas) */
export function getAccountOf(item) {
  const main = getMainAccount();
  if (!main) return null;
  return getActiveAccounts().find(a => !a.main && a !== main && a.items.includes(item))?.name ?? main.name;
}

/**
 * Lo que necesita y lo que recibe cada cuenta en un mes, según el presupuesto.
 * @returns {Array<{name, main, needs:Array<{key,amount}>, inflows:Array<{key,amount}>, need, inflow}>}
 */
export function getAccountBudget(month) {
  const main = getMainAccount();
  const map = new Map(getActiveAccounts().map(a => [a.name,
    { name: a.name, main: a === main, needs: [], inflows: [], need: 0, inflow: 0 }]));
  if (map.size === 0) return [];
  for (const l of getPlanLinesForMonth(month)) {
    if (!(l.amount > 0)) continue;
    const acc = map.get(getAccountOf(planItemKey(l.budgetKey)));
    acc.needs.push({ key: l.budgetKey, amount: l.amount });
    acc.need += l.amount;
  }
  for (const l of getIncomeForMonth(month)) {
    if (!(l.amount > 0)) continue;
    const acc = map.get(getAccountOf(`INC:${l.incomeKey}`));
    acc.inflows.push({ key: l.incomeKey, amount: l.amount });
    acc.inflow += l.amount;
  }
  return [...map.values()];
}

/**
 * Transferencias para dejar cada cuenta con lo que necesita su parte del presupuesto.
 * Las cuentas a las que les sobra (p. ej. donde entra un ingreso) pagan primero a las
 * que les falta; el resto lo pone la principal. Lo que sobre en una cuenta secundaria
 * se propone pasarlo a la principal.
 * @returns {{ list: Array<{from,to,amount,done,pending,leftover?:boolean}>, short:number, accounts:Array }}
 */
export function getTransferPlan(month) {
  const accs = getAccountBudget(month);
  if (accs.length < 2) return { list: [], short: 0, accounts: accs };
  const r2 = n => Math.round(n * 100) / 100;
  const bal = accs.map(a => ({ name: a.name, main: a.main, net: r2(a.inflow - a.need) }));
  // Lo ya transferido este mes cuenta como hecho: solo se reparte lo que falta
  // (así, si cambias el presupuesto después, no se proponen otra vez las mismas transferencias)
  const done = transfers.filter(x => x.month === month);
  for (const x of done) {
    const from = bal.find(b => b.name === x.from);
    const to   = bal.find(b => b.name === x.to);
    if (from) from.net = r2(from.net - x.amount);
    if (to)   to.net   = r2(to.net + x.amount);
  }
  const deficits = bal.filter(b => b.net < -0.004).sort((a, b) => a.net - b.net);
  const surplus  = bal.filter(b => b.net > 0.004)
    .sort((a, b) => Number(a.main) - Number(b.main) || b.net - a.net);   // secundarias primero
  const list = [];
  const push = (from, to, amount, extra = {}) => {
    const t = list.find(x => x.from === from && x.to === to);
    if (t) t.amount = r2(t.amount + amount); else list.push({ from, to, amount: r2(amount), ...extra });
  };
  let short = 0;
  for (const d of deficits) {
    let need = -d.net;
    for (const s of surplus) {
      if (need < 0.005) break;
      if (s.net < 0.005) continue;
      const amount = Math.min(need, s.net);
      push(s.name, d.name, amount);
      s.net = r2(s.net - amount);
      need = r2(need - amount);
    }
    short += need;
  }
  const main = bal.find(b => b.main);
  for (const s of surplus) {
    if (!s.main && s.net > 0.004 && main) push(s.name, main.name, s.net, { leftover: true });
  }
  // list = lo que falta por mover; se le suman las ya hechas del mismo par para enseñarlas
  for (const t of list) { t.pending = t.amount; t.done = 0; }
  for (const x of done) {
    const t = list.find(y => y.from === x.from && y.to === x.to);
    if (t) { t.done = r2(t.done + x.amount); t.amount = r2(t.amount + x.amount); }
    else list.push({ from: x.from, to: x.to, amount: x.amount, done: x.amount, pending: 0 });
  }
  for (const t of list) {           // fusiona los hechos repetidos del mismo par
    const first = list.find(y => y.from === t.from && y.to === t.to);
    if (first !== t) { first.amount = r2(first.amount + t.amount); first.done = r2(first.done + t.done); t.dup = true; }
  }
  return { list: list.filter(t => !t.dup), short: r2(short), accounts: accs };
}

