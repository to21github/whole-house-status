const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const WebSocket = require('ws');

const { createServer, isRoomOrderCommand } = require('../src/server');

test('declares Supervisor API access for persisted room ordering', async () => {
  const configPath = path.join(__dirname, '..', 'config.yaml');
  const config = await fs.readFile(configPath, 'utf8');

  assert.match(config, /^version: "0\.1\.21"$/m);
  assert.match(config, /homeassistant_api: true\nhassio_api: true/);
});

class FakeHomeAssistantClient extends EventEmitter {
  connect() {}

  close() {}
}

function createIgnoredEntityStore() {
  return {
    getEntityIds() {
      return new Set();
    },
    setIgnored() {}
  };
}

function createLogger() {
  return {
    warn() {},
    error() {}
  };
}

function createMessageInbox(socket) {
  const messages = [];
  const waiting = [];

  socket.on('message', (rawMessage) => {
    const message = JSON.parse(rawMessage.toString());
    const next = waiting.shift();
    if (next) {
      next.resolve(message);
      return;
    }
    messages.push(message);
  });
  socket.on('error', (error) => {
    for (const next of waiting.splice(0)) {
      next.reject(error);
    }
  });

  return {
    next(timeoutMs = 1_000) {
      if (messages.length > 0) {
        return Promise.resolve(messages.shift());
      }

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const index = waiting.findIndex((entry) => entry.resolve === resolve);
          if (index >= 0) {
            waiting.splice(index, 1);
          }
          reject(new Error('Timed out waiting for a WebSocket message'));
        }, timeoutMs);
        waiting.push({
          resolve(message) {
            clearTimeout(timeout);
            resolve(message);
          },
          reject(error) {
            clearTimeout(timeout);
            reject(error);
          }
        });
      });
    }
  };
}

function withinTimeout(promise, timeoutMs = 1_000, message = 'Timed out waiting for an async operation') {
  let timeout;
  const deadline = new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timeout));
}

async function openBrowserSocket(url) {
  const socket = new WebSocket(url);
  const inbox = createMessageInbox(socket);
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    socket.once('error', onError);
    socket.once('open', () => {
      socket.off('error', onError);
      resolve();
    });
  });

  return { socket, inbox };
}

async function startApp({
  roomOrderStore,
  useMockData = false,
  token,
  optionsPath,
  supervisorOptionsClientFactory
} = {}) {
  const haClient = new FakeHomeAssistantClient();
  const app = createServer({
    useMockData,
    token,
    roomOrderStore,
    optionsPath,
    supervisorOptionsClientFactory,
    haClientFactory: () => haClient,
    ignoredEntityStore: createIgnoredEntityStore(),
    logger: createLogger(),
    refreshIntervalMs: 60_000
  });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', () => {
      app.server.off('error', reject);
      resolve();
    });
  });
  const { port } = app.server.address();

  return { app, haClient, url: `ws://127.0.0.1:${port}/ws` };
}

async function createOptionsPath(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'whole-house-status-'));
  const optionsPath = path.join(directory, 'options.json');
  await fs.writeFile(optionsPath, JSON.stringify({
    rooms: { order: ['全部', '客厅', '厨房'] }
  }));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return optionsPath;
}

async function stopApp(app) {
  for (const client of app.browserWss.clients) {
    client.terminate();
  }
  await new Promise((resolve, reject) => {
    app.server.close((error) => error ? reject(error) : resolve());
  });
  await new Promise((resolve, reject) => {
    app.browserWss.close((error) => error ? reject(error) : resolve());
  });
}

function seedRooms(haClient) {
  haClient.emit('registries', {
    entity: [
      { entity_id: 'switch.living_room', area_id: 'living-room' },
      { entity_id: 'switch.kitchen', area_id: 'kitchen' }
    ],
    device: [],
    area: [
      { area_id: 'living-room', name: '客厅' },
      { area_id: 'kitchen', name: '厨房' }
    ]
  });
  haClient.emit('states', [
    { entity_id: 'switch.living_room', state: 'off', attributes: { friendly_name: '客厅灯' } },
    { entity_id: 'switch.kitchen', state: 'on', attributes: { friendly_name: '厨房灯' } },
    { entity_id: 'switch.unassigned', state: 'off', attributes: { friendly_name: '未分组设备' } }
  ]);
}

