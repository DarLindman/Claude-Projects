import { actions as modalActions } from './dom.js';
import { bindActions } from './events.js';
import { stopFireCanvas } from './effects.js';
import { _cameraCapyState } from './pet.js';
import { loadProfile } from './profile.js';
import { actions as navActions, registerScreen } from './router.js';
import { actions as analysisActions } from './screens/analysis.js';
import { actions as authActions, doLogin, doRegister, enterAuth, leaveAuth } from './screens/auth.js';
import { actions as cameraActions, animatePlaceholder, autoResizeTextarea } from './screens/camera.js';
import { animateDashStagger, loadDashboard } from './screens/dashboard.js';
import { actions as homeActions, loadDiary } from './screens/home.js';
import { actions as settingsActions, populateProfileSelects } from './screens/settings.js';
import { actions as statsActions, loadStats, stopStatsCapyWalk } from './screens/stats.js';
import { actions as weightActions, loadWeightScreen } from './screens/weight.js';
import { actions as welcomeActions, mountWelcomePet } from './screens/welcome.js';
import { bootSession } from './session.js';

// ════════════════════════════════════════════════════
// Init
// ════════════════════════════════════════════════════
// Screen hooks: the per-screen enter/leave behaviour that navigate() used to hard-code.
// Registration order matches the order of the original if/else chain in navigate().
registerScreen('auth',      { enter: enterAuth, leave: leaveAuth });
registerScreen('dashboard', { enter: () => { loadDashboard(); animateDashStagger(); }, leave: stopFireCanvas });
registerScreen('home',      { enter: loadDiary });
registerScreen('stats',     { enter: () => { loadStats(); }, leave: stopStatsCapyWalk });
registerScreen('weight',    { enter: loadWeightScreen });
registerScreen('camera',    { enter: animatePlaceholder });
registerScreen('analysis',  { enter: () => _cameraCapyState('neutral') });

populateProfileSelects();
mountWelcomePet();
loadProfile();

// The session is an HttpOnly cookie: ask the server whether it is still valid.
bootSession();

document.getElementById('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.getElementById('reg-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });
document.getElementById('res-name').addEventListener('input', function() { autoResizeTextarea(this); });
document.getElementById('food-text-input').addEventListener('input', function() { autoResizeTextarea(this); });

// Event delegation: markup names actions (data-action / data-change), see events.js.
// One listener pair per screen root, per modal and on the bottom nav; navigation and modal
// actions are shared by all of them. Modals live outside the screens; the edit-meal modal
// is driven by the diary's actions.
const shared = { ...navActions, ...modalActions };
const roots = {
  '#screen-welcome':   welcomeActions,
  '#screen-auth':      authActions,
  '#screen-dashboard': {},
  '#screen-home':      homeActions,
  '#screen-camera':    cameraActions,
  '#screen-analysis':  analysisActions,
  '#screen-stats':     statsActions,
  '#screen-weight':    weightActions,
  '#screen-settings':  settingsActions,
  '#bottom-nav':       {},
  '#modal-change-pass': settingsActions,
  '#modal-profile':    settingsActions,
  '#edit-modal':       homeActions,
};
for (const [selector, actions] of Object.entries(roots)) {
  bindActions(document.querySelector(selector), { ...shared, ...actions });
}
