// -----------------------------------------------------------------------------
// Device registry.
//
// Unlike a fixed catalog, a SolarEdge installation is discovered: the site
// (src/site.js) detects the inverters, meters and batteries answering on the
// configured unit ids, and this module turns that hardware description into
// the Gladys discovery payload, and resolves an external id back to its
// hardware (scene actions, widgets).
// -----------------------------------------------------------------------------

import { buildBatteryDevice, batteryIds } from './battery.js';
import { buildInverterDevice, inverterIds } from './inverter.js';
import { buildMeterDevice, meterIds } from './meter.js';

export const EMPTY_HARDWARE = Object.freeze({ inverters: [], meters: [], batteries: [] });

/**
 * Build the discovery payload of every detected device.
 */
export function buildDiscoveredDevices(gladys, hardware = EMPTY_HARDWARE) {
  return [
    ...hardware.inverters.map((info) => buildInverterDevice(gladys, info)),
    ...hardware.meters.map((info) => buildMeterDevice(gladys, info)),
    ...hardware.batteries.map((info) => buildBatteryDevice(gladys, info)),
  ];
}

/**
 * Every device external id, with its kind and hardware description.
 */
export function listDevices(gladys, hardware = EMPTY_HARDWARE) {
  return [
    ...hardware.inverters.map((info) => ({
      kind: 'inverter',
      info,
      externalId: inverterIds(gladys, info).device,
    })),
    ...hardware.meters.map((info) => ({
      kind: 'meter',
      info,
      externalId: meterIds(gladys, info).device,
    })),
    ...hardware.batteries.map((info) => ({
      kind: 'battery',
      info,
      externalId: batteryIds(gladys, info).device,
    })),
  ];
}

export function findDevice(gladys, hardware, externalId) {
  return listDevices(gladys, hardware).find((device) => device.externalId === externalId);
}

/**
 * The Modbus unit id that controls a device: an inverter is its own unit, a
 * meter or a battery is reached through the inverter it is wired to. With no
 * device given, the first inverter (the leader) is used.
 * @returns {number|null}
 */
export function controlUnitOf(gladys, hardware, externalId) {
  if (!externalId) {
    return hardware.inverters[0]?.unitId ?? null;
  }
  return findDevice(gladys, hardware, externalId)?.info.unitId ?? null;
}
