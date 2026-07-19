const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { loadOptions, normalizeOptions } = require('./options');
const { AlertEngine } = require('./alertEngine');
const { StateStore } = require('./stateStore');
const { buildViewModel } = require('./viewModel');
const { HomeAssistantClient } = require('./haClient');
const { IgnoredEntityStore, isEntityId } = require('./ignoredEntityStore');
const { SupervisorOptionsClient } = require('./supervisorOptionsClient');
const { isValidDisplayedRoomOrder, buildPersistedRoomOrder } = require('./roomOrder');

function resolvePort(value) {
  return Number(value === undefined || value === '' ? 8099 : value);
}

const PORT = resolvePort(process.env.PORT);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const INGRESS_PROXY_ADDRESS = '172.30.32.2';
const SHUTDOWN_TIMEOUT_MS = 5_000;
const REFRESH_INTERVAL_MS = 1_000;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function createMockStates() {
  return [
    { entity_id: 'switch.ke_ting_zhu_deng', state: 'unavailable', attributes: { friendly_name: '客厅主灯' } },
    { entity_id: 'switch.dian_shi_kai_guan', state: 'on', attributes: { friendly_name: '电脑开关' } },
    { entity_id: 'switch.men_ting_ding_deng', state: 'on', attributes: { friendly_name: '门口顶灯' } },
    { entity_id: 'climate.qdhkl_cn_proxy_621130311_0101_ac', state: 'cool', attributes: { friendly_name: '门口空调' } },
    { entity_id: 'switch.xuan_guan_deng', state: 'off', attributes: { friendly_name: '玄关灯' } },
    { entity_id: 'switch.men_kou_deng_dai', state: 'off', attributes: { friendly_name: '门口灯带' } },
    { entity_id: 'switch.men_kou_ye_deng', state: 'off', attributes: { friendly_name: '门口夜灯' } },
    { entity_id: 'binary_sensor.men_kou_motion', state: 'off', attributes: { friendly_name: '门口人体' } }
  ];
}

function safeFilePath(urlPath, publicDir = PUBLIC_DIR) {
  let cleanPath;
  try {
    cleanPath = decodeURIComponent((urlPath || '/').split('?')[0]);
  } catch {
    return null;
  }
  if (cleanPath.includes('\0')) {
    return null;
  }

  const requestedPath = cleanPath.endsWith('/') ? `${cleanPath}index.html` : cleanPath;
  const requested = requestedPath === '/index.html' ? 'index.html' : requestedPath.replace(/^[/\\]+/, '');
  const root = path.resolve(publicDir);
  const filePath = path.resolve(root, requested);
  return filePath === root || filePath.startsWith(`${root}${path.sep}`) ? filePath : null;
}

function serveStatic(req, res, publicDir = PUBLIC_DIR) {
  const filePath = safeFilePath(req.url, publicDir);
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(content);
  });
}

function isTrustedProxyAddress(address) {
  return typeof address === 'string' && address.replace(/^::ffff:/, '') === INGRESS_PROXY_ADDRESS;
}

function isIngressRequestAllowed(address, { token, useMockData }) {
  return useMockData || !token || isTrustedProxyAddress(address);
}

function rejectUpgrade(socket) {
  socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  socket.destroy();
}

function isDashboardIgnoreCommand(command) {
  return Boolean(
    command
    && typeof command === 'object'
    && command.type === 'set_dashboard_entity_ignored'
    && isEntityId(command.entity_id)
    && typeof command.ignored === 'boolean'
  );
}

function isRoomOrderCommand(command, displayedRooms) {
  return Boolean(
    command
    && typeof command === 'object'
    && command.type === 'set_room_order'
    && isValidDisplayedRoomOrder(command.rooms, displayedRooms)
  );
}

