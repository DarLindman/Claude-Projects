'use strict';

const { MODEL } = require('./anthropic');
const { ensureHebrewDishName, cleanDishName } = require('./hebrewName');

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

סדר העבודה בתשובה — קודם מזהים, אחר כך קובעים שם:
1. visual_description — קודם כול תאר באנגלית, במשפט קצר וניטרלי, מה רואים בתמונה: המרכיב העיקרי, אופן ההכנה והתוספות. זה שלב הזיהוי בלבד, עדיין בלי שם למנה.
2. dish_name — רק אחרי התיאור קבע את שם המנה בעברית, לפי כללי השמות שלהלן. אל תעתיק מילים מהתיאור האנגלי ואל תתרגם אותו מילה במילה: שאל את עצמך איך ישראלי היה קורא למנה הזאת.
3. items — המרכיבים והערכים התזונתיים, לפי השיטה שלמעלה.

כללי השמות ל-dish_name:
המשתמש קורא את השם ביומן האוכל שלו וצריך לזהות בו מיד את הארוחה שלו. לכן השם צריך להיות במילים שהוא עצמו היה אומר, ולא תרגום, תעתיק או מונח מקצועי.
- השם שישראלי ממוצע היה אומר: כפי שהמנה כתובה בתפריט של מסעדה, כפי שהמוצר נקרא בסופר, או כפי שהיה מספר לחבר מה אכל.
- המילה היומיומית עדיפה על תעתיק של מילה לועזית, על מילה מיושנת ועל מילה נדירה או תנ"כית: מילים כאלה נשמעות מוזרות, והמשתמש לא מזהה בהן את האוכל שלו.
- מילה לועזית מותרת רק כשהיא המילה העברית המקובלת לאותו מאכל (כמו פסטה, פיצה, המבורגר).
- אם למנה יש שם מוכר, השתמש בו במקום לפרט את המרכיבים שלה.
- קצר ומדויק: המרכיב העיקרי, ואופן ההכנה רק כשהוא חשוב (מטוגן, צלוי, אפוי), עד חמש מילים בערך. בלי "בצלחת יש", בלי רשימה של כל המרכיבים ובלי מידת עשייה.
- אותיות עבריות בלבד: בלי אותיות לטיניות, סיניות או של כל כתב אחר, בלי אמוג'י, ובלי לכתוב מילה זרה בכתב המקורי שלה.

דוגמאות להמחשה בלבד. הן מסבירות את העיקרון ואינן רשימה לחיפוש; אותו היגיון חל על כל מאכל אחר, גם על מאכלים שלא מופיעים כאן:
* פרוסת עוף בציפוי פירורי לחם, מטוגנת: "שניצל", ולא תעתיק כמו "קאטלט" — שניצל הוא השם שכל ישראלי אומר.
* לחמנייה עם קציצת בשר טחון צלויה: "המבורגר" — מילה לועזית, אבל זו המילה המקובלת בעברית.
* מרק סמיך של עדשים: "מרק עדשים", ולא מילה תנ"כית כמו "נזיד".
* כדורי פלאפל בתוך פיתה עם סלט וטחינה: "פלאפל בפיתה" — השם המוכר, בלי לפרט כל מה שיש בפיתה.
* חזה עוף צלוי ולידו אורז: "חזה עוף צלוי עם אורז" — המרכיב העיקרי, אופן ההכנה והתוספת.`;

// The user message of the image request: the reply fields in the order the model
// fills them (recognise, then name, then the nutrition items).
const IMAGE_USER_MESSAGE = `זהה כל מרכיב בנפרד. השב עם JSON object בלבד, ללא markdown, והשדות בסדר הזה:\n{"visual_description":"short neutral English description","dish_name":"שם המנה","items":[{"name":"שם בעברית","weight_g":0,"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0,"fiber_g":0}]}\nvisual_description קודם (זיהוי), אחריו dish_name לפי כללי השמות, ורק אז items.\nweight_g קודם — אז חשב קלוריות לפי weight_g בלבד.`;

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

const sumItems = (items) => items.reduce((acc, item) => ({
  calories: acc.calories + (Number(item.calories) || 0),
  protein_g: acc.protein_g + (Number(item.protein_g) || 0),
  carbs_g: acc.carbs_g + (Number(item.carbs_g) || 0),
  fat_g: acc.fat_g + (Number(item.fat_g) || 0),
  fiber_g: acc.fiber_g + (Number(item.fiber_g) || 0),
}), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 });

// ─── Analyze food image ───────────────────────────────────────────────────────
async function analyzeImage(anthropic, { imageBase64, mimeType }) {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1300, // the items plus room for visual_description
    temperature: 0,
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

  // The reply describes the user's meal (visual_description), so it is never logged:
  // a failure logs only its kind and the reply length (a JSON.parse message can quote
  // the input, so it is not passed on either).
  const raw = message.content[0].text.trim();
  let parsed;
  try {
    const objMatch = raw.match(/\{[\s\S]*\}/);
    if (objMatch) parsed = JSON.parse(objMatch[0]);
  } catch {
    console.error(`[analyze] JSON parse error (reply of ${raw.length} characters)`);
    throw new AnalysisParseError('invalid JSON');
  }
  if (!parsed) {
    console.error(`[analyze] no JSON object found (reply of ${raw.length} characters)`);
    throw new AnalysisParseError('no JSON object found');
  }
  const items = parsed.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new AnalysisParseError('no items');
  }
  // visual_description is only the model's recognition step: it is never read here,
  // so it is not returned, stored or logged. Item names are cleaned defensively but not
  // returned; dish_name goes through the guard as is (missing or of any type it becomes
  // the default name)
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
  const raw = message.content[0].text.trim();
  const arrMatch = raw.match(/\[[\s\S]*\]/);
  if (!arrMatch) {
    console.error('[analyze-text] no JSON array found in response');
    throw new AnalysisParseError('no JSON array found');
  }
  let items;
  try { items = JSON.parse(arrMatch[0]); }
  catch (parseErr) {
    console.error('[analyze-text] JSON parse error:', parseErr.message, '\nmatched:', arrMatch[0]);
    throw new AnalysisParseError(parseErr.message);
  }
  if (!Array.isArray(items) || items.length === 0) throw new AnalysisParseError('no items');
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
};
