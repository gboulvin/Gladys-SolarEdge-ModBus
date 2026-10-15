# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-15

### Added

- Local connection to SolarEdge inverters over Modbus TCP (SunSpec), without
  any SolarEdge account nor cloud: a single persistent connection, requests
  queued one at a time, automatic reconnection.
- Automatic detection of the inverters (leader/follower unit ids), of up to
  three Modbus meters per inverter and of up to three StorEdge batteries.
- Inverter devices: solar production, total production index, AC voltage and
  current, heat sink temperature, status.
- Grid meter devices: signed grid power (import > 0), import and export
  indexes, house consumption computed from the production and the grid
  exchange. Consumption meters: power and consumption index.
- Battery devices: charge level, charge and discharge power, charged and
  discharged energy indexes, available energy, temperature, status.
- Scene triggers: inverter status changed, solar surplus (configurable
  threshold, with hysteresis), battery status changed, inverter connection
  lost or restored.
- Scene actions: read the solar installation, limit the solar production,
  set the battery mode, charge or discharge the battery for a given duration,
  set the backup reserve. Writes are refused unless "Allow inverter control"
  is turned on.
- Dashboard widgets: "Solar production" (live tiles, production chart, today's
  production, inverter status, self-sufficiency) and "Solar battery" (charge
  gauge, power, status, mode, backup reserve, mode buttons).
- Configuration buttons: test the connection, remove the production limit.
- English, French, German and Spanish texts and documentation.
- The detected hardware and today's production baseline are kept in `/data`,
  so the devices survive a restart while the inverter sleeps.

### Changed

- CI: `actions/setup-node` v7, `docker/setup-qemu-action` v4, Prettier 3.9.10.

[Unreleased]: https://github.com/gboulvin/Gladys-SolarEdge-ModBus/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/gboulvin/Gladys-SolarEdge-ModBus/releases/tag/v1.0.1
