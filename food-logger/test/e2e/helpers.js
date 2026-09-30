'use strict';

const { expect } = require('@playwright/test');

// Collects everything that should never happen in a healthy page: uncaught
// exceptions, console.error output and CSP violations.
function attachGuards(page) {
  const guards = { errors: [], csp: [] };

  page.on('pageerror', (err) => guards.errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    // The URL matters for resource errors ("Failed to load resource: ... 401"), whose text has none.
    if (msg.type() === 'error') {
      const url = msg.location()?.url;
      guards.errors.push(`console.error: ${msg.text()}${url ? ` [${url}]` : ''}`);
    }
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

// A signed-out page load asks GET /auth/me, which answers 401; Chrome logs every 4xx
// resource load as a console error. Only that exact request is allowed.
const SIGNED_OUT_ME = /^console\.error: Failed to load resource: the server responded with a status of 401 \(Unauthorized\) \[http:\/\/localhost:\d+\/auth\/me\]$/;

// Saving an analysis shows a celebration and only then navigates to the diary, on a fixed
// 2.7 s timer (screens/analysis.js). The default 5 s expect timeout leaves too little room on a
// slow machine, so every wait for "saved entry appears in the diary" uses this one.
const SAVE_TO_DIARY = { timeout: 10_000 };

module.exports = { attachGuards, expectNoGuardEvents, SIGNED_OUT_ME, SAVE_TO_DIARY };
