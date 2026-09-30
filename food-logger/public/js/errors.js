// Error-code table: the single place that maps server error codes to Hebrew text.
// Keys are either a code ("NOT_FOUND") or "field:FIELDCODE" ("food_name:REQUIRED") for
// per-field validation errors. Sub-project 2 extends this with English.
export const errors = {
  // per-field validation errors
  'food_name:REQUIRED': 'שם האוכל חסר',
  'food_name:TOO_LONG': 'שם האוכל ארוך מדי (מקסימום 200 תווים)',
  'food_name:INVALID': 'שם האוכל לא תקין',
  'meal_type:REQUIRED': 'סוג ארוחה לא תקין',
  'meal_type:INVALID': 'סוג ארוחה לא תקין',
  'weight_kg:REQUIRED': 'משקל לא תקין',
  'weight_kg:INVALID': 'משקל לא תקין',
  'text:REQUIRED': 'לא הוזן טקסט',
  'text:TOO_LONG': 'תיאור ארוך מדי (מקסימום 500 תווים)',
  'imageBase64:REQUIRED': 'לא נבחרה תמונה',
  'username:REQUIRED': 'שם משתמש או סיסמא שגויים',
  'username:INVALID': 'שם משתמש חייב להכיל 3–50 תווים, סיסמא לפחות 6',
  'username:TOO_LONG': 'שם משתמש חייב להכיל 3–50 תווים, סיסמא לפחות 6',
  'password:REQUIRED': 'שם משתמש או סיסמא שגויים',
  'password:INVALID': 'שם משתמש חייב להכיל 3–50 תווים, סיסמא לפחות 6',
  'password:TOO_LONG': 'הסיסמא ארוכה מדי',
  'newPassword:REQUIRED': 'סיסמא חדשה חייבת להכיל לפחות 6 תווים',
  'newPassword:INVALID': 'סיסמא חדשה חייבת להכיל לפחות 6 תווים',
  'newPassword:TOO_LONG': 'הסיסמא ארוכה מדי',
  // codes
  UNAUTHORIZED: 'החיבור פג, יש להתחבר מחדש',
  SESSION_EXPIRED: 'החיבור פג, יש להתחבר מחדש',
  INVALID_CREDENTIALS: 'שם משתמש או סיסמא שגויים',
  WRONG_CURRENT_PASSWORD: 'סיסמא נוכחית שגויה',
  USERNAME_TAKEN: 'שם המשתמש כבר קיים',
  WEAK_PASSWORD: 'סיסמא חייבת להכיל לפחות 8 תווים',
  PASSWORD_TOO_LONG: 'הסיסמא ארוכה מדי (מקסימום 72 בתים)',
  NOT_FOUND: 'לא נמצא',
  AI_UNAVAILABLE: 'לא ניתן לנתח את תגובת ה-AI',
  IMAGE_INVALID: 'התמונה אינה תקינה, נסה תמונה אחרת',
  RATE_LIMITED: 'יותר מדי בקשות, נסה שוב מאוחר יותר',
  CSRF: 'הבקשה נדחתה, נסה לרענן את הדף',
  VALIDATION: 'הנתונים שהוזנו אינם תקינים',
  INTERNAL: 'שגיאת שרת',
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
