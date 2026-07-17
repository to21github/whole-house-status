const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOptions } = require('../src/options');
const { resolveRoom, buildRooms } = require('../src/roomResolver');
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
