'use strict';

const fs = require('fs');
const path = require('path');

// The PNG icons the app ships: the iOS home-screen icon plus the sizes the web app manifest lists.
// `maskable` icons are full-bleed (the launcher applies its own shape) with the picture kept
// inside the safe zone.
const ICONS = [
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
];

// Capybara holding a salad bowl — matches favicon.svg design. Everything is drawn in the
// 44x44 units of favicon.svg and scaled to `size`.
function drawIcon(createCanvas, size, maskable) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.scale(size / 44, size / 44);

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // Orange background: rounded for the plain icons, full-bleed for the maskable one
  ctx.fillStyle = '#E8703A';
  if (maskable) ctx.fillRect(0, 0, 44, 44);
  else { roundRect(0, 0, 44, 44, 10); ctx.fill(); }

  if (maskable) {
    // The safe zone is the central circle of 40 % radius. The picture spans y 11..44, so its
    // middle (22, 27.5) is moved to the centre and it is scaled to 82 %: its farthest points
    // (the ears, the bowl rim) end up about 15.8 units from the centre, inside the 17.6 limit.
    ctx.translate(22, 22); ctx.scale(0.82, 0.82); ctx.translate(-22, -27.5);
  }

  // Body
  ctx.fillStyle = '#C4956A';
  ctx.beginPath(); ctx.ellipse(22, 32, 12, 7, 0, 0, Math.PI * 2); ctx.fill();

  // Head
  roundRect(11, 14, 22, 16, 6);
  ctx.fillStyle = '#C4956A'; ctx.fill();

  // Snout
  roundRect(14, 20, 16, 8, 4);
  ctx.fillStyle = '#b07d50'; ctx.fill();

  // Ears
  for (const ex of [14, 30]) {
    ctx.fillStyle = '#C4956A';
    ctx.beginPath(); ctx.arc(ex, 15, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e0a87a';
    ctx.beginPath(); ctx.arc(ex, 15, 2, 0, Math.PI * 2); ctx.fill();
  }

  // Eyes
  for (const [ex, ey] of [[17, 18], [27, 18]]) {
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(ex, ey, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'white';
    ctx.beginPath(); ctx.arc(ex - 0.5, ey - 0.5, 0.7, 0, Math.PI * 2); ctx.fill();
  }

  // Arms
  ctx.strokeStyle = '#b07d50'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(13, 30); ctx.quadraticCurveTo(9, 35, 9, 39); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(31, 30); ctx.quadraticCurveTo(35, 35, 35, 39); ctx.stroke();

  // Bowl body
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.moveTo(6, 37);
  ctx.quadraticCurveTo(6, 44, 22, 44);
  ctx.quadraticCurveTo(38, 44, 38, 37);
  ctx.closePath(); ctx.fill();

  // Bowl rim ellipse
  ctx.beginPath(); ctx.ellipse(22, 37, 16, 4, 0, 0, Math.PI * 2); ctx.fill();

  // 6 ingredients
  for (const [ix, iy, ir, ic] of [
    [10, 41, 2.5, '#2E7D32'],
    [16, 42.5, 2, '#EF5350'],
    [22, 43,   2, '#FFD54F'],
    [28, 42.5, 2, '#A5D6A7'],
    [34, 41,   2, '#E53935'],
    [22, 36,   2, '#2E7D32'],
  ]) {
    ctx.fillStyle = ic;
    ctx.beginPath(); ctx.arc(ix, iy, ir, 0, Math.PI * 2); ctx.fill();
  }

  return canvas.toBuffer('image/png');
}

// Renders every icon of ICONS into `publicDir` and returns the 180 px PNG (the one the
// /apple-touch-icon.png and /favicon.ico routes serve), or null when rendering fails.
function buildIcon(publicDir) {
  try {
    const { createCanvas } = require('@napi-rs/canvas');
    let apple = null;
    for (const { file, size, maskable } of ICONS) {
      const png = drawIcon(createCanvas, size, maskable);
      fs.writeFileSync(path.join(publicDir, file), png);
      if (file === 'apple-touch-icon.png') apple = png;
    }
    console.log('PWA icons generated (%d bytes for the 180 px icon)', apple.length);
    return apple;
  } catch (e) {
    console.error('icon generation failed:', e);
    return null;
  }
}

module.exports = { buildIcon, ICONS };
