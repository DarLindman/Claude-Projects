'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseJpegSize } = require('../../src/lib/image');
const { realJpeg, jpegHeader } = require('../helpers/jpeg');

test('parseJpegSize reads the size of a real JPEG', () => {
  assert.deepEqual(parseJpegSize(realJpeg(16, 16)), { width: 16, height: 16 });
  assert.deepEqual(parseJpegSize(realJpeg(40, 24)), { width: 40, height: 24 });
});

test('parseJpegSize reads crafted headers, including progressive (SOF2) ones', () => {
  assert.deepEqual(parseJpegSize(jpegHeader(2000, 1500)), { width: 2000, height: 1500 });
  assert.deepEqual(parseJpegSize(jpegHeader(640, 480, { sof: 0xc2 })), { width: 640, height: 480 });
});

test('parseJpegSize returns null for non-JPEGs, truncated or sizeless data and zero sizes', () => {
  assert.equal(parseJpegSize(null), null);
  assert.equal(parseJpegSize('a string'), null);
  assert.equal(parseJpegSize(Buffer.alloc(0)), null);
  assert.equal(parseJpegSize(Buffer.from([0xff, 0xd8, 0xff])), null);
  assert.equal(parseJpegSize(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')), null);
  assert.equal(parseJpegSize(jpegHeader(10, 10).subarray(0, 25)), null); // cut inside the SOF
  assert.equal(parseJpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), null); // ends before any SOF
  assert.equal(parseJpegSize(jpegHeader(0, 10)), null);
  assert.equal(parseJpegSize(jpegHeader(10, 0)), null);
});

test('parseJpegSize survives segment lengths that point past the end or make no progress', () => {
  assert.equal(parseJpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0, 0])), null);
  assert.equal(parseJpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0, 0])), null);
  assert.equal(parseJpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xff, 0xff, 0xff, 0xff])), null); // fill bytes only
});

test('parseJpegSize does not mistake DHT, JPG or DAC markers (C4, C8, CC) for a frame header', () => {
  for (const sof of [0xc4, 0xc8, 0xcc]) assert.equal(parseJpegSize(jpegHeader(10, 10, { sof })), null, sof.toString(16));
});
