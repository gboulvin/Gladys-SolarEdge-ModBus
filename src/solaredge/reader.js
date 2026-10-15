// -----------------------------------------------------------------------------
// SolarEdge reads and writes over a ModbusTcpClient.
//
// Every function takes the client and the Modbus unit id (1 for a single
// inverter; leader/follower installations chained over RS485 answer on the
// unit ids set in SetApp) and returns plain objects in SI units: W, Wh, V, A,
// °C, %. Nothing here knows about Gladys.
// -----------------------------------------------------------------------------

import {
  float32LE,
  encodeFloat32LE,
  encodeUint32LE,
  int16,
  scaled,
  string,
  uint16,
  uint32BE,
  uint32LE,
  uint64LE,
} from './decode.js';
import {
  ACTIVE_POWER_LIMIT,
  BATTERIES,
  BATTERY,
  BATTERY_STATUS,
  COMMON,
  INVERTER,
  INVERTER_STATUS,
  METER,
  METERS,
  STORAGE_COMMANDS,
  STORAGE_CONTROL,
  STORAGE_CONTROL_MODES,
  SUNSPEC_MARKER,
  keyOf,
} from './registers.js';

// Common block fields, as offsets from the DID register.
function parseCommonFields(registers, offset) {
  return {
    manufacturer: string(registers, offset + 2, 16),
    model: string(registers, offset + 18, 16),
    option: string(registers, offset + 34, 8),
    version: string(registers, offset + 42, 8),
    serial: string(registers, offset + 50, 16),
  };
}

/**
 * Read the identity of the inverter answering on `unitId`. Throws when the
 * device does not speak SunSpec.
 */
export async function readInverterInfo(client, unitId) {
  const registers = await client.readHoldingRegisters(unitId, COMMON.BASE, COMMON.LENGTH);
  if (registers[0] !== SUNSPEC_MARKER[0] || registers[1] !== SUNSPEC_MARKER[1]) {
    throw new Error(`Unit ${unitId} is not a SunSpec device (no "SunS" marker at 40000)`);
  }
  const info = parseCommonFields(registers, 2);
  const model = await client.readHoldingRegisters(unitId, INVERTER.BASE, 1);
  return { unitId, ...info, sunspecModel: model[0], serial: info.serial || `unit${unitId}` };
}

/**
 * Read the live values of an inverter.
 */
export async function readInverter(client, unitId) {
  const r = await client.readHoldingRegisters(unitId, INVERTER.BASE, INVERTER.LENGTH);
  const model = r[0];
  const aSf = int16(r, 6);
  const vSf = int16(r, 13);
  const voltageAB = scaled(uint16(r, 7), vSf);
  const voltageAN = scaled(uint16(r, 10), vSf);
  // Single phase inverters report their voltage as AB; three phase ones as
  // phase-to-neutral voltages.
  const voltage = model === 101 || !voltageAN ? voltageAB : voltageAN;
  const status = uint16(r, 38);
  return {
    model,
    current: scaled(uint16(r, 2), aSf),
    voltage,
    power: scaled(int16(r, 14), int16(r, 15), 'int16'),
    frequency: scaled(uint16(r, 16), int16(r, 17)),
    apparentPower: scaled(int16(r, 18), int16(r, 19), 'int16'),
    powerFactor: scaled(int16(r, 22), int16(r, 23), 'int16'),
    // acc32 lifetime counter: 0 means "not available yet", not "nothing produced".
    energy: uint32BE(r, 24) === 0 ? null : scaled(uint32BE(r, 24), int16(r, 26), 'acc32'),
    dcCurrent: scaled(uint16(r, 27), int16(r, 28)),
    dcVoltage: scaled(uint16(r, 29), int16(r, 30)),
    dcPower: scaled(int16(r, 31), int16(r, 32), 'int16'),
    temperature: scaled(int16(r, 34), int16(r, 37), 'int16'),
    statusCode: status,
    status: INVERTER_STATUS[status] ?? 'unknown',
  };
}

/**
 * Read the active power limit (%), or null when Advanced Power Control is
 * not available on this inverter.
 */
export async function readActivePowerLimit(client, unitId) {
  try {
    const [limit] = await client.readHoldingRegisters(unitId, ACTIVE_POWER_LIMIT, 1);
    return limit <= 100 ? limit : null;
  } catch {
    return null;
  }
}

