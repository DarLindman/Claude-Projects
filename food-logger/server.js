'use strict';

require('dotenv').config();
const path = require('path');
const { loadConfig, deployWarnings } = require('./src/config');
const { createPool } = require('./src/db/pool');
const { migrate } = require('./src/db/migrate');
const { createAnthropic, MODEL } = require('./src/lib/anthropic');
const { buildIcon } = require('./src/lib/icon');
const { createApp } = require('./src/app');

async function main() {
  const config = loadConfig();
  // What the deploy actually runs with (never secrets); a wrong ORIGIN or NODE_ENV otherwise shows up only as 403s.
  console.log(`config: nodeEnv=${config.nodeEnv} origin=${config.origin} trustProxy=${config.trustProxy} imageModel=${config.imageModel} imageEffort=${config.imageEffort} textModel=${MODEL}`);
  for (const w of deployWarnings(config)) console.warn(`WARNING: ${w}`);
  const pool = createPool(config);
  // An error on an idle pooled client must be logged, not crash silently.
  pool.on('error', (err) => console.error('Unexpected idle database client error:', err));
  await migrate(pool);
  console.log('DB ready');
  const anthropic = createAnthropic(config);
  const icon = buildIcon(path.join(__dirname, 'public'));
  const app = createApp({ config, pool, anthropic, icon });
  app.listen(config.port, () => console.log(`Food Logger running on http://localhost:${config.port}`));
}

main().catch((e) => {
  console.error('Startup failed:', e);
  process.exit(1);
});
