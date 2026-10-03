// Meal thumbnails. The server stores one small JPEG per meal and serves it to its owner.
import { setHtml } from './dom.js';
import { plateSvg } from './placeholder.js';

export function photoSrc(id) { return `/api/food/${id}/photo`; }

// A thumbnail that fails to load (404, offline) is replaced by the drawn plate, inside the same polaroid frame, so a
// broken image is never shown. Every meal thumbnail <img> carries `data-photo`. Images do not bubble their error
// event and the CSP forbids onerror attributes, so one capturing listener on the document serves every screen.
// The replacement is an <svg>, so it can never fail again; the flag stops a second event on the same element.
export function installPhotoFallback() {
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.hasAttribute('data-photo') || img.dataset.photoFailed) return;
    img.dataset.photoFailed = '1';
    const holder = document.createElement('div');
    setHtml(holder, plateSvg());
    img.replaceWith(...holder.childNodes);
  }, { capture: true });
}
