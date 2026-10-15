// -----------------------------------------------------------------------------
// Device type: SOLAREDGE METER
// A Modbus energy meter wired to an inverter (up to three per inverter).
//
// The meter at the grid connection point ("Export+Import") feeds the
// `grid-sensor` category: one signed power (import > 0, export < 0, the
// Gladys convention — SolarEdge counts the export as positive) and the two
// cumulative indexes. It also carries the house consumption, computed from
// the production of the inverters and the grid exchange.
//
// A meter on the house load ("Consumption") is an `energy-sensor`: power and
// consumption index.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { deviceName, numericState, platformId, toKwh } from './common.js';

export const METER_TYPE = 'meter';

export const METER_FEATURES = {
  GRID_POWER: 'grid-power',
  GRID_IMPORT: 'grid-import',
  GRID_EXPORT: 'grid-export',
  CONSUMPTION_POWER: 'consumption-power',
  CONSUMPTION_ENERGY: 'consumption-energy',
};

export function meterIds(gladys, info) {
  return gladys.externalIds(METER_TYPE, platformId(info.serial));
}

export function buildMeterDevice(gladys, info) {
  const ids = meterIds(gladys, info);
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
  const consumptionPower = feature(
    METER_FEATURES.CONSUMPTION_POWER,
    'House consumption',
    C.ENERGY_SENSOR,
    T.ENERGY_SENSOR.POWER,
    { unit: U.WATT, min: 0, max: 100000 },
  );
  const features =
    info.role === 'consumption'
      ? [
          consumptionPower,
          feature(
            METER_FEATURES.CONSUMPTION_ENERGY,
            'Consumption index',
            C.ENERGY_SENSOR,
            T.ENERGY_SENSOR.INDEX,
            { unit: U.KILOWATT_HOUR, min: 0, max: 100000000 },
          ),
        ]
      : [
          feature(METER_FEATURES.GRID_POWER, 'Grid power', C.GRID_SENSOR, T.GRID_SENSOR.POWER, {
            unit: U.WATT,
            min: -100000,
            max: 100000,
          }),
          feature(
            METER_FEATURES.GRID_IMPORT,
            'Grid import index',
            C.GRID_SENSOR,
            T.GRID_SENSOR.INPUT_INDEX,
            { unit: U.KILOWATT_HOUR, min: 0, max: 100000000 },
          ),
          feature(
            METER_FEATURES.GRID_EXPORT,
            'Grid export index',
            C.GRID_SENSOR,
            T.GRID_SENSOR.OUTPUT_INDEX,
            { unit: U.KILOWATT_HOUR, min: 0, max: 100000000 },
          ),
          consumptionPower,
        ];
  return {
    name: deviceName('SolarEdge meter', info),
    external_id: ids.device,
    features,
  };
}

/**
 * Grid exchange in the Gladys convention (import > 0, export < 0).
 */
export function gridPower(reading, config) {
  if (!Number.isFinite(reading.power)) {
    return null;
  }
  const exportPositive = config.invert_grid_power ? -reading.power : reading.power;
  return Math.round(-exportPositive);
}

/**
 * States of a meter reading. `productionPower` is the AC power of the
 * inverters (W), used to compute the house consumption behind a grid meter.
 */
export function meterStates(gladys, info, reading, { config, productionPower }) {
  const ids = meterIds(gladys, info);
  if (info.role === 'consumption') {
    return [
      ...numericState(
        ids.feature(METER_FEATURES.CONSUMPTION_POWER),
        Number.isFinite(reading.power) ? Math.round(Math.abs(reading.power)) : null,
      ),
      ...numericState(
        ids.feature(METER_FEATURES.CONSUMPTION_ENERGY),
        toKwh(reading.importedEnergy),
      ),
    ];
  }
  const grid = gridPower(reading, config);
  const consumption =
    grid !== null && Number.isFinite(productionPower)
      ? Math.max(0, Math.round(productionPower + grid))
      : null;
  const [importedEnergy, exportedEnergy] = config.invert_grid_power
    ? [reading.exportedEnergy, reading.importedEnergy]
    : [reading.importedEnergy, reading.exportedEnergy];
  return [
    ...numericState(ids.feature(METER_FEATURES.GRID_POWER), grid),
    ...numericState(ids.feature(METER_FEATURES.GRID_IMPORT), toKwh(importedEnergy)),
    ...numericState(ids.feature(METER_FEATURES.GRID_EXPORT), toKwh(exportedEnergy)),
    ...numericState(ids.feature(METER_FEATURES.CONSUMPTION_POWER), consumption),
  ];
}
