// =========================================================
// normalizer.js — limpia el nombre del comercio para matching.
// Reproduce el nodo "Normalización del merchan" del workflow n8n.
// =========================================================

/**
 * @param {string} raw — p.ej. "Panadería La Mejor, S.L."
 * @returns {{merchant_norm:string, merchant_base:string}}
 */
export function normalizeMerchant(raw) {
  const merchant_norm = _normalize(raw);

  let base = merchant_norm;
  base = _reduceTicketNoise(base);
  base = _stripLegalSuffixes(base);

  return {
    merchant_norm,
    merchant_base: base || merchant_norm,
  };
}

function _normalize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function _stripLegalSuffixes(text) {
  let t = (text || '').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  const suffixes = ['s a u', 'sau', 's a', 'sa', 's l u', 'slu', 's l', 'sl'];

  for (let i = 0; i < 3; i++) {
    for (const s of suffixes) {
      if (t.endsWith(' ' + s)) t = t.slice(0, -(s.length + 1)).trim();
      if (t === s) t = '';
    }
  }
  return t.trim();
}

function _reduceTicketNoise(text) {
  let t = text || '';
  if (t.includes('-')) t = t.split('-')[0].trim();
  t = t.replace(/\b(c\s*c|cc|centro comercial)\b.*$/g, '').trim();
  return t;
}
