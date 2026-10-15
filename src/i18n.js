// -----------------------------------------------------------------------------
// Multi-language texts. Gladys picks the user's language in every
// `{ en, fr, de, es }` object (English is the fallback), so the integration
// only builds the object.
// -----------------------------------------------------------------------------

export const t = (en, fr, de, es) => ({ en, fr, de, es });

/**
 * Apply `fn` to every language of a text, e.g. to interpolate a value.
 */
export const mapText = (text, fn) =>
  Object.fromEntries(Object.entries(text).map(([lang, value]) => [lang, fn(value, lang)]));

export const INVERTER_STATUS_TEXT = {
  off: t('Off', 'Arrêté', 'Aus', 'Apagado'),
  sleeping: t('Sleeping', 'En veille', 'Ruhezustand', 'En reposo'),
  starting: t('Starting', 'Démarrage', 'Startet', 'Arrancando'),
  producing: t('Producing', 'En production', 'Produziert', 'Produciendo'),
  throttled: t('Limited', 'Bridé', 'Begrenzt', 'Limitado'),
  shutting_down: t('Shutting down', 'Arrêt en cours', 'Fährt herunter', 'Apagándose'),
  fault: t('Fault', 'Défaut', 'Fehler', 'Fallo'),
  standby: t('Standby', 'Attente', 'Standby', 'En espera'),
  unknown: t('Unknown', 'Inconnu', 'Unbekannt', 'Desconocido'),
};

export const BATTERY_STATUS_TEXT = {
  off: t('Off', 'Arrêtée', 'Aus', 'Apagada'),
  standby: t('Standby', 'Attente', 'Standby', 'En espera'),
  charging: t('Charging', 'En charge', 'Lädt', 'Cargando'),
  discharging: t('Discharging', 'En décharge', 'Entlädt', 'Descargando'),
  fault: t('Fault', 'Défaut', 'Fehler', 'Fallo'),
  idle: t('Idle', 'Au repos', 'Leerlauf', 'Inactiva'),
  sleep: t('Sleep', 'Veille', 'Schlafmodus', 'Suspendida'),
  unknown: t('Unknown', 'Inconnu', 'Unbekannt', 'Desconocido'),
};

export const STORAGE_MODE_TEXT = {
  disabled: t('Disabled', 'Désactivé', 'Deaktiviert', 'Desactivado'),
  maximize_self_consumption: t(
    'Self-consumption',
    'Autoconsommation',
    'Eigenverbrauch',
    'Autoconsumo',
  ),
  time_of_use: t('Time of use', 'Heures creuses', 'Zeitsteuerung', 'Por horario'),
  backup_only: t('Backup only', 'Secours seul', 'Nur Notstrom', 'Solo respaldo'),
  remote_control: t('Remote control', 'Pilotage distant', 'Fernsteuerung', 'Control remoto'),
  unknown: t('Unknown', 'Inconnu', 'Unbekannt', 'Desconocido'),
};
