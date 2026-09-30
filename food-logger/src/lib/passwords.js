'use strict';

const bcrypt = require('bcryptjs');
const { AppError } = require('../middleware/errors');

const COST = 12;
const MIN_LENGTH = 8;
const MAX_BYTES = 72; // bcrypt ignores everything after 72 bytes

// New passwords only (register, change-password). Login accepts whatever an existing account has.
// Length is counted in characters for the minimum and in UTF-8 bytes for the maximum.
function validateNewPassword(pw) {
  if ([...pw].length < MIN_LENGTH) throw new AppError(400, 'WEAK_PASSWORD');
  if (Buffer.byteLength(pw, 'utf8') > MAX_BYTES) throw new AppError(400, 'PASSWORD_TOO_LONG');
}

const hashPassword = (pw, cost = COST) => bcrypt.hash(pw, cost);
const verifyPassword = (pw, hash) => bcrypt.compare(pw, hash);
const needsRehash = (hash) => bcrypt.getRounds(hash) < COST;

// Compared against when the username is unknown, so a miss costs the same as a wrong password.
// Computed once at module load, at the current cost.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing-parity', COST);

module.exports = { COST, validateNewPassword, hashPassword, verifyPassword, needsRehash, DUMMY_HASH };
