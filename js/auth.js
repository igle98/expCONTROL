import { OAUTH_CLIENT_ID, SCOPES } from './config.js';

const TOKEN_KEY = 'gasto_bot_token';

let tokenClient = null;
let _resolveToken = null;
let _rejectToken  = null;

// =========================================================
// API pública
// =========================================================

/**
 * Inicializa el cliente GIS y conecta los callbacks de sesión.
 * Debe llamarse una sola vez desde app.js tras DOMContentLoaded.
 *
 * @param {() => void} onSignedIn  - callback cuando el token es válido
 * @param {() => void} onSignedOut - callback cuando el usuario cierra sesión
 */
export function initAuth(onSignedIn, onSignedOut) {
  if (!_gisLoaded()) {
    console.error('[auth] Google Identity Services no está disponible.');
    return;
  }

  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: OAUTH_CLIENT_ID,
    scope:     SCOPES,
    callback:  (response) => {
      if (response.error) {
        _clearToken();
        if (_rejectToken) { _rejectToken(new Error(response.error)); _rejectToken = null; }
        if (typeof onSignedOut === 'function') onSignedOut(response.error);
        return;
      }
      _storeToken(response);
      if (_resolveToken) { _resolveToken(response.access_token); _resolveToken = null; }
      if (typeof onSignedIn === 'function') onSignedIn();
    },
  });

  // Si ya hay un token válido en sesión, arrancar directamente
  const stored = _loadToken();
  if (stored) {
    if (typeof onSignedIn === 'function') onSignedIn();
  }
}

/**
 * Devuelve un access_token válido. Si el almacenado es válido lo devuelve
 * inmediatamente; si ha expirado o no existe, abre el popup de Google.
 *
 * @returns {Promise<string>} access_token
 */
export function getToken() {
  const stored = _loadToken();
  if (stored) return Promise.resolve(stored.accessToken);

  if (!tokenClient) return Promise.reject(new Error('[auth] tokenClient no inicializado'));

  return new Promise((resolve, reject) => {
    _resolveToken = resolve;
    _rejectToken  = reject;
    // prompt: '' → sin pantalla de selección de cuenta si ya se autorizó
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

/**
 * Revoca el token actual y llama al callback onSignedOut.
 */
export function signOut() {
  const stored = _loadToken();
  if (stored && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(stored.accessToken, () => {});
  }
  _clearToken();
}

// =========================================================
// Helpers privados
// =========================================================

function _gisLoaded() {
  return Boolean(window.google?.accounts?.oauth2);
}

function _storeToken(tokenResponse) {
  const data = {
    accessToken: tokenResponse.access_token,
    expiresAt:   Date.now() + (tokenResponse.expires_in ?? 3600) * 1000,
  };
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(data));
  } catch {
    // sessionStorage no disponible (modo privado extremo)
  }
}

function _loadToken() {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (_isExpired(data)) { _clearToken(); return null; }
    return data;
  } catch {
    return null;
  }
}

function _clearToken() {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* noop */ }
}

/** Considera expirado si quedan menos de 60 s */
function _isExpired(data) {
  return !data?.expiresAt || Date.now() > data.expiresAt - 60_000;
}
