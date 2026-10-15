import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ModbusTcpClient } from '../../src/modbus/client.js';
import { SolarEdgeSite } from '../../src/site.js';
import { createMemoryStore } from '../../src/store.js';
import { normalizeConfig } from '../../src/config.js';
import { FakeInverter } from './fakeInverter.js';

/**
 * A detected site on a fake inverter, its devices created in the fake Gladys.
 */
export async function createTestSite({ config = {}, inverter = new FakeInverter(), now } = {}) {
  const gladys = createFakeGladys();
  const store = createMemoryStore();
  const clock = { date: now ?? new Date('2026-06-21T10:00:00') };
  const site = new SolarEdgeSite({
    gladys,
    store,
    createClient: inverter.clientFactory(ModbusTcpClient),
    now: () => clock.date,
  });
  await site.init();
  site.configure(normalizeConfig({ host: '192.168.1.50', ...config }));
  await site.detect();
  await gladys.publishDiscoveredDevices(site.devices());
  return { gladys, store, site, inverter, clock };
}
