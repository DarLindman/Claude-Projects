'use strict';

// Detects an image's real type from its magic bytes; the client's declared
// MIME type is never trusted. Returns null for anything else.
const startsWith = (buf, bytes, offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

function detectImageType(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buf, ascii('GIF87a')) || startsWith(buf, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(buf, ascii('RIFF')) && startsWith(buf, ascii('WEBP'), 8)) return 'image/webp';
  return null;
}

// Pixel size from a JPEG's frame header (SOF), without decoding the picture. Walks the marker
// segments from the start; returns { width, height } or null when the data is not a JPEG, ends
// before a frame header, or has a zero size. Never throws and never reads past the buffer.
// C4 (DHT), C8 (JPG) and CC (DAC) share the C0-CF range but are not frame headers.
function parseJpegSize(buf) {
  if (!Buffer.isBuffer(buf) || !startsWith(buf, [0xff, 0xd8, 0xff])) return null;
  let pos = 2;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) return null;
    const marker = buf[pos + 1];
    if (marker === 0xff) { pos += 1; continue; } // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; } // no length
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan before any frame header
    const length = buf.readUInt16BE(pos + 2);
    if (length < 2) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (length < 8 || pos + 9 > buf.length) return null;
      const height = buf.readUInt16BE(pos + 5);
      const width = buf.readUInt16BE(pos + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    pos += 2 + length;
  }
  return null;
}

module.exports = { detectImageType, parseJpegSize };
