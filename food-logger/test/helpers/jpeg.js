'use strict';

// Test-only JPEG builders. No file in the repo is an image: they are made here.
const { createCanvas } = require('@napi-rs/canvas');

// A real, decodable JPEG (a few hundred bytes) of the given size; `shade` varies the bytes.
function realJpeg(width = 16, height = 16, shade = 0) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = `rgb(${shade % 256}, 120, 60)`;
  ctx.fillRect(0, 0, width, height);
  return canvas.toBuffer('image/jpeg', 60);
}

// Just a header that claims `width` x `height`: SOI, a JFIF APP0, a baseline SOF0, EOI.
// Not decodable; enough for code that reads the dimensions.
function jpegHeader(width, height, { sof = 0xc0 } = {}) {
  const u16 = (n) => Buffer.from([(n >> 8) & 0xff, n & 0xff]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe0]), u16(16), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'),
    Buffer.from([0xff, sof]), u16(17), Buffer.from([8]), u16(height), u16(width),
    Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

module.exports = { realJpeg, jpegHeader };
