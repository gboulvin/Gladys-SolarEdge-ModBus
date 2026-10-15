import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SCENE_ACTIONS, SCENE_ACTION_KEYS } from '../src/scenes.js';
import { SCENE_TRIGGERS } from '../src/site.js';
import { encodeFloat32LE } from '../src/solaredge/decode.js';
import { createTestSite } from './helpers/site.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const declarationOf = (list, key) => manifest[list].find((entry) => entry.key === key);
const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function assertDeclaredOutputs(key, outputs) {
  const declaration = declarationOf('scene_actions', key);
  const declared = keysOf(declaration.outputs);
  for (const [output, value] of Object.entries(outputs)) {
    assert.ok(declared.includes(output), `${key}: output "${output}" is not declared`);
    const { type } = declaration.outputs.find((o) => o.key === output);
    assert.equal(typeof value, type, `${key}: output "${output}" must be a ${type}`);
  }
}

test('control actions are refused while control is not allowed', async (t) => {
  const { site, inverter } = await createTestSite();
  t.after(() => site.closeClient());
  const outputs = await SCENE_ACTIONS.set_production_limit(site, { fields: { limit: 50 } });
  assert.equal(outputs.applied, false);
  assert.match(outputs.error, /disabled/);
  assertDeclaredOutputs('set_production_limit', outputs);
  assert.deepEqual(inverter.writes, [], 'nothing written to the inverter');
});

test('set_production_limit writes the limit of the chosen inverter', async (t) => {
  const { site, inverter } = await createTestSite({ config: { enable_control: true } });
  t.after(() => site.closeClient());
  const device = site.devices()[0].external_id;
  const outputs = await SCENE_ACTIONS.set_production_limit(site, { fields: { device, limit: 30 } });
  assert.deepEqual(outputs, { applied: true, error: '', limit: 30 });
  assertDeclaredOutputs('set_production_limit', outputs);
  assert.deepEqual(inverter.writes, [{ unitId: 1, address: 0xf001, values: [30] }]);
});

test('battery actions reach the inverter the battery is wired to', async (t) => {
  const { site, inverter } = await createTestSite({ config: { enable_control: true } });
  t.after(() => site.closeClient());
  const battery = site.devices().find((d) => d.external_id.includes(':battery:')).external_id;
  const mode = await SCENE_ACTIONS.set_battery_mode(site, {
    fields: { device: battery, mode: 'backup_only' },
  });
  assert.equal(mode.applied, true);
  assertDeclaredOutputs('set_battery_mode', mode);
  const reserve = await SCENE_ACTIONS.set_backup_reserve(site, { fields: { reserve: 40 } });
  assert.equal(reserve.applied, true);
  const command = await SCENE_ACTIONS.battery_command(site, {
    fields: { device: battery, command: 'discharge_to_match_load', duration: 30, power_limit: '' },
  });
  assert.equal(command.applied, true);
  assertDeclaredOutputs('battery_command', command);
  assert.deepEqual(inverter.writes, [
    { unitId: 1, address: 0xe004, values: [3] },
    { unitId: 1, address: 0xe008, values: encodeFloat32LE(40) },
    { unitId: 1, address: 0xe004, values: [4] },
    { unitId: 1, address: 0xe00b, values: [1800, 0] },
    { unitId: 1, address: 0xe00d, values: [5] },
  ]);
});

test('an unknown mode is an output, not a failure', async (t) => {
  const { site } = await createTestSite({ config: { enable_control: true } });
  t.after(() => site.closeClient());
  const outputs = await SCENE_ACTIONS.set_battery_mode(site, { fields: { mode: 'turbo' } });
  assert.equal(outputs.applied, false);
});

test('get_solar_status returns the latest values of the installation', async (t) => {
  const { site } = await createTestSite();
  t.after(() => site.closeClient());
  await site.pollOnce();
  const outputs = await SCENE_ACTIONS.get_solar_status(site, { fields: {} });
  assert.deepEqual(outputs, {
    connected: true,
    production_power: 3000,
    consumption_power: 2000,
    grid_power: -1000,
    battery_level: 55,
    today_production: 0,
    inverter_status: 'producing',
  });
  assertDeclaredOutputs('get_solar_status', outputs);
});

test('every scene event carries declared, primitive data only', async (t) => {
  const { site, gladys, inverter } = await createTestSite({ config: { surplus_threshold: 500 } });
  t.after(() => site.closeClient());
  inverter.setMeter({ power: 100 });
  await site.pollOnce();
  inverter.setInverter({ status: 7 });
  inverter.setBattery({ status: 6, power: 0 });
  inverter.setMeter({ power: 2000 });
  await site.pollOnce();
  inverter.online = false;
  for (let i = 0; i < 3; i += 1) await site.pollOnce();
  const fired = new Set(gladys.fake.sceneEvents.map((e) => e.key));
  assert.deepEqual([...fired].sort(), Object.values(SCENE_TRIGGERS).sort(), 'every trigger fires');
  for (const { key, data } of gladys.fake.sceneEvents) {
    const trigger = declarationOf('scene_triggers', key);
    const declared = [...keysOf(trigger.fields), ...keysOf(trigger.variables)];
    for (const [dataKey, value] of Object.entries(data)) {
      assert.ok(declared.includes(dataKey), `${key}: data.${dataKey} is not declared`);
      assert.ok(value === null || typeof value !== 'object', `${key}: data.${dataKey}`);
    }
    for (const field of trigger.fields ?? []) {
      if (field.options && data[field.key] !== undefined) {
        assert.ok(
          field.options.some((o) => o.value === data[field.key]),
          `${key}: "${data[field.key]}" is not an option of the ${field.key} filter`,
        );
      }
    }
  }
});

test('every scene action key is handled', () => {
  assert.deepEqual(Object.keys(SCENE_ACTIONS).sort(), Object.values(SCENE_ACTION_KEYS).sort());
});