export async function writeActivePowerLimit(client, unitId, percent) {
  const value = Math.round(percent);
  if (!(value >= 0 && value <= 100)) {
    throw new RangeError('The production limit is a percentage between 0 and 100');
  }
  await client.writeRegister(unitId, ACTIVE_POWER_LIMIT, value);
  return value;
}

/**
 * Identify meter `index` (0..2) of the inverter, or resolve null when there
 * is none.
 */
export async function readMeterInfo(client, unitId, index) {
  const base = METERS[index];
  let registers;
  try {
    registers = await client.readHoldingRegisters(unitId, base, METER.COMMON_LENGTH + 2);
  } catch {
    return null;
  }
  const [did, length] = registers;
  const model = registers[METER.MODEL_OFFSET];
  if (did !== 1 || length !== 65 || !METER.MODELS.includes(model)) {
    return null;
  }
  const info = parseCommonFields(registers, 0);
  return {
    unitId,
    index,
    ...info,
    sunspecModel: model,
    serial: info.serial || `unit${unitId}-meter${index + 1}`,
    // SolarEdge writes the meter function in the option field: "Export+Import"
    // at the grid connection point, "Consumption" on the house load...
    role: /consumption/i.test(info.option) && !/export/i.test(info.option) ? 'consumption' : 'grid',
  };
}

/**
 * Read the live values of meter `index`. Power is the SolarEdge sign:
 * positive when exporting to the grid, negative when importing.
 */
export async function readMeter(client, unitId, index) {
  const r = await client.readHoldingRegisters(
    unitId,
    METERS[index] + METER.DATA_OFFSET,
    METER.DATA_LENGTH,
  );
  const energySf = int16(r, 52);
  const exported = uint32BE(r, 36);
  const imported = uint32BE(r, 44);
  return {
    current: scaled(int16(r, 0), int16(r, 4), 'int16'),
    voltage: scaled(int16(r, 5), int16(r, 13), 'int16'),
    frequency: scaled(int16(r, 14), int16(r, 15), 'int16'),
    power: scaled(int16(r, 16), int16(r, 20), 'int16'),
    exportedEnergy: exported === 0 ? null : scaled(exported, energySf, 'acc32'),
    importedEnergy: imported === 0 ? null : scaled(imported, energySf, 'acc32'),
  };
}

/**
 * Identify battery `index` (0..2) of the inverter, or resolve null when there
 * is none.
 */
export async function readBatteryInfo(client, unitId, index) {
  const base = BATTERIES[index];
  let r;
  try {
    r = await client.readHoldingRegisters(unitId, base, BATTERY.INFO_LENGTH);
  } catch {
    return null;
  }
  const ratedEnergy = float32LE(r, 0x42);
  const manufacturer = string(r, 0, 16);
  if (!manufacturer || !(ratedEnergy > 0)) {
    return null;
  }
  const serial = string(r, 0x30, 16);
  return {
    unitId,
    index,
    manufacturer,
    model: string(r, 0x10, 16),
    version: string(r, 0x20, 16),
    serial: serial || `unit${unitId}-battery${index + 1}`,
    ratedEnergy,
    maxChargePower: float32LE(r, 0x44),
    maxDischargePower: float32LE(r, 0x46),
  };
}

/**
 * Read the live values of battery `index`. Power is positive while charging.
 */
export async function readBattery(client, unitId, index) {
  const r = await client.readHoldingRegisters(
    unitId,
    BATTERIES[index] + BATTERY.LIVE_OFFSET,
    BATTERY.LIVE_LENGTH,
  );
  const statusCode = uint32LE(r, 26);
  const status = BATTERY_STATUS[statusCode] ?? 'unknown';
  const level = float32LE(r, 24);
  // Voltage, current and power are bogus outside of the active states.
  const active = ['charging', 'discharging', 'idle'].includes(status);
  return {
    temperature: float32LE(r, 0),
    voltage: active ? float32LE(r, 4) : 0,
    current: active ? float32LE(r, 6) : 0,
    power: active ? float32LE(r, 8) : 0,
    dischargedEnergy: uint64LE(r, 10),
    chargedEnergy: uint64LE(r, 14),
    maxEnergy: float32LE(r, 18),
    availableEnergy: float32LE(r, 20),
    health: float32LE(r, 22),
    level: level !== null && level >= 0 && level <= 100 ? level : null,
    statusCode,
    status,
  };
}

