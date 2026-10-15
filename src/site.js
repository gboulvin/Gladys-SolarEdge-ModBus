// -----------------------------------------------------------------------------
// The SolarEdge installation ("site"): detection, polling loop, publication.
//
// One site = one Modbus TCP connection to the inverter configured in Gladys
// (SolarEdge accepts a single client) and every unit behind it: inverters,
// meters and batteries. Each cycle reads everything, then:
//   - publishes the states that changed (publishChangedStates: the host API
//     accepts 300 states per minute, sized for changes, not snapshots);
//   - fires the scene triggers (status changes, solar surplus, connection);
//   - keeps a snapshot the widgets and scene actions read from.
//
// The loop is driven by the integration, not by Gladys' onPoll: one cycle
// reads all the devices in a row over the single connection, which a poll
// per device could not schedule.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ModbusTcpClient } from './modbus/client.js';
import {
  detectSite,
  readActivePowerLimit,
  readBattery,
  readInverter,
  readMeter,
  readStorageControl,
  writeActivePowerLimit,
  writeBackupReserve,
  writeStorageCommand,
  writeStorageControlMode,
} from './solaredge/reader.js';
import {
  EMPTY_HARDWARE,
  buildDiscoveredDevices,
  controlUnitOf,
  listDevices,
} from './devices/index.js';
import { inverterIds, inverterStates } from './devices/inverter.js';
import { gridPower, meterIds, meterStates } from './devices/meter.js';
import { batteryIds, batteryStates } from './devices/battery.js';
import { isConfigured } from './config.js';

const logger = createLogger({ name: 'site' });

// Scene trigger keys, as declared in the manifest `scene_triggers` field.
// Keys are forever: scenes store them.
export const SCENE_TRIGGERS = {
  INVERTER_STATUS_CHANGED: 'inverter_status_changed',
  SOLAR_SURPLUS: 'solar_surplus',
  BATTERY_STATUS_CHANGED: 'battery_status_changed',
  CONNECTION_CHANGED: 'connection_changed',
};

// Consecutive failed cycles before the connection is reported lost: one
// missed answer (the inverter reboots its Modbus stack now and then) is not
// worth an alert.
export const FAILURES_BEFORE_LOST = 3;
// Share of the 300 states/minute host API budget the loop may use.
const STATE_BUDGET_PER_MINUTE = 240;
// An unchanged value is re-sent every 30 minutes, so it stays recently dated.
const HEARTBEAT_MS = 30 * 60 * 1000;
// The surplus ends below this share of the threshold (hysteresis: a cloud
// passing by does not fire started/ended/started...).
const SURPLUS_END_RATIO = 0.5;

const HARDWARE_FILE = 'hardware.json';
const DAILY_FILE = 'daily-production.json';

export class ControlDisabledError extends Error {
  constructor() {
    super('Inverter control is disabled in the integration configuration');
    this.name = 'ControlDisabledError';
  }
}

