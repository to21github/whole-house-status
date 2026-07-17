const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOptions, DEFAULT_OPTIONS } = require('../src/options');

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
