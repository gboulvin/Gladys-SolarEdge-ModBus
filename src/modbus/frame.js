// -----------------------------------------------------------------------------
// Modbus TCP framing (MBAP header + PDU), the three function codes the
// integration needs:
//   - 0x03 Read Holding Registers (every SolarEdge reading);
//   - 0x06 Write Single Register (16-bit settings);
//   - 0x10 Write Multiple Registers (32-bit settings: floats, timeouts).
//
// Pure functions on Buffers, no socket: the client (client.js) owns the
// connection, and the tests exercise the framing without any network.
// -----------------------------------------------------------------------------

export const FUNCTION_CODES = {
  READ_HOLDING_REGISTERS: 0x03,
  WRITE_SINGLE_REGISTER: 0x06,
  WRITE_MULTIPLE_REGISTERS: 0x10,
};

// Modbus caps: 125 registers per read, 123 per multiple write.
export const MAX_READ_REGISTERS = 125;
export const MAX_WRITE_REGISTERS = 123;

const MBAP_LENGTH = 7;

// Standard exception codes, for readable error messages.
const EXCEPTIONS = {
  1: 'illegal function',
  2: 'illegal data address',
  3: 'illegal data value',
  4: 'server device failure',
  5: 'acknowledge',
  6: 'server device busy',
  10: 'gateway path unavailable',
  11: 'gateway target device failed to respond',
};

export class ModbusException extends Error {
  constructor(functionCode, exceptionCode) {
    const reason = EXCEPTIONS[exceptionCode] ?? 'unknown exception';
    super(
      `Modbus exception ${exceptionCode} (${reason}) on function 0x${functionCode.toString(16)}`,
    );
    this.name = 'ModbusException';
    this.functionCode = functionCode;
    this.exceptionCode = exceptionCode;
  }
}

function assertRegisterAddress(address) {
  if (!Number.isInteger(address) || address < 0 || address > 0xffff) {
    throw new RangeError(`Invalid register address ${address}`);
  }
}

function frame(transactionId, unitId, pdu) {
  const header = Buffer.alloc(MBAP_LENGTH);
  header.writeUInt16BE(transactionId & 0xffff, 0);
  header.writeUInt16BE(0, 2); // protocol id: Modbus
  header.writeUInt16BE(pdu.length + 1, 4); // unit id + PDU
  header.writeUInt8(unitId & 0xff, 6);
  return Buffer.concat([header, pdu]);
}

/**
 * Build a Read Holding Registers request.
 */
export function buildReadRequest(transactionId, unitId, address, count) {
  assertRegisterAddress(address);
  if (!Number.isInteger(count) || count < 1 || count > MAX_READ_REGISTERS) {
    throw new RangeError(`Invalid register count ${count}`);
  }
  const pdu = Buffer.alloc(5);
  pdu.writeUInt8(FUNCTION_CODES.READ_HOLDING_REGISTERS, 0);
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(count, 3);
  return frame(transactionId, unitId, pdu);
}

/**
 * Build a Write Single Register request.
 */
export function buildWriteSingleRequest(transactionId, unitId, address, value) {
  assertRegisterAddress(address);
  const pdu = Buffer.alloc(5);
  pdu.writeUInt8(FUNCTION_CODES.WRITE_SINGLE_REGISTER, 0);
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(value & 0xffff, 3);
  return frame(transactionId, unitId, pdu);
}

/**
 * Build a Write Multiple Registers request.
 */
export function buildWriteMultipleRequest(transactionId, unitId, address, registers) {
  assertRegisterAddress(address);
  if (registers.length < 1 || registers.length > MAX_WRITE_REGISTERS) {
    throw new RangeError(`Invalid register count ${registers.length}`);
  }
  const pdu = Buffer.alloc(6 + registers.length * 2);
  pdu.writeUInt8(FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS, 0);
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(registers.length, 3);
  pdu.writeUInt8(registers.length * 2, 5);
  registers.forEach((value, index) => pdu.writeUInt16BE(value & 0xffff, 6 + index * 2));
  return frame(transactionId, unitId, pdu);
}

/**
 * Cut the complete frames out of a receive buffer (TCP is a stream: a frame
 * can arrive split, or several in one chunk).
 * @returns {{ frames: Array<{ transactionId, unitId, pdu }>, rest: Buffer }}
 */
export function extractFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= MBAP_LENGTH) {
    const length = buffer.readUInt16BE(offset + 4);
    const total = 6 + length;
    if (buffer.length - offset < total) {
      break;
    }
    frames.push({
      transactionId: buffer.readUInt16BE(offset),
      unitId: buffer.readUInt8(offset + 6),
      pdu: buffer.subarray(offset + MBAP_LENGTH, offset + total),
    });
    offset += total;
  }
  return { frames, rest: buffer.subarray(offset) };
}

/**
 * Decode the PDU of a response to `functionCode`: the registers of a read,
 * nothing for a write. Throws a ModbusException on an exception response.
 * @returns {number[]|undefined}
 */
export function parseResponse(functionCode, pdu) {
  const responseCode = pdu.readUInt8(0);
  if (responseCode === (functionCode | 0x80)) {
    throw new ModbusException(functionCode, pdu.readUInt8(1));
  }
  if (responseCode !== functionCode) {
    throw new Error(`Unexpected Modbus function 0x${responseCode.toString(16)} in response`);
  }
  if (functionCode !== FUNCTION_CODES.READ_HOLDING_REGISTERS) {
    return undefined;
  }
  const byteCount = pdu.readUInt8(1);
  if (pdu.length < 2 + byteCount || byteCount % 2 !== 0) {
    throw new Error('Truncated Modbus read response');
  }
  const registers = [];
  for (let i = 0; i < byteCount; i += 2) {
    registers.push(pdu.readUInt16BE(2 + i));
  }
  return registers;
}
