// -----------------------------------------------------------------------------
// In-memory SolarEdge inverter for the tests: a register image answering
// Modbus TCP frames over a fake socket. No network involved.
//
// Default installation: one three-phase inverter (unit 1) with an
// Export+Import meter (meter 1) and one battery (battery 1).
// -----------------------------------------------------------------------------

import { Duplex } from 'node:stream';
import { extractFrames } from '../../src/modbus/frame.js';
import { encodeFloat32LE, encodeUint32LE } from '../../src/solaredge/decode.js';

function stringRegisters(text, length) {
  const buffer = Buffer.alloc(length * 2);
  buffer.write(text, 'latin1');
  return Array.from({ length }, (_, i) => buffer.readUInt16BE(i * 2));
}

const u32be = (value) => [Math.floor(value / 0x10000), value & 0xffff];
const i16 = (value) => (value < 0 ? value + 0x10000 : value);
const u64le = (value) => {
  const words = [];
  let rest = value;
  for (let i = 0; i < 4; i += 1) {
    words.push(rest % 0x10000);
    rest = Math.floor(rest / 0x10000);
  }
  return words;
};

export class FakeInverter {
  constructor({ unitId = 1, meter = true, battery = true } = {}) {
    this.unitId = unitId;
    this.units = new Map();
    this.writes = [];
    this._online = true;
    this.sockets = new Set();
    this.connections = 0;
    const regs = new Map();
    this.units.set(unitId, regs);
    this.regs = regs;
    this.set(40000, [0x5375, 0x6e53, 1, 65]);
    this.set(40004, stringRegisters('SolarEdge', 16));
    this.set(40020, stringRegisters('SE8K-RWS48BNN4', 16));
    this.set(40036, stringRegisters('', 8));
    this.set(40044, stringRegisters('0004.0019.0036', 8));
    this.set(40052, stringRegisters('7E1234AB', 16));
    this.set(40068, [unitId]);
    this.setInverter({});
    this.set(0xf001, [100]);
    if (meter) {
      this.set(40121, [1, 65]);
      this.set(40123, stringRegisters('SolarEdge', 16));
      this.set(40139, stringRegisters('WND-3Y-400-MB', 16));
      this.set(40155, stringRegisters('Export+Import', 8));
      this.set(40163, stringRegisters('2.31', 8));
      this.set(40171, stringRegisters('5012345', 16));
      this.set(40187, [2]);
      this.set(40188, [203, 105]);
      this.setMeter({});
    }
    if (battery) {
      this.set(0xe100, stringRegisters('LG', 16));
      this.set(0xe110, stringRegisters('RESU 10H', 16));
      this.set(0xe120, stringRegisters('1.2.3', 16));
      this.set(0xe130, stringRegisters('BAT98765', 16));
      this.set(0xe140, [1, 0]);
      this.set(0xe142, [
        ...encodeFloat32LE(9800),
        ...encodeFloat32LE(5000),
        ...encodeFloat32LE(5000),
        ...encodeFloat32LE(7000),
        ...encodeFloat32LE(7000),
      ]);
      this.setBattery({});
      this.set(0xe000, [0, 0, ...encodeFloat32LE(0), 1, 1, ...encodeFloat32LE(0)]);
      this.set(0xe008, [...encodeFloat32LE(20), 7, ...encodeUint32LE(3600), 0]);
      this.set(0xe00e, [...encodeFloat32LE(5000), ...encodeFloat32LE(5000)]);
    }
  }

  get online() {
    return this._online;
  }

  // Going offline also cuts the open connections, like a rebooting inverter.
  set online(value) {
    this._online = value;
    if (!value) {
      for (const socket of this.sockets) socket.destroy();
      this.sockets.clear();
    }
  }

  set(address, values) {
    values.forEach((value, i) => this.regs.set(address + i, value));
  }

  /** Inverter live values: power W, energy Wh, status... */
  setInverter({
    power = 3000,
    energy = 12345678,
    status = 4,
    voltage = 230.5,
    temperature = 41.2,
  }) {
    this.set(40069, [103, 50]);
    // currents (sf -2)
    this.set(40071, [1300, 433, 433, 434, i16(-2)]);
    // voltages AB BC CA AN BN CN (sf -1)
    const v = Math.round(voltage * 10);
    this.set(40076, [3990, 3990, 3990, v, v, v, i16(-1)]);
    this.set(40083, [i16(power), 0]);
    this.set(40085, [5000, i16(-2)]);
    this.set(40087, [i16(power), 0, 0, 0, i16(100), i16(-2)]);
    this.set(40093, [...u32be(energy), 0]);
    this.set(40096, [800, i16(-2), 4000, i16(-1), i16(power + 50), 0]);
    this.set(40102, [0, i16(Math.round(temperature * 100)), 0, 0, i16(-2)]);
    this.set(40107, [status, 0]);
  }

