'use strict';

const fs = require('fs');
const path = require('path');

// Capybara holding a salad bowl — matches favicon.svg design, scaled to 180×180
function buildIcon(publicDir) {
  try {
    const { createCanvas } = require('@napi-rs/canvas');
    const size = 180;
    const s = size / 44; // scale factor from 44×44 favicon.svg viewBox
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
    }

    // Orange rounded background
    roundRect(0, 0, size, size, 10 * s);
    ctx.fillStyle = '#E8703A'; ctx.fill();

    // Body
    ctx.fillStyle = '#C4956A';
    ctx.beginPath(); ctx.ellipse(22*s, 32*s, 12*s, 7*s, 0, 0, Math.PI*2); ctx.fill();

    // Head
    roundRect(11*s, 14*s, 22*s, 16*s, 6*s);
    ctx.fillStyle = '#C4956A'; ctx.fill();

    // Snout
    roundRect(14*s, 20*s, 16*s, 8*s, 4*s);
    ctx.fillStyle = '#b07d50'; ctx.fill();

    // Left ear
    ctx.fillStyle = '#C4956A';
    ctx.beginPath(); ctx.arc(14*s, 15*s, 4*s, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#e0a87a';
    ctx.beginPath(); ctx.arc(14*s, 15*s, 2*s, 0, Math.PI*2); ctx.fill();

    // Right ear
    ctx.fillStyle = '#C4956A';
    ctx.beginPath(); ctx.arc(30*s, 15*s, 4*s, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#e0a87a';
    ctx.beginPath(); ctx.arc(30*s, 15*s, 2*s, 0, Math.PI*2); ctx.fill();

    // Eyes
    for (const [ex, ey] of [[17, 18], [27, 18]]) {
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath(); ctx.arc(ex*s, ey*s, 2.5*s, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = 'white';
      ctx.beginPath(); ctx.arc((ex-0.5)*s, (ey-0.5)*s, 0.7*s, 0, Math.PI*2); ctx.fill();
    }

    // Arms
    ctx.strokeStyle = '#b07d50'; ctx.lineWidth = 2.5*s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(13*s, 30*s); ctx.quadraticCurveTo(9*s, 35*s, 9*s, 39*s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(31*s, 30*s); ctx.quadraticCurveTo(35*s, 35*s, 35*s, 39*s); ctx.stroke();

    // Bowl body
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.moveTo(6*s, 37*s);
    ctx.quadraticCurveTo(6*s, 44*s, 22*s, 44*s);
    ctx.quadraticCurveTo(38*s, 44*s, 38*s, 37*s);
    ctx.closePath(); ctx.fill();

    // Bowl rim ellipse
    ctx.beginPath(); ctx.ellipse(22*s, 37*s, 16*s, 4*s, 0, 0, Math.PI*2); ctx.fill();

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
      ctx.beginPath(); ctx.arc(ix*s, iy*s, ir*s, 0, Math.PI*2); ctx.fill();
    }

    const png = canvas.toBuffer('image/png');
    fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), png);
    console.log('PWA icon generated (%d bytes)', png.length);
    return png;
  } catch (e) {
    console.error('icon generation failed:', e);
    return null;
  }
}

module.exports = { buildIcon };
