'use strict';

// Finds the photos to evaluate. The real type comes from the magic bytes
// (detectImageType), never from the extension; everything else is skipped with a reason.

const path = require('node:path');
const { detectImageType } = require('../../src/lib/image');

const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MAX_BYTES = 5 * 1024 * 1024; // the API limit for one image

async function loadPhotos(dir, { listFiles, readFile }) {
  let names;
  try {
    names = await listFiles(dir);
  } catch (err) {
    if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') return { error: `Photo directory not found: ${dir}` };
    return { error: `Cannot read the photo directory ${dir}: ${err?.message}` };
  }
  const photos = [];
  const skipped = [];
  for (const file of [...names].sort()) {
    if (file.startsWith('.')) continue;
    if (!EXTENSIONS.has(path.extname(file).toLowerCase())) {
      skipped.push({ file, reason: 'not a photo (extension is not jpg, jpeg, png, webp or gif)' });
      continue;
    }
    const full = path.join(dir, file);
    let bytes;
    try {
      bytes = await readFile(full);
    } catch {
      skipped.push({ file, reason: 'cannot be read' });
      continue;
    }
    const mimeType = detectImageType(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
    if (!mimeType) skipped.push({ file, reason: 'the content is not a jpeg, png, webp or gif image' });
    else if (bytes.length > MAX_BYTES) skipped.push({ file, reason: 'larger than 5 MB, too big for the API' });
    else photos.push({ file, path: full, bytes: Buffer.from(bytes), mimeType });
  }
  if (photos.length === 0) return { error: `No photos found in ${dir} (jpg, jpeg, png, webp, gif)`, skipped };
  return { photos, skipped };
}

module.exports = { loadPhotos };
