// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys from the `config_schema` of the manifest;
// fetched with `gladys.getConfig()` and hot-reloaded through
// `gladys.onConfigUpdated()`. This module provides the defaults and
// normalizes the received object, so the rest of the code never deals with
// strings coming from a form or with `undefined`.
// -----------------------------------------------------------------------------

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  host: '',
  // SetApp inverters listen on 1502; older LCD ones were often set to 502.
  port: 1502,
  // Modbus unit ids of the inverters, comma separated (leader/follower).
  unit_ids: '1',
  // Seconds between two reads of the whole installation.
  poll_interval: 10,
  // SolarEdge meters count the power exported to the grid as positive.
  // Turn this on for a meter installed the other way round.
  invert_grid_power: false,
  // Export power (W) above which the solar surplus scene trigger fires.
  surplus_threshold: 500,
  // Writes to the inverter (production limit, battery modes) are refused
  // unless the user explicitly allows them.
  enable_control: false,
};

export const POLL_INTERVAL_BOUNDS = { min: 5, max: 300 };

function toNumber(value, fallback) {
  const number = Number(value);
  return value === '' || value === null || value === undefined || !Number.isFinite(number)
    ? fallback
    : number;
}

function toBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

/**
 * Parse the unit id list: "1, 2,3" -> [1, 2, 3]; invalid entries dropped,
 * duplicates removed, [1] when nothing valid remains.
 */
export function parseUnitIds(value) {
  const ids = String(value ?? '')
    .split(/[\s,;]+/)
    .map((part) => Number(part))
    .filter((id) => Number.isInteger(id) && id >= 1 && id <= 247);
  return ids.length > 0 ? [...new Set(ids)] : [1];
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const pollInterval = toNumber(raw.poll_interval, DEFAULT_CONFIG.poll_interval);
  return {
    ...DEFAULT_CONFIG,
    host: String(raw.host ?? DEFAULT_CONFIG.host).trim(),
    port: toNumber(raw.port, DEFAULT_CONFIG.port),
    unit_ids: String(raw.unit_ids ?? DEFAULT_CONFIG.unit_ids),
    unitIds: parseUnitIds(raw.unit_ids ?? DEFAULT_CONFIG.unit_ids),
    poll_interval: Math.min(
      POLL_INTERVAL_BOUNDS.max,
      Math.max(POLL_INTERVAL_BOUNDS.min, pollInterval),
    ),
    invert_grid_power: toBoolean(raw.invert_grid_power ?? DEFAULT_CONFIG.invert_grid_power),
    surplus_threshold: Math.max(
      1,
      toNumber(raw.surplus_threshold, DEFAULT_CONFIG.surplus_threshold),
    ),
    enable_control: toBoolean(raw.enable_control ?? DEFAULT_CONFIG.enable_control),
  };
}

export function isConfigured(config) {
  return config.host.length > 0;
}
