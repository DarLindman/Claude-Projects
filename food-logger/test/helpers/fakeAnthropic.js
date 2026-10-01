'use strict';

// Test double for the Anthropic client. Records every call in `calls` and
// answers by request kind:
//   - system prompt starts with the repair-prompt prefix -> `fake.repairReply`
//     (string; a function called with the request that returns a string/response
//     or throws; an Error instance makes the call reject). Default: 'סלט'
//   - user content is an array (image request)         -> `fake.imageReply` when set (a
//     string, for malformed-reply tests), else a JSON object with visual_description,
//     draft_name, dish_name and items (the shape the image prompt asks for); the
//     response's stop_reason is `fake.imageStopReason` when set, else 'end_turn'
//   - otherwise (text request)                         -> `fake.textReply` when set (a
//     string), else a JSON array of items
// `fake.imageContent` / `fake.textContent`, when set, are returned as the response's
// `content` array as is (any block shapes, for the reply-parsing tests); they win over
// imageReply / textReply.
const { REPAIR_PROMPT_PREFIX } = require('../../src/lib/hebrewName');

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
  const fake = {
    calls,
    repairReply: 'סלט',
    imageReply: undefined,
    imageStopReason: undefined,
    imageContent: undefined,
    textReply: undefined,
    textContent: undefined,
    messages: {
      async create(args) {
        calls.push(args);
        if (typeof args.system === 'string' && args.system.startsWith(REPAIR_PROMPT_PREFIX)) {
          const r = fake.repairReply;
          if (r instanceof Error) throw r;
          const out = typeof r === 'function' ? r(args) : r;
          return typeof out === 'string' ? reply(out) : out;
        }
        const content = args.messages?.[0]?.content;
        if (Array.isArray(content)) {
          if (fake.imageContent !== undefined) return { content: fake.imageContent, stop_reason: fake.imageStopReason ?? 'end_turn' };
          const text = fake.imageReply !== undefined ? fake.imageReply
            : JSON.stringify({ visual_description: 'grilled chicken with white rice', draft_name: 'עוף עם אורז לבן', dish_name: 'עוף עם אורז', items: IMAGE_ITEMS });
          return { ...reply(text), stop_reason: fake.imageStopReason ?? 'end_turn' };
        }
        if (fake.textContent !== undefined) return { content: fake.textContent, stop_reason: 'end_turn' };
        return reply(fake.textReply !== undefined ? fake.textReply : JSON.stringify(TEXT_ITEMS));
      },
    },
  };
  return fake;
}

module.exports = { fakeAnthropic, IMAGE_ITEMS, TEXT_ITEMS };
