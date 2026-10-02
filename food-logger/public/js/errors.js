// Error-code table: the single place that maps server error codes to Hebrew text.
// Keys are either a code ("NOT_FOUND") or "field:FIELDCODE" ("food_name:REQUIRED") for
// per-field validation errors. Sub-project 2 extends this with English.
export const errors = {
  // per-field validation errors
  'food_name:REQUIRED': 'שם המנה חסר',
  'food_name:TOO_LONG': 'שם המנה ארוך מדי (מקסימום 200 תווים)',
  'food_name:INVALID': 'שם המנה לא תקין',
  'meal_type:REQUIRED': 'סוג ארוחה לא תקין',
  'meal_type:INVALID': 'סוג ארוחה לא תקין',
  'weight_kg:REQUIRED': 'משקל לא תקין',
  'weight_kg:INVALID': 'משקל לא תקין',
  'text:REQUIRED': 'לא הוזן טקסט',
  'text:TOO_LONG': 'התיאור ארוך מדי (מקסימום 500 תווים)',
  'imageBase64:REQUIRED': 'לא נבחרה תמונה',
  'username:REQUIRED': 'שם משתמש או סיסמה שגויים',
  'username:INVALID': 'שם המשתמש צריך להכיל 3–50 תווים, והסיסמה לפחות 8 תווים',
  'username:TOO_LONG': 'שם המשתמש צריך להכיל 3–50 תווים, והסיסמה לפחות 8 תווים',
  'password:REQUIRED': 'שם משתמש או סיסמה שגויים',
  'password:INVALID': 'שם המשתמש צריך להכיל 3–50 תווים, והסיסמה לפחות 8 תווים',
  'password:TOO_LONG': 'הסיסמה ארוכה מדי',
  'newPassword:REQUIRED': 'סיסמה חדשה חייבת להכיל לפחות 8 תווים',
  'newPassword:INVALID': 'סיסמה חדשה חייבת להכיל לפחות 8 תווים',
  'newPassword:TOO_LONG': 'הסיסמה ארוכה מדי',
  // codes
  UNAUTHORIZED: 'פג תוקף החיבור, יש להתחבר מחדש',
  SESSION_EXPIRED: 'פג תוקף החיבור, יש להתחבר מחדש',
  INVALID_CREDENTIALS: 'שם משתמש או סיסמה שגויים',
  WRONG_CURRENT_PASSWORD: 'סיסמה נוכחית שגויה',
  USERNAME_TAKEN: 'שם המשתמש כבר קיים',
  WEAK_PASSWORD: 'סיסמה חייבת להכיל לפחות 8 תווים',
  PASSWORD_TOO_LONG: 'הסיסמה ארוכה מדי',
  NOT_FOUND: 'הפריט לא נמצא',
  AI_UNAVAILABLE: 'הניתוח לא הצליח, נסה שוב בעוד רגע',
  IMAGE_INVALID: 'התמונה אינה תקינה, נסה תמונה אחרת',
  RATE_LIMITED: 'יותר מדי בקשות, נסה שוב מאוחר יותר',
  CSRF: 'הבקשה נדחתה, נסה לרענן את הדף',
  VALIDATION: 'הנתונים שהוזנו אינם תקינים',
  INTERNAL: 'משהו השתבש, נסה שוב',
};

// The message to show for a failed apiFetch. Unknown codes (and non-API errors such as
// a network failure) fall back to the generic server-error text.
export function messageFor(err) {
  const fields = err && err.fields;
  if (fields && typeof fields === 'object') {
    for (const [field, code] of Object.entries(fields)) {
      const m = errors[`${field}:${code}`];
      if (m) return m;
    }
  }
  return (err && errors[err.code]) || errors.INTERNAL;
}

// An AI analysis (camera screen, recalculation in the edit modal) that hit the hourly
// limit gets its own text; any other failure uses messageFor.
export const ANALYSIS_LIMIT = 'הגעת למגבלת הניתוחים לשעה, נסה שוב מאוחר יותר';
export function analysisMessageFor(err) {
  return err && (err.code === 'RATE_LIMITED' || err.status === 429) ? ANALYSIS_LIMIT : messageFor(err);
}
