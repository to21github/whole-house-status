const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOptions } = require('../src/options');
const { AlertEngine } = require('../src/alertEngine');
const { buildViewModel } = require('../src/viewModel');

function entity(entityId, state, friendlyName) {
  return {
    entity_id: entityId,
    state,
    attributes: {
      friendly_name: friendlyName
    }
  };
}

test('buildViewModel computes stats and keeps alerts first', () => {
  const options = normalizeOptions({
    rooms: {
      overrides: {
        'switch.offline': '客厅',
        'switch.timeout': '门口',
        'light.door': '门口'
      }
    },
    alerts: {
      on_duration_rules: [
        { entity_id: 'switch.timeout', duration_minutes: 1 }
      ]
    }
  });
  const alertEngine = new AlertEngine(options);
  const now = Date.parse('2026-07-17T08:00:00Z');
  const states = {
    'switch.offline': entity('switch.offline', 'unavailable', '客厅主灯'),
    'switch.timeout': entity('switch.timeout', 'on', '电脑开关'),
    'light.door': entity('light.door', 'on', '门口顶灯'),
    'sensor.power': entity('sensor.power', '900', '功率')
  };

  alertEngine.evaluate(states['switch.timeout'], states, now);
  const model = buildViewModel({
    states,
    registries: { entity: [], device: [], area: [] },
    options,
    alertEngine,
    now: now + 2 * 60 * 1000,
    selectedRoom: '门口',
    haConnected: true
  });

  assert.equal(model.stats.error, 1);
  assert.equal(model.stats.warning, 1);
  assert.equal(model.stats.on, 1);
  assert.equal(model.stats.online, 2);
  assert.equal(model.alerts[0].entity_id, 'switch.offline');
  assert.equal(model.alerts[0].status, 'error');
  assert.equal(model.alerts[1].entity_id, 'switch.timeout');
  assert.equal(model.devices.length, 1);
  assert.equal(model.devices[0].entity_id, 'light.door');
});

test('buildViewModel excludes configured entities and unsupported domains', () => {
  const options = normalizeOptions({
    entities: {
      include_domains: ['switch', 'light'],
      exclude_entities: ['switch.hidden']
    }
  });
  const model = buildViewModel({
    states: {
      'switch.hidden': entity('switch.hidden', 'on', '隐藏开关'),
      'media_player.tv': entity('media_player.tv', 'on', '电视'),
      'light.visible': entity('light.visible', 'off', '可见灯')
    },
    registries: { entity: [], device: [], area: [] },
    options,
    alertEngine: new AlertEngine(options),
    now: Date.now(),
    selectedRoom: '全部',
    haConnected: true
  });

  assert.deepEqual(model.devices.map((device) => device.entity_id), ['light.visible']);
});

test('buildViewModel includes configured room order', () => {
  const options = normalizeOptions({
    rooms: {
      order: ['全部', '门口', '客厅'],
      overrides: { 'switch.a': '客厅' }
    }
  });
  const model = buildViewModel({
    states: {
      'switch.a': entity('switch.a', 'off', '开关 A')
    },
    registries: { entity: [], device: [], area: [] },
    options,
    alertEngine: new AlertEngine(options),
    now: Date.now(),
    selectedRoom: '全部',
    haConnected: false,
    configError: '配置解析失败'
  });

  assert.deepEqual(model.rooms, ['全部', '客厅']);
  assert.equal(model.connection.ha_connected, false);
  assert.equal(model.connection.config_error, '配置解析失败');
});

test('buildViewModel prunes alert timers for entities absent from the snapshot', () => {
  const options = normalizeOptions({});
  const alertEngine = new AlertEngine(options);
  const removed = entity('switch.removed', 'on', '已移除开关');
  const now = Date.parse('2026-07-17T08:00:00Z');

  alertEngine.evaluate(removed, { [removed.entity_id]: removed }, now);
  buildViewModel({
    states: {},
    registries: { entity: [], device: [], area: [] },
    options,
    alertEngine,
    now
  });

  assert.equal(alertEngine.activeSince.has(removed.entity_id), false);
  assert.equal(alertEngine.lastObservedAt.has(removed.entity_id), false);
});

test('buildViewModel creates registry indexes once per snapshot', () => {
  const options = normalizeOptions({});
  const reads = { entity: 0, device: 0, area: 0 };
  const registries = {};
  Object.defineProperties(registries, {
    entity: {
      get() {
        reads.entity += 1;
        return [
          { entity_id: 'light.kitchen', area_id: 'kitchen' },
          { entity_id: 'switch.balcony', area_id: 'balcony' }
        ];
      }
    },
    device: {
      get() {
        reads.device += 1;
        return [];
      }
    },
    area: {
      get() {
        reads.area += 1;
        return [
          { area_id: 'kitchen', name: '厨房' },
          { area_id: 'balcony', name: '阳台' }
        ];
      }
    }
  });

  const model = buildViewModel({
    states: {
      'light.kitchen': entity('light.kitchen', 'off', '厨房灯'),
      'switch.balcony': entity('switch.balcony', 'off', '阳台开关')
    },
    registries,
    options,
    alertEngine: new AlertEngine(options),
    now: Date.now()
  });

  assert.deepEqual(model.devices.map((device) => device.room), ['厨房', '阳台']);
  assert.deepEqual(reads, { entity: 1, device: 1, area: 1 });
});
