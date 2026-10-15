// -----------------------------------------------------------------------------
// Device type: SOLAREDGE INVERTER
// One device per inverter answering on a configured Modbus unit id.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { deviceName, numericState, platformId, roundTo, textState, toKwh } from './common.js';

export const INVERTER_TYPE = 'inverter';

export const INVERTER_FEATURES = {
  POWER: 'power',
  ENERGY: 'energy',
  VOLTAGE: 'voltage',
  CURRENT: 'current',
  TEMPERATURE: 'temperature',
  STATUS: 'status',
};

// Text published in the status feature (a text state is not translated).
export const INVERTER_STATUS_LABELS = {
  off: 'Off',
  sleeping: 'Sleeping (night)',
  starting: 'Starting',
  producing: 'Producing',
  throttled: 'Producing (limited)',
  shutting_down: 'Shutting down',
  fault: 'Fault',
  standby: 'Standby',
  unknown: 'Unknown',
};

export function inverterIds(gladys, info) {
  return gladys.externalIds(INVERTER_TYPE, platformId(info.serial));
}

export function buildInverterDevice(gladys, info) {
  const ids = inverterIds(gladys, info);
  const feature = (key, name, category, type, extra) => ({
    name,
    external_id: ids.feature(key),
    category,
    type,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    ...extra,
  });
  return {
    name: deviceName('SolarEdge', info),
    external_id: ids.device,
    features: [
      feature(
        INVERTER_FEATURES.POWER,
        'Solar production',
        C.ENERGY_PRODUCTION_SENSOR,
        T.ENERGY_PRODUCTION_SENSOR.POWER,
        { unit: U.WATT, min: 0, max: 100000 },
      ),
      feature(
        INVERTER_FEATURES.ENERGY,
        'Total production',
        C.ENERGY_PRODUCTION_SENSOR,
        T.ENERGY_PRODUCTION_SENSOR.INDEX,
        { unit: U.KILOWATT_HOUR, min: 0, max: 100000000 },
      ),
      feature(INVERTER_FEATURES.VOLTAGE, 'AC voltage', C.ENERGY_SENSOR, T.ENERGY_SENSOR.VOLTAGE, {
        unit: U.VOLT,
        min: 0,
        max: 500,
      }),
      feature(INVERTER_FEATURES.CURRENT, 'AC current', C.ENERGY_SENSOR, T.ENERGY_SENSOR.CURRENT, {
        unit: U.AMPERE,
        min: 0,
        max: 200,
      }),
      feature(
        INVERTER_FEATURES.TEMPERATURE,
        'Heat sink temperature',
        C.DEVICE_TEMPERATURE_SENSOR,
        T.SENSOR.DECIMAL,
        { unit: U.CELSIUS, min: -40, max: 120 },
      ),
      feature(INVERTER_FEATURES.STATUS, 'Status', C.TEXT, T.TEXT.TEXT, { keep_history: false }),
    ],
  };
}

/**
 * States of an inverter reading. The AC power reads slightly negative at
 * night (self consumption): production is never negative.
 */
export function inverterStates(gladys, info, reading) {
  const ids = inverterIds(gladys, info);
  const power = Number.isFinite(reading.power) ? Math.max(0, Math.round(reading.power)) : null;
  return [
    ...numericState(ids.feature(INVERTER_FEATURES.POWER), power),
    ...numericState(ids.feature(INVERTER_FEATURES.ENERGY), toKwh(reading.energy)),
    ...numericState(ids.feature(INVERTER_FEATURES.VOLTAGE), roundTo(reading.voltage, 1)),
    ...numericState(ids.feature(INVERTER_FEATURES.CURRENT), roundTo(reading.current, 2)),
    ...numericState(ids.feature(INVERTER_FEATURES.TEMPERATURE), roundTo(reading.temperature, 1)),
    ...textState(ids.feature(INVERTER_FEATURES.STATUS), INVERTER_STATUS_LABELS[reading.status]),
  ];
}
