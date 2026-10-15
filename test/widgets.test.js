import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { WIDGETS, WIDGET_KEYS, refreshWidgets, widgetSignature } from '../src/widgets.js';
import { SolarEdgeSite } from '../src/site.js';
import { createMemoryStore } from '../src/store.js';
import { normalizeConfig } from '../src/config.js';
import { FakeInverter } from './helpers/fakeInverter.js';
import { createTestSite } from './helpers/site.js';

const request = (config, settings = {}) => ({ settings, language: 'en', units: 'metric', config });

async function contents(site) {
  return Promise.all(
    Object.values(WIDGETS).map((widget) => widget.get(site, request(site.config))),
  );
}

test('the widgets render exactly as sent, in every state', async (t) => {
  const unconfigured = new SolarEdgeSite({
    gladys: createFakeGladys(),
    store: createMemoryStore(),
  });
  unconfigured.configure(normalizeConfig());
  for (const content of await contents(unconfigured)) {
    assert.deepEqual(validateWidgetContent(content), []);
  }

  const { site, inverter } = await createTestSite({ config: { enable_control: true } });
  t.after(() => site.closeClient());
  for (const content of await contents(site)) {
    assert.deepEqual(validateWidgetContent(content), [], 'before the first reading');
  }
  await site.pollOnce();
  inverter.set(0xf001, [60]);
  await site.pollOnce();
  for (const content of await contents(site)) {
    assert.deepEqual(validateWidgetContent(content), [], 'with readings');
  }
  inverter.online = false;
  for (let i = 0; i < 3; i += 1) await site.pollOnce();
  for (const content of await contents(site)) {
    assert.deepEqual(validateWidgetContent(content), [], 'connection lost');
  }
});

test('the battery widget explains an installation without battery', async (t) => {
  const { site } = await createTestSite({ inverter: new FakeInverter({ battery: false }) });
  t.after(() => site.closeClient());
  const content = await WIDGETS.battery_overview.get(site, request(site.config));
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].type, 'text');
});

test('live tiles and charts reference published features', async (t) => {
  const { site } = await createTestSite();
  t.after(() => site.closeClient());
  await site.pollOnce();
  const features = new Set(site.devices().flatMap((d) => d.features.map((f) => f.external_id)));
  for (const content of await contents(site)) {
    for (const component of content.components) {
      for (const id of [component.device_feature, ...(component.device_features ?? [])]) {
        if (id) assert.ok(features.has(id), `unknown feature ${id}`);
      }
    }
  }
});

test('mode buttons only show when control is allowed', async (t) => {
  const readOnly = await createTestSite();
  t.after(() => readOnly.site.closeClient());
  const content = await WIDGETS.battery_overview.get(readOnly.site, request(readOnly.site.config));
  assert.equal(content.components.filter((c) => c.type === 'button').length, 0);
});

test('every widget button is handled and answers a short toast', async (t) => {
  const { site, inverter } = await createTestSite({ config: { enable_control: true } });
  t.after(() => site.closeClient());
  await site.pollOnce();
  for (const [key, widget] of Object.entries(WIDGETS)) {
    const content = await widget.get(site, request(site.config));
    const buttons = content.components.filter((c) => c.type === 'button' && c.action);
    for (const { action } of buttons) {
      const message = await widget.action(site, {
        actionKey: action.key,
        params: action.params ?? {},
        settings: {},
        config: site.config,
      });
      assert.ok(message.en && message.en.length <= 200, `${key}.${action.key}`);
    }
    await assert.rejects(
      widget.action(site, { actionKey: 'nope', params: {}, settings: {}, config: site.config }),
      /Unknown widget action/,
    );
  }
  assert.deepEqual(
    inverter.writes.map((w) => w.values[0]),
    [1, 3],
    'self-consumption then backup only',
  );
});

test('the widget signature follows the computed rows', async (t) => {
  const { site, inverter } = await createTestSite();
  t.after(() => site.closeClient());
  await site.pollOnce();
  const before = widgetSignature(site);
  inverter.setInverter({ power: 3100 });
  await site.pollOnce();
  assert.equal(widgetSignature(site), before, 'a live value needs no nudge');
  inverter.setInverter({ status: 2 });
  await site.pollOnce();
  assert.notEqual(widgetSignature(site), before);
});

test('refreshWidgets nudges every widget', () => {
  const gladys = createFakeGladys();
  refreshWidgets(gladys);
  assert.deepEqual(gladys.fake.widgetRefreshes, Object.values(WIDGET_KEYS));
});
