'use strict';

const { MODEL } = require('./anthropic');
const { ensureHebrewDishName, cleanDishName } = require('./hebrewName');
const { replyText, blockTypes, stopReasonOf, extractJson, isPlainObject } = require('./aiReply');

// Thrown when the model's reply cannot be turned into nutrition items. Routes
// map it to the "could not analyze the AI response" 500; any other error maps
// to the endpoint-specific generic 500.
class AnalysisParseError extends Error {}

const IMAGE_SYSTEM_PROMPT = `אתה מנתח תזונה מומחה. נתח תמונות אוכל לפי השיטה הבאה:

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

סדר העבודה בתשובה — קודם מזהים, אחר כך כותבים טיוטה של השם, בודקים אותה, ורק אז קובעים את השם הסופי:
1. visual_description — קודם כול תאר באנגלית, במשפט קצר וניטרלי, מה רואים בתמונה: המרכיב העיקרי, אופן ההכנה והתוספות. זה שלב הזיהוי בלבד, עדיין בלי שם למנה. לפני שאתה מחליט מהו המרכיב העיקרי, התבונן במרקם, בצורת החיתוך, בצבע ובתוספות שלצדו.
2. draft_name — טיוטה ראשונה של שם המנה בעברית, לפי כללי השמות שלהלן. אל תעתיק מילים מהתיאור האנגלי ואל תתרגם אותו מילה במילה: שאל את עצמך איך ישראלי היה קורא למנה הזאת.
3. dish_name — השם הסופי. קרא שוב את הטיוטה ובדוק אותה מול כללי השמות, מילה אחר מילה. אם היא עומדת בכללים, כתוב אותה כפי שהיא; אם לא, תקן אותה.
4. items — המרכיבים והערכים התזונתיים, לפי השיטה שלמעלה.

כללי השמות:
המשתמש קורא את השם ביומן האוכל שלו וצריך לזהות בו מיד את הארוחה שלו. לכן השם צריך להיות במילים שהוא עצמו היה אומר, ולא תרגום, תעתיק או מונח מקצועי.
- השם שישראלי ממוצע היה אומר: כפי שהמנה כתובה בתפריט של מסעדה, כפי שהמוצר נקרא בסופר, או כפי שהיה מספר לחבר מה אכל.
- רק מילים שכל ישראלי מכיר, בכתיב המקובל. לפני שאתה קובע את השם הסופי, קרא שוב כל מילה בשם ושאל את עצמך: האם זו מילה שישראלים באמת אומרים, והאם היא כתובה נכון? אם לא, החלף אותה במילה פשוטה ומוכרת.
- המילה היומיומית עדיפה על תעתיק של מילה לועזית שאינה נהוגה, על מילה מיושנת ועל מילה נדירה או תנ"כית: מילים כאלה נשמעות מוזרות, והמשתמש לא מזהה בהן את האוכל שלו.
- לעולם אל תמציא מילה, ואל תכתוב באותיות עבריות שם לועזי של מנה שישראלים לא אומרים בפועל. אם אינך יודע את המילה העברית היומיומית, תאר את האוכל בפשטות: המרכיב העיקרי ואיך הוא הוכן (מטוגן, צלוי, אפוי, מבושל או טרי).
- מילה ממקור לועזי מותרת כשהיא המילה העברית המקובלת לאותו מאכל, כלומר זו שישראלים אומרים בפועל (כמו פסטה, פיצה, המבורגר).
- אם למנה יש שם מוכר, השתמש בו במקום לפרט את המרכיבים שלה.
- כשאי אפשר להבחין מה המאכל, למשל כששני מאכלים נראים דומים בתמונה, עדיף שם כללי ונכון על פני ניחוש מפורט ושגוי. אבל כשרואים בבירור מה זה, תן את השם המוכר והמדויק.
- קצר ומדויק: המרכיב העיקרי, ואופן ההכנה רק כשהוא חשוב (מטוגן, צלוי, אפוי), עד חמש מילים בערך. בלי "בצלחת יש", בלי רשימה של כל המרכיבים ובלי מידת עשייה.
- אותיות עבריות בלבד: בלי אותיות לטיניות, סיניות או של כל כתב אחר, בלי אמוג'י, ובלי לכתוב מילה זרה בכתב המקורי שלה.

דוגמאות להמחשה בלבד. הן מסבירות את העיקרון ואינן רשימה לחיפוש; אותו היגיון חל על כל מאכל אחר, גם על מאכלים שלא מופיעים כאן:
* פרוסת עוף בציפוי פירורי לחם, מטוגנת: "שניצל" — השם שכל ישראלי אומר, ולא תעתיק של שם לועזי שלא נהוג בעברית.
* לחמנייה עם קציצת בשר טחון צלויה: "המבורגר" — מילה לועזית, אבל זו המילה המקובלת בעברית.
* מרק סמיך של עדשים: "מרק עדשים", ולא מילה תנ"כית כמו "נזיד".
* כדורי פלאפל בתוך פיתה עם סלט וטחינה: "פלאפל בפיתה" — השם המוכר, בלי לפרט כל מה שיש בפיתה.
* חזה עוף צלוי ולידו אורז: "חזה עוף צלוי עם אורז" — המרכיב העיקרי, אופן ההכנה והתוספת.
* פרוסת עוגה שלא רואים ממה היא עשויה: "עוגה" — שם כללי ונכון, ולא ניחוש של סוג מסוים.`;