test('accepts a valid room reorder, persists it, and broadcasts the updated model', async (t) => {
  const savedOrders = [];
  const optionsPath = await createOptionsPath(t);
  const { app, haClient, url } = await startApp({
    optionsPath,
    roomOrderStore: {
      async setRoomOrder(order) {
        savedOrders.push(order);
      }
    }
  });
  t.after(() => stopApp(app));
  seedRooms(haClient);

  const origin = await openBrowserSocket(url);
  const observer = await openBrowserSocket(url);
  t.after(() => origin.socket.terminate());
  t.after(() => observer.socket.terminate());
  assert.deepEqual((await origin.inbox.next()).rooms, ['全部', '客厅', '厨房', '未分组']);
  assert.deepEqual((await observer.inbox.next()).rooms, ['全部', '客厅', '厨房', '未分组']);

  origin.socket.send(JSON.stringify({
    type: 'set_room_order',
    rooms: ['全部', '厨房', '客厅', '未分组']
  }));

  const originModel = await origin.inbox.next();
  const observerModel = await observer.inbox.next();
  const result = await origin.inbox.next();
  assert.deepEqual(savedOrders, [['全部', '厨房', '客厅']]);
  assert.deepEqual(originModel.rooms, ['全部', '厨房', '客厅', '未分组']);
  assert.deepEqual(observerModel.rooms, ['全部', '厨房', '客厅', '未分组']);
  assert.deepEqual(result, {
    type: 'room_order_result',
    rooms: ['全部', '厨房', '客厅', '未分组']
  });
});

test('rejects a room reorder that moves the 全部 sentinel without persisting', async (t) => {
  const savedOrders = [];
  const optionsPath = await createOptionsPath(t);
  const { app, haClient, url } = await startApp({
    optionsPath,
    roomOrderStore: {
      async setRoomOrder(order) {
        savedOrders.push(order);
      }
    }
  });
  t.after(() => stopApp(app));
  seedRooms(haClient);

  const browser = await openBrowserSocket(url);
  t.after(() => browser.socket.terminate());
  await browser.inbox.next();
  browser.socket.send(JSON.stringify({
    type: 'set_room_order',
    rooms: ['厨房', '全部', '客厅', '未分组']
  }));

  const result = await browser.inbox.next();
  assert.deepEqual(savedOrders, []);
  assert.deepEqual(result.rooms, ['全部', '客厅', '厨房', '未分组']);
  assert.equal(result.type, 'room_order_result');
  assert.equal(typeof result.error, 'string');
  assert.notEqual(result.error, '');
});

test('reports a persistence failure without changing the current room model', async (t) => {
  const optionsPath = await createOptionsPath(t);
  const { app, haClient, url } = await startApp({
    optionsPath,
    roomOrderStore: {
      async setRoomOrder() {
        throw new Error('Supervisor unavailable');
      }
    }
  });
  t.after(() => stopApp(app));
  seedRooms(haClient);

  const browser = await openBrowserSocket(url);
  t.after(() => browser.socket.terminate());
  const initialModel = await browser.inbox.next();
  browser.socket.send(JSON.stringify({
    type: 'set_room_order',
    rooms: ['全部', '厨房', '客厅', '未分组']
  }));

  const result = await browser.inbox.next();
  assert.deepEqual(app.snapshot().rooms, initialModel.rooms);
  assert.equal(result.type, 'room_order_result');
  assert.deepEqual(result.rooms, initialModel.rooms);
  assert.match(result.error, /Supervisor unavailable/);
});

test('returns the latest rooms when a pending room-order save rejects', async (t) => {
  let rejectSave;
  let signalSaveStarted;
  const saveStarted = new Promise((resolve) => {
    signalSaveStarted = resolve;
  });
  const optionsPath = await createOptionsPath(t);
  const { app, haClient, url } = await startApp({
    optionsPath,
    roomOrderStore: {
      async setRoomOrder() {
        signalSaveStarted();
        await new Promise((resolve, reject) => {
          rejectSave = reject;
        });
      }
    }
  });
  t.after(() => stopApp(app));
  seedRooms(haClient);

  const browser = await openBrowserSocket(url);
  t.after(() => browser.socket.terminate());
  const initialModel = await browser.inbox.next();
  browser.socket.send(JSON.stringify({
    type: 'set_room_order',
    rooms: ['全部', '厨房', '客厅', '未分组']
  }));
  await withinTimeout(saveStarted, 1_000, 'Timed out waiting for the room-order save');

  haClient.emit('registries', {
    entity: [
      { entity_id: 'switch.living_room', area_id: 'living-room' },
      { entity_id: 'switch.kitchen', area_id: 'kitchen' },
      { entity_id: 'switch.study', area_id: 'study' }
    ],
    device: [],
    area: [
      { area_id: 'living-room', name: '客厅' },
      { area_id: 'kitchen', name: '厨房' },
      { area_id: 'study', name: '书房' }
    ]
  });
  haClient.emit('states', [
    { entity_id: 'switch.living_room', state: 'off', attributes: { friendly_name: '客厅灯' } },
    { entity_id: 'switch.kitchen', state: 'on', attributes: { friendly_name: '厨房灯' } },
    { entity_id: 'switch.unassigned', state: 'off', attributes: { friendly_name: '未分组设备' } },
    { entity_id: 'switch.study', state: 'off', attributes: { friendly_name: '书房灯' } }
  ]);

  const registryModel = await browser.inbox.next();
  const latestModel = await browser.inbox.next();
  assert.deepEqual(registryModel.rooms, initialModel.rooms);
  assert.deepEqual(latestModel.rooms, ['全部', '客厅', '厨房', '书房', '未分组']);

  rejectSave(new Error('Supervisor unavailable'));
  const result = await browser.inbox.next();
  assert.equal(result.type, 'room_order_result');
  assert.deepEqual(result.rooms, latestModel.rooms);
  assert.match(result.error, /Supervisor unavailable/);
});

