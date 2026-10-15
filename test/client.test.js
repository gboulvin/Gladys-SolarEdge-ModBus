import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import { ModbusTcpClient } from '../src/modbus/client.js';
import { ModbusException } from '../src/modbus/frame.js';
import { FakeInverter } from './helpers/fakeInverter.js';

const clientFor = (inverter, options = {}) =>
  new ModbusTcpClient({
    host: 'inverter',
    port: 1502,
    timeout: 200,
    createConnection: inverter.createConnection,
    ...options,
  });

test('concurrent requests share one connection and are answered in order', async () => {
  const inverter = new FakeInverter();
  const client = clientFor(inverter);
  try {
    const [marker, model, limit] = await Promise.all([
      client.readHoldingRegisters(1, 40000, 2),
      client.readHoldingRegisters(1, 40069, 1),
      client.readHoldingRegisters(1, 0xf001, 1),
    ]);
    assert.deepEqual(marker, [0x5375, 0x6e53]);
    assert.deepEqual(model, [103]);
    assert.deepEqual(limit, [100]);
    assert.equal(inverter.connections, 1, 'SolarEdge accepts a single Modbus client');
  } finally {
    client.close();
  }
});

test('a Modbus exception rejects the request, the connection stays usable', async () => {
  const inverter = new FakeInverter();
  const client = clientFor(inverter);
  try {
    await assert.rejects(client.readHoldingRegisters(1, 30000, 1), ModbusException);
    assert.deepEqual(await client.readHoldingRegisters(1, 40068, 1), [1]);
    assert.equal(inverter.connections, 1);
  } finally {
    client.close();
  }
});

test('writes reach the inverter', async () => {
  const inverter = new FakeInverter();
  const client = clientFor(inverter);
  try {
    await client.writeRegister(1, 0xf001, 50);
    await client.writeRegisters(1, 0xe008, [0, 0x41a0]);
    assert.deepEqual(inverter.writes, [
      { unitId: 1, address: 0xf001, values: [50] },
      { unitId: 1, address: 0xe008, values: [0, 0x41a0] },
    ]);
  } finally {
    client.close();
  }
});

test('a refused connection rejects, the next request reconnects', async () => {
  const inverter = new FakeInverter();
  inverter.online = false;
  const client = clientFor(inverter);
  try {
    await assert.rejects(client.readHoldingRegisters(1, 40000, 2), /ECONNREFUSED/);
    inverter.online = true;
    assert.deepEqual(await client.readHoldingRegisters(1, 40068, 1), [1]);
    assert.equal(inverter.connections, 2);
  } finally {
    client.close();
  }
});

test('an unanswered request times out and drops the connection', async () => {
  let connections = 0;
  const silent = () => {
    connections += 1;
    const socket = new Duplex({ read() {}, write: (_c, _e, cb) => cb() });
    setImmediate(() => socket.emit('connect'));
    return socket;
  };
  const client = new ModbusTcpClient({ host: 'x', port: 1, timeout: 50, createConnection: silent });
  try {
    await assert.rejects(client.readHoldingRegisters(1, 40000, 2), /timed out/);
    await assert.rejects(client.readHoldingRegisters(1, 40000, 2), /timed out/);
    assert.equal(connections, 2, 'a fresh connection after a timeout');
  } finally {
    client.close();
  }
});

test('a closed client refuses new requests', async () => {
  const client = clientFor(new FakeInverter());
  client.close();
  await assert.rejects(client.readHoldingRegisters(1, 40000, 2), /closed/);
});
