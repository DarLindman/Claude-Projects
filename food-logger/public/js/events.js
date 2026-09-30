// Event delegation. Markup carries no inline handlers (the CSP forbids them); it names
// an action instead:
//   data-action="name"   click handler          data-change="name"  change handler
//   data-arg="value"     single string argument  data-id="7"         record id
// Handlers receive (el, event): the element that carries the attribute and the event.
// They read el.dataset.arg / el.dataset.id / el.value and convert numbers themselves.

function delegate(rootEl, eventName, attr, actions) {
  rootEl.addEventListener(eventName, (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const el = target.closest(`[${attr}]`);
    if (!el || !rootEl.contains(el)) return;
    const name = el.getAttribute(attr);
    const handler = Object.hasOwn(actions, name) ? actions[name] : undefined;
    if (typeof handler !== 'function') {
      console.warn(`No handler for ${attr}="${name}"`);
      return;
    }
    handler(el, event);
  });
}

// Installs ONE delegated click listener and ONE delegated change listener on rootEl.
// Elements rendered later (innerHTML) are covered without re-binding.
export function bindActions(rootEl, actions) {
  delegate(rootEl, 'click', 'data-action', actions);
  delegate(rootEl, 'change', 'data-change', actions);
}