function createServer({
  useMockData = process.env.USE_MOCK_DATA === 'true',
  token = process.env.SUPERVISOR_TOKEN,
  optionsPath,
  ignoredEntitiesPath = process.env.IGNORED_ENTITIES_PATH || '/data/ignored-entities.json',
  ignoredEntityStore,
  roomOrderStore,
  publicDir = PUBLIC_DIR,
  logger = console,
  haClientFactory = () => new HomeAssistantClient(),
  supervisorOptionsClientFactory = (options) => new SupervisorOptionsClient(options),
  refreshIntervalMs = REFRESH_INTERVAL_MS
} = {}) {
  let configError = null;
  const optionsLogger = {
    warn(message) {
      configError = message;
      logger.warn(message);
    }
  };
  let options;
  try {
    options = loadOptions(optionsPath, optionsLogger);
  } catch (error) {
    configError = error.message;
    logger.error(error.message);
    options = loadOptions('/path-that-does-not-exist', optionsLogger);
  }

  const store = new StateStore();
  const alertEngine = new AlertEngine(options);
  const dashboardIgnoreStore = ignoredEntityStore || new IgnoredEntityStore({
    filePath: ignoredEntitiesPath,
    logger
  });
  const effectiveRoomOrderStore = roomOrderStore
    || (!useMockData && token ? supervisorOptionsClientFactory({ token }) : null);
  let registries = { entity: [], device: [], area: [] };
  let haConnected = false;
  if (useMockData) {
    store.setStates(createMockStates());
    haConnected = true;
  }

  function snapshot() {
    return buildViewModel({
      states: store.getStateMap(),
      registries,
      options,
      alertEngine,
      now: Date.now(),
      selectedRoom: options.display.default_room,
      haConnected,
      configError,
      dashboardIgnoredEntityIds: dashboardIgnoreStore.getEntityIds()
    });
  }

  const server = http.createServer((req, res) => {
    if (!isIngressRequestAllowed(req.socket.remoteAddress, { token, useMockData })) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    serveStatic(req, res, publicDir);
  });
  const browserWss = new WebSocket.Server({ noServer: true });
  const clients = new Set();
  let roomOrderSavePending = false;

  function send(client, payload) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(payload));
    }
  }

  function broadcast() {
    const payload = snapshot();
    for (const client of clients) {
      send(client, payload);
    }
  }

  async function handleBrowserCommand(client, rawMessage) {
    let command;
    try {
      command = JSON.parse(rawMessage.toString());
    } catch {
      return;
    }
    const displayedRooms = snapshot().rooms;
    if (command && typeof command === 'object' && command.type === 'set_room_order') {
      if (!isRoomOrderCommand(command, displayedRooms)) {
        send(client, {
          type: 'room_order_result',
          rooms: displayedRooms,
          error: 'Invalid room order'
        });
        return;
      }

      if (!effectiveRoomOrderStore) {
        send(client, {
          type: 'room_order_result',
          rooms: displayedRooms,
          error: 'Room order persistence is unavailable'
        });
        return;
      }

      if (roomOrderSavePending) {
        send(client, {
          type: 'room_order_result',
          rooms: displayedRooms,
          error: 'A room order update is already in progress'
        });
        return;
      }

      roomOrderSavePending = true;
      try {
        const persistedOrder = buildPersistedRoomOrder(command.rooms, options.rooms.order);
        await effectiveRoomOrderStore.setRoomOrder(persistedOrder);
        options = normalizeOptions({
          ...options,
          rooms: {
            ...options.rooms,
            order: persistedOrder
          }
        });
        broadcast();
        send(client, {
          type: 'room_order_result',
          rooms: snapshot().rooms
        });
      } catch (error) {
        send(client, {
          type: 'room_order_result',
          rooms: displayedRooms,
          error: error && error.message ? error.message : 'Unable to persist room order'
        });
      } finally {
        roomOrderSavePending = false;
      }
      return;
    }

    if (!isDashboardIgnoreCommand(command)) {
      return;
    }

    try {
      dashboardIgnoreStore.setIgnored(command.entity_id, command.ignored);
      broadcast();
      send(client, {
        type: 'dashboard_entity_ignored_result',
        entity_id: command.entity_id,
        ignored: command.ignored
      });
    } catch (error) {
      send(client, {
        type: 'dashboard_entity_ignored_result',
        entity_id: command.entity_id,
        ignored: command.ignored,
        error: error && error.message ? error.message : 'Unable to update dashboard ignored entities'
      });
    }
  }

  browserWss.on('connection', (client) => {
    clients.add(client);
    send(client, snapshot());
    client.on('close', () => clients.delete(client));
    client.on('message', (message) => handleBrowserCommand(client, message));
  });

  let refreshTimer = setInterval(() => {
    if (clients.size > 0) {
      broadcast();
    }
  }, refreshIntervalMs);
  refreshTimer.unref();

  function stopRefresh() {
    if (!refreshTimer) {
      return;
    }
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  const nativeServerClose = server.close.bind(server);
  server.close = (...args) => {
    stopRefresh();
    return nativeServerClose(...args);
  };
  server.once('close', stopRefresh);

  server.on('upgrade', (req, socket, head) => {
    if (!isIngressRequestAllowed(req.socket.remoteAddress, { token, useMockData })) {
      rejectUpgrade(socket);
      return;
    }
    if (new URL(req.url, 'http://localhost').pathname !== '/ws') {
      socket.destroy();
      return;
    }
    browserWss.handleUpgrade(req, socket, head, (ws) => browserWss.emit('connection', ws, req));
  });

  let haClient = null;
  if (!useMockData) {
    haClient = haClientFactory();
    haClient.on('connection', (connected) => {
      haConnected = connected;
      broadcast();
    });
    haClient.on('registries', (nextRegistries) => {
      registries = nextRegistries;
      broadcast();
    });
    haClient.on('states', (states) => {
      store.setStates(states);
      broadcast();
    });
    haClient.on('state_changed', (event) => {
      store.applyStateChanged(event);
      broadcast();
    });
    haClient.on('error', (error) => logger.error(error.message));
    haClient.connect();
  }

  return { server, browserWss, snapshot, broadcast, haClient, stopRefresh };
}

function closeWithCallback(close) {
  return new Promise((resolve) => {
    try {
      close(() => resolve());
    } catch {
      resolve();
    }
  });
}

async function closeApplication({ server, browserWss, haClient, stopRefresh }) {
  if (stopRefresh) {
    stopRefresh();
  }
  const serverClosed = closeWithCallback((done) => server.close(done));

  for (const client of browserWss.clients) {
    try {
      client.terminate();
    } catch {
      // A browser client can already be closed while shutdown is in progress.
    }
  }

  const browserWssClosed = closeWithCallback((done) => browserWss.close(done));
  if (haClient) {
    try {
      haClient.close();
    } catch {
      // Continue closing the local server even if the HA client is already closed.
    }
  }

  await Promise.all([serverClosed, browserWssClosed]);
}

function main() {
  const app = createServer();
  const { server } = app;
  let shuttingDown = false;

  function shutdown() {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    const fallback = setTimeout(() => process.exit(0), SHUTDOWN_TIMEOUT_MS);
    fallback.unref();
    closeApplication(app).finally(() => {
      clearTimeout(fallback);
      process.exit(0);
    });
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  server.listen(PORT, '0.0.0.0', () => {
    const address = server.address();
    const listeningPort = address && typeof address === 'object' ? address.port : PORT;
    console.log(`Whole House Status Add-on listening on ${listeningPort}`);
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  createServer,
  createMockStates,
  resolvePort,
  safeFilePath,
  isTrustedProxyAddress,
  isIngressRequestAllowed,
  isRoomOrderCommand
};