// The user message of the image request: the reply fields in the order the model
// fills them (recognise, draft the name, re-read and fix it, then the nutrition items).
const IMAGE_USER_MESSAGE = `זהה כל מרכיב בנפרד. השב עם JSON object בלבד, ללא markdown, והשדות בסדר הזה:
{"visual_description":"short neutral English description","draft_name":"טיוטה ראשונה של השם","dish_name":"השם הסופי של המנה","items":[{"name":"שם בעברית","weight_g":0,"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0,"fiber_g":0}]}
visual_description קודם (זיהוי), אחריו draft_name (טיוטה לפי כללי השמות), אחריו dish_name (קרא שוב את הטיוטה, בדוק כל מילה מול כללי השמות ותקן מה שצריך), ורק אז items.
weight_g קודם — אז חשב קלוריות לפי weight_g בלבד.`;

const TEXT_SYSTEM_PROMPT = `אתה מחשבון תזונה מדויק למשתמשים ישראלים.

== כללי כמויות ==

כמות מפורשת במספר — חשב בדיוק לפי מה שכתוב, ללא שינוי.
  "100 גרם אורז" = 100 גרם בדיוק. "3 ביצים" = 3 ביצים בדיוק.

צורת יחיד ללא מספר = בדיוק 1 יחידה (הנחיה מכוונת, אסור להתעלם):
  "סרדין" = 1 סרדין בלבד.  "אנשובי" = 1 פילה (~5 גרם).  "ביצה" = ביצה 1.

ללא כמות ולא מספר — השתמש בכמות הקבועה הבאה (אל תחרוג ממנה):
  טונה במים = 85 גרם נטו מסוננת.
  סרדינים (ריבוי) = 45 גרם (כ-3 סרדינים קטנים).
  עוף/בשר = 100 גרם מבושל.
  אורז/פסטה = 100 גרם מבושל.
  לחם = 1 פרוסה = 25 גרם.
  אגוז מלך (יחיד) = 1 חצי גרעין = 5 גרם. אגוזי מלך (ריבוי ללא מספר) = 20 גרם.
  כף שמן = 13 מ"ל. כפית סוכר = 4 גרם.
  קופסת קוטג' / גביע קוטג' = 250 גרם (גודל סטנדרטי ישראלי).
  שקית פריכיות קטנה = 30 גרם. שקית פריכיות גדולה = 60 גרם.
  גביע יוגורט = 150 גרם. גביע גבינה = 250 גרם.

== כלל קריטי לשמירה על עקביות ==
לכל פריט, קבע תחילה את weight_g (משקל בגרמים) ורק אז חשב את שאר הערכים.
הערכים התזונתיים חייבים להיות עקביים לחלוטין עם weight_g שבחרת.

== שמות ==
בעברית תקנית בלבד — אפס אנגלית, אפס לטינית.`;

// The temperature rule, in one place: Haiku gets temperature 0 (as it always has); every
// other model gets none (null omits the field), because newer models reject it with a 400
// ("temperature is deprecated for this model").
const temperatureFor = (model) => (model.startsWith('claude-haiku') ? 0 : null);

