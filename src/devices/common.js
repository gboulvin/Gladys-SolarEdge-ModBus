// -----------------------------------------------------------------------------
// Helpers shared by the device builders.
// -----------------------------------------------------------------------------

/**
 * Platform id of a device: its serial number, the unique id SolarEdge gives
 * it. External ids are forever, so it never depends on a label or on the
 * configuration (a changed unit id must not create a new device).
 */
export function platformId(serial) {
  return String(serial)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * A numeric state, or nothing when the value is unknown: Gladys refuses a
 * state that is not a finite number.
 */
export function numericState(externalId, value) {
  return Number.isFinite(value) ? [{ device_feature_external_id: externalId, state: value }] : [];
}

export function textState(externalId, text) {
  return typeof text === 'string' && text.length > 0
    ? [{ device_feature_external_id: externalId, text }]
    : [];
}

export const toKwh = (wh) => (Number.isFinite(wh) ? Math.round(wh) / 1000 : null);

export const roundTo = (value, decimals) =>
  Number.isFinite(value) ? Math.round(value * 10 ** decimals) / 10 ** decimals : null;

export function deviceName(prefix, info) {
  const model = info.model ? ` ${info.model}` : '';
  return `${prefix}${model} (${info.serial})`.slice(0, 100);
}
