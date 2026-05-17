// =========================================================
// Helpers de DOM — createElement, modal, toast, loading
// =========================================================

// --------------------------------------------------------
// createElement helper
// --------------------------------------------------------
/**
 * Crea un elemento HTML con atributos e hijos.
 * @param {string} tag
 * @param {Object} [attrs]
 * @param {...(HTMLElement|string)} children
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style' && typeof v === 'object') {
      Object.assign(node.style, v);
    } else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v !== undefined && v !== null && v !== false) {
      node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const child of children) {
    if (child == null) continue;
    node.appendChild(
      child instanceof Node ? child : document.createTextNode(String(child))
    );
  }
  return node;
}

// --------------------------------------------------------
// Modal
// --------------------------------------------------------
const _overlay = () => document.getElementById('modal-overlay');
const _mBody   = () => document.getElementById('modal-body');
const _mFooter = () => document.getElementById('modal-footer');
const _mTitle  = () => document.getElementById('modal-title');

/**
 * Abre el modal mostrando bodyEl en el cuerpo y footerEl en el pie.
 * @param {string} title
 * @param {HTMLElement} bodyEl
 * @param {HTMLElement} footerEl
 */
export function openModal(title, bodyEl, footerEl) {
  _mTitle().textContent  = title;
  _mBody().replaceChildren(bodyEl);
  _mFooter().replaceChildren(footerEl);
  _overlay().classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Cerrar al pulsar fuera del modal-box
  _overlay().addEventListener('click', _onOverlayClick);
}

export function closeModal() {
  _overlay().classList.add('hidden');
  document.body.style.overflow = '';
  _overlay().removeEventListener('click', _onOverlayClick);
}

function _onOverlayClick(e) {
  if (e.target === _overlay()) closeModal();
}

// Botón X del modal
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modal-close')?.addEventListener('click', closeModal);
});

// --------------------------------------------------------
// Toast
// --------------------------------------------------------
let _toastTimer = null;

/**
 * @param {string} message
 * @param {'info'|'success'|'error'} [type='info']
 * @param {number} [duration=3000]
 */
export function showToast(message, type = 'info', duration = 3000) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.className   = `toast toast-${type}`;  // resetea clases

  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.add('hidden'), duration);
}

// --------------------------------------------------------
// Loading overlay
// --------------------------------------------------------
/**
 * @param {boolean} isLoading
 * @param {string} [text='Cargando…']
 */
export function setLoading(isLoading, text = 'Cargando datos…') {
  const overlay = document.getElementById('loading-overlay');
  const label   = document.getElementById('loading-text');
  if (!overlay) return;
  if (label) label.textContent = text;
  overlay.classList.toggle('hidden', !isLoading);
}

// --------------------------------------------------------
// Helpers de visibilidad
// --------------------------------------------------------
export function show(el) { el?.classList.remove('hidden'); }
export function hide(el) { el?.classList.add('hidden'); }
export function toggle(el, visible) {
  el?.classList.toggle('hidden', !visible);
}
