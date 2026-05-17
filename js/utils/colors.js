// =========================================================
// Generador de colores determinista para categorías.
// Mismo nombre de categoría → mismo color siempre.
// =========================================================

/**
 * Dado un array de claves de categoría, devuelve un Map clave → color HSL.
 * @param {string[]} keys
 * @returns {Map<string, string>}
 */
export function getCategoryColors(keys) {
  const map = new Map();
  for (const key of keys) {
    map.set(key, getCategoryColor(key));
  }
  return map;
}

/**
 * Color HSL determinista para una clave de categoría.
 * @param {string} key
 * @returns {string}  'hsl(H, 70%, 55%)'
 */
export function getCategoryColor(key) {
  const hue = _hashToHue(key);
  return `hsl(${hue}, 65%, 58%)`;
}

/**
 * Versión con alpha, útil para fondos de badges.
 * @param {string} key
 * @param {number} alpha  0-1
 * @returns {string}  'hsla(H, 70%, 55%, A)'
 */
export function getCategoryColorAlpha(key, alpha = 0.15) {
  const hue = _hashToHue(key);
  return `hsla(${hue}, 65%, 58%, ${alpha})`;
}

// =========================================================
// Hash simple djb2 → ángulo 0-359
// =========================================================
function _hashToHue(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash |= 0; // to 32-bit int
  }
  return Math.abs(hash) % 360;
}
