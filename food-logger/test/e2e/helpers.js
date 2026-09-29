'use strict';

const { expect } = require('@playwright/test');

// Collects everything that should never happen in a healthy page: uncaught
// exceptions, console.error output and CSP violations.
function attachGuards(page) {
  const guards = { errors: [], csp: [] };

  page.on('pageerror', (err) => guards.errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') guards.errors.push(`console.error: ${msg.text()}`);
  });

  page.exposeFunction('__reportCsp', (detail) => guards.csp.push(detail)).catch(() => {});
  page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__reportCsp(`${e.violatedDirective} blocked ${e.blockedURI || 'inline'} (${e.effectiveDirective})`);
    });
  });

  return guards;
}

const matches = (message, allowed) =>
  allowed.some((a) => (a instanceof RegExp ? a.test(message) : message.includes(a)));

// `allow` is an explicit list of known baseline messages (substrings or regexes).
function expectNoGuardEvents(guards, allow = []) {
  const errors = guards.errors.filter((m) => !matches(m, allow));
  const csp = guards.csp.filter((m) => !matches(m, allow));
  const report = [
    errors.length ? `Page errors:\n  ${errors.join('\n  ')}` : '',
    csp.length ? `CSP violations:\n  ${csp.join('\n  ')}` : '',
  ].filter(Boolean).join('\n');
  expect(errors.length + csp.length, report || 'no guard events').toBe(0);
}

module.exports = { attachGuards, expectNoGuardEvents };