  /** Meter live values, SolarEdge sign: power > 0 = export. */
  setMeter({ power = 1000, exported = 5000000, imported = 2000000 }) {
    const base = 40190;
    this.set(base, [i16(500), 0, 0, 0, i16(-2)]);
    this.set(base + 5, [2301, 2301, 2301, 2301, 3985, 3985, 3985, 3985, i16(-1)]);
    this.set(base + 14, [5000, i16(-2)]);
    this.set(base + 16, [i16(power), 0, 0, 0, 0]);
    this.set(base + 21, Array(15).fill(0));
    this.set(base + 36, [...u32be(exported), 0, 0, 0, 0, 0, 0]);
    this.set(base + 44, [...u32be(imported), 0, 0, 0, 0, 0, 0]);
    this.set(base + 52, [0]);
  }

  /** Battery live values: power > 0 = charging. */
  setBattery({ power = 1500, level = 55, status = 3, available = 5390 }) {
    const base = 0xe100 + 0x6c;
    this.set(base, [
      ...encodeFloat32LE(24.5),
      ...encodeFloat32LE(26),
      ...encodeFloat32LE(400),
      ...encodeFloat32LE(power / 400),
      ...encodeFloat32LE(power),
      ...u64le(800000),
      ...u64le(900000),
      ...encodeFloat32LE(9800),
      ...encodeFloat32LE(available),
      ...encodeFloat32LE(98),
      ...encodeFloat32LE(level),
      ...encodeUint32LE(status),
    ]);
  }

  handle(frame) {
    const { transactionId, unitId, pdu } = frame;
    const fc = pdu.readUInt8(0);
    const address = pdu.readUInt16BE(1);
    const regs = this.units.get(unitId);
    const respond = (body) => {
      const header = Buffer.alloc(7);
      header.writeUInt16BE(transactionId, 0);
      header.writeUInt16BE(0, 2);
      header.writeUInt16BE(body.length + 1, 4);
      header.writeUInt8(unitId, 6);
      return Buffer.concat([header, body]);
    };
    const exception = (code) => respond(Buffer.from([fc | 0x80, code]));
    if (!regs) {
      return exception(11);
    }
    if (fc === 0x03) {
      const count = pdu.readUInt16BE(3);
      const values = [];
      for (let i = 0; i < count; i += 1) {
        const value = regs.get(address + i);
        if (value === undefined) {
          return exception(2);
        }
        values.push(value);
      }
      const body = Buffer.alloc(2 + count * 2);
      body.writeUInt8(0x03, 0);
      body.writeUInt8(count * 2, 1);
      values.forEach((value, i) => body.writeUInt16BE(value, 2 + i * 2));
      return respond(body);
    }
    if (fc === 0x06) {
      const value = pdu.readUInt16BE(3);
      regs.set(address, value);
      this.writes.push({ unitId, address, values: [value] });
      return respond(pdu.subarray(0, 5));
    }
    if (fc === 0x10) {
      const count = pdu.readUInt16BE(3);
      const values = Array.from({ length: count }, (_, i) => pdu.readUInt16BE(6 + i * 2));
      values.forEach((value, i) => regs.set(address + i, value));
      this.writes.push({ unitId, address, values });
      return respond(pdu.subarray(0, 5));
    }
    return exception(1);
  }

  /** The `createConnection` to give the ModbusTcpClient. */
  get createConnection() {
    return () => {
      this.connections += 1;
      let buffer = Buffer.alloc(0);
      const inverter = this;
      const socket = new Duplex({
        read() {},
        write(chunk, _encoding, callback) {
          buffer = Buffer.concat([buffer, chunk]);
          const { frames, rest } = extractFrames(buffer);
          buffer = rest;
          for (const frame of frames) {
            const response = inverter.handle(frame);
            // Answer asynchronously, like a real socket.
            setImmediate(() => socket.push(response));
          }
          callback();
        },
      });
      this.sockets.add(socket);
      setImmediate(() => {
        if (this.online) {
          socket.emit('connect');
        } else {
          socket.emit('error', new Error('connect ECONNREFUSED'));
        }
      });
      return socket;
    };
  }

  /** A ready-to-use client factory for SolarEdgeSite. */
  clientFactory(ModbusTcpClient) {
    return ({ host, port }) =>
      new ModbusTcpClient({ host, port, timeout: 500, createConnection: this.createConnection });
  }
}
