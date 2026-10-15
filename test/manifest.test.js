// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest, but nothing there can know which
// handlers the code registers, nor that every text is translated.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { SCENE_TRIGGERS } from '../src/site.js';
import { WIDGETS } from '../src/widgets.js';
import { ACTION_KEYS } from '../src/actions.js';
import { DEFAULT_CONFIG } from '../src/config.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) return version[i] > required[i];
  }
  return true;
}

// Every multi-language text of the manifest, with its path.
function collectTexts(node, path = '', texts = []) {
  if (Array.isArray(node)) {
    node.forEach((child, i) => collectTexts(child, `${path}[${i}]`, texts));
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (['label', 'description', 'placeholder'].includes(key)) {
        texts.push({ path: `${path}.${key}`, value });
      } else {
        collectTexts(value, `${path}.${key}`, texts);
      }
    }
  }
  return texts;
}

test('every manifest text is translated in English, French, German and Spanish', () => {
  const texts = collectTexts(manifest);
  assert.ok(texts.length > 50);
  for (const { path, value } of texts) {
    assert.equal(typeof value, 'object', `${path} must be a multi-language object`);
    for (const lang of LANGUAGES) {
      assert.ok(
        typeof value[lang] === 'string' && value[lang].length > 0,
        `${path}.${lang} is missing`,
      );
    }
  }
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const lang of LANGUAGES) {
    const text = manifest.description[lang];
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('the integration is local only', () => {
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['energy']);
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.values(ACTION_KEYS).sort());
});

test('capability fields require Gladys >= 5.1.0', () => {
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]));
});

test('every scene_actions key has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
});

test('every widgets key has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(WIDGETS).sort());
  for (const widget of manifest.widgets) {
    for (const lang of LANGUAGES) {
      const label = widget.label[lang];
      assert.ok(label.length >= 3 && label.length <= 30, `widget ${widget.key} label.${lang}`);
      assert.ok(widget.description[lang].length <= 100, `widget ${widget.key} description.${lang}`);
    }
  }
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(SCENE_TRIGGERS).sort());
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') continue;
    assert.ok(field.key in DEFAULT_CONFIG, `${field.key} has no default in the code`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, field.key);
    }
  }
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const lang of LANGUAGES) {
      assert.ok(section.description[lang].length <= 1000);
    }
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('dynamic selects declare a source and no static options or default', () => {
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, field.key);
    assert.equal(field.default, undefined, field.key);
  }
});

test('select defaults are among their options', () => {
  for (const field of allFields.filter((f) => f.options && f.default !== undefined)) {
    assert.ok(
      field.options.some((o) => o.value === field.default),
      field.key,
    );
  }
});

test('scene trigger fields use the types a trigger accepts', () => {
  for (const trigger of manifest.scene_triggers) {
    for (const field of trigger.fields ?? []) {
      assert.ok(['string', 'number', 'select', 'multi_select'].includes(field.type), field.key);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
  assert.match(manifest.docker_image, /^ghcr\.io\/gboulvin\/gladys-solaredge-modbus:/);
});
