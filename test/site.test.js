import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { FAILURES_BEFORE_LOST, SCENE_TRIGGERS, SolarEdgeSite } from '../src/site.js';
import { createMemoryStore } from '../src/store.js';
import { normalizeConfig } from '../src/config.js';
import { createTestSite } from './helpers/site.js';

const stateOf = (gladys, suffix) =>
  gladys.fake.states.filter((s) => s.device_feature_external_id.endsWith(suffix)).at(-1);

test('the discovery payload is accepted by Gladys', async (t) => {
  const { site, gladys } = await createTestSite();
  t.after(() => site.closeClient());
  const devices = gladys.fake.discoveredDevices;
  assert.equal(devices.length, 3);
  for (const device of devices) {
    assert.match(device.external_id, /^ext:[^:]+:(inverter|meter|battery):/);
  }
});

test('a cycle publishes the readings in the Gladys conventions', async (t) => {
  const { site, gladys } = await createTestSite();
  t.after(() => site.closeClient());
  const snapshot = await site.pollOnce();
  assert.equal(snapshot.ok, true);
  assert.equal(stateOf(gladys, 'inverter:7e1234ab:power').state, 3000);
  assert.equal(stateOf(gladys, 'inverter:7e1234ab:energy').state, 12345.678);
  assert.equal(stateOf(gladys, 'inverter:7e1234ab:status').text, 'Producing');
  // SolarEdge: +1000 W = export. Gladys: export < 0.
  assert.equal(stateOf(gladys, 'meter:5012345:grid-power').state, -1000);
  assert.equal(stateOf(gladys, 'meter:5012345:consumption-power').state, 2000);
  assert.equal(stateOf(gladys, 'battery:bat98765:charge-power').state, 1500);
  assert.equal(stateOf(gladys, 'battery:bat98765:discharge-power').state, 0);
  assert.deepEqual(snapshot.totals, {
    production: 3000,
    grid: -1000,
    consumption: 2000,
    todayProduction: 0,
    batteryLevel: 55,
    batteryPower: 1500,
  });
});

test('only changed values are published again', async (t) => {
  const { site, gladys } = await createTestSite();
  t.after(() => site.closeClient());
  await site.pollOnce();
  const first = gladys.fake.states.length;
  await site.pollOnce();
  assert.equal(gladys.fake.states.length, first, 'nothing changed, nothing sent');
});

test('the grid direction can be inverted', async (t) => {
  const { site, gladys } = await createTestSite({ config: { invert_grid_power: true } });
  t.after(() => site.closeClient());
  await site.pollOnce();
  assert.equal(stateOf(gladys, 'meter:5012345:grid-power').state, 1000);
  assert.equal(stateOf(gladys, 'meter:5012345:grid-import').state, 5000);
  assert.equal(stateOf(gladys, 'meter:5012345:consumption-power').state, 4000);
});

test('an inverter status change fires one scene event, the first reading none', async (t) => {
  const { site, gladys, inverter } = await createTestSite();
  t.after(() => site.closeClient());
  await site.pollOnce();
  assert.equal(gladys.fake.sceneEvents.length, 0);
  inverter.setInverter({ power: 0, status: 2 });
  await site.pollOnce();
  await site.pollOnce();
  const events = gladys.fake.sceneEvents.filter(
    (e) => e.key === SCENE_TRIGGERS.INVERTER_STATUS_CHANGED,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].data.status, 'sleeping');
  assert.equal(events[0].data.previous_status, 'producing');
  assert.equal(events[0].data.device, site.devices()[0].external_id);
});

test('the battery status change fires its scene event', async (t) => {
  const { site, gladys, inverter } = await createTestSite();
  t.after(() => site.closeClient());
  await site.pollOnce();
  inverter.setBattery({ power: -1200, status: 4, level: 70 });
  await site.pollOnce();
  const [event] = gladys.fake.sceneEvents;
  assert.equal(event.key, SCENE_TRIGGERS.BATTERY_STATUS_CHANGED);
  assert.deepEqual(
    { status: event.data.status, previous: event.data.previous_status, level: event.data.level },
    { status: 'discharging', previous: 'charging', level: 70 },
  );
});

