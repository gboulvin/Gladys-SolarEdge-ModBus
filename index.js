// -----------------------------------------------------------------------------
// Entry point of the SolarEdge (Modbus) integration for Gladys Assistant.
//
// Role of this file: wire the SDK to the site (src/site.js). It holds no
// Modbus logic. It:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. connects, detects the installation and starts the polling loop.
//
// The supervisor injects GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN and
// GLADYS_INTEGRATION_SELECTOR: `new GladysIntegration()` reads them.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { SolarEdgeSite } from './src/site.js';
import { createFileStore } from './src/store.js';
import { createActions } from './src/actions.js';
import { SCENE_ACTIONS } from './src/scenes.js';
import { WIDGETS, refreshWidgets, widgetSignature } from './src/widgets.js';

const gladys = new GladysIntegration();
const site = new SolarEdgeSite({ gladys, store: createFileStore() });

let config = normalizeConfig();
site.configure(config);

// Nudge the widgets when their computed rows change (tiles and charts are
// live and need nothing).
let lastWidgetSignature = null;
site.onSnapshot = () => {
  const signature = widgetSignature(site);
  if (signature !== lastWidgetSignature) {
    lastWidgetSignature = signature;
    refreshWidgets(gladys);
  }
};

async function publishDevices() {
  const devices = site.devices();
  if (devices.length > 0) {
    await gladys.publishDiscoveredDevices(devices);
  }
}

/**
 * (Re)detect the installation, publish the devices and (re)start the loop.
 * Detection failures are not fatal: the hardware known from a previous run
 * (persisted in /data) keeps the devices alive until the inverter answers.
 */
async function startSite() {
  site.stop();
  if (!site.configured) {
    await gladys.setConnectionStatus(false, {
      en: 'Enter the address of your SolarEdge inverter to start.',
      fr: "Renseignez l'adresse de votre onduleur SolarEdge pour commencer.",
      de: 'Geben Sie die Adresse Ihres SolarEdge-Wechselrichters ein, um zu beginnen.',
      es: 'Introduzca la dirección de su inversor SolarEdge para empezar.',
    });
    refreshWidgets(gladys);
    return;
  }
  try {
    await site.detect();
  } catch (err) {
    logger.warn(`Detection failed, using the known hardware: ${err.message}`);
    site.closeClient();
  }
  await publishDevices();
  refreshWidgets(gladys);
  site.start();
}

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> detecting the installation');
  if (site.configured) {
    try {
      await site.detect();
    } catch (err) {
      logger.warn(`Detection failed: ${err.message}`);
    }
  }
  await publishDevices();
});

// Every feature is a read-only sensor: control goes through the scene
// actions, which check the `enable_control` permission.
gladys.onSetValue(async (device) => {
  throw new Error(`${device.external_id} has no controllable feature`);
});

// --- Manifest actions: buttons in the Configuration screen -------------------
for (const [key, handler] of Object.entries(createActions({ site, publishDevices }))) {
  gladys.onAction(key, (fields) => handler(fields));
}

// --- Scene actions -----------------------------------------------------------
for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(key, (fields) => handler(site, { fields, config }));
}

// --- Dashboard widgets -------------------------------------------------------
for (const [key, widget] of Object.entries(WIDGETS)) {
  gladys.onWidgetGet(key, (request) => widget.get(site, { ...request, config }));
  gladys.onWidgetAction(key, (actionKey, params, { settings }) =>
    widget.action(site, { actionKey, params, settings, config }),
  );
}

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
  site.configure(config);
  await startSite();
});

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  try {
    config = normalizeConfig(await gladys.getConfig());
    site.configure(config);
    await startSite();
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
        de: 'Die Initialisierung ist fehlgeschlagen, prüfen Sie die Logs der Integration.',
        es: 'La inicialización ha fallado, consulte los registros de la integración.',
      })
      .catch(() => {});
  }
});

// While Gladys is unreachable the readings could not be published: pause the
// loop, it restarts with the next 'connected'.
gladys.on('disconnected', () => {
  site.stop();
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  await site.shutdown();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the SolarEdge (Modbus) integration...');
await site.init();
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
