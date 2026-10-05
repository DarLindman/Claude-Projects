export const MEAL_LABELS = { breakfast: 'בוקר', lunch: 'צהריים', dinner: 'ערב', snack: 'חטיף' };

// A whole number with the thousands separator used across the app (1142 -> "1,142").
// Anything that is not a finite number prints as 0, so a bad value never shows NaN.
export function formatNumber(value) {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
  return n.toLocaleString('he-IL');
}


// A weight in kg with the app's thousands separator; a fraction keeps one decimal (72.5, 1,000.5), a whole number none (70).
// Anything that is not a finite number prints as 0.
export function formatKg(value) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Number.isInteger(n) ? formatNumber(n) : n.toLocaleString('he-IL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