test('the solar surplus starts above the threshold and ends below half of it', async (t) => {
  const { site, gladys, inverter } = await createTestSite({
    config: { surplus_threshold: 1000 },
  });
  t.after(() => site.closeClient());
  const surplusEvents = () =>
    gladys.fake.sceneEvents
      .filter((e) => e.key === SCENE_TRIGGERS.SOLAR_SURPLUS)
      .map((e) => [e.data.state, e.data.export_power]);
  inverter.setMeter({ power: 200 });
  await site.pollOnce();
  inverter.setMeter({ power: 1500 });
  await site.pollOnce();
  inverter.setMeter({ power: 700 }); // above half: still a surplus
  await site.pollOnce();
  inverter.setMeter({ power: 300 });
  await site.pollOnce();
  assert.deepEqual(surplusEvents(), [
    ['started', 1500],
    ['ended', 300],
  ]);
});

test('the connection is reported lost after repeated failures, then restored', async (t) => {
  const { site, gladys, inverter } = await createTestSite();
  t.after(() => site.closeClient());
  await site.pollOnce();
  inverter.online = false;
  for (let i = 0; i < FAILURES_BEFORE_LOST + 2; i += 1) {
    await site.pollOnce();
  }
  const connectionEvents = () =>
    gladys.fake.sceneEvents
      .filter((e) => e.key === SCENE_TRIGGERS.CONNECTION_CHANGED)
      .map((e) => e.data.state);
  assert.deepEqual(connectionEvents(), ['lost'], 'reported once');
  assert.equal(site.connectionLost, true);
  inverter.online = true;
  await site.pollOnce();
  assert.deepEqual(connectionEvents(), ['lost', 'restored']);
  assert.equal(site.connectionLost, false);
});

test("today's production counts from the first reading of the local day", async (t) => {
  const { site, inverter, clock, store } = await createTestSite();
  t.after(() => site.closeClient());
  await site.pollOnce();
  inverter.setInverter({ energy: 12345678 + 4560 });
  const snapshot = await site.pollOnce();
  assert.equal(snapshot.totals.todayProduction, 4.56);
  assert.equal(store.files['daily-production.json'].baseline['7E1234AB'], 12345678);
  clock.date = new Date('2026-06-22T08:00:00');
  assert.equal((await site.pollOnce()).totals.todayProduction, 0, 'a new day starts at 0');
});

test('the known hardware survives a restart when the inverter does not answer', async (t) => {
  const { site, store, inverter } = await createTestSite();
  t.after(() => site.closeClient());
  const gladys = createFakeGladys();
  inverter.online = false;
  const restarted = new SolarEdgeSite({
    gladys,
    store,
    createClient: inverter.clientFactory((await import('../src/modbus/client.js')).ModbusTcpClient),
  });
  t.after(() => restarted.closeClient());
  await restarted.init();
  restarted.configure(normalizeConfig({ host: '192.168.1.50' }));
  const detected = await restarted.detect();
  assert.equal(detected.inverters.length, 0);
  assert.equal(detected.errors.length, 1, 'the failure is reported');
  assert.equal(restarted.devices().length, 3, 'the devices of the previous run are kept');
});

test('a large installation is polled slower to stay within the state budget', () => {
  const site = new SolarEdgeSite({ gladys: createFakeGladys(), store: createMemoryStore() });
  site.configure(normalizeConfig({ host: 'x', poll_interval: 5 }));
  const inverters = Array.from({ length: 10 }, (_, i) => ({ unitId: i + 1, serial: `S${i}` }));
  site.hardware = { inverters, meters: [], batteries: [] };
  assert.equal(site.featureCount(), 60);
  assert.equal(site.effectiveInterval(), 15);
});

test('nothing is read before the address is configured', async () => {
  const site = new SolarEdgeSite({ gladys: createFakeGladys(), store: createMemoryStore() });
  site.configure(normalizeConfig());
  assert.equal(await site.pollOnce(), null);
});
