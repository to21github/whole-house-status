const assert = require('node:assert/strict');
const test = require('node:test');

const { HomeAssistantClient } = require('../src/haClient');

const REGISTRY_COMMANDS = new Map([
  ['config/entity_registry/list', 'entity'],
  ['config/device_registry/list', 'device'],
  ['config/area_registry/list', 'area']
]);

function createClient(registrySnapshots) {
  const client = new HomeAssistantClient({ token: 'test-token' });
  const ws = {};
  const commands = [];
  let registryReadCount = 0;
  client.ws = ws;
  client.send = async (type, payload = {}) => {
    commands.push({ type, payload });
    if (type === 'get_states') {
      return [];
    }

    const registryKey = REGISTRY_COMMANDS.get(type);
    if (!registryKey) {
      return undefined;
    }

    const snapshotIndex = Math.min(
      Math.floor(registryReadCount / REGISTRY_COMMANDS.size),
      registrySnapshots.length - 1
    );
    registryReadCount += 1;
    return registrySnapshots[snapshotIndex][registryKey];
  };

  return { client, commands, ws };
}

function registries(deviceAreaId) {
  return {
    entity: [{ entity_id: 'switch.living_room_light', device_id: 'device-1' }],
    device: [{ id: 'device-1', area_id: deviceAreaId }],
    area: [{ area_id: 'living-room', name: '客厅' }]
  };
}

test('subscribes to state and registry updates before loading Home Assistant data', async () => {
  const { client, commands, ws } = createClient([registries(null)]);

  await client.loadInitialData(ws);

  assert.deepEqual(
    commands
      .filter((command) => command.type === 'subscribe_events')
      .map((command) => command.payload.event_type)
      .sort(),
    [
      'area_registry_updated',
      'device_registry_updated',
      'entity_registry_updated',
      'state_changed'
    ]
  );
});

test('refreshes cached registries after a device is assigned to an area', async () => {
  const { client, ws } = createClient([
    registries(null),
    registries('living-room')
  ]);
  const receivedRegistries = [];
  client.on('registries', (value) => receivedRegistries.push(value));

  await client.loadInitialData(ws);
  await client.handleMessage(Buffer.from(JSON.stringify({
    type: 'event',
    event: {
      event_type: 'device_registry_updated',
      data: { action: 'update', device_id: 'device-1' }
    }
  })), ws);

  assert.equal(receivedRegistries.length, 2);
  assert.equal(receivedRegistries[1].device[0].area_id, 'living-room');
});
