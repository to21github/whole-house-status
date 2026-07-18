const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { loadOptions } = require('./options');
const { AlertEngine } = require('./alertEngine');
const { StateStore } = require('./stateStore');
const { buildViewModel } = require('./viewModel');
const { HomeAssistantClient } = require('./haClient');

const PORT = Number(process.env.PORT === undefined ? 8099 : process.env.PORT);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const INGRESS_PROXY_ADDRESS = '172.30.32.2';
const SHUTDOWN_TIMEOUT_MS = 5_000;
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

function createServer({
  useMockData = process.env.USE_MOCK_DATA === 'true',
  token = process.env.SUPERVISOR_TOKEN,
  optionsPath,
  publicDir = PUBLIC_DIR,
  logger = console,
  haClientFactory = () => new HomeAssistantClient()
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
      configError
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

  browserWss.on('connection', (client) => {
    clients.add(client);
    send(client, snapshot());
    client.on('close', () => clients.delete(client));
  });

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

  return { server, browserWss, snapshot, broadcast, haClient };
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

async function closeApplication({ server, browserWss, haClient }) {
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
  safeFilePath,
  isTrustedProxyAddress,
  isIngressRequestAllowed
};
