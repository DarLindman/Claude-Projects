const API = ''; // Same origin

// Token access and the 401 handler are injected by session.js (configureApi) so this
// module does not import session.js, which itself imports apiFetch (keeps the graph acyclic).
let _getToken = () => null;
let _onUnauthorized = () => {};
export function configureApi({ getToken, onUnauthorized }) {
  _getToken = getToken;
  _onUnauthorized = onUnauthorized;
}

export async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${_getToken()}`, ...(opts.headers || {}) }
  });
  if (res.status === 401) {
    if (_getToken()) { _onUnauthorized(); return; }
    const errData = await res.json();
    const err = new Error(errData.error || 'שם משתמש או סיסמא שגויים'); err.status = 401; throw err;
  }
  const data = await res.json();
  if (!res.ok) { const err = new Error(data.error || 'שגיאת שרת'); err.status = res.status; throw err; }
  return data;
}
