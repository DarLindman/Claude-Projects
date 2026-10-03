// Cross-module UI state. Screen-private state stays in the module that owns it;
// the signed-in username lives in session.js; the session itself is an HttpOnly cookie.
import { todayStr } from './dates.js';

export const state = {
  currentScreen: 'auth',
  diaryDate: todayStr(),
  statsMonth: todayStr().slice(0, 7),
  statsYear: new Date().getFullYear().toString(),
  currentStatsTab: 'weekly',
  selectedMeal: 'lunch',
  capturedImageBase64: null,
  capturedMime: 'image/jpeg',
  photoBlob: null,   // the photo of the analysis in progress (set by analyzeFood, cleared by a text analysis); saveEntry makes the thumbnail from it
  userProfile: null,
  weightLogs: [],
  pendingRegUser: null,
  pendingRegPass: null,
  regGender: 'male',
  regActivity: 'light',
  regGoalKg: 0,
  mpGender: 'male',
  mpActivity: 'light',
  mpGoalKg: 0,
};
