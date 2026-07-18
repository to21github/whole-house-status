const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { IgnoredEntityStore } = require('../src/ignoredEntityStore');

function createTempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whole-house-status-ignored-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('IgnoredEntityStore persists valid entity IDs and restores them on reload', (t) => {
  const filePath = path.join(createTempDirectory(t), 'ignored-entities.json');
  const store = new IgnoredEntityStore({ filePath, logger: { warn() {} } });

  assert.equal(store.setIgnored('switch.desk', true), true);
  assert.equal(store.setIgnored('bad entity id', true), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), ['switch.desk']);

  const restored = new IgnoredEntityStore({ filePath, logger: { warn() {} } });
  assert.equal(restored.has('switch.desk'), true);
});

test('IgnoredEntityStore ignores malformed persisted data and warns', (t) => {
  const filePath = path.join(createTempDirectory(t), 'ignored-entities.json');
  fs.writeFileSync(filePath, '{');
  const warnings = [];

  const store = new IgnoredEntityStore({
    filePath,
    logger: { warn: (message) => warnings.push(message) }
  });

  assert.deepEqual([...store.getEntityIds()], []);
  assert.equal(warnings.length, 1);
});

test('IgnoredEntityStore preserves its previous set when persistence fails', (t) => {
  const directory = createTempDirectory(t);
  const parentFile = path.join(directory, 'not-a-directory');
  fs.writeFileSync(parentFile, 'block writes');
  const store = new IgnoredEntityStore({
    filePath: path.join(parentFile, 'ignored-entities.json'),
    logger: { warn() {} }
  });

  assert.throws(() => store.setIgnored('switch.desk', true));
  assert.equal(store.has('switch.desk'), false);
});
