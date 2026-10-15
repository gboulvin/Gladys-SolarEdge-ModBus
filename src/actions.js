// -----------------------------------------------------------------------------
// Manifest actions: the buttons of the Configuration screen. Each handler
// resolves the multi-language message displayed under the button.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ControlDisabledError } from './site.js';
import { t } from './i18n.js';
import { inverterIds } from './devices/inverter.js';

const logger = createLogger({ name: 'actions' });

export const ACTION_KEYS = {
  TEST_CONNECTION: 'test_connection',
  RESET_PRODUCTION_LIMIT: 'reset_production_limit',
};

const NOT_CONFIGURED = t(
  'Enter the address of the inverter first, then save.',
  "Renseignez d'abord l'adresse de l'onduleur, puis enregistrez.",
  'Geben Sie zuerst die Adresse des Wechselrichters ein und speichern Sie.',
  'Introduzca primero la dirección del inversor y guarde.',
);

function describe(detected) {
  const inverters = detected.inverters
    .map(
      (inv) =>
        `${inv.model || inv.manufacturer} ${inv.serial} (v${inv.version}, unit ${inv.unitId})`,
    )
    .join(', ');
  const counts = { meters: detected.meters.length, batteries: detected.batteries.length };
  return t(
    `Connected: ${inverters}. ${counts.meters} meter(s), ${counts.batteries} battery(ies). New devices are in the Discovery tab.`,
    `Connecté : ${inverters}. ${counts.meters} compteur(s), ${counts.batteries} batterie(s). Les nouveaux appareils sont dans l'onglet Découverte.`,
    `Verbunden: ${inverters}. ${counts.meters} Zähler, ${counts.batteries} Batterie(n). Neue Geräte finden Sie im Tab Erkennung.`,
    `Conectado: ${inverters}. ${counts.meters} contador(es), ${counts.batteries} batería(s). Los nuevos dispositivos están en la pestaña Descubrimiento.`,
  );
}

export function createActions({ site, publishDevices }) {
  return {
    async [ACTION_KEYS.TEST_CONNECTION]() {
      if (!site.configured) {
        return NOT_CONFIGURED;
      }
      try {
        const detected = await site.detect();
        if (detected.inverters.length === 0) {
          const reason = detected.errors.map((e) => `unit ${e.unitId}: ${e.message}`).join('; ');
          return t(
            `No SolarEdge inverter answered (${reason}).`,
            `Aucun onduleur SolarEdge n'a répondu (${reason}).`,
            `Kein SolarEdge-Wechselrichter hat geantwortet (${reason}).`,
            `Ningún inversor SolarEdge ha respondido (${reason}).`,
          );
        }
        await publishDevices();
        return describe(detected);
      } catch (err) {
        logger.warn(`Connection test failed: ${err.message}`);
        return t(
          `Cannot reach ${site.config.host}:${site.config.port} (${err.message}). Check that Modbus TCP is enabled in SetApp.`,
          `Impossible de joindre ${site.config.host}:${site.config.port} (${err.message}). Vérifiez que Modbus TCP est activé dans SetApp.`,
          `${site.config.host}:${site.config.port} nicht erreichbar (${err.message}). Prüfen Sie, ob Modbus TCP in SetApp aktiviert ist.`,
          `No se puede acceder a ${site.config.host}:${site.config.port} (${err.message}). Compruebe que Modbus TCP está activado en SetApp.`,
        );
      }
    },

    async [ACTION_KEYS.RESET_PRODUCTION_LIMIT]() {
      if (!site.configured || site.hardware.inverters.length === 0) {
        return NOT_CONFIGURED;
      }
      try {
        for (const inverter of site.hardware.inverters) {
          await site.setProductionLimit(inverterIds(site.gladys, inverter).device, 100);
        }
        return t(
          'The inverters produce at full power again (limit 100 %).',
          'Les onduleurs produisent de nouveau à pleine puissance (limite 100 %).',
          'Die Wechselrichter erzeugen wieder mit voller Leistung (Grenze 100 %).',
          'Los inversores vuelven a producir a plena potencia (límite 100 %).',
        );
      } catch (err) {
        if (err instanceof ControlDisabledError) {
          return t(
            'Allow the inverter control in the configuration first.',
            "Autorisez d'abord le pilotage de l'onduleur dans la configuration.",
            'Erlauben Sie zuerst die Steuerung des Wechselrichters in der Konfiguration.',
            'Permita primero el control del inversor en la configuración.',
          );
        }
        return t(
          `The inverter refused the command: ${err.message}`,
          `L'onduleur a refusé la commande : ${err.message}`,
          `Der Wechselrichter hat den Befehl abgelehnt: ${err.message}`,
          `El inversor ha rechazado la orden: ${err.message}`,
        );
      }
    },
  };
}
