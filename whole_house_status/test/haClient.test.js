const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { HomeAssistantClient } = require('../src/haClient');

class FakeWebSocket extends EventEmitter {
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    super();
    this.url = url;
    this.readyState = FakeWebSocket.OPEN;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  send(message) {
    this.sent.push(JSON.parse(message));
  }

  close() {
    this.readyState = 3;
    this.emit('close');
  }

  message(message) {
    this.emit('message', Buffer.from(JSON.stringify(message)));
  }
}

function createClient(overrides = {}) {
  FakeWebSocket.instances = [];
  return new HomeAssistantClient({
    url: 'ws://example.test/websocket',
    token: 'test-token',
    WebSocket: FakeWebSocket,
    reconnectBaseMs: 1,
    reconnectMaxMs: 1,
    ...overrides
  });
}

test('sends the supervisor token when Home Assistant requires authentication', () => {
  const client = createClient();
  client.connect();

  FakeWebSocket.instances[0].message({ type: 'auth_required' });

  assert.deepEqual(FakeWebSocket.instances[0].sent, [
    { type: 'auth', access_token: 'test-token' }
  ]);
  client.close();
});

test('forwards Home Assistant state_changed events', () => {
  const client = createClient();
  const events = [];
  client.on('state_changed', (event) => events.push(event));
  client.connect();

  const event = {
    event_type: 'state_changed',
    data: { entity_id: 'switch.desk', new_state: { entity_id: 'switch.desk', state: 'on' } }
  };
  FakeWebSocket.instances[0].message({ type: 'event', event });

  assert.deepEqual(events, [event]);
  client.close();
});

test('correlates command results with their request ids', async () => {
  const client = createClient();
  client.connect();

  const result = client.send('get_states');
  FakeWebSocket.instances[0].message({ id: 1, type: 'result', success: true, result: [{ entity_id: 'switch.desk' }] });

  assert.deepEqual(await result, [{ entity_id: 'switch.desk' }]);
  client.close();
});

test('reports authentication rejection without scheduling a reconnect', async () => {
  const client = createClient();
  const errors = [];
  client.on('error', (error) => errors.push(error.message));
  client.connect();

  FakeWebSocket.instances[0].message({ type: 'auth_invalid', message: 'bad token' });
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.deepEqual(errors, ['Home Assistant authentication failed: bad token']);
  assert.equal(FakeWebSocket.instances.length, 1);
});

test('ignores malformed messages and rejects sends without an open socket', async () => {
  const client = createClient();
  assert.doesNotThrow(() => client.handleMessage(Buffer.from('{not json')));
  await assert.rejects(client.send('get_states'), /not connected/);
});

test('does not create duplicate connections or reconnect after a stale close event', async () => {
  const client = createClient();
  client.connect();
  const first = FakeWebSocket.instances[0];
  client.connect();
  assert.equal(FakeWebSocket.instances.length, 1);

  first.emit('close');
  client.connect();
  assert.equal(FakeWebSocket.instances.length, 2);
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(FakeWebSocket.instances.length, 2);
  client.close();
});

