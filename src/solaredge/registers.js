// -----------------------------------------------------------------------------
// SolarEdge Modbus TCP register map.
//
// Sources: "SunSpec Implementation Technical Note" (SolarEdge, inverter and
// meter blocks) and "Power Control Open Protocol for StorEdge" (storage
// control and battery blocks). Addresses are the 0-based register addresses
// sent on the wire (40000 = the first register of the SunSpec map).
// -----------------------------------------------------------------------------

// "SunS" marker at 40000-40001: proves a SunSpec device answers.
export const SUNSPEC_MARKER = [0x5375, 0x6e53];

export const COMMON = {
  BASE: 40000,
  // marker (2) + DID (1) + length (1) + manufacturer (16) + model (16) +
  // option (8) + version (8) + serial (16) + device address (1)
  LENGTH: 69,
};

export const INVERTER = {
  BASE: 40069, // C_SunSpec_DID (101 single phase, 102 split phase, 103 three phase)
  LENGTH: 40,
  MODELS: [101, 102, 103],
};

// Up to three meters, each one a common block followed by a meter model
// (201 single phase ... 204 three phase delta). The blocks are 174
// registers apart.
export const METERS = [40121, 40295, 40469];
export const METER = {
  COMMON_LENGTH: 67, // DID + length + 65 registers
  MODEL_OFFSET: 67, // model DID, then the length
  DATA_OFFSET: 69,
  DATA_LENGTH: 53,
  MODELS: [201, 202, 203, 204],
};

export const BATTERIES = [0xe100, 0xe200, 0xe400];
export const BATTERY = {
  INFO_LENGTH: 0x4c,
  LIVE_OFFSET: 0x6c,
  LIVE_LENGTH: 28,
};

export const STORAGE_CONTROL = {
  BASE: 0xe000,
  LENGTH: 0x12,
  CONTROL_MODE: 0xe004,
  AC_CHARGE_POLICY: 0xe005,
  BACKUP_RESERVE: 0xe008,
  DEFAULT_MODE: 0xe00a,
  COMMAND_TIMEOUT: 0xe00b,
  COMMAND_MODE: 0xe00d,
  CHARGE_LIMIT: 0xe00e,
  DISCHARGE_LIMIT: 0xe010,
};

// Active power limit, % of the nominal power (Advanced Power Control).
export const ACTIVE_POWER_LIMIT = 0xf001;

// I_Status of the inverter model.
export const INVERTER_STATUS = {
  1: 'off',
  2: 'sleeping',
  3: 'starting',
  4: 'producing',
  5: 'throttled',
  6: 'shutting_down',
  7: 'fault',
  8: 'standby',
};

// Battery status (0xE186).
export const BATTERY_STATUS = {
  0: 'off',
  1: 'off',
  2: 'standby',
  3: 'charging',
  4: 'discharging',
  5: 'fault',
  6: 'idle',
  7: 'idle',
  10: 'sleep',
};

// Storage control mode (0xE004).
export const STORAGE_CONTROL_MODES = {
  disabled: 0,
  maximize_self_consumption: 1,
  time_of_use: 2,
  backup_only: 3,
  remote_control: 4,
};

// Storage charge/discharge command (0xE00A default mode, 0xE00D command).
export const STORAGE_COMMANDS = {
  off: 0,
  charge_excess_pv: 1,
  charge_pv_first: 2,
  charge_pv_and_grid: 3,
  maximize_export: 4,
  discharge_to_match_load: 5,
  maximize_self_consumption: 7,
};

export const keyOf = (map, value) =>
  Object.keys(map).find((key) => map[key] === value) ?? 'unknown';
