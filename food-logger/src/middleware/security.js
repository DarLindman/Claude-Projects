'use strict';

const helmet = require('helmet');

// The whole policy in one place. `style-src 'unsafe-inline'` stays for the inline style=
// attributes in the markup (inline CSS cannot run script); script-src is strict: no inline
// scripts, no eval, no inline event handlers. No upgrade-insecure-requests: it would break
// plain-http local development.
const CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'media-src': ["'self'", 'blob:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
};

// The camera is used by the photo capture; everything else is switched off.
const PERMISSIONS_POLICY = 'camera=(self), microphone=(), geolocation=()';

// Security headers for every response (static files, routers, 404s and errors included), so
// mount this first. Helmet's remaining defaults stay on: COOP/CORP same-origin,
// Origin-Agent-Cluster, X-Frame-Options SAMEORIGIN, X-DNS-Prefetch-Control off, and so on.
function securityMiddleware(config) {
  return [
    helmet({
      contentSecurityPolicy: { useDefaults: false, directives: CSP_DIRECTIVES },
      strictTransportSecurity: config.isProd ? undefined : false,
      referrerPolicy: { policy: 'no-referrer' },
      xContentTypeOptions: true,
    }),
    (req, res, next) => {
      res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
      next();
    },
  ];
}

module.exports = { securityMiddleware };