test('emits initial-load failures as errors', async () => {
  const client = createClient();
  const errors = [];
  client.on('error', (error) => errors.push(error.message));
  client.connect();

  FakeWebSocket.instances[0].message({ type: 'auth_ok' });
  const firstCommand = FakeWebSocket.instances[0].sent[0];
  FakeWebSocket.instances[0].message({
    id: firstCommand.id,
    type: 'result',
    success: false,
    error: { message: 'load failed' }
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(errors, ['load failed']);
  client.close();
});

test('buffers state changes received after subscription until the initial snapshot is emitted in arrival order', async () => {
  const client = createClient();
  const emissions = [];
  client.on('registries', () => emissions.push('registries'));
  client.on('states', (states) => emissions.push(['states', states]));
  client.on('state_changed', (event) => emissions.push(['state_changed', event]));
  client.connect();
  const socket = FakeWebSocket.instances[0];

  socket.message({ type: 'auth_ok' });
  const subscription = socket.sent.find((message) => message.type === 'subscribe_events');
  assert.ok(subscription);
  socket.message({ id: subscription.id, type: 'result', success: true, result: null });
  await new Promise((resolve) => setImmediate(resolve));

  const statesRequest = socket.sent.find((message) => message.type === 'get_states');
  const entityRequest = socket.sent.find((message) => message.type === 'config/entity_registry/list');
  const deviceRequest = socket.sent.find((message) => message.type === 'config/device_registry/list');
  const areaRequest = socket.sent.find((message) => message.type === 'config/area_registry/list');
  const changed = {
    event_type: 'state_changed',
    data: { entity_id: 'switch.desk', new_state: { entity_id: 'switch.desk', state: 'on' } }
  };
  const changedAgain = {
    event_type: 'state_changed',
    data: { entity_id: 'switch.desk', new_state: { entity_id: 'switch.desk', state: 'off' } }
  };

  socket.message({ type: 'event', event: changed });
  socket.message({ type: 'event', event: changedAgain });
  socket.message({
    id: statesRequest.id,
    type: 'result',
    success: true,
    result: [{ entity_id: 'switch.desk', state: 'off' }]
  });
  socket.message({ id: entityRequest.id, type: 'result', success: true, result: [] });
  socket.message({ id: deviceRequest.id, type: 'result', success: true, result: [] });
  socket.message({ id: areaRequest.id, type: 'result', success: true, result: [] });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(emissions, [
    'registries',
    ['states', [{ entity_id: 'switch.desk', state: 'off' }]],
    ['state_changed', changed],
    ['state_changed', changedAgain]
  ]);
  client.close();
});

test('reconnects instead of emitting state changes after an initial snapshot failure', async () => {
  const client = createClient({ reconnectBaseMs: 1, reconnectMaxMs: 1 });
  const errors = [];
  const events = [];
  client.on('error', (error) => errors.push(error.message));
  client.on('state_changed', (event) => events.push(event));
  client.connect();
  const socket = FakeWebSocket.instances[0];

  socket.message({ type: 'auth_ok' });
  const subscription = socket.sent.find((message) => message.type === 'subscribe_events');
  socket.message({ id: subscription.id, type: 'result', success: true, result: null });
  await new Promise((resolve) => setImmediate(resolve));
  const statesRequest = socket.sent.find((message) => message.type === 'get_states');
  socket.message({
    id: statesRequest.id,
    type: 'result',
    success: false,
    error: { message: 'snapshot failed' }
  });
  await new Promise((resolve) => setTimeout(resolve, 10));

  socket.message({
    type: 'event',
    event: {
      event_type: 'state_changed',
      data: { entity_id: 'switch.desk', new_state: { entity_id: 'switch.desk', state: 'on' } }
    }
  });

  assert.deepEqual(errors, ['snapshot failed']);
  assert.equal(socket.readyState, 3);
  assert.equal(FakeWebSocket.instances.length, 2);
  assert.deepEqual(events, []);
  client.close();
});

test('does not replay a buffered state change after the sync socket closes', async () => {
  const client = createClient({ reconnectBaseMs: 100, reconnectMaxMs: 100 });
  const events = [];
  client.on('error', () => {});
  client.on('state_changed', (event) => events.push(event));
  client.connect();
  const socket = FakeWebSocket.instances[0];

  socket.message({ type: 'auth_ok' });
  const subscription = socket.sent.find((message) => message.type === 'subscribe_events');
  socket.message({ id: subscription.id, type: 'result', success: true, result: null });
  await new Promise((resolve) => setImmediate(resolve));
  const statesRequest = socket.sent.find((message) => message.type === 'get_states');
  socket.message({
    type: 'event',
    event: {
      event_type: 'state_changed',
      data: { entity_id: 'switch.desk', new_state: { entity_id: 'switch.desk', state: 'on' } }
    }
  });
  socket.close();
  socket.message({
    id: statesRequest.id,
    type: 'result',
    success: true,
    result: [{ entity_id: 'switch.desk', state: 'off' }]
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(events, []);
  client.close();
});
