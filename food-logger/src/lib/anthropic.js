'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-haiku-4-5-20251001';

// `config.anthropicApiKey` may be undefined outside production; the client
// still constructs and only fails when a request is actually made.
function createAnthropic(config) {
  return new Anthropic({ apiKey: config.anthropicApiKey });
}

module.exports = { createAnthropic, MODEL };
