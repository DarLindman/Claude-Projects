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
  return `${label}, ${date.getDate()} ${months[date.getMonth()]}`;
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
