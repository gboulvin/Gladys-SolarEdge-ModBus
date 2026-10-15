// -----------------------------------------------------------------------------
// Dashboard widgets (manifest `widgets`, Gladys 5.1+).
//
// The content is declarative (`text`, `value`, `gauge`, `status`, `chart`,
// `button`): the core renders it with its own theme. Tiles and the chart are
// bound to device features (`device_feature`): they move with the published
// states, nothing to refresh. The status rows are computed from the latest
// snapshot of the site: index.js nudges the widgets when they change.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import {
  t,
  mapText,
  BATTERY_STATUS_TEXT,
  INVERTER_STATUS_TEXT,
  STORAGE_MODE_TEXT,
} from './i18n.js';
import { INVERTER_FEATURES, inverterIds } from './devices/inverter.js';
import { METER_FEATURES, meterIds } from './devices/meter.js';
import { BATTERY_FEATURES, batteryIds } from './devices/battery.js';
import { ControlDisabledError } from './site.js';

const logger = createLogger({ name: 'widgets' });

export const WIDGET_KEYS = {
  SOLAR_OVERVIEW: 'solar_overview',
  BATTERY_OVERVIEW: 'battery_overview',
};

const ACTIONS = {
  REFRESH: 'refresh',
  SELF_CONSUMPTION: 'self_consumption',
  BACKUP_ONLY: 'backup_only',
};

const CHART_INTERVALS = ['last-twelve-hours', 'last-day', 'last-three-days', 'last-week'];

const INVERTER_STATUS_COLOR = {
  producing: WIDGET_COLORS.SUCCESS,
  throttled: WIDGET_COLORS.WARNING,
  fault: WIDGET_COLORS.DANGER,
  sleeping: WIDGET_COLORS.NEUTRAL,
  off: WIDGET_COLORS.NEUTRAL,
};

const BATTERY_STATUS_COLOR = {
  charging: WIDGET_COLORS.SUCCESS,
  discharging: WIDGET_COLORS.INFO,
  fault: WIDGET_COLORS.DANGER,
};

const NOT_CONFIGURED = t(
  'Enter the address of your SolarEdge inverter in the integration configuration.',
  "Renseignez l'adresse de votre onduleur SolarEdge dans la configuration de l'intégration.",
  'Geben Sie die Adresse Ihres SolarEdge-Wechselrichters in der Konfiguration der Integration ein.',
  'Introduzca la dirección de su inversor SolarEdge en la configuración de la integración.',
);

const NO_BATTERY = t(
  'No SolarEdge battery was detected on this installation.',
  "Aucune batterie SolarEdge n'a été détectée sur cette installation.",
  'In dieser Anlage wurde keine SolarEdge-Batterie erkannt.',
  'No se ha detectado ninguna batería SolarEdge en esta instalación.',
);

const CONNECTION_LOST = t(
  'The inverter does not answer. Check that Modbus TCP is enabled and the address is right.',
  "L'onduleur ne répond pas. Vérifiez que Modbus TCP est activé et que l'adresse est correcte.",
  'Der Wechselrichter antwortet nicht. Prüfen Sie, ob Modbus TCP aktiv und die Adresse korrekt ist.',
  'El inversor no responde. Compruebe que Modbus TCP está activado y que la dirección es correcta.',
);

const kwh = (value) => `${value.toFixed(value >= 100 ? 0 : 1)} kWh`;

function bodyText(text) {
  return { type: 'text', variant: 'body', text };
}

