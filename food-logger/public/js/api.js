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

// The unauthorized handler is injected by session.js (configureApi) so this module does
// not import session.js, which itself imports apiFetch (keeps the graph acyclic).
// The session lives in an HttpOnly cookie the browser sends by itself (same-origin
// fetch); no token is ever visible to JavaScript.
let _onUnauthorized = () => {};
export function configureApi({ onUnauthorized }) {
  _onUnauthorized = onUnauthorized;
}

// Only these codes mean the session is gone; other 401s (wrong password) must not log out.
const SESSION_CODES = new Set(['UNAUTHORIZED', 'SESSION_EXPIRED']);

// `X-FL-Client: 1` goes on every request: the server's CSRF check requires it on every
// state-changing request, and a cross-site form cannot send a custom header.
// `silent: true` skips the unauthorized handler (used by the boot-time session check).
export async function apiFetch(path, opts = {}) {
  const { silent = false, ...fetchOpts } = opts;
  const res = await fetch(API + path, {
    ...fetchOpts,
    headers: { 'Content-Type': 'application/json', ...(fetchOpts.headers || {}), 'X-FL-Client': '1' }
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body (proxy error page) */ }
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error?.code || 'INTERNAL', data?.fields);
    if (!silent && SESSION_CODES.has(err.code)) _onUnauthorized();
    throw err;
  }
  return data;
}
