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

test('buildViewModel keeps all normal devices and an empty selected room for client filtering', () => {
  const options = normalizeOptions({
    display: { default_room: '书房' },
    rooms: {
      order: ['全部', '客厅', '卧室', '书房'],
      overrides: {
        'switch.living_room': '客厅',
        'switch.bedroom': '卧室'
      }
    }
  });
  const model = buildViewModel({
    states: {
      'switch.living_room': entity('switch.living_room', 'off', '客厅开关'),
      'switch.bedroom': entity('switch.bedroom', 'off', '卧室开关')
    },
    registries: { entity: [], device: [], area: [] },
    options,
    alertEngine: new AlertEngine(options),
    now: Date.parse('2026-07-18T00:00:00Z'),
    selectedRoom: '书房'
  });

  assert.equal(model.selected_room, '书房');
  assert.deepEqual(new Set(model.devices.map((device) => device.entity_id)), new Set([
    'switch.living_room',
    'switch.bedroom'
  ]));
  assert.equal(model.rooms.includes('书房'), true);
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

test('buildViewModel ignores malformed state ids and normalizes invalid friendly names', () => {
  const options = normalizeOptions({});
  const model = buildViewModel({
    states: {
      numeric: { entity_id: 42, state: 'off', attributes: { friendly_name: '数字 ID' } },
      missingSeparator: entity('switch', 'off', '缺少分隔符'),
      missingDomain: entity('.missing_domain', 'off', '缺少域'),
      missingObjectId: entity('switch.', 'off', '缺少对象 ID'),
      fallbackName: entity('switch.fallback', 'off', '  '),
      nonStringName: entity('switch.non_string', 'off', 42)
    },
    registries: { entity: [], device: [], area: [] },
    options,
    alertEngine: new AlertEngine(options),
    now: Date.parse('2026-07-17T08:00:00Z')
  });

  assert.deepEqual(model.devices.map((device) => ({
    entity_id: device.entity_id,
    name: device.name
  })), [
    { entity_id: 'switch.fallback', name: 'switch.fallback' },
    { entity_id: 'switch.non_string', name: 'switch.non_string' }
  ]);
});

test('buildViewModel normalizes null registries before indexing', () => {
  const options = normalizeOptions({});
  const model = buildViewModel({
    states: {
      'light.visible': entity('light.visible', 'off', '可见灯')
    },
    registries: null,
    options,
    alertEngine: new AlertEngine(options),
    now: Date.parse('2026-07-17T08:00:00Z')
  });

  assert.equal(model.devices[0].room, '未分组');
});

test('buildViewModel normalizes supplied times once for evaluation and output', () => {
  const options = normalizeOptions({});

  for (const suppliedNow of [NaN, Infinity, null, 'not a date', '2026-07-17T08:00:00Z']) {
    const evaluationTimes = [];
    const alertEngine = {
      prune() {},
      evaluate(_entity, _states, now) {
        evaluationTimes.push(now);
        return { status: 'idle', label: '在线', color: 'idle', reason: 'idle' };
      }
    };

    const model = buildViewModel({
      states: {
        'switch.visible': entity('switch.visible', 'off', '可见开关')
      },
      registries: { entity: [], device: [], area: [] },
      options,
      alertEngine,
      now: suppliedNow
    });
    const updatedAt = Date.parse(model.updated_at);

    assert.equal(Number.isFinite(updatedAt), true);
    assert.deepEqual(evaluationTimes, [updatedAt]);
  }
});

test('buildViewModel returns safe error devices when the alert engine is unavailable or throws', () => {
  const options = normalizeOptions({});
  const cases = [
    { alertEngine: null, reason: 'alert_engine_unavailable' },
    { alertEngine: {}, reason: 'alert_engine_unavailable' },
    {
      alertEngine: {
        prune() {
          throw new Error('prune failed');
        },
        evaluate() {
          return { status: 'idle', label: '在线', color: 'idle', reason: 'idle' };
        }
      },
      reason: 'alert_engine_error'
    },
    {
      alertEngine: {
        prune() {},
        evaluate() {
          throw new Error('evaluate failed');
        }
      },
      reason: 'alert_engine_error'
    }
  ];

  for (const { alertEngine, reason } of cases) {
    const model = buildViewModel({
      states: {
        'switch.visible': entity('switch.visible', 'off', '可见开关')
      },
      registries: { entity: [], device: [], area: [] },
      options,
      alertEngine,
      now: Date.parse('2026-07-17T08:00:00Z')
    });

    assert.deepEqual(model.alerts[0], {
      entity_id: 'switch.visible',
      name: '可见开关',
      room: '未分组',
      raw_state: 'off',
      status: 'error',
      status_label: '故障',
      status_color: 'red',
      reason,
      show_entity_id: true
    });
    assert.deepEqual(model.devices, []);
  }
});

test('buildViewModel preserves all status colors and includes idle devices', () => {
  const options = normalizeOptions({
    rooms: {
      overrides: {
        'switch.offline': '客厅',
        'switch.timeout': '客厅',
        'switch.active': '客厅',
        'light.idle': '客厅'
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
    'switch.offline': entity('switch.offline', 'unavailable', '离线'),
    'switch.timeout': entity('switch.timeout', 'on', '超时'),
    'switch.active': entity('switch.active', 'on', '开启'),
    'light.idle': entity('light.idle', 'off', '空闲')
  };

  alertEngine.evaluate(states['switch.timeout'], states, now);
  const model = buildViewModel({
    states,
    registries: { entity: [], device: [], area: [] },
    options,
    alertEngine,
    now: now + 2 * 60 * 1000,
    selectedRoom: '客厅'
  });

  assert.deepEqual(new Set([
    ...model.alerts.map((device) => device.status_color),
    ...model.devices.map((device) => device.status_color)
  ]), new Set(['red', 'orange', 'green', 'idle']));
  assert.equal(model.devices.some((device) => device.entity_id === 'light.idle'), true);
});

test('buildViewModel sorts devices with equal names by entity id', () => {
  const options = normalizeOptions({});
  const model = buildViewModel({
    states: {
      'switch.z': entity('switch.z', 'off', '同名设备'),
      'switch.a': entity('switch.a', 'off', '同名设备')
    },
    registries: { entity: [], device: [], area: [] },
    options,
    alertEngine: new AlertEngine(options),
    now: Date.parse('2026-07-17T08:00:00Z')
  });

  assert.deepEqual(model.devices.map((device) => device.entity_id), ['switch.a', 'switch.z']);
});
