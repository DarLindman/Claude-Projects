'use strict';

const crypto = require('crypto');

// Error contract: { error: { code }, fields? }. No human-language text from the
// server; the client maps codes to messages.
class AppError extends Error {
  constructor(status, code, fields) {
    super(code);
    this.status = status;
    this.code = code;
    if (fields) this.fields = fields;
  }
}

// Express 4 does not catch rejected promises; this forwards them to errorHandler.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);

function requestId(req, res, next) {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

// body-parser failures: oversize, malformed JSON, bad encoding, aborted upload.
const BODY_PARSER_TYPES = new Set([
  'entity.too.large', 'entity.parse.failed', 'entity.verify.failed',
  'encoding.unsupported', 'charset.unsupported', 'request.aborted', 'request.size.invalid',
]);

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  let appError = err;
  if (!(err instanceof AppError)) {
    if (err && BODY_PARSER_TYPES.has(err.type)) {
      appError = new AppError(400, 'VALIDATION');
    } else {
      // The original message never reaches the client; only the request id links them.
      console.error(`[${req.id}] ${req.method} ${req.originalUrl}`, err);
      appError = new AppError(500, 'INTERNAL');
    }
  }
  const body = { error: { code: appError.code } };
  if (appError.fields) body.fields = appError.fields;
  res.status(appError.status).json(body);
}

module.exports = { AppError, asyncHandler, requestId, errorHandler };
