// The neutral picture shown where a meal has no thumbnail: a plate seen from above on a cream cloth, hand-drawn
// like the rest of the diary. Pure markup (no ids, so any number of copies can be on the page at once); it fills
// its box, so the caller sizes the parent. Returns a Trusted fragment (see dom.js). The `wobS` filter lives in the
// hidden SVG of index.html.
import { raw } from './dom.js';

export function plateSvg() {
  return raw(
    '<svg class="plate-ph" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">' +
    '<rect width="100" height="100" fill="#efe3c9"/>' +
    '<g filter="url(#wobS)">' +
    '<ellipse cx="51" cy="54" rx="40" ry="39" fill="#8a6a45" opacity=".22"/>' +                     // soft shadow under the plate
    '<circle cx="50" cy="50" r="39" fill="#fffdf6" stroke="#6b4426" stroke-width="1.6" stroke-opacity=".7"/>' +
    '<circle cx="50" cy="50" r="29" fill="#f5ecd9" stroke="#6b4426" stroke-width="1.1" stroke-opacity=".45"/>' +
    '<path d="M36 44c4-6 10-8 16-6" fill="none" stroke="#fffdf6" stroke-width="2.4" stroke-linecap="round" opacity=".9"/>' + // a glint on the rim
    '</g>' +
    '</svg>'
  );
}
