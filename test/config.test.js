import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, isConfigured, normalizeConfig, parseUnitIds } from '../src/config.js';

test('normalizeConfig returns the defaults when called with no argument', () => {
  const config = normalizeConfig();
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    assert.deepEqual(config[key], value, key);
  }
  assert.deepEqual(config.unitIds, [1]);
  assert.equal(isConfigured(config), false);
});

test('normalizeConfig coerces the values of a form', () => {
  const config = normalizeConfig({
    host: ' 192.168.1.50 ',
    port: '502',
    unit_ids: '1, 2;3',
    poll_interval: '30',
    invert_grid_power: 'true',
    enable_control: true,
  });
  assert.equal(config.host, '192.168.1.50');
  assert.equal(config.port, 502);
  assert.deepEqual(config.unitIds, [1, 2, 3]);
  assert.equal(config.poll_interval, 30);
  assert.equal(config.invert_grid_power, true);
  assert.equal(config.enable_control, true);
  assert.equal(isConfigured(config), true);
});

test('the refresh interval stays within its bounds', () => {
  assert.equal(normalizeConfig({ poll_interval: 1 }).poll_interval, 5);
  assert.equal(normalizeConfig({ poll_interval: 9999 }).poll_interval, 300);
  assert.equal(normalizeConfig({ poll_interval: '' }).poll_interval, DEFAULT_CONFIG.poll_interval);
});

test('parseUnitIds drops invalid ids and duplicates', () => {
  assert.deepEqual(parseUnitIds('2,2, x, 0, 248, 3'), [2, 3]);
  assert.deepEqual(parseUnitIds(''), [1]);
  assert.deepEqual(parseUnitIds(undefined), [1]);
});
