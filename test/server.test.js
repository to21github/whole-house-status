const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { createServer, isIngressRequestAllowed, isTrustedProxyAddress, safeFilePath } = require('../src/server');

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
  });
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function bufferChildOutput(child) {
  let output = '';
  const subscribers = new Set();

  function onOutput(chunk) {
    output += chunk.toString();
    for (const subscriber of subscribers) {
      subscriber();
    }
  }

  child.stdout.on('data', onOutput);
  child.stderr.on('data', onOutput);

  return {
    getOutput() {
      return output;
    },
    subscribe(subscriber) {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    stop() {
      child.stdout.off('data', onOutput);
      child.stderr.off('data', onOutput);
    }
  };
}

function waitForStartup(child, outputBuffer, message, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe;
    const timeout = setTimeout(() => finish(new Error(`Server did not start within ${timeoutMs}ms: ${outputBuffer.getOutput()}`)), timeoutMs);

    function finish(error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      unsubscribe();
      child.off('error', onError);
      child.off('exit', onExit);
      if (error) {
        reject(error);
      } else {
        resolve(outputBuffer.getOutput());
      }
    }

    function onOutput(chunk) {
      if (outputBuffer.getOutput().includes(message)) {
        finish();
      }
    }

    function onError(error) {
      finish(error);
    }

    function onExit(code, signal) {
      finish(new Error(`Server exited before startup (code ${code}, signal ${signal}): ${outputBuffer.getOutput()}`));
    }

    unsubscribe = outputBuffer.subscribe(onOutput);
    child.once('error', onError);
    child.once('exit', onExit);
    onOutput();
  });
}

function waitForExit(child, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error(`Server did not exit within ${timeoutMs}ms`)), timeoutMs);

    function finish(error, code, signal) {
      clearTimeout(timeout);
      child.off('error', onError);
      child.off('exit', onExit);
      if (error) {
        reject(error);
      } else {
        resolve({ code, signal });
      }
    }

    function onError(error) {
      finish(error);
    }

    function onExit(code, signal) {
      finish(null, code, signal);
    }

    child.once('error', onError);
    child.once('exit', onExit);
  });
}

async function forceStop(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const exited = waitForExit(child, 1_000);
  child.kill('SIGKILL');
  await exited;
}

test('safeFilePath rejects traversal and malformed encodings', () => {
  const publicDir = path.join(os.tmpdir(), 'whole-house-status-public');
  assert.equal(safeFilePath('/../secret.txt', publicDir), null);
  assert.equal(safeFilePath('/%2e%2e/secret.txt', publicDir), null);
  assert.equal(safeFilePath('/%E0%A4%A', publicDir), null);
  assert.equal(safeFilePath('/room/', publicDir), path.join(publicDir, 'room', 'index.html'));
});

test('recognizes the Home Assistant ingress proxy address including IPv4-mapped IPv6', () => {
  assert.equal(isTrustedProxyAddress('172.30.32.2'), true);
  assert.equal(isTrustedProxyAddress('::ffff:172.30.32.2'), true);
  assert.equal(isTrustedProxyAddress('127.0.0.1'), false);
});

test('limits production ingress requests to the Home Assistant proxy only', () => {
  assert.equal(isIngressRequestAllowed('127.0.0.1', { token: 'token', useMockData: false }), false);
  assert.equal(isIngressRequestAllowed('::ffff:172.30.32.2', { token: 'token', useMockData: false }), true);
  assert.equal(isIngressRequestAllowed('127.0.0.1', { token: undefined, useMockData: false }), true);
  assert.equal(isIngressRequestAllowed('127.0.0.1', { token: 'token', useMockData: true }), true);
});

test('mock server serves static assets, publishes a snapshot, and closes cleanly', async (t) => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whole-house-status-public-'));
  const optionsPath = path.join(publicDir, 'options.json');
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<h1>status</h1>');
  fs.writeFileSync(optionsPath, '{not json');
  const warnings = [];
  const app = createServer({
    useMockData: true,
    publicDir,
    optionsPath,
    logger: { warn: (message) => warnings.push(message), error: () => {} },
    haClientFactory: () => { throw new Error('mock mode must not create a HA client'); }
  });
  const port = await listen(app.server);
  t.after(async () => {
    await close(app.server);
    fs.rmSync(publicDir, { recursive: true, force: true });
  });

  const page = await request(port, '/');
  assert.equal(page.statusCode, 200);
  assert.equal(page.body, '<h1>status</h1>');
  assert.equal(warnings.length, 1);

  const snapshot = await new Promise((resolve, reject) => {
    const browser = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    browser.once('message', (message) => {
      browser.close();
      resolve(JSON.parse(message));
    });
    browser.once('error', reject);
  });
  assert.equal(snapshot.connection.ha_connected, true);
  assert.match(snapshot.connection.config_error, /Unable to load options/);
  assert.equal(snapshot.devices.length, 7);
});

test('production server rejects non-proxy HTTP and WebSocket traffic', async (t) => {
  const haClient = new EventEmitter();
  haClient.connect = () => {};
  const app = createServer({
    token: 'supervisor-token',
    useMockData: false,
    haClientFactory: () => haClient,
    logger: { warn: () => {}, error: () => {} }
  });
  const port = await listen(app.server);
  t.after(() => close(app.server));

  const page = await request(port, '/');
  assert.equal(page.statusCode, 403);

  const upgradeStatus = await new Promise((resolve, reject) => {
    const browser = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    browser.once('unexpected-response', (_request, response) => resolve(response.statusCode));
    browser.once('error', reject);
  });
  assert.equal(upgradeStatus, 403);
});

test('entrypoint exits cleanly after SIGTERM', async (t) => {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, USE_MOCK_DATA: 'true', PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const outputBuffer = bufferChildOutput(child);
  t.after(async () => {
    try {
      await forceStop(child);
    } finally {
      outputBuffer.stop();
    }
  });

  const startupOutput = await waitForStartup(child, outputBuffer, 'Whole House Status Add-on listening on');
  assert.match(startupOutput, /Whole House Status Add-on listening on [1-9]\d*/);
  assert.equal(child.kill('SIGTERM'), true);

  const result = await waitForExit(child);
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
});
