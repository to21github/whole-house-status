const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeOptions, loadOptions, DEFAULT_OPTIONS } = require('../src/options');

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_OPTIONS));
}

function createTempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whole-house-status-options-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function createCollectingLogger() {
  const warnings = [];
  return {
    warnings,
    logger: {
      warn(message) {
        warnings.push(message);
      }
    }
  };
}

test('normalizeOptions returns safe defaults', () => {
  const options = normalizeOptions({});

  assert.equal(options.display.title, '全屋设备状态');
  assert.deepEqual(options.entities.include_domains, ['switch', 'light', 'climate', 'binary_sensor']);
  assert.equal(options.alerts.default_on_duration_minutes, 480);
  assert.equal(options.rooms.order[0], '全部');
});

test('normalizeOptions supports object room overrides', () => {
  const options = normalizeOptions({
    rooms: {
      overrides: {
        'switch.men_ting_ding_deng': '门口'
      }
    }
  });

  assert.deepEqual(options.rooms.overrides, {
    'switch.men_ting_ding_deng': '门口'
  });
});

test('normalizeOptions supports array room overrides from add-on schema', () => {
  const options = normalizeOptions({
    rooms: {
      overrides: [
        { entity_id: 'light.kitchen', room: '厨房' },
        { entity_id: 'switch.balcony', room: '阳台' }
      ]
    }
  });

  assert.deepEqual(options.rooms.overrides, {
    'light.kitchen': '厨房',
    'switch.balcony': '阳台'
  });
});

test('normalizeOptions cleans invalid alert rules', () => {
  const options = normalizeOptions({
    alerts: {
      high_power_rules: [
        {
          entity_id: 'switch.water_heater',
          power_sensor: 'sensor.water_heater_power',
          threshold_w: '800',
          duration_minutes: '30'
        },
        {
          entity_id: '',
          power_sensor: 'sensor.bad',
          threshold_w: 'bad',
          duration_minutes: 1
        }
      ],
      on_duration_rules: [
        { entity_id: 'switch.computer_socket', duration_minutes: '480' },
        { entity_id: '', duration_minutes: 20 }
      ]
    }
  });

  assert.deepEqual(options.alerts.high_power_rules, [
    {
      entity_id: 'switch.water_heater',
      power_sensor: 'sensor.water_heater_power',
      threshold_w: 800,
      duration_minutes: 30
    }
  ]);
  assert.deepEqual(options.alerts.on_duration_rules, [
    {
      entity_id: 'switch.computer_socket',
      duration_minutes: 480
    }
  ]);
});

test('DEFAULT_OPTIONS is not mutated by normalizeOptions', () => {
  const before = JSON.stringify(DEFAULT_OPTIONS);
  normalizeOptions({
    display: { title: '门口设备状态' },
    rooms: { order: ['全部', '门口'] }
  });
  assert.equal(JSON.stringify(DEFAULT_OPTIONS), before);
});

test('normalizeOptions treats null as empty options', () => {
  assert.deepEqual(normalizeOptions(null), cloneDefaults());
});

test('normalizeOptions treats arrays and primitives as empty options', () => {
  for (const value of [[], 'invalid', 42, true]) {
    assert.deepEqual(normalizeOptions(value), cloneDefaults());
  }
});

test('normalizeOptions restores the full default order when rooms.order is empty', () => {
  const options = normalizeOptions({ rooms: { order: [] } });

  assert.deepEqual(options.rooms.order, DEFAULT_OPTIONS.rooms.order);
});

test('normalizeOptions prepends 全部 to a non-empty custom room order', () => {
  const options = normalizeOptions({ rooms: { order: ['厨房', '阳台'] } });

  assert.deepEqual(options.rooms.order, ['全部', '厨房', '阳台']);
});

test('loadOptions returns defaults when the options path is missing', (t) => {
  const directory = createTempDirectory(t);
  const { logger, warnings } = createCollectingLogger();

  const options = loadOptions(path.join(directory, 'missing.json'), logger);

  assert.deepEqual(options, cloneDefaults());
  assert.deepEqual(warnings, []);
});

test('loadOptions reads and normalizes a valid JSON file', (t) => {
  const directory = createTempDirectory(t);
  const optionsPath = path.join(directory, 'options.json');
  const { logger, warnings } = createCollectingLogger();
  fs.writeFileSync(optionsPath, JSON.stringify({
    display: { title: '门口设备状态' },
    rooms: { order: ['门口'] }
  }));

  const options = loadOptions(optionsPath, logger);

  assert.equal(options.display.title, '门口设备状态');
  assert.deepEqual(options.rooms.order, ['全部', '门口']);
  assert.deepEqual(warnings, []);
});

test('loadOptions treats JSON null as empty options', (t) => {
  const directory = createTempDirectory(t);
  const optionsPath = path.join(directory, 'options.json');
  const { logger, warnings } = createCollectingLogger();
  fs.writeFileSync(optionsPath, 'null');

  const options = loadOptions(optionsPath, logger);

  assert.deepEqual(options, cloneDefaults());
  assert.deepEqual(warnings, []);
});

test('loadOptions warns and returns defaults for malformed JSON', (t) => {
  const directory = createTempDirectory(t);
  const optionsPath = path.join(directory, 'options.json');
  const { logger, warnings } = createCollectingLogger();
  fs.writeFileSync(optionsPath, '{');

  const options = loadOptions(optionsPath, logger);

  assert.deepEqual(options, cloneDefaults());
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^Unable to load options from /);
});

test('loadOptions warns and returns defaults when the path is not a file', (t) => {
  const directory = createTempDirectory(t);
  const { logger, warnings } = createCollectingLogger();

  const options = loadOptions(directory, logger);

  assert.deepEqual(options, cloneDefaults());
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^Unable to load options from /);
});