/**
 * Read the storage control settings (StorEdge inverters only).
 */
export async function readStorageControl(client, unitId) {
  const r = await client.readHoldingRegisters(unitId, STORAGE_CONTROL.BASE, STORAGE_CONTROL.LENGTH);
  return {
    controlMode: keyOf(STORAGE_CONTROL_MODES, uint16(r, 4)),
    acChargePolicy: uint16(r, 5),
    backupReserve: float32LE(r, 8),
    defaultMode: keyOf(STORAGE_COMMANDS, uint16(r, 10)),
    commandTimeout: uint32LE(r, 11),
    commandMode: keyOf(STORAGE_COMMANDS, uint16(r, 13)),
    chargeLimit: float32LE(r, 14),
    dischargeLimit: float32LE(r, 16),
  };
}

export async function writeStorageControlMode(client, unitId, mode) {
  const value = STORAGE_CONTROL_MODES[mode];
  if (value === undefined) {
    throw new RangeError(`Unknown storage control mode "${mode}"`);
  }
  await client.writeRegister(unitId, STORAGE_CONTROL.CONTROL_MODE, value);
}

export async function writeBackupReserve(client, unitId, percent) {
  if (!(percent >= 0 && percent <= 100)) {
    throw new RangeError('The backup reserve is a percentage between 0 and 100');
  }
  await client.writeRegisters(unitId, STORAGE_CONTROL.BACKUP_RESERVE, encodeFloat32LE(percent));
}

/**
 * Send a remote charge/discharge command to the battery: switches the storage
 * control to "remote control" first, then writes the command, its duration
 * and its optional power limit. When the duration ends, the inverter falls
 * back to the default mode (0xE00A).
 * @param {object} command
 * @param {string} command.mode key of STORAGE_COMMANDS
 * @param {number} command.durationSeconds
 * @param {number} [command.powerLimit] W, applies to charge or discharge
 */
export async function writeStorageCommand(client, unitId, { mode, durationSeconds, powerLimit }) {
  const value = STORAGE_COMMANDS[mode];
  if (value === undefined) {
    throw new RangeError(`Unknown storage command "${mode}"`);
  }
  const seconds = Math.round(durationSeconds);
  if (!(seconds >= 1 && seconds <= 86400)) {
    throw new RangeError('The command duration is between 1 second and 24 hours');
  }
  await client.writeRegister(
    unitId,
    STORAGE_CONTROL.CONTROL_MODE,
    STORAGE_CONTROL_MODES.remote_control,
  );
  await client.writeRegisters(unitId, STORAGE_CONTROL.COMMAND_TIMEOUT, encodeUint32LE(seconds));
  if (powerLimit !== undefined && powerLimit !== null && powerLimit > 0) {
    const limit = encodeFloat32LE(powerLimit);
    await client.writeRegisters(unitId, STORAGE_CONTROL.CHARGE_LIMIT, limit);
    await client.writeRegisters(unitId, STORAGE_CONTROL.DISCHARGE_LIMIT, limit);
  }
  await client.writeRegister(unitId, STORAGE_CONTROL.COMMAND_MODE, value);
}

/**
 * Detect everything that answers behind the configured unit ids: the
 * inverters, and the meters and batteries connected to each of them.
 * An inverter that does not answer is reported in `errors`, the others are
 * still returned.
 */
export async function detectSite(client, unitIds) {
  const site = { inverters: [], meters: [], batteries: [], errors: [] };
  for (const unitId of unitIds) {
    try {
      site.inverters.push(await readInverterInfo(client, unitId));
    } catch (err) {
      site.errors.push({ unitId, message: err.message });
      continue;
    }
    for (let index = 0; index < METERS.length; index += 1) {
      const meter = await readMeterInfo(client, unitId, index);
      if (meter) site.meters.push(meter);
    }
    for (let index = 0; index < BATTERIES.length; index += 1) {
      const battery = await readBatteryInfo(client, unitId, index);
      if (battery) site.batteries.push(battery);
    }
  }
  return site;
}
