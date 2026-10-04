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

// A modal is a paper slip on a dimmed page. Opening it moves the focus into the slip (the slip itself, not a field, so no
// keyboard pops up on a phone) and remembers what had the focus; closing gives it back, unless the user already moved on.
const _openers = new Map();   // modal id -> the element that had the focus when it opened
export function openModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay.classList.contains('open')) _openers.set(id, document.activeElement);
  overlay.classList.add('open');
  overlay.querySelector('.modal-sheet')?.focus({ preventScroll: true });
}
export function closeModal(id) {
  const overlay = document.getElementById(id);
  const wasOpen = overlay.classList.contains('open');
  overlay.classList.remove('open');
  const opener = _openers.get(id);
  _openers.delete(id);
  const focus = document.activeElement;
  const focusLost = !focus || focus === document.body || overlay.contains(focus);
  if (wasOpen && focusLost && opener && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true });
}
// Closes every open modal at once (a sign-out must not leave one over the next person's screen).
export function closeAllModals() {
  _openers.clear();   // first: nothing is given the focus back (the opener may be on a screen that is about to be hidden)
  document.querySelectorAll('.modal-overlay.open').forEach(o => closeModal(o.id));
}
// Escape closes the top slip through its own cross, so every rule of that close (the edit slip stays while it recalculates) applies.
export function closeTopModalOnEscape(event) {
  if (event.key !== 'Escape' || event.isComposing) return;   // Escape that ends an IME composition is not a close
  const open = document.querySelectorAll('.modal-overlay.open');
  if (open.length) open[open.length - 1].querySelector('.modal-close')?.click();
}

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
