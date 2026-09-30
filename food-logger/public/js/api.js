const API = ''; // Same origin

// A failed request. `code` is the server's stable error code, `fields` the per-field
// codes of a VALIDATION error. Show it to the user with messageFor() from errors.js.
export class ApiError extends Error {
  constructor(status, code, fields) {
    super(code);
    this.status = status;
    this.code = code;
    this.fields = fields || null;
  }
}

// Token access and the unauthorized handler are injected by session.js (configureApi) so
// this module does not import session.js, which itself imports apiFetch (keeps the graph acyclic).
let _getToken = () => null;
let _onUnauthorized = () => {};
export function configureApi({ getToken, onUnauthorized }) {
  _getToken = getToken;
  _onUnauthorized = onUnauthorized;
}

// Only these codes mean the session is gone; other 401s (wrong password) must not log out.
const SESSION_CODES = new Set(['UNAUTHORIZED', 'SESSION_EXPIRED']);

export async function apiFetch(path, opts = {}) {
  const token = _getToken();
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) }
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body (proxy error page) */ }
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error?.code || 'INTERNAL', data?.fields);
    if (SESSION_CODES.has(err.code)) _onUnauthorized();
    throw err;
  }
  return data;
}
