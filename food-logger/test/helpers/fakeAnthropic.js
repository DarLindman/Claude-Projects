'use strict';

// Test double for the Anthropic client. Records every call in `calls` and
// answers by request kind:
//   - system prompt starts with "You are a translator" -> plain Hebrew name
//   - user content is an array (image request)         -> JSON object with items
//   - otherwise (text request)                         -> JSON array of items
const IMAGE_ITEMS = [
  { name: 'עוף chicken', weight_g: 150, calories: 250, protein_g: 30, carbs_g: 0, fat_g: 12, fiber_g: 0 },
  { name: 'אורז', weight_g: 150, calories: 200, protein_g: 4, carbs_g: 44, fat_g: 0.5, fiber_g: 1 },
];
const TEXT_ITEMS = [
  { name: 'סלט', weight_g: 200, calories: 80, protein_g: 2, carbs_g: 10, fat_g: 4, fiber_g: 3 },
  { name: 'לחם', weight_g: 25, calories: 65, protein_g: 2, carbs_g: 12, fat_g: 1, fiber_g: 1 },
];

function fakeAnthropic() {
  const calls = [];
  const reply = (text) => ({ content: [{ type: 'text', text }] });
  return {
    calls,
    messages: {
      async create(args) {
        calls.push(args);
        if (typeof args.system === 'string' && args.system.startsWith('You are a translator')) {
          return reply('סלט');
        }
        const content = args.messages?.[0]?.content;
        if (Array.isArray(content)) {
          return reply(JSON.stringify({ dish_name: 'עוף עם אורז plate', items: IMAGE_ITEMS }));
        }
        return reply(JSON.stringify(TEXT_ITEMS));
      },
    },
  };
}

module.exports = { fakeAnthropic, IMAGE_ITEMS, TEXT_ITEMS };