// The JSON of a reply, or an AnalysisParseError. The reply describes the user's meal, so it
// is never logged or put in the error: a failure logs (under `tag`) only its kind, the
// reply length, the block types and stop_reason (so a reply cut by max_tokens or one
// without a text block is recognisable), and the error message carries the same details
// for the route's request-id log line. A JSON.parse message can quote the input, so it is
// not passed on either. Returns the value and a `fail(kind)` for the caller's own checks.
function parseReply(message, kind, tag, accept) {
  const fail = (what, length) => {
    const details = `${what} (reply of ${length} characters in blocks ${blockTypes(message)}, stop_reason ${stopReasonOf(message)})`;
    console.error(`[${tag}] ${details}`);
    throw new AnalysisParseError(details);
  };
  const text = replyText(message);
  if (text === null) fail('no text block', 0);
  const { value, error } = extractJson(text, kind, accept);
  if (error) fail(error, text.length);
  return { value, fail: (what) => fail(what, text.length) };
}

const sumItems = (items) => items.reduce((acc, item) => ({
  calories: acc.calories + (Number(item.calories) || 0),
  protein_g: acc.protein_g + (Number(item.protein_g) || 0),
  carbs_g: acc.carbs_g + (Number(item.carbs_g) || 0),
  fat_g: acc.fat_g + (Number(item.fat_g) || 0),
  fiber_g: acc.fiber_g + (Number(item.fiber_g) || 0),
}), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 });

// ─── Analyze food image ───────────────────────────────────────────────────────
// `model` is the configured image model (config.imageModel) in production; without it the
// request goes to MODEL. `temperature` defaults to temperatureFor(model); an explicit value
// wins (the evaluation tool): null omits the field, a number from 0 to 1 is sent.
async function analyzeImage(anthropic, { imageBase64, mimeType, model = MODEL, temperature }) {
  if (typeof model !== 'string' || !model.trim()) throw new TypeError('model must be a non-empty string');
  if (temperature === undefined) temperature = temperatureFor(model);
  if (temperature !== null && !(typeof temperature === 'number' && Number.isFinite(temperature) && temperature >= 0 && temperature <= 1)) {
    throw new TypeError('temperature must be null or a finite number from 0 to 1');
  }
  const message = await anthropic.messages.create({
    model,
    max_tokens: 1500, // the items plus room for visual_description and draft_name
    ...(temperature === null ? {} : { temperature }),
    system: IMAGE_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: imageBase64 }
        },
        { type: 'text', text: IMAGE_USER_MESSAGE }
      ]
    }]
  });

  // The reply describes the user's meal (visual_description, draft_name), so it is never
  // logged (see parseReply).
  const { value: parsed, fail } = parseReply(message, 'object', 'analyze');
  const items = parsed.items;
  if (!Array.isArray(items) || items.length === 0) fail('no items');
  // visual_description and draft_name are only the model's recognition and first attempt:
  // they are never read here, so they are not returned, stored or logged. Item names are
  // cleaned defensively but not returned; dish_name (the checked final name) goes through
  // the guard as is (missing or of any type it becomes the default name).
  items.forEach(item => { item.name = cleanDishName(item.name); });
  const totals = sumItems(items);
  const { name: foodName } = await ensureHebrewDishName(anthropic, parsed.dish_name, {});
  return { foodName, ...totals };
}

// ─── Analyze food text ────────────────────────────────────────────────────────
async function analyzeText(anthropic, text) {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1200,
    temperature: 0,
    system: TEXT_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `זהה כל מאכל בטקסט וחשב ערכים תזונתיים מדויקים.\nהחזר JSON array בלבד, ללא markdown, ללא הסבר:\n[{"name":"שם בעברית","weight_g":0,"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0,"fiber_g":0}]\nכל הערכים מספרים. weight_g חובה — קבע אותו קודם כל.\n\nהטקסט: ${text.trim()}`
    }]
  });
  // An array counts only when every element is an object, so a "[1]" in prose or in an
  // earlier field is skipped and the items array after it is found.
  const { value: items, fail } = parseReply(message, 'array', 'analyze-text', (a) => a.every(isPlainObject));
  if (items.length === 0) fail('no items');
  const totals = sumItems(items);
  // The shown name is what the user typed: only non-Hebrew letters are translated, the
  // rest (punctuation, emoji, digits) stays; no word limit, at most the food-name limit
  // of 200 characters, and a text without letters (such as "100") stays as typed.
  const { name: foodName } = await ensureHebrewDishName(anthropic, text.trim(), { mode: 'userText', maxWords: Infinity, maxChars: 200, requireHebrewLetter: false });
  return { foodName, ...totals };
}

module.exports = {
  IMAGE_SYSTEM_PROMPT,
  IMAGE_USER_MESSAGE,
  TEXT_SYSTEM_PROMPT,
  AnalysisParseError,
  analyzeImage,
  analyzeText,
  temperatureFor,
};
