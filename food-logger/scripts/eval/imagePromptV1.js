'use strict';

const { MODEL } = require('../../src/lib/anthropic');
const { AnalysisParseError } = require('../../src/lib/analysis');

// FROZEN COPY for the naming evaluation tool only (scripts/, never loaded by src/).
// The image system prompt and user message exactly as they were before the
// recognise-then-name prompt (commit 929c25d, src/lib/analysis.js). Do not edit:
// test/api/analysis-prompt.test.js checks their SHA-256 against that commit.
// Below the two constants: analyzeImageV1 reproduces the whole old image pipeline.

const IMAGE_SYSTEM_PROMPT_V1 = `אתה מנתח תזונה מומחה. נתח תמונות אוכל לפי השיטה הבאה:

שלב 1 — זיהוי: זהה כל מרכיב גלוי תוך שימוש בהקשר המלא. דוגמאות: בשר אדום ליד אצות/אבוקדו/סויה = טונה/סשימי ולא בקר; בשר בתוך בצק עלים = וולינגטון; עיגול כהה שטוח = פטייה ולא שניצל. לגבי דגים: אל תניח סלמון אלא אם הצבע ורוד-כתום בבירור — דג לבן = דג לבן/בקלה/פילה דג, דג מטוגן שלא ברור = פילה דג מטוגן.
שלב 2 — נסתרים: שקול תמיד רכיבים לא גלויים — שמן טיגון, חמאה, ציפוי, רוטב, שמן זית.
שלב 3 — כמויות: הערך weight_g לפי יחסים בתמונה (צלחת, כלים, ידיים כהשוואה).

עוגני כמויות לאוכל נפוץ:
- פרוסת לחם = 25-30 גרם
- חזה עוף / שניצל = 150-200 גרם
- המבורגר פטי = 120-150 גרם
- אורז מבושל (מנה) = 150-200 גרם
- תפוח אדמה בינוני = 150 גרם
- ביצה = 55 גרם
- כף שמן = 13 גרם (120 קלוריות)
- חמאה כף = 14 גרם
- גבינה פרוסה = 20-25 גרם

הנחות:
- מנת מסעדה: הכל גדול יותר ממה שנראה, שמן/חמאה נסתרים תמיד נכללים.
- אל תעגל לעשרות/מאות — חשב מדויק (למשל 187 ולא 200).
- שמות מרכיבים בעברית מדוברת ישראלית בלבד — אותיות עבריות בלבד.
- dish_name: תיאור המנה בעברית מדוברת עד 10 מילים, לפי הקשר המנה המלא, ללא "בצלחת יש", ללא מידת עשייה. דוגמאות למילים נכונות: מלפפון, שעועית ירוקה, עוף, בשר, פירה, אורז, סלט, טונה. אסור להשתמש במילים נדירות או תנ"כיות.`;

const imageUserMessageV1 = `זהה כל מרכיב בנפרד. השב עם JSON object בלבד, ללא markdown:\n{"dish_name":"תיאור המנה","items":[{"name":"שם בעברית","weight_g":0,"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0,"fiber_g":0}]}\nweight_g קודם — אז חשב קלוריות לפי weight_g בלבד.`;


// The old silent name stripping (same Hebrew block U+0590-U+05FF as the old literal):
// everything that is not Hebrew, whitespace, a digit or - ' " ( ) , . / is dropped.
const cleanHebrewV1 = (s) => (s || '').replace(/[^֐-׿\s\d\-'"(),./]/g, '').replace(/\s{2,}/g, ' ').trim();

const sumItems = (items) => items.reduce((acc, item) => ({
  calories: acc.calories + (Number(item.calories) || 0),
  protein_g: acc.protein_g + (Number(item.protein_g) || 0),
  carbs_g: acc.carbs_g + (Number(item.carbs_g) || 0),
  fat_g: acc.fat_g + (Number(item.fat_g) || 0),
  fiber_g: acc.fiber_g + (Number(item.fiber_g) || 0),
}), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 });

// The old image pipeline (929c25d): V1 prompt and message, temperature 0.1, 1200 tokens,
// the dish name silently stripped with cleanHebrewV1 (no repair call), default 'מנה'.
async function analyzeImageV1(anthropic, { imageBase64, mimeType }) {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1200,
    temperature: 0.1,
    system: IMAGE_SYSTEM_PROMPT_V1,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
        { type: 'text', text: imageUserMessageV1 },
      ],
    }],
  });

  const raw = message.content[0].text.trim();
  let parsed;
  try {
    const objMatch = raw.match(/\{[\s\S]*\}/);
    if (objMatch) parsed = JSON.parse(objMatch[0]);
  } catch {
    throw new AnalysisParseError('invalid JSON');
  }
  if (!parsed) throw new AnalysisParseError('no JSON object found');
  const items = parsed.items;
  if (!Array.isArray(items) || items.length === 0) throw new AnalysisParseError('no items');
  items.forEach((item) => { item.name = cleanHebrewV1(item.name); });
  const totals = sumItems(items);
  const foodName = cleanHebrewV1((parsed.dish_name || '').trim()) || 'מנה';
  return { foodName, ...totals };
}

module.exports = { IMAGE_SYSTEM_PROMPT_V1, imageUserMessageV1, cleanHebrewV1, analyzeImageV1 };
