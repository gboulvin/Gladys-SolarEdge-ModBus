// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// Each handler receives the RESOLVED fields (scene variables substituted,
// defaults applied, a `"source": "devices"` field = the chosen device
// external_id) and resolves the declared scalar outputs.
//
// A write the user did not allow (`enable_control` off) or the inverter
// refused is an OUTPUT (`applied: false` + `error`), never a thrown error: a
// scene action is not a condition, the scene author gates the next actions
// on `applied`. The scene triggers are fired by the polling loop
// (src/site.js), never as a consequence of an action.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { STORAGE_COMMANDS, STORAGE_CONTROL_MODES } from './solaredge/registers.js';

const logger = createLogger({ name: 'scenes' });

export const SCENE_ACTION_KEYS = {
  SET_PRODUCTION_LIMIT: 'set_production_limit',
  SET_BATTERY_MODE: 'set_battery_mode',
  BATTERY_COMMAND: 'battery_command',
  SET_BACKUP_RESERVE: 'set_backup_reserve',
  GET_SOLAR_STATUS: 'get_solar_status',
};

const emptyToUndefined = (value) => (value === '' || value === null ? undefined : value);

async function applied(label, write) {
  try {
    await write();
    logger.info(`${label}: applied`);
    return { applied: true, error: '' };
  } catch (err) {
    logger.warn(`${label}: not applied (${err.message})`);
    return { applied: false, error: err.message.slice(0, 200) };
  }
}

export const SCENE_ACTIONS = {
  async [SCENE_ACTION_KEYS.SET_PRODUCTION_LIMIT](site, { fields }) {
    const limit = Number(fields.limit);
    const result = await applied(`Production limit ${limit}%`, () =>
      site.setProductionLimit(emptyToUndefined(fields.device), limit),
    );
    return { ...result, limit: result.applied ? Math.round(limit) : -1 };
  },

  async [SCENE_ACTION_KEYS.SET_BATTERY_MODE](site, { fields }) {
    const mode = fields.mode;
    if (!(mode in STORAGE_CONTROL_MODES)) {
      return { applied: false, error: `Unknown mode "${mode}"` };
    }
    return applied(`Battery mode ${mode}`, () =>
      site.setStorageMode(emptyToUndefined(fields.device), mode),
    );
  },

  async [SCENE_ACTION_KEYS.BATTERY_COMMAND](site, { fields }) {
    const mode = fields.command;
    if (!(mode in STORAGE_COMMANDS)) {
      return { applied: false, error: `Unknown command "${mode}"` };
    }
    const minutes = Number(fields.duration ?? 60);
    const powerLimit = Number(emptyToUndefined(fields.power_limit) ?? 0);
    return applied(`Battery command ${mode} for ${minutes} min`, () =>
      site.sendStorageCommand(emptyToUndefined(fields.device), {
        mode,
        durationSeconds: minutes * 60,
        powerLimit: powerLimit > 0 ? powerLimit : undefined,
      }),
    );
  },

  async [SCENE_ACTION_KEYS.SET_BACKUP_RESERVE](site, { fields }) {
    const reserve = Number(fields.reserve);
    return applied(`Backup reserve ${reserve}%`, () =>
      site.setBackupReserve(emptyToUndefined(fields.device), reserve),
    );
  },

  // Read-only: the latest values of the installation, for the next actions
  // of the scene (a condition on the surplus, a notification text...).
  async [SCENE_ACTION_KEYS.GET_SOLAR_STATUS](site) {
    const snapshot = site.snapshot;
    const totals = snapshot?.totals ?? {};
    const leader = snapshot?.inverters.find((entry) => entry.reading)?.reading;
    const value = (number) => (Number.isFinite(number) ? Math.round(number * 100) / 100 : -1);
    return {
      connected: Boolean(snapshot) && !site.connectionLost,
      production_power: value(totals.production),
      consumption_power: value(totals.consumption),
      grid_power: Number.isFinite(totals.grid) ? Math.round(totals.grid) : 0,
      battery_level: value(totals.batteryLevel),
      today_production: value(totals.todayProduction),
      inverter_status: leader?.status ?? 'unknown',
    };
  },
};
