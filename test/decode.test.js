import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeFloat32LE,
  encodeUint32LE,
  float32LE,
  int16,
  scaled,
  string,
  uint32BE,
  uint32LE,
  uint64LE,
} from '../src/solaredge/decode.js';

test('integers decode in both word orders', () => {
  assert.equal(int16([0xfffe], 0), -2);
  assert.equal(uint32BE([0x0001, 0x0002], 0), 0x10002);
  assert.equal(uint32LE([0x0002, 0x0001], 0), 0x10002);
  assert.equal(uint64LE([1, 0, 0, 0], 0), 1);
  assert.equal(uint64LE([0, 1, 0, 0], 0), 0x10000);
  assert.deepEqual(encodeUint32LE(3600), [3600, 0]);
});

test('StorEdge floats are low word first, NaN reads as null', () => {
  assert.deepEqual(encodeFloat32LE(20), [0x0000, 0x41a0]);
  assert.equal(float32LE(encodeFloat32LE(1234.5), 0), 1234.5);
  assert.equal(float32LE([0xffff, 0xff7f], 0), -3.4028234663852886e38);
  assert.equal(float32LE([0x0000, 0x7fc0], 0), null);
});

test('scale factors apply, sentinels read as null', () => {
  assert.equal(scaled(2305, -1), 230.5);
  assert.equal(scaled(12, 2), 1200);
  assert.equal(scaled(0xffff, 0), null);
  assert.equal(scaled(-0x8000, 0, 'int16'), null);
  assert.equal(scaled(100, -0x8000), null);
});

test('strings stop at the first NUL and are trimmed', () => {
  assert.equal(string([0x5365, 0x2000, 0x4142], 0, 3), 'Se');
  assert.equal(string([0x4142, 0x4320], 0, 2), 'ABC');
});
