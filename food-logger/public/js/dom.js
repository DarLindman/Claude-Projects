export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Escape-by-default HTML templates ────────────────────────────────────────
// html`<b>${value}</b>` HTML-escapes every interpolated value (text and attribute
// contexts alike). Only a Trusted fragment, i.e. the result of another html`` call or
// of raw(), is inserted as markup. setHtml() is the one place that assigns innerHTML,
// and it accepts nothing but a Trusted fragment, so a plain string of markup can never
// reach the DOM by mistake.
class Trusted {
  constructor(markup) {
    this.__raw = markup;
    Object.freeze(this);
  }
}

// Mark a string as trusted markup. Use only for text that provably holds no user data.
export function raw(markup) {
  return new Trusted(String(markup));
}

function renderValue(value) {
  if (value instanceof Trusted) return value.__raw;
  if (Array.isArray(value)) return value.map(renderValue).join(''); // escape each item, then join
  if (value === null || value === undefined || value === false) return '';
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += renderValue(values[i]) + strings[i + 1];
  return new Trusted(out);
}

// The only innerHTML assignment in the frontend.
export function setHtml(el, fragment) {
  if (!(fragment instanceof Trusted)) {
    throw new Error(`setHtml expects the result of html\`\` or raw(), got ${fragment === null ? 'null' : typeof fragment}`);
  }
  el.innerHTML = fragment.__raw;
}

export function openModal(id) { document.getElementById(id).classList.add('open'); }
export function closeModal(id) { document.getElementById(id).classList.remove('open'); }

let toastTimer;
export function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

// Delegated actions for modals (see events.js). The overlay carries closeModalBackdrop and
// acts only when the click landed on the overlay itself, so clicks inside the sheet are ignored.
export const actions = {
  openModal: (el) => openModal(el.dataset.arg),
  closeModal: (el) => closeModal(el.dataset.arg),
  closeModalBackdrop: (el, event) => { if (event.target === el) closeModal(el.dataset.arg); },
};
