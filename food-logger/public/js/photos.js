// Meal thumbnails. The server stores one small JPEG per meal and serves it to its owner.
import { apiFetch } from './api.js';
import { setHtml } from './dom.js';
import { plateSvg } from './placeholder.js';

// The thumbnail of a meal. The server keeps one per meal and sends it with a year-long immutable cache header, so a
// replaced thumbnail would show stale from the browser cache: a caller that ever replaces one passes a new `version`
// (a timestamp) and gets a different URL, which the cache has never seen. Nothing replaces a thumbnail yet.
export function photoSrc(id, version) {
  return version === undefined || version === null ? `/api/food/${id}/photo` : `/api/food/${id}/photo?v=${encodeURIComponent(version)}`;
}

const THUMB_MAX_BYTES = 110 * 1024;   // the server accepts 120 KB; a little room for the transport

// A JPEG blob from the base64 text the analysis request is built from (no decoding, no canvas).
export function blobFromBase64(b64, mime = 'image/jpeg') {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const decodeImage = (blob) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
  img.src = url;
});
const canvasToJpeg = (canvas, quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

// A small JPEG of the meal for the diary: the longest side at most `maxSide`, never enlarged. When the result is over
// 110 KB it is encoded once more at quality 0.5; when that is still too big, or anything at all goes wrong (an
// unreadable image, no canvas), the answer is null and the meal simply has no thumbnail. Never throws.
export async function makeThumbnail(blob, { maxSide = 480, quality = 0.7 } = {}) {
  try {
    if (!blob || !blob.size) return null;   // nothing to decode (an empty blob would even raise a CSP report)
    const img = await decodeImage(blob);
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    let out = await canvasToJpeg(canvas, quality);
    if (out && out.size > THUMB_MAX_BYTES && quality > 0.5) out = await canvasToJpeg(canvas, 0.5);
    if (!out || out.type !== 'image/jpeg' || out.size > THUMB_MAX_BYTES) return null;
    return out;
  } catch {
    return null;
  }
}

// PUT the thumbnail of a saved meal. true only when the server answered 200 { ok: true }; every failure (a rejected
// request, an error status, the network down) is false and never throws, so a thumbnail can never block a meal.
// `silent`: a lost session here must not log the user out in the middle of the save celebration.
export async function uploadThumbnail(foodId, blob) {
  try {
    const data = await apiFetch(photoSrc(foodId), { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob, silent: true });
    return data?.ok === true;
  } catch {
    return false;
  }
}

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
