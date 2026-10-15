import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ModbusException,
  buildReadRequest,
  buildWriteMultipleRequest,
  buildWriteSingleRequest,
  extractFrames,
  parseResponse,
} from '../src/modbus/frame.js';

test('a read request carries the MBAP header and the PDU', () => {
  const frame = buildReadRequest(0x0102, 1, 40000, 69);
  assert.deepEqual(
    [...frame],
    [0x01, 0x02, 0x00, 0x00, 0x00, 0x06, 0x01, 0x03, 0x9c, 0x40, 0x00, 0x45],
  );
});

test('write requests encode their values', () => {
  assert.deepEqual(
    [...buildWriteSingleRequest(1, 1, 0xf001, 80).subarray(7)],
    [0x06, 0xf0, 0x01, 0, 80],
  );
  assert.deepEqual(
    [...buildWriteMultipleRequest(1, 1, 0xe008, [0x0000, 0x41a0]).subarray(7)],
    [0x10, 0xe0, 0x08, 0, 2, 4, 0x00, 0x00, 0x41, 0xa0],
  );
});

test('requests refuse out-of-range addresses and counts', () => {
  assert.throws(() => buildReadRequest(1, 1, 70000, 1), RangeError);
  assert.throws(() => buildReadRequest(1, 1, 40000, 126), RangeError);
  assert.throws(() => buildWriteMultipleRequest(1, 1, 0, []), RangeError);
});

test('extractFrames reassembles split and merged frames', () => {
  const a = Buffer.from([0, 1, 0, 0, 0, 5, 1, 3, 2, 0x12, 0x34]);
  const b = Buffer.from([0, 2, 0, 0, 0, 3, 1, 0x83, 2]);
  const first = extractFrames(Buffer.concat([a, b.subarray(0, 4)]));
  assert.equal(first.frames.length, 1);
  assert.equal(first.frames[0].transactionId, 1);
  const second = extractFrames(Buffer.concat([first.rest, b.subarray(4)]));
  assert.equal(second.frames.length, 1);
  assert.equal(second.frames[0].transactionId, 2);
  assert.equal(second.rest.length, 0);
});

test('parseResponse decodes registers and raises Modbus exceptions', () => {
  assert.deepEqual(parseResponse(3, Buffer.from([3, 4, 0x12, 0x34, 0xff, 0xff])), [0x1234, 0xffff]);
  assert.equal(parseResponse(6, Buffer.from([6, 0xf0, 1, 0, 80])), undefined);
  assert.throws(
    () => parseResponse(3, Buffer.from([0x83, 2])),
    (err) => {
      assert.ok(err instanceof ModbusException);
      assert.equal(err.exceptionCode, 2);
      assert.match(err.message, /illegal data address/);
      return true;
    },
  );
  assert.throws(() => parseResponse(3, Buffer.from([3, 4, 0x12])), /Truncated/);
});
