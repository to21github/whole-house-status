const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOptions } = require('../src/options');
const { createRegistryIndexes, resolveRoom, buildRooms } = require('../src/roomResolver');
const { StateStore } = require('../src/stateStore');

test('room override wins over Home Assistant registries', () => {
  const options = normalizeOptions({
    rooms: {
      overrides: {
        'switch.men_ting_ding_deng': '门口'
      }
    }
  });
  const registries = {
    entity: [{ entity_id: 'switch.men_ting_ding_deng', area_id: 'living_room' }],
    device: [],
    area: [{ area_id: 'living_room', name: '客厅' }]
  };

  const room = resolveRoom({ entity_id: 'switch.men_ting_ding_deng' }, registries, options);
  assert.equal(room, '门口');
});

test('entity registry area is used when no override exists', () => {
  const options = normalizeOptions({});
  const registries = {
    entity: [{ entity_id: 'light.kitchen_ceiling', area_id: 'kitchen' }],
    device: [],
    area: [{ area_id: 'kitchen', name: '厨房' }]
  };

  const room = resolveRoom({ entity_id: 'light.kitchen_ceiling' }, registries, options);
  assert.equal(room, '厨房');
});

test('device registry area is used when entity has only device_id', () => {
  const options = normalizeOptions({});
  const registries = {
    entity: [{ entity_id: 'binary_sensor.balcony_motion', device_id: 'device-1' }],
    device: [{ id: 'device-1', area_id: 'balcony' }],
    area: [{ area_id: 'balcony', name: '阳台' }]
  };

  const room = resolveRoom({ entity_id: 'binary_sensor.balcony_motion' }, registries, options);
  assert.equal(room, '阳台');
});

test('unknown entities are placed into 未分组', () => {
  const options = normalizeOptions({});
  const room = resolveRoom({ entity_id: 'switch.unknown' }, { entity: [], device: [], area: [] }, options);
  assert.equal(room, '未分组');
});

test('buildRooms keeps configured order and appends discovered rooms', () => {
  const options = normalizeOptions({
    rooms: { order: ['全部', '门口', '客厅'] }
  });
  const rooms = buildRooms([
    { room: '客厅' },
    { room: '厨房' },
    { room: '门口' }
  ], options);

  assert.deepEqual(rooms, ['全部', '门口', '客厅', '厨房']);
});

test('buildRooms always places 未分组 after every named room', () => {
  const options = normalizeOptions({
    rooms: { order: ['全部', '未分组', '门口', '客厅'] }
  });
  const rooms = buildRooms([
    { room: '未分组' },
    { room: '客厅' },
    { room: '门口' }
  ], options);

  assert.deepEqual(rooms, ['全部', '门口', '客厅', '未分组']);
});

test('StateStore applies state_changed events', () => {
  const store = new StateStore();
  store.setStates([
    { entity_id: 'switch.a', state: 'off', attributes: {} }
  ]);
  store.applyStateChanged({
    data: {
      entity_id: 'switch.a',
      new_state: { entity_id: 'switch.a', state: 'on', attributes: {} }
    }
  });

  assert.equal(store.getStateMap()['switch.a'].state, 'on');
});

test('StateStore deletes only for explicit null new_state events', () => {
  const store = new StateStore();
  store.setStates([{ entity_id: 'switch.a', state: 'off', attributes: {} }]);

  store.applyStateChanged({ data: { entity_id: 'switch.a' } });
  assert.equal(store.getStateMap()['switch.a'].state, 'off');

  store.applyStateChanged({ data: { entity_id: 'switch.a', new_state: null } });
  assert.equal(store.getStateMap()['switch.a'], undefined);
});

test('StateStore ignores removal events without a non-empty entity id', () => {
  const store = new StateStore();
  store.setStates([{ entity_id: 'switch.a', state: 'off', attributes: {} }]);

  store.applyStateChanged({ data: { entity_id: '', new_state: null } });

  assert.equal(store.getStateMap()['switch.a'].state, 'off');
});

test('StateStore ignores malformed and mismatched new_state events', () => {
  const store = new StateStore();
  store.setStates([{ entity_id: 'switch.a', state: 'off', attributes: {} }]);

  store.applyStateChanged({
    data: {
      entity_id: 'switch.a',
      new_state: { state: 'on', attributes: {} }
    }
  });
  store.applyStateChanged({
    data: {
      entity_id: 'switch.a',
      new_state: { entity_id: 'switch.b', state: 'on', attributes: {} }
    }
  });

  assert.deepEqual(store.getStateMap(), {
    'switch.a': { entity_id: 'switch.a', state: 'off', attributes: {} }
  });
});

test('StateStore leaves the last valid snapshot intact for invalid snapshots', () => {
  const store = new StateStore();
  const expected = { entity_id: 'switch.a', state: 'off', attributes: {} };
  store.setStates([expected]);

  for (const snapshot of [null, {}, 'invalid', [{ state: 'on', attributes: {} }]]) {
    assert.doesNotThrow(() => store.setStates(snapshot));
    assert.deepEqual(store.getStateMap(), { 'switch.a': expected });
  }
});

test('StateStore isolates stored and returned states from caller mutations', () => {
  const store = new StateStore();
  const incoming = {
    entity_id: 'switch.a',
    state: 'off',
    attributes: { nested: { mode: 'auto' } }
  };
  store.setStates([incoming]);

  incoming.state = 'on';
  incoming.attributes.nested.mode = 'manual';
  const stateMap = store.getStateMap();
  stateMap['switch.a'].state = 'on';
  stateMap['switch.a'].attributes.nested.mode = 'manual';
  const states = store.getStates();
  states[0].attributes.nested.mode = 'away';

  assert.deepEqual(store.getStateMap(), {
    'switch.a': {
      entity_id: 'switch.a',
      state: 'off',
      attributes: { nested: { mode: 'auto' } }
    }
  });
});

test('createRegistryIndexes produces reusable indexes for resolveRoom', () => {
  const options = normalizeOptions({});
  const indexes = createRegistryIndexes({
    entity: [{ entity_id: 'light.kitchen_ceiling', area_id: 'kitchen' }],
    device: [],
    area: [{ area_id: 'kitchen', name: '厨房' }]
  });

  assert.equal(indexes.entityById['light.kitchen_ceiling'].area_id, 'kitchen');
  assert.equal(resolveRoom({ entity_id: 'light.kitchen_ceiling' }, indexes, options), '厨房');
});

test('buildRooms deduplicates configured and discovered rooms', () => {
  const options = normalizeOptions({
    rooms: { order: ['全部', '客厅', '客厅'] }
  });
  const rooms = buildRooms([
    { room: '客厅' },
    { room: '厨房' },
    { room: '厨房' }
  ], options);

  assert.deepEqual(rooms, ['全部', '客厅', '厨房']);
});
