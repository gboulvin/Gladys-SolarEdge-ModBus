// -----------------------------------------------------------------------------
// Register decoding helpers.
//
// Two encodings coexist on a SolarEdge inverter:
//   - the SunSpec blocks (40000+: common, inverter, meters) are big-endian
//     16-bit registers, 32-bit values high word first, and every measurement
//     comes with a power-of-ten scale factor register;
//   - the StorEdge blocks (0xE000+: storage control, batteries) hold IEEE 754
//     floats and 32/64-bit counters LOW word first.
// SunSpec marks an unavailable value with a sentinel: those decode as null.
// -----------------------------------------------------------------------------

const NOT_IMPLEMENTED = {
  UINT16: 0xffff,
  INT16: -0x8000,
  UINT32: 0xffffffff,
};

export function uint16(registers, offset) {
  return registers[offset];
}

export function int16(registers, offset) {
  const value = registers[offset];
  return value >= 0x8000 ? value - 0x10000 : value;
}

// SunSpec 32-bit unsigned (acc32 counters), high word first.
export function uint32BE(registers, offset) {
  return registers[offset] * 0x10000 + registers[offset + 1];
}

// StorEdge 32-bit unsigned, low word first.
export function uint32LE(registers, offset) {
  return registers[offset + 1] * 0x10000 + registers[offset];
}

// StorEdge 64-bit unsigned counter, low word first. Energy counters in Wh stay
// far below 2^53, so a Number is exact.
export function uint64LE(registers, offset) {
  let value = 0;
  for (let i = 3; i >= 0; i -= 1) {
    value = value * 0x10000 + registers[offset + i];
  }
  return value;
}

// StorEdge IEEE 754 float, low word first. NaN (unimplemented) becomes null.
export function float32LE(registers, offset) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt16BE(registers[offset + 1], 0);
  buffer.writeUInt16BE(registers[offset], 2);
  const value = buffer.readFloatBE(0);
  return Number.isFinite(value) ? value : null;
}

export function encodeFloat32LE(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeFloatBE(value, 0);
  return [buffer.readUInt16BE(2), buffer.readUInt16BE(0)];
}

export function encodeUint32LE(value) {
  return [value & 0xffff, Math.floor(value / 0x10000) & 0xffff];
}

// Fixed-length ASCII string, NUL/space padded.
export function string(registers, offset, length) {
  const buffer = Buffer.alloc(length * 2);
  for (let i = 0; i < length; i += 1) {
    buffer.writeUInt16BE(registers[offset + i] ?? 0, i * 2);
  }
  return buffer.toString('latin1').replace(/\0.*$/s, '').trim();
}

/**
 * Apply a SunSpec scale factor: value × 10^sf, null when the raw value is the
 * "not implemented" sentinel of its type.
 * @param {number} raw
 * @param {number} sf scale factor (int16)
 * @param {'uint16'|'int16'|'acc32'|'uint32'} type
 */
export function scaled(raw, sf, type = 'uint16') {
  if (
    (type === 'uint16' && raw === NOT_IMPLEMENTED.UINT16) ||
    (type === 'int16' && raw === NOT_IMPLEMENTED.INT16) ||
    (type === 'uint32' && raw === NOT_IMPLEMENTED.UINT32) ||
    sf === NOT_IMPLEMENTED.INT16
  ) {
    return null;
  }
  const decimals = Math.max(0, -sf);
  return Number((raw * 10 ** sf).toFixed(decimals));
}

export function round(value, decimals = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
