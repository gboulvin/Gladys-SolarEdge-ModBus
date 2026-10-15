// -----------------------------------------------------------------------------
// Device type: SOLAREDGE BATTERY (StorEdge / Home Battery)
// One device per battery connected to an inverter.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { deviceName, numericState, platformId, roundTo, textState, toKwh } from './common.js';

export const BATTERY_TYPE = 'battery';

export const BATTERY_FEATURES = {
  LEVEL: 'level',
  CHARGE_POWER: 'charge-power',
  DISCHARGE_POWER: 'discharge-power',
  CHARGE_INDEX: 'charge-index',
  DISCHARGE_INDEX: 'discharge-index',
  ENERGY_REMAINING: 'energy-remaining',
  TEMPERATURE: 'temperature',
  STATUS: 'status',
};

export const BATTERY_STATUS_LABELS = {
  off: 'Off',
  standby: 'Standby',
  charging: 'Charging',
  discharging: 'Discharging',
  fault: 'Fault',
  idle: 'Idle',
  sleep: 'Sleep',
  unknown: 'Unknown',
};

export function batteryIds(gladys, info) {
  return gladys.externalIds(BATTERY_TYPE, platformId(info.serial));
}

export function buildBatteryDevice(gladys, info) {
  const ids = batteryIds(gladys, info);
  const maxPower = Math.ceil(
    Math.max(info.maxChargePower ?? 0, info.maxDischargePower ?? 0, 10000),
  );
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
  const B = T.BATTERY_STORAGE;
  return {
    name: deviceName('SolarEdge battery', info),
    external_id: ids.device,
    features: [
      feature(BATTERY_FEATURES.LEVEL, 'Battery level', C.BATTERY_STORAGE, B.BATTERY_LEVEL, {
        unit: U.PERCENT,
        min: 0,
        max: 100,
      }),
      feature(BATTERY_FEATURES.CHARGE_POWER, 'Charge power', C.BATTERY_STORAGE, B.CHARGE_POWER, {
        unit: U.WATT,
        min: 0,
        max: maxPower,
      }),
      feature(
        BATTERY_FEATURES.DISCHARGE_POWER,
        'Discharge power',
        C.BATTERY_STORAGE,
        B.DISCHARGE_POWER,
        { unit: U.WATT, min: 0, max: maxPower },
      ),
      feature(BATTERY_FEATURES.CHARGE_INDEX, 'Charged energy', C.BATTERY_STORAGE, B.CHARGE_INDEX, {
        unit: U.KILOWATT_HOUR,
        min: 0,
        max: 100000000,
      }),
      feature(
        BATTERY_FEATURES.DISCHARGE_INDEX,
        'Discharged energy',
        C.BATTERY_STORAGE,
        B.DISCHARGE_INDEX,
        { unit: U.KILOWATT_HOUR, min: 0, max: 100000000 },
      ),
      feature(
        BATTERY_FEATURES.ENERGY_REMAINING,
        'Available energy',
        C.BATTERY_STORAGE,
        B.BATTERY_ENERGY_REMAINING,
        { unit: U.KILOWATT_HOUR, min: 0, max: Math.ceil((info.ratedEnergy ?? 100000) / 1000) },
      ),
      feature(
        BATTERY_FEATURES.TEMPERATURE,
        'Battery temperature',
        C.DEVICE_TEMPERATURE_SENSOR,
        T.SENSOR.DECIMAL,
        { unit: U.CELSIUS, min: -40, max: 100 },
      ),
      feature(BATTERY_FEATURES.STATUS, 'Status', C.TEXT, T.TEXT.TEXT, { keep_history: false }),
    ],
  };
}

export function batteryStates(gladys, info, reading) {
  const ids = batteryIds(gladys, info);
  const power = Number.isFinite(reading.power) ? Math.round(reading.power) : null;
  return [
    ...numericState(ids.feature(BATTERY_FEATURES.LEVEL), roundTo(reading.level, 0)),
    ...numericState(
      ids.feature(BATTERY_FEATURES.CHARGE_POWER),
      power === null ? null : Math.max(0, power),
    ),
    ...numericState(
      ids.feature(BATTERY_FEATURES.DISCHARGE_POWER),
      power === null ? null : Math.max(0, -power),
    ),
    ...numericState(ids.feature(BATTERY_FEATURES.CHARGE_INDEX), toKwh(reading.chargedEnergy)),
    ...numericState(ids.feature(BATTERY_FEATURES.DISCHARGE_INDEX), toKwh(reading.dischargedEnergy)),
    ...numericState(
      ids.feature(BATTERY_FEATURES.ENERGY_REMAINING),
      roundTo(toKwh(reading.availableEnergy), 2),
    ),
    ...numericState(ids.feature(BATTERY_FEATURES.TEMPERATURE), roundTo(reading.temperature, 1)),
    ...textState(ids.feature(BATTERY_FEATURES.STATUS), BATTERY_STATUS_LABELS[reading.status]),
  ];
}