test('reports an error when room-order persistence is unavailable', async (t) => {
  const optionsPath = await createOptionsPath(t);
  const { app, haClient, url } = await startApp({ optionsPath });
  t.after(() => stopApp(app));
  seedRooms(haClient);

  const browser = await openBrowserSocket(url);
  t.after(() => browser.socket.terminate());
  const initialModel = await browser.inbox.next();
  browser.socket.send(JSON.stringify({
    type: 'set_room_order',
    rooms: ['全部', '厨房', '客厅', '未分组']
  }));

  const result = await browser.inbox.next();
  assert.equal(result.type, 'room_order_result');
  assert.deepEqual(result.rooms, initialModel.rooms);
  assert.equal(typeof result.error, 'string');
  assert.notEqual(result.error, '');
  assert.deepEqual(app.snapshot().rooms, initialModel.rooms);
});

test('rejects a second room-order request while the first save is pending', async (t) => {
  let resolveSave;
  let signalSaveStarted;
  const saveStarted = new Promise((resolve) => {
    signalSaveStarted = resolve;
  });
  const optionsPath = await createOptionsPath(t);
  const { app, haClient, url } = await startApp({
    optionsPath,
    roomOrderStore: {
      async setRoomOrder() {
        signalSaveStarted();
        await new Promise((resolve) => {
          resolveSave = resolve;
        });
      }
    }
  });
  t.after(() => stopApp(app));
  seedRooms(haClient);

  const browser = await openBrowserSocket(url);
  t.after(() => browser.socket.terminate());
  const initialModel = await browser.inbox.next();
  browser.socket.send(JSON.stringify({
    type: 'set_room_order',
    rooms: ['全部', '厨房', '客厅', '未分组']
  }));
  await withinTimeout(saveStarted, 1_000, 'Timed out waiting for the first room-order save');
  browser.socket.send(JSON.stringify({
    type: 'set_room_order',
    rooms: ['全部', '客厅', '厨房', '未分组']
  }));

  const busyResult = await browser.inbox.next();
  assert.equal(busyResult.type, 'room_order_result');
  assert.deepEqual(busyResult.rooms, initialModel.rooms);
  assert.equal(typeof busyResult.error, 'string');
  assert.notEqual(busyResult.error, '');

  resolveSave();
  await browser.inbox.next();
  await browser.inbox.next();
});

test('identifies only valid room-order commands for the displayed rooms', () => {
  const displayedRooms = ['全部', '客厅', '厨房', '未分组'];

  assert.equal(isRoomOrderCommand({
    type: 'set_room_order',
    rooms: ['全部', '厨房', '客厅', '未分组']
  }, displayedRooms), true);
  assert.equal(isRoomOrderCommand({
    type: 'set_room_order',
    rooms: ['厨房', '全部', '客厅', '未分组']
  }, displayedRooms), false);
  assert.equal(isRoomOrderCommand({ type: 'set_dashboard_entity_ignored' }, displayedRooms), false);
});

test('starts in mock mode without a Supervisor token or room-order store', async (t) => {
  const { app } = await startApp({ useMockData: true, token: undefined });
  t.after(() => stopApp(app));

  assert.equal(app.server.listening, true);
});

test('constructs the injected Supervisor room-order store in non-mock mode', async (t) => {
  let constructionCount = 0;
  const { app } = await startApp({
    token: 'test-token',
    supervisorOptionsClientFactory({ token }) {
      constructionCount += 1;
      assert.equal(token, 'test-token');
      return { setRoomOrder() {} };
    }
  });
  t.after(() => stopApp(app));

  assert.equal(app.server.listening, true);
  assert.equal(constructionCount, 1);
});

test('does not construct a Supervisor room-order store in mock mode with a token', async (t) => {
  let constructionCount = 0;
  const { app } = await startApp({
    useMockData: true,
    token: 'test-token',
    supervisorOptionsClientFactory() {
      constructionCount += 1;
      throw new Error('Mock mode must not construct a Supervisor room-order store');
    }
  });
  t.after(() => stopApp(app));

  assert.equal(app.server.listening, true);
  assert.equal(constructionCount, 0);
});
