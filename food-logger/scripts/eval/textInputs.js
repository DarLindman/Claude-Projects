'use strict';

// The built-in meal descriptions of the text evaluation (scripts/eval-text.js): realistic
// Hebrew free text as users type it, varied on purpose (simple foods, drinks, restaurant
// dishes, quantities in grams, cups and pieces, mixed items, one deliberately vague, one in
// transliterated English, one with emoji, one with Latin letters). Written generally: no
// entry is tuned to a model's behaviour.

const TEXT_INPUTS = [
  'ביצה קשה אחת',
  '2 פרוסות לחם מלא עם גבינה לבנה ומלפפון',
  'קפה הפוך',
  'כוס קולה זירו',
  'שניצל בפירורי לחם עם אורז ושעועית ירוקה',
  '100 גרם חזה עוף בגריל וסלט ירקות קטן',
  'קערת קורנפלקס עם חלב 3%',
  'פיתה עם חומוס, שניצל וסלט',
  'מנת פלאפל בפיתה עם טחינה וצ׳יפס',
  'שלוש כוסות מים ותפוח',
  'פסטה ברוטב עגבניות, כוס וחצי',
  'חצי אבטיח בינוני',
  'אכלתי משהו קטן בערב',
  'צ׳יזבורגר עם צ׳יפס',
  'מרק עוף עם אטריות וגזר 🍲',
  'פיצה מרגריטה, 3 משולשים',
  'בורקס גבינה עם ביצה וסלט',
  'חופן שקדים (כ-30 גרם) ובננה',
  'בירה 330 מ״ל ושקית במבה',
  'שקשוקה עם 2 ביצים ולחם לטבול',
  'סושי: 8 יחידות סלמון ואבוקדו',
  'chicken שווארמה בלאפה',
];

module.exports = { TEXT_INPUTS };