function solarOverview(site, settings) {
  const { gladys, hardware, snapshot } = site;
  if (!site.configured || hardware.inverters.length === 0) {
    return { ttl_seconds: 300, components: [bodyText(NOT_CONFIGURED)] };
  }
  const components = [];
  const productionFeatures = hardware.inverters.map((info) =>
    inverterIds(gladys, info).feature(INVERTER_FEATURES.POWER),
  );
  const gridMeter = hardware.meters.find((info) => info.role === 'grid');
  const consumptionMeter = gridMeter ?? hardware.meters.find((m) => m.role === 'consumption');
  const consumptionFeature = consumptionMeter
    ? meterIds(gladys, consumptionMeter).feature(METER_FEATURES.CONSUMPTION_POWER)
    : null;

  // Tiles. With several inverters the total is computed (inline value), a
  // single inverter is bound live.
  if (productionFeatures.length === 1) {
    components.push({
      type: 'value',
      label: t('Production', 'Production', 'Erzeugung', 'Producción'),
      icon: 'sun',
      color: WIDGET_COLORS.SUCCESS,
      device_feature: productionFeatures[0],
    });
  } else if (Number.isFinite(snapshot?.totals.production)) {
    components.push({
      type: 'value',
      label: t('Production', 'Production', 'Erzeugung', 'Producción'),
      icon: 'sun',
      color: WIDGET_COLORS.SUCCESS,
      value: Math.round(snapshot.totals.production),
      unit: 'W',
    });
  }
  if (consumptionFeature) {
    components.push({
      type: 'value',
      label: t('Consumption', 'Consommation', 'Verbrauch', 'Consumo'),
      icon: 'home',
      device_feature: consumptionFeature,
    });
  }
  if (gridMeter) {
    components.push({
      type: 'value',
      label: t('Grid', 'Réseau', 'Netz', 'Red'),
      icon: 'zap',
      device_feature: meterIds(gladys, gridMeter).feature(METER_FEATURES.GRID_POWER),
    });
  }
  if (hardware.batteries.length > 0) {
    components.push({
      type: 'gauge',
      label: t('Battery', 'Batterie', 'Batterie', 'Batería'),
      color: WIDGET_COLORS.PRIMARY,
      device_feature: batteryIds(gladys, hardware.batteries[0]).feature(BATTERY_FEATURES.LEVEL),
      min: 0,
      max: 100,
    });
  }

  // Focal chart: production (and consumption) history, from the core.
  const interval = CHART_INTERVALS.includes(settings?.chart_interval)
    ? settings.chart_interval
    : 'last-day';
  components.push({
    type: 'chart',
    chart_type: 'area',
    title: t('Production', 'Production', 'Erzeugung', 'Producción'),
    device_features: [productionFeatures[0], consumptionFeature].filter(Boolean),
    interval,
    now_marker: true,
  });

  if (site.connectionLost) {
    components.push(bodyText(CONNECTION_LOST));
  }

  // Computed rows.
  const items = [];
  const totals = snapshot?.totals;
  if (Number.isFinite(totals?.todayProduction)) {
    items.push({
      label: t(
        "Today's production",
        'Production du jour',
        'Heutige Erzeugung',
        'Producción de hoy',
      ),
      icon: 'sunrise',
      value: kwh(totals.todayProduction),
      color: WIDGET_COLORS.SUCCESS,
    });
  }
  for (const { info, reading } of snapshot?.inverters ?? []) {
    if (!reading) continue;
    const label =
      hardware.inverters.length > 1
        ? mapText(
            t('Inverter', 'Onduleur', 'Wechselrichter', 'Inversor'),
            (s) => `${s} ${info.unitId}`,
          )
        : t('Inverter', 'Onduleur', 'Wechselrichter', 'Inversor');
    items.push({
      label,
      icon: 'activity',
      value: INVERTER_STATUS_TEXT[reading.status] ?? INVERTER_STATUS_TEXT.unknown,
      color: INVERTER_STATUS_COLOR[reading.status] ?? WIDGET_COLORS.NEUTRAL,
    });
    if (Number.isFinite(reading.powerLimit) && reading.powerLimit < 100) {
      items.push({
        label: t(
          'Production limit',
          'Limite de production',
          'Leistungsbegrenzung',
          'Límite de producción',
        ),
        icon: 'sliders',
        value: `${reading.powerLimit} %`,
        color: WIDGET_COLORS.WARNING,
      });
    }
  }
  if (
    Number.isFinite(totals?.consumption) &&
    totals.consumption > 0 &&
    Number.isFinite(totals.grid)
  ) {
    const selfPowered = Math.round(
      (100 * Math.max(0, totals.consumption - Math.max(0, totals.grid))) / totals.consumption,
    );
    items.push({
      label: t('Self-sufficiency', 'Autonomie', 'Autarkie', 'Autosuficiencia'),
      icon: 'percent',
      value: `${selfPowered} %`,
      color: selfPowered >= 50 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (items.length > 0) {
    components.push({ type: 'status', items: items.slice(0, 10) });
  }
  components.push({
    type: 'button',
    label: t('Refresh', 'Actualiser', 'Aktualisieren', 'Actualizar'),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: ACTIONS.REFRESH },
  });
  return { ttl_seconds: 300, components };
}

function batteryOverview(site, config) {
  const { gladys, hardware, snapshot } = site;
  if (!site.configured || hardware.inverters.length === 0) {
    return { ttl_seconds: 300, components: [bodyText(NOT_CONFIGURED)] };
  }
  if (hardware.batteries.length === 0) {
    return { ttl_seconds: 300, components: [bodyText(NO_BATTERY)] };
  }
  const battery = hardware.batteries[0];
  const ids = batteryIds(gladys, battery);
  const components = [
    {
      type: 'gauge',
      label: t('Charge level', 'Niveau de charge', 'Ladestand', 'Nivel de carga'),
      color: WIDGET_COLORS.PRIMARY,
      device_feature: ids.feature(BATTERY_FEATURES.LEVEL),
      min: 0,
      max: 100,
    },
    {
      type: 'value',
      label: t('Charging', 'Charge', 'Laden', 'Carga'),
      icon: 'battery-charging',
      color: WIDGET_COLORS.SUCCESS,
      device_feature: ids.feature(BATTERY_FEATURES.CHARGE_POWER),
    },
    {
      type: 'value',
      label: t('Discharging', 'Décharge', 'Entladen', 'Descarga'),
      icon: 'battery',
      color: WIDGET_COLORS.INFO,
      device_feature: ids.feature(BATTERY_FEATURES.DISCHARGE_POWER),
    },
    {
      type: 'value',
      label: t('Available', 'Disponible', 'Verfügbar', 'Disponible'),
      icon: 'database',
      device_feature: ids.feature(BATTERY_FEATURES.ENERGY_REMAINING),
    },
  ];
  if (site.connectionLost) {
    components.push(bodyText(CONNECTION_LOST));
  }
  const items = [];
  const entry = snapshot?.batteries.find((b) => b.info.serial === battery.serial);
  if (entry?.reading) {
    items.push({
      label: t('Status', 'État', 'Status', 'Estado'),
      icon: 'activity',
      value: BATTERY_STATUS_TEXT[entry.reading.status] ?? BATTERY_STATUS_TEXT.unknown,
      color: BATTERY_STATUS_COLOR[entry.reading.status] ?? WIDGET_COLORS.NEUTRAL,
    });
    if (Number.isFinite(entry.reading.health)) {
      items.push({
        label: t('Health', 'Santé', 'Zustand', 'Salud'),
        icon: 'heart',
        value: `${Math.round(entry.reading.health)} %`,
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
  }
  const storage = snapshot?.storage[battery.unitId];
  if (storage) {
    items.push({
      label: t('Mode', 'Mode', 'Modus', 'Modo'),
      icon: 'settings',
      value: STORAGE_MODE_TEXT[storage.controlMode] ?? STORAGE_MODE_TEXT.unknown,
      color: WIDGET_COLORS.NEUTRAL,
    });
    if (Number.isFinite(storage.backupReserve)) {
      items.push({
        label: t('Backup reserve', 'Réserve de secours', 'Notstromreserve', 'Reserva de respaldo'),
        icon: 'shield',
        value: `${Math.round(storage.backupReserve)} %`,
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
  }
  if (items.length > 0) {
    components.push({ type: 'status', items });
  }
  // Mode buttons only when the user allowed the integration to write to the
  // inverter. `params` are declared here, never taken from the dashboard.
  if (config.enable_control) {
    components.push(
      {
        type: 'button',
        label: t('Self-consumption', 'Autoconsommation', 'Eigenverbrauch', 'Autoconsumo'),
        icon: 'sun',
        style: 'secondary',
        action: { key: ACTIONS.SELF_CONSUMPTION, confirm: true },
      },
      {
        type: 'button',
        label: t('Backup only', 'Secours seul', 'Nur Notstrom', 'Solo respaldo'),
        icon: 'shield',
        style: 'secondary',
        action: { key: ACTIONS.BACKUP_ONLY, confirm: true },
      },
    );
  }
  return { ttl_seconds: 300, components };
}

const DONE = t('Done.', 'C’est fait.', 'Erledigt.', 'Hecho.');
const CONTROL_DISABLED = t(
  'Inverter control is disabled in the integration configuration.',
  "Le pilotage de l'onduleur est désactivé dans la configuration de l'intégration.",
  'Die Steuerung des Wechselrichters ist in der Konfiguration deaktiviert.',
  'El control del inversor está desactivado en la configuración de la integración.',
);

async function setMode(site, mode) {
  try {
    await site.setStorageMode(
      site.hardware.batteries[0] && batteryIds(site.gladys, site.hardware.batteries[0]).device,
      mode,
    );
  } catch (err) {
    if (err instanceof ControlDisabledError) {
      return CONTROL_DISABLED;
    }
    throw err;
  }
  await site.pollOnce();
  return DONE;
}

export const WIDGETS = {
  [WIDGET_KEYS.SOLAR_OVERVIEW]: {
    async get(site, { settings }) {
      return solarOverview(site, settings);
    },
    async action(site, { actionKey }) {
      logger.info(`onWidgetAction <- ${WIDGET_KEYS.SOLAR_OVERVIEW}.${actionKey}`);
      if (actionKey === ACTIONS.REFRESH) {
        const snapshot = await site.pollOnce();
        return snapshot?.ok
          ? t(
              'Values refreshed.',
              'Valeurs actualisées.',
              'Werte aktualisiert.',
              'Valores actualizados.',
            )
          : CONNECTION_LOST;
      }
      throw new Error(`Unknown widget action: ${actionKey}`);
    },
  },
  [WIDGET_KEYS.BATTERY_OVERVIEW]: {
    async get(site, { config }) {
      return batteryOverview(site, config);
    },
    async action(site, { actionKey }) {
      logger.info(`onWidgetAction <- ${WIDGET_KEYS.BATTERY_OVERVIEW}.${actionKey}`);
      if (actionKey === ACTIONS.SELF_CONSUMPTION) {
        return setMode(site, 'maximize_self_consumption');
      }
      if (actionKey === ACTIONS.BACKUP_ONLY) {
        return setMode(site, 'backup_only');
      }
      throw new Error(`Unknown widget action: ${actionKey}`);
    },
  },
};

/**
 * What the computed rows of the widgets show: when it changes, the widgets
 * are nudged (index.js). Tiles and charts are live and need no nudge.
 */
export function widgetSignature(site) {
  const snapshot = site.snapshot;
  return JSON.stringify([
    site.configured,
    site.connectionLost,
    site.hardware.inverters.length,
    site.hardware.batteries.length,
    snapshot?.totals.todayProduction !== null && snapshot?.totals.todayProduction !== undefined
      ? Math.round(snapshot.totals.todayProduction * 10)
      : null,
    snapshot?.inverters.map((e) => [e.reading?.status, e.reading?.powerLimit]),
    snapshot?.batteries.map((e) => [e.reading?.status, Math.round(e.reading?.health ?? -1)]),
    Object.values(snapshot?.storage ?? {}).map((s) => [
      s.controlMode,
      Math.round(s.backupReserve ?? -1),
    ]),
    Number.isFinite(snapshot?.totals.consumption) && snapshot.totals.consumption > 0
      ? Math.round(
          (10 * Math.max(0, snapshot.totals.consumption - Math.max(0, snapshot.totals.grid ?? 0))) /
            snapshot.totals.consumption,
        )
      : null,
  ]);
}

export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
