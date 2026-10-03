export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// "HH:mm" of the local clock.
export function nowTimeStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// Whole days from fromStr to toStr (both YYYY-MM-DD). Date.UTC keeps any time zone out of it.
export function daysBetween(fromStr, toStr) {
  const [fy, fm, fd] = fromStr.split('-').map(Number);
  const [ty, tm, td] = toStr.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

const WEEKDAYS = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];   // Sunday first, like Date.getDay()
const MONTHS_SHORT = ['ינו׳','פבר׳','מרץ','אפר׳','מאי','יוני','יולי','אוג׳','ספט׳','אוק׳','נוב׳','דצמ׳'];
const MONTHS_FULL = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

export function formatDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const isToday = str === todayStr();
  const label = isToday ? 'היום' : `יום ${WEEKDAYS[date.getDay()]}`;
  // "1 באוק׳", "1 במרץ": the day of the month takes the prefix ב before the month name
  return `${label}, ${date.getDate()} ב${MONTHS_SHORT[date.getMonth()]}`;
}

// The home page's title: "שבת, 3 באוקטובר" (the weekday, then the day of the month with the full month name).
export function formatDateTitle(str) {
  const [y, m, d] = str.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ב${MONTHS_FULL[date.getMonth()]}`;
}

// A number of days in words: "יום אחד" for one, "N ימים" otherwise.
export function formatDayCount(n) {
  return n === 1 ? 'יום אחד' : `${n} ימים`;
}

export function formatMonth(str) {
  const [y, m] = str.split('-');
  return `${MONTHS_FULL[+m - 1]} ${y}`;
}

export function addDays(str, n) {
  const [y, m, d] = str.split('-').map(Number);
  const date = new Date(y, m - 1, d + n);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

// The seven YYYY-MM-DD strings of the Sunday-Saturday week that holds `str` (calendar arithmetic only: Date.UTC for the weekday, addDays for the rest).
export function weekOf(str) {
  const [y, m, d] = str.split('-').map(Number);
  const sunday = addDays(str, -new Date(Date.UTC(y, m - 1, d)).getUTCDay());
  return Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
}

export function addMonths(str, n) {
  const [y, m] = str.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function formatDateShort(str) {
  const [y, m, d] = str.split('-').map(Number);
  return `${d}/${m}`;
}

// The Hebrew letter of the weekday of `str` (YYYY-MM-DD) with a geresh: "א׳" is Sunday. Date.UTC keeps any time zone out of it.
const DAY_LETTERS = ['א','ב','ג','ד','ה','ו','ש'];
export function weekdayLetter(str) {
  const [y, m, d] = str.split('-').map(Number);
  return `${DAY_LETTERS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}׳`;
}

// Every day of the month `ym` (YYYY-MM) as YYYY-MM-DD, in calendar order.
export function monthDays(ym) {
  const [y, m] = ym.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);
}

// The twelve months of `year` as YYYY-MM.
export function yearMonths(year) {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
}
