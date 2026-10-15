# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for SolarEdge inverters, meters and
batteries, read **locally over Modbus TCP** (SunSpec + StorEdge registers). A
Node.js service (Node 22+, ESM, no build step) running in its own sandboxed
Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/site.test.js             # one file
node --test --test-name-pattern "surplus" # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                     SDK wiring only: handlers registered before connect()
src/modbus/frame.js          Modbus TCP framing (FC 03, 06, 16), pure functions
src/modbus/client.js         single persistent connection, serialized requests, reconnection
src/solaredge/registers.js   register map (SunSpec inverter/meters, StorEdge storage/batteries)
src/solaredge/decode.js      scale factors, word orders, sentinels
src/solaredge/reader.js      reads/writes in SI units; detectSite(); knows nothing about Gladys
src/devices/<type>.js        inverter / meter / battery: discovery payload + states of a reading
src/devices/index.js         hardware description -> devices, external id -> hardware
src/site.js                  detection, polling loop, publication, scene triggers, control
src/scenes.js                scene action handlers (manifest `scene_actions`)
src/widgets.js               dashboard widgets (manifest `widgets`)
src/actions.js               Configuration screen buttons (manifest `actions`)
src/config.js                DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/store.js                 JSON persistence under /data (hardware, daily baseline)
src/i18n.js                  { en, fr, de, es } texts shared by widgets and actions
gladys-assistant-integration.json  manifest
docs/{en,fr,de,es}.md        user documentation, re-hosted by Gladys (en and fr mandatory)
test/helpers/fakeInverter.js in-memory SolarEdge register image answering Modbus frames
```

## Rules

- **External ids are forever.** Devices are keyed on the SolarEdge **serial
  number** (`gladys.externalIds(type, platformId(serial))`), never on the unit
  id, the IP address or a label. Feature keys (`power`, `grid-power`,
  `level`…), manifest keys (`config_schema`, `actions`, `scene_triggers`,
  `scene_actions`, `widgets`) and their option values are stored by users:
  never rename one.
- **One Modbus client.** SolarEdge accepts a single Modbus TCP connection:
  every read and write goes through the site's one `ModbusTcpClient`, whose
  queue sends one request at a time. Never open a second connection.
- **Writes are opt-in.** Anything that writes to the inverter goes through
  `site.control()`, which refuses unless `enable_control` is on. Scene actions
  report a refused or failed write as `applied: false`, never as a throw.
- **Gladys conventions.** Grid power is signed import > 0 / export < 0
  (SolarEdge meters count the export as positive). Indexes are in kWh,
  powers in W. Publish with `publishChangedStates` (the host API accepts 300
  states/minute); `effectiveInterval()` slows large installations down.
- **Scene triggers** fire on transitions only (never on the first reading),
  with flat data restricted to the keys declared in the manifest.
- **The container rootfs is read-only.** Write only under `/data` (`src/store.js`).
  Never log tokens. The inverter address is not a secret but stays out of
  error reports sent upstream.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the hand-pushed tag path, which bumps all three
  together before tagging (`node .github/scripts/release.mjs prepare …`).
  `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading by hand.
- **Four languages.** Every user-facing text is `{ en, fr, de, es }`: manifest
  labels, descriptions and placeholders, action messages, widget texts,
  connection status messages, and `docs/*.md` kept in sync.
  `test/manifest.test.js` fails on a missing language in the manifest.
- **Manifest.** The catalog `description` holds 10 to 100 characters per
  language. `widgets`, `scene_triggers`, `scene_actions` require
  `gladys_version >= 5.1.0`. `test/manifest.test.js` ties the manifest to the
  code (defaults, actions, scene and widget handlers, triggers).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network: they talk to
  `test/helpers/fakeInverter.js` through an injected socket factory.
