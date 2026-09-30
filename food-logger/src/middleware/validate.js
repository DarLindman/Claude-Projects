'use strict';

const { AppError } = require('./errors');

// Value at `path` inside the raw input, or undefined when any step is missing.
function valueAt(input, path) {
  let v = input;
  for (const key of path) {
    if (v === null || typeof v !== 'object') return undefined;
    v = v[key];
  }
  return v;
}

// Per-field code: REQUIRED (missing, or an empty string under a min-1 rule),
// TOO_LONG (string over its max), otherwise INVALID.
function fieldCode(issue, input) {
  if (valueAt(input, issue.path) === undefined) return 'REQUIRED';
  if (issue.code === 'too_small' && issue.origin === 'string' && issue.minimum === 1) return 'REQUIRED';
  if (issue.code === 'too_big' && issue.origin === 'string') return 'TOO_LONG';
  return 'INVALID';
}

function collectFields(error, input, fields) {
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    if (!(key in fields)) fields[key] = fieldCode(issue, input);
  }
}

// Validates req.body / req.params / req.query with zod schemas and sets
// req.valid = { body, params, query } (parsed values). Failure -> 400 VALIDATION.
function validate({ body, params, query } = {}) {
  const parts = { body, params, query };
  return function validateRequest(req, res, next) {
    const valid = {};
    const fields = {};
    for (const [part, schema] of Object.entries(parts)) {
      if (!schema) continue;
      const result = schema.safeParse(req[part]);
      if (result.success) valid[part] = result.data;
      else collectFields(result.error, req[part], fields);
    }
    if (Object.keys(fields).length) return next(new AppError(400, 'VALIDATION', fields));
    req.valid = valid;
    next();
  };
}

module.exports = { validate };
