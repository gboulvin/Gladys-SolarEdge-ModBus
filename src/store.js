// -----------------------------------------------------------------------------
// Tiny JSON persistence under /data, the only writable volume of the
// container (the rootfs is read-only).
//
// Keeps what must survive a restart: the detected hardware (so the devices
// stay known while the inverter sleeps or is unreachable) and the daily
// production baseline. A failing disk never stops the integration: errors
// are logged and the in-memory value is used.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'store' });

export const DATA_DIR = process.env.DATA_DIR || '/data';

export function createFileStore(dir = DATA_DIR) {
  return {
    async load(name, fallback) {
      try {
        return JSON.parse(await readFile(path.join(dir, name), 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger.warn(`Cannot read ${name}: ${err.message}`);
        }
        return fallback;
      }
    },
    async save(name, data) {
      const file = path.join(dir, name);
      try {
        await mkdir(dir, { recursive: true });
        // Write then rename: a crash never leaves a half-written file.
        await writeFile(`${file}.tmp`, JSON.stringify(data));
        await rename(`${file}.tmp`, file);
      } catch (err) {
        logger.warn(`Cannot write ${name}: ${err.message}`);
      }
    },
  };
}

// In-memory store, for the tests.
export function createMemoryStore(initial = {}) {
  const files = { ...initial };
  return {
    files,
    async load(name, fallback) {
      return name in files ? structuredClone(files[name]) : fallback;
    },
    async save(name, data) {
      files[name] = structuredClone(data);
    },
  };
}