// Local calendar date of the container, YYYY-MM-DD.
function localDate(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

const sum = (values) => {
  const known = values.filter(Number.isFinite);
  return known.length > 0 ? known.reduce((a, b) => a + b, 0) : null;
};

export class SolarEdgeSite {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK fake)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.createClient] `({ host, port }) => ModbusTcpClient`
   * @param {Function} [options.now] clock, for the tests
   */
  constructor({ gladys, store, createClient, now }) {
    this.gladys = gladys;
    this.store = store;
    this.createClient = createClient ?? ((options) => new ModbusTcpClient(options));
    this.now = now ?? (() => new Date());
    this.config = null;
    this.client = null;
    this.hardware = EMPTY_HARDWARE;
    this.daily = { date: null, baseline: {} };
    this.snapshot = null;
    this.previous = null;
    this.failures = 0;
    this.connectionLost = false;
    this.lastError = null;
    this.publishedConnection = null;
    this.publishedTransports = null;
    this.timer = null;
    this.running = false;
    this.cycle = null;
    this.onSnapshot = null;
  }

  async init() {
    this.hardware = await this.store.load(HARDWARE_FILE, EMPTY_HARDWARE);
    this.daily = await this.store.load(DAILY_FILE, { date: null, baseline: {} });
  }

  /**
   * Apply a (new) configuration. A changed address drops the connection.
   */
  configure(config) {
    const previous = this.config;
    this.config = config;
    if (previous && (previous.host !== config.host || previous.port !== config.port)) {
      this.closeClient();
      // Another inverter: the status and surplus memories no longer apply.
      this.previous = null;
    }
  }

  get configured() {
    return Boolean(this.config && isConfigured(this.config));
  }

  getClient() {
    if (!this.configured) {
      throw new Error('No inverter address configured');
    }
    if (!this.client) {
      this.client = this.createClient({ host: this.config.host, port: this.config.port });
    }
    return this.client;
  }

  closeClient() {
    this.client?.close();
    this.client = null;
  }

  // --- Detection -------------------------------------------------------------

  /**
   * Detect the hardware behind the configured unit ids. Keeps the previously
   * known hardware when nothing answers (night, network outage): the devices
   * must not disappear from Gladys.
   * @returns {Promise<{ inverters, meters, batteries, errors }>}
   */
  async detect() {
    const detected = await detectSite(this.getClient(), this.config.unitIds);
    if (detected.inverters.length > 0) {
      const { inverters, meters, batteries } = detected;
      this.hardware = { inverters, meters, batteries };
      await this.store.save(HARDWARE_FILE, this.hardware);
      logger.info(
        `Detected ${inverters.length} inverter(s), ${meters.length} meter(s), ${batteries.length} battery(ies)`,
      );
    } else {
      logger.warn(
        `No inverter answered: ${detected.errors.map((e) => `unit ${e.unitId}: ${e.message}`).join('; ')}`,
      );
    }
    return detected;
  }

  devices() {
    return buildDiscoveredDevices(this.gladys, this.hardware);
  }

  featureCount() {
    return this.devices().reduce((count, device) => count + device.features.length, 0);
  }

  /**
   * Seconds between two cycles: the configured interval, slowed down when a
   * large installation would exceed the state budget of the host API.
   */
  effectiveInterval() {
    const budgetFloor = Math.ceil((this.featureCount() * 60) / STATE_BUDGET_PER_MINUTE);
    return Math.max(this.config.poll_interval, budgetFloor);
  }

  // --- Reading ---------------------------------------------------------------

  async readAll() {
    const client = this.getClient();
    const snapshot = {
      at: this.now(),
      inverters: [],
      meters: [],
      batteries: [],
      storage: {},
      errors: [],
    };
    const attempt = async (label, fn) => {
      try {
        return await fn();
      } catch (err) {
        snapshot.errors.push({ label, message: err.message });
        return null;
      }
    };
    for (const info of this.hardware.inverters) {
      const reading = await attempt(`inverter ${info.serial}`, () =>
        readInverter(client, info.unitId),
      );
      if (reading) {
        reading.powerLimit = await readActivePowerLimit(client, info.unitId);
      }
      snapshot.inverters.push({ info, reading });
    }
    for (const info of this.hardware.meters) {
      const reading = await attempt(`meter ${info.serial}`, () =>
        readMeter(client, info.unitId, info.index),
      );
      snapshot.meters.push({ info, reading });
    }
    for (const info of this.hardware.batteries) {
      const reading = await attempt(`battery ${info.serial}`, () =>
        readBattery(client, info.unitId, info.index),
      );
      snapshot.batteries.push({ info, reading });
    }
    const storageUnits = [...new Set(this.hardware.batteries.map((b) => b.unitId))];
    for (const unitId of storageUnits) {
      const storage = await attempt(`storage control ${unitId}`, () =>
        readStorageControl(client, unitId),
      );
      if (storage) snapshot.storage[unitId] = storage;
    }
    snapshot.ok = [...snapshot.inverters, ...snapshot.meters, ...snapshot.batteries].some(
      (entry) => entry.reading,
    );
    snapshot.totals = await this.computeTotals(snapshot);
    return snapshot;
  }

  async computeTotals(snapshot) {
    const inverters = snapshot.inverters.filter((entry) => entry.reading);
    const production = sum(inverters.map(({ reading }) => Math.max(0, reading.power ?? 0)));
    const gridMeters = snapshot.meters.filter((e) => e.reading && e.info.role === 'grid');
    const grid = sum(gridMeters.map(({ reading }) => gridPower(reading, this.config)));
    const consumptionMeters = snapshot.meters.filter(
      (e) => e.reading && e.info.role === 'consumption',
    );
    let consumption = null;
    if (grid !== null && production !== null) {
      consumption = Math.max(0, production + grid);
    } else if (consumptionMeters.length > 0) {
      consumption = sum(consumptionMeters.map(({ reading }) => Math.abs(reading.power ?? 0)));
    }
    const batteries = snapshot.batteries.filter((e) => e.reading);
    const levels = batteries.map(({ reading }) => reading.level).filter(Number.isFinite);
    return {
      production,
      grid,
      consumption,
      todayProduction: await this.todayProduction(inverters, snapshot.at),
      batteryLevel:
        levels.length > 0 ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : null,
      batteryPower: sum(batteries.map(({ reading }) => reading.power)),
    };
  }

  /**
   * Energy produced since local midnight, in kWh, from the lifetime counters
   * and a baseline taken at the first reading of the day (persisted, so a
   * restart does not reset it).
   */
  async todayProduction(inverters, at) {
    const date = localDate(at);
    let changed = false;
    if (this.daily.date !== date) {
      this.daily = { date, baseline: {} };
      changed = true;
    }
    let total = null;
    for (const { info, reading } of inverters) {
      if (!Number.isFinite(reading.energy)) continue;
      const baseline = this.daily.baseline[info.serial];
      if (baseline === undefined || reading.energy < baseline) {
        this.daily.baseline[info.serial] = reading.energy;
        changed = true;
      }
      total = (total ?? 0) + (reading.energy - this.daily.baseline[info.serial]);
    }
    if (changed) {
      await this.store.save(DAILY_FILE, this.daily);
    }
    return total === null ? null : Math.round(total / 10) / 100;
  }

  // --- Publication -----------------------------------------------------------

  statesOf(snapshot) {
    const productionPower = snapshot.totals.production;
    return [
      ...snapshot.inverters
        .filter((e) => e.reading)
        .flatMap(({ info, reading }) => inverterStates(this.gladys, info, reading)),
      ...snapshot.meters
        .filter((e) => e.reading)
        .flatMap(({ info, reading }) =>
          meterStates(this.gladys, info, reading, { config: this.config, productionPower }),
        ),
      ...snapshot.batteries
        .filter((e) => e.reading)
        .flatMap(({ info, reading }) => batteryStates(this.gladys, info, reading)),
    ];
  }

  async publishStates(snapshot) {
    const states = this.statesOf(snapshot);
    if (states.length > 0) {
      await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
    }
  }

  /**
   * Per-device transport badge: `local` when the last cycle read it,
   * `unreachable` otherwise. Only sent when it changes.
   */
  async publishTransports(snapshot) {
    const reached = new Set();
    for (const entry of snapshot?.inverters ?? []) {
      if (entry.reading) reached.add(inverterIds(this.gladys, entry.info).device);
    }
    for (const entry of snapshot?.meters ?? []) {
      if (entry.reading) reached.add(meterIds(this.gladys, entry.info).device);
    }
    for (const entry of snapshot?.batteries ?? []) {
      if (entry.reading) reached.add(batteryIds(this.gladys, entry.info).device);
    }
    const entries = listDevices(this.gladys, this.hardware).map(({ externalId }) => ({
      external_id: externalId,
      transport: reached.has(externalId) ? 'local' : 'unreachable',
    }));
    const signature = JSON.stringify(entries);
    if (entries.length === 0 || signature === this.publishedTransports) {
      return;
    }
    await this.gladys.publishTransports(entries);
    this.publishedTransports = signature;
  }

  async setConnection(connected, message) {
    const signature = JSON.stringify([connected, message ?? null]);
    if (signature === this.publishedConnection) {
      return;
    }
    await this.gladys.setConnectionStatus(connected, message);
    this.publishedConnection = signature;
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.error(`Scene event ${key} refused`, err);
    }
  }

  /**
   * Fire the scene triggers: one event per TRANSITION between two cycles,
   * never on the first reading (nothing changed, the integration just
   * started).
   */
  async fireSceneEvents(snapshot) {
    const memory = {
      inverters: new Map(),
      batteries: new Map(),
      surplus: new Map(),
    };
    for (const { info, reading } of snapshot.inverters) {
      if (!reading) continue;
      const device = inverterIds(this.gladys, info).device;
      memory.inverters.set(device, reading.status);
      const before = this.previous?.inverters.get(device);
      if (before !== undefined && before !== reading.status) {
        await this.fire(SCENE_TRIGGERS.INVERTER_STATUS_CHANGED, {
          device,
          status: reading.status,
          previous_status: before,
          power: Math.max(0, Math.round(reading.power ?? 0)),
        });
      }
    }
    for (const { info, reading } of snapshot.batteries) {
      if (!reading) continue;
      const device = batteryIds(this.gladys, info).device;
      memory.batteries.set(device, reading.status);
      const before = this.previous?.batteries.get(device);
      if (before !== undefined && before !== reading.status) {
        await this.fire(SCENE_TRIGGERS.BATTERY_STATUS_CHANGED, {
          device,
          status: reading.status,
          previous_status: before,
          level: Number.isFinite(reading.level) ? Math.round(reading.level) : 0,
        });
      }
    }
    const threshold = this.config.surplus_threshold;
    for (const { info, reading } of snapshot.meters) {
      if (!reading || info.role !== 'grid') continue;
      const device = meterIds(this.gladys, info).device;
      const grid = gridPower(reading, this.config);
      if (grid === null) continue;
      const exportPower = Math.max(0, -grid);
      const wasSurplus = this.previous?.surplus.get(device);
      let surplus = wasSurplus ?? exportPower >= threshold;
      if (!wasSurplus && exportPower >= threshold) surplus = true;
      if (wasSurplus && exportPower < threshold * SURPLUS_END_RATIO) surplus = false;
      memory.surplus.set(device, surplus);
      if (wasSurplus !== undefined && wasSurplus !== surplus) {
        await this.fire(SCENE_TRIGGERS.SOLAR_SURPLUS, {
          device,
          state: surplus ? 'started' : 'ended',
          export_power: exportPower,
        });
      }
    }
    this.previous = memory;
  }

  // --- Cycle -----------------------------------------------------------------

  /**
   * One full cycle: read, publish, fire the triggers. Never throws: a failed
   * cycle is counted, and reported once the connection is considered lost.
   */
  async pollOnce() {
    if (!this.configured || this.hardware.inverters.length === 0) {
      return null;
    }
    let snapshot;
    try {
      snapshot = await this.readAll();
    } catch (err) {
      snapshot = { ok: false, errors: [{ label: 'connection', message: err.message }] };
    }
    try {
      if (snapshot.ok) {
        await this.onSuccess(snapshot);
      } else {
        await this.onFailure(snapshot);
      }
    } catch (err) {
      logger.error('Publication failed', err);
    }
    return snapshot;
  }

  async onSuccess(snapshot) {
    for (const error of snapshot.errors) {
      logger.warn(`Read failed (${error.label}): ${error.message}`);
    }
    this.snapshot = snapshot;
    this.failures = 0;
    this.lastError = null;
    await this.publishStates(snapshot);
    await this.fireSceneEvents(snapshot);
    await this.publishTransports(snapshot);
    if (this.connectionLost) {
      this.connectionLost = false;
      logger.info('Connection to the inverter restored');
      await this.fire(SCENE_TRIGGERS.CONNECTION_CHANGED, { state: 'restored', message: '' });
    }
    await this.setConnection(true);
    this.onSnapshot?.(snapshot);
  }

  async onFailure(snapshot) {
    this.failures += 1;
    this.lastError = snapshot.errors[0]?.message ?? 'No answer';
    logger.warn(`Cycle failed (${this.failures}): ${this.lastError}`);
    // Start over with a fresh socket at the next cycle.
    this.closeClient();
    if (this.failures < FAILURES_BEFORE_LOST || this.connectionLost) {
      return;
    }
    this.connectionLost = true;
    await this.fire(SCENE_TRIGGERS.CONNECTION_CHANGED, {
      state: 'lost',
      message: this.lastError.slice(0, 200),
    });
    await this.publishTransports(null);
    await this.setConnection(false, {
      en: `The inverter does not answer over Modbus TCP: ${this.lastError}`,
      fr: `L'onduleur ne répond pas en Modbus TCP : ${this.lastError}`,
      de: `Der Wechselrichter antwortet nicht über Modbus TCP: ${this.lastError}`,
      es: `El inversor no responde por Modbus TCP: ${this.lastError}`,
    });
    this.onSnapshot?.(this.snapshot);
  }

  start() {
    this.stop();
    this.running = true;
    const loop = async () => {
      this.cycle = this.pollOnce();
      await this.cycle;
      this.cycle = null;
      if (this.running) {
        this.timer = setTimeout(loop, this.effectiveInterval() * 1000);
      }
    };
    this.timer = setTimeout(loop, 0);
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
  }

  async shutdown() {
    this.stop();
    await this.cycle;
    this.closeClient();
  }

  // --- Control ---------------------------------------------------------------

  async control(externalId, write) {
    if (!this.config?.enable_control) {
      throw new ControlDisabledError();
    }
    const unitId = controlUnitOf(this.gladys, this.hardware, externalId);
    if (unitId === null) {
      throw new Error('Unknown SolarEdge device');
    }
    return write(this.getClient(), unitId);
  }

  setProductionLimit(externalId, percent) {
    return this.control(externalId, (client, unitId) =>
      writeActivePowerLimit(client, unitId, percent),
    );
  }

  setStorageMode(externalId, mode) {
    return this.control(externalId, (client, unitId) =>
      writeStorageControlMode(client, unitId, mode),
    );
  }

  setBackupReserve(externalId, percent) {
    return this.control(externalId, (client, unitId) =>
      writeBackupReserve(client, unitId, percent),
    );
  }

  sendStorageCommand(externalId, command) {
    return this.control(externalId, (client, unitId) =>
      writeStorageCommand(client, unitId, command),
    );
  }
}
