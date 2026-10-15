import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModbusTcpClient } from '../src/modbus/client.js';
import {
  detectSite,
  readBattery,
  readInverter,
  readMeter,
  readStorageControl,
  writeActivePowerLimit,
  writeBackupReserve,
  writeStorageCommand,
  writeStorageControlMode,
} from '../src/solaredge/reader.js';
import { encodeFloat32LE } from '../src/solaredge/decode.js';
import { FakeInverter } from './helpers/fakeInverter.js';

async function withClient(inverter, fn) {
  const client = new ModbusTcpClient({
    host: 'inverter',
    port: 1502,
    timeout: 200,
    createConnection: inverter.createConnection,
  });
  try {
    await fn(client);
  } finally {
    client.close();
  }
}

test('detectSite finds the inverter, its meter and its battery', async () => {
  await withClient(new FakeInverter(), async (client) => {
    const site = await detectSite(client, [1, 2]);
    assert.equal(site.inverters.length, 1);
    assert.equal(site.inverters[0].serial, '7E1234AB');
    assert.equal(site.inverters[0].model, 'SE8K-RWS48BNN4');
    assert.equal(site.meters.length, 1);
    assert.equal(site.meters[0].role, 'grid');
    assert.equal(site.meters[0].serial, '5012345');
    assert.equal(site.batteries.length, 1);
    assert.equal(site.batteries[0].ratedEnergy, 9800);
    assert.deepEqual(
      site.errors.map((e) => e.unitId),
      [2],
      'a unit id nobody answers on is reported, not fatal',
    );
  });
});

test('an installation without meter nor battery is detected as such', async () => {
  await withClient(new FakeInverter({ meter: false, battery: false }), async (client) => {
    const site = await detectSite(client, [1]);
    assert.equal(site.inverters.length, 1);
    assert.equal(site.meters.length, 0);
    assert.equal(site.batteries.length, 0);
  });
});

test('readInverter applies the scale factors', async () => {
  const inverter = new FakeInverter();
  inverter.setInverter({ power: 4200, energy: 9876543, status: 2, voltage: 231.4 });
  await withClient(inverter, async (client) => {
    const reading = await readInverter(client, 1);
    assert.equal(reading.power, 4200);
    assert.equal(reading.energy, 9876543);
    assert.equal(reading.voltage, 231.4);
    assert.equal(reading.current, 13);
    assert.equal(reading.frequency, 50);
    assert.equal(reading.temperature, 41.2);
    assert.equal(reading.status, 'sleeping');
  });
});

test('readMeter and readBattery decode both word orders', async () => {
  const inverter = new FakeInverter();
  inverter.setMeter({ power: -850, exported: 1234, imported: 5678 });
  inverter.setBattery({ power: -2000, level: 80, status: 4 });
  await withClient(inverter, async (client) => {
    const meter = await readMeter(client, 1, 0);
    assert.equal(meter.power, -850);
    assert.equal(meter.exportedEnergy, 1234);
    assert.equal(meter.importedEnergy, 5678);
    const battery = await readBattery(client, 1, 0);
    assert.equal(battery.power, -2000);
    assert.equal(battery.level, 80);
    assert.equal(battery.status, 'discharging');
    assert.equal(battery.chargedEnergy, 900000);
    const storage = await readStorageControl(client, 1);
    assert.equal(storage.controlMode, 'maximize_self_consumption');
    assert.equal(storage.backupReserve, 20);
  });
});

test('the battery power is zeroed outside of the active states', async () => {
  const inverter = new FakeInverter();
  inverter.setBattery({ power: 123, status: 1 });
  await withClient(inverter, async (client) => {
    const battery = await readBattery(client, 1, 0);
    assert.equal(battery.status, 'off');
    assert.equal(battery.power, 0);
  });
});

test('control writes target the documented registers', async () => {
  const inverter = new FakeInverter();
  await withClient(inverter, async (client) => {
    await writeActivePowerLimit(client, 1, 40);
    await writeStorageControlMode(client, 1, 'backup_only');
    await writeBackupReserve(client, 1, 30);
    await writeStorageCommand(client, 1, {
      mode: 'charge_pv_and_grid',
      durationSeconds: 3600,
      powerLimit: 2500,
    });
  });
  assert.deepEqual(inverter.writes, [
    { unitId: 1, address: 0xf001, values: [40] },
    { unitId: 1, address: 0xe004, values: [3] },
    { unitId: 1, address: 0xe008, values: encodeFloat32LE(30) },
    { unitId: 1, address: 0xe004, values: [4] },
    { unitId: 1, address: 0xe00b, values: [3600, 0] },
    { unitId: 1, address: 0xe00e, values: encodeFloat32LE(2500) },
    { unitId: 1, address: 0xe010, values: encodeFloat32LE(2500) },
    { unitId: 1, address: 0xe00d, values: [3] },
  ]);
});

test('control writes refuse out-of-range values before touching the inverter', async () => {
  const inverter = new FakeInverter();
  await withClient(inverter, async (client) => {
    await assert.rejects(writeActivePowerLimit(client, 1, 120), RangeError);
    await assert.rejects(writeBackupReserve(client, 1, -1), RangeError);
    await assert.rejects(writeStorageControlMode(client, 1, 'turbo'), RangeError);
    await assert.rejects(
      writeStorageCommand(client, 1, { mode: 'off', durationSeconds: 0 }),
      RangeError,
    );
  });
  assert.deepEqual(inverter.writes, []);
});
