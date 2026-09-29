'use strict';

// Boots the real app on port 3100 for the Playwright suite. Uses the test
// database only (createTestPool refuses any name not ending in `_test`), a
// fake Anthropic client, and rate limits raised so registrations never throttle.

const { loadConfig } = require('../../src/config');
const { migrate } = require('../../src/db/migrate');
const { createApp } = require('../../src/app');
const { createTestPool, resetDb } = require('../helpers/db');
const { fakeAnthropic } = require('../helpers/fakeAnthropic');

const PORT = 3100;

async function main() {
  // Throws before connecting if the database name does not end in `_test`.
  const pool = await createTestPool();
  const config = loadConfig({
    NODE_ENV: 'test',
    JWT_SECRET: 'e2e-secret-e2e-secret-e2e-secret-1234',
    ORIGIN: `http://localhost:${PORT}`,
    // Only used to satisfy validation; the pool above is what the app talks to.
    DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://localhost/foodlogger_test',
  });

  await migrate(pool);
  await resetDb(pool);

  const app = createApp({
    config,
    pool,
    anthropic: fakeAnthropic(),
    limits: { loginPerMin: 100000, analyzePerHour: 100000 },
  });
  const server = app.listen(PORT, () => console.log(`e2e server listening on ${PORT}`));

  const shutdown = () => server.close(() => pool.end().finally(() => process.exit(0)));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
