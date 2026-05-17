// =========================================================
// parser.js — texto libre → {amount, merchant_raw, date, ...}
// Reproduce el nodo "Info transacción texto" del workflow n8n.
// =========================================================

const MONTHS = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
};

const DATE_TEXT_RE = /(\d{1,2})\s*(de)?\s*(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/;

/**
 * @param {string} text — p.ej. "12.50 mercadona ayer" o "5 cafe 7 de febrero"
 * @returns {{amount:number, currency:string, date:string, merchant_raw:string, description:string, source:string}}
 * @throws Error si el formato es inválido
 */
export function parseExpense(text) {
  const rawText = String(text || '').trim();
  const parts = rawText.split(/\s+/).filter(Boolean);

  // 1) Amount
  const amountRaw = parts.shift();
  if (!amountRaw) throw new Error('Formato incorrecto. Usa: 12.50 Mercadona [fecha opcional]');
  const amount = Math.round(parseFloat(amountRaw.replace(',', '.')) * 100) / 100;
  if (isNaN(amount)) {
    throw new Error('Formato incorrecto. Usa: 12.50 Mercadona [fecha opcional]');
  }

  // 2) Fecha
  let date = new Date();
  const fullText = parts.join(' ').toLowerCase();

  if (fullText.includes('ayer')) {
    date.setDate(date.getDate() - 1);
    const idx = parts.findIndex(p => p.toLowerCase() === 'ayer');
    if (idx !== -1) parts.splice(idx, 1);
  }

  const matchText = parts.join(' ').toLowerCase().match(DATE_TEXT_RE);
  if (matchText) {
    const day = parseInt(matchText[1], 10);
    const month = MONTHS[matchText[3]];
    const year = new Date().getFullYear();
    date = new Date(year, month, day);

    // Quitar la subcadena de fecha del merchant
    const joined = parts.join(' ');
    const cleaned = joined.replace(matchText[0], '').replace(/\s+/g, ' ').trim();
    parts.length = 0;
    if (cleaned) parts.push(...cleaned.split(/\s+/));
  }

  // 3) Merchant
  const merchant_raw = parts.join(' ').replace(/ayer/gi, '').trim();
  if (!merchant_raw) throw new Error('Debes indicar un comercio.');

  return {
    amount,
    currency:     'EUR',
    date:         _toISODate(date),
    merchant_raw,
    description:  merchant_raw,
    source:       'pwa',
  };
}

function _toISODate(d) {
  // Local-date ISO (no UTC drift)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
