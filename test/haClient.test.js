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
