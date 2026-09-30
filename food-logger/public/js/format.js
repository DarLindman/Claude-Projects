export const MEAL_LABELS = { breakfast: 'בוקר', lunch: 'צהריים', dinner: 'ערב', snack: 'חטיף' };
export const MEAL_BADGE = { breakfast: 'badge-breakfast', lunch: 'badge-lunch', dinner: 'badge-dinner', snack: 'badge-snack' };

const FOOD_EMOJI_MAP = [
  [['עוף','chicken','שניצל','קציצ'], '🍗'],
  [['בשר','סטייק','steak','כבד'], '🥩'],
  [['דג','fish','סלמון','salmon','טונה','tuna','בס','דניס','פילה דג'], '🐟'],
  [['סלט','salad'], '🥗'],
  [['פסטה','pasta','ספגטי','spaghetti','פנה','לזניה'], '🍝'],
  [['פיצה','pizza'], '🍕'],
  [['סושי','sushi','מאקי'], '🍱'],
  [['בורגר','המבורגר','burger','hamburger'], '🍔'],
  [['אורז','rice'], '🍚'],
  [['לחם','toast','טוסט','כריך','sandwich','פיתה','לאפה','בגט'], '🥪'],
  [['קרואסון','croissant'], '🥐'],
  [['ביצה','egg','חביתה','שקשוקה'], '🍳'],
  [['גבינה','cheese'], '🧀'],
  [['אבוקדו','avocado'], '🥑'],
  [['חומוס','hummus'], '🫘'],
  [['פלאפל','falafel'], '🧆'],
  [['מרק','soup'], '🍲'],
  [['יוגורט','yogurt','גביע'], '🥛'],
  [['שייק חלבון','protein shake','אבקת חלבון'], '💪'],
  [['שייק','smoothie','shake'], '🥤'],
  [['קפה','coffee','לאטה','קפוצ'], '☕'],
  [['תה','tea'], '🍵'],
  [['מיץ','juice'], '🧃'],
  [['שוקולד','chocolate'], '🍫'],
  [['עוגה','cake','קינוח','brownie'], '🎂'],
  [['גלידה','ice cream','ארטיק'], '🍦'],
  [['חטיף','chips','צ\'יפס','בייגל'], '🍿'],
  [['שקדים','almonds','אגוז','nuts','קשיו','פיסטוק'], '🥜'],
  [['בננה','banana'], '🍌'],
  [['תפוח','apple'], '🍎'],
  [['תות','strawberry'], '🍓'],
  [['ענב','grape'], '🍇'],
  [['מנגו','mango'], '🥭'],
  [['תפוז','orange','מיץ תפוזים'], '🍊'],
  [['אננס','pineapple'], '🍍'],
  [['אבטיח','watermelon'], '🍉'],
  [['ירקות','vegetable','ברוקולי','כרוב','גזר'], '🥦'],
  [['תירס','corn'], '🌽'],
  [['בטטה','sweet potato'], '🍠'],
  [['תפוח אדמה','potato'], '🥔'],
  [['וופל','waffle'], '🧇'],
  [['פנקייק','pancake'], '🥞'],
];

export function getFoodEmoji(name) {
  const n = (name || '').toLowerCase();
  for (const [keywords, emoji] of FOOD_EMOJI_MAP) {
    if (keywords.some(k => n.includes(k))) return emoji;
  }
  return '🍽️';
}
