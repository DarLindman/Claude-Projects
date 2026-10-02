export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export function formatDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const days = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
  const months = ['ינו׳','פבר׳','מרץ','אפר׳','מאי','יוני','יולי','אוג׳','ספט׳','אוק׳','נוב׳','דצמ׳'];
  const isToday = str === todayStr();
  const label = isToday ? 'היום' : `יום ${days[date.getDay()]}`;
  // "1 באוק׳", "1 במרץ": the day of the month takes the prefix ב before the month name
  return `${label}, ${date.getDate()} ב${months[date.getMonth()]}`;
}

// A number of days in words: "יום אחד" for one, "N ימים" otherwise.
export function formatDayCount(n) {
  return n === 1 ? 'יום אחד' : `${n} ימים`;
}

export function formatMonth(str) {
  const [y, m] = str.split('-');
  const months = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  return `${months[+m - 1]} ${y}`;
}

export function addDays(str, n) {
  const [y, m, d] = str.split('-').map(Number);
  const date = new Date(y, m - 1, d + n);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
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
