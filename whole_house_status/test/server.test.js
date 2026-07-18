const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { createServer, isIngressRequestAllowed, isTrustedProxyAddress, resolvePort, safeFilePath } = require('../src/server');

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

test('resolvePort defaults only unset and empty values while preserving explicit ports', () => {
  assert.equal(resolvePort(undefined), 8099);
  assert.equal(resolvePort(''), 8099);
  assert.equal(resolvePort('0'), 0);
  assert.equal(resolvePort('4567'), 4567);
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

test('mock server rejects percent-encoded NUL paths without losing service', async (t) => {
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
  const port = Number(startupOutput.match(/listening on (\d+)/)[1]);

  const malformed = await request(port, '/%00');
  assert.ok(malformed.statusCode >= 400);

  const page = await request(port, '/');
  assert.equal(page.statusCode, 200);
});

test('connected browser receives a duration warning without a Home Assistant event', async (t) => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whole-house-status-public-'));
  const optionsPath = path.join(publicDir, 'options.json');
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<h1>status</h1>');
  fs.writeFileSync(optionsPath, JSON.stringify({
    alerts: { default_on_duration_minutes: 0.001 }
  }));
  const app = createServer({
    useMockData: true,
    publicDir,
    optionsPath,
    refreshIntervalMs: 10,
    logger: { warn: () => {}, error: () => {} }
  });
  const port = await listen(app.server);
  let browser;
  t.after(async () => {
    if (browser) {
      browser.terminate();
    }
    await close(app.server);
    fs.rmSync(publicDir, { recursive: true, force: true });
  });

  const snapshots = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for a duration warning snapshot'));
    }, 1_000);
    const received = [];
    browser = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    browser.on('error', reject);
    browser.on('message', (message) => {
      const snapshot = JSON.parse(message);
      received.push(snapshot);
      const warning = snapshot.alerts.find((device) => device.entity_id === 'switch.dian_shi_kai_guan');
      if (warning && warning.reason === 'on_duration') {
        clearTimeout(timeout);
        browser.close();
        resolve(received);
      }
    });
  });

  const initial = snapshots[0].devices.find((device) => device.entity_id === 'switch.dian_shi_kai_guan');
  assert.equal(initial.reason, 'active');
  assert.ok(snapshots.some((snapshot) => (
    snapshot.alerts.some((device) => device.entity_id === 'switch.dian_shi_kai_guan' && device.reason === 'on_duration')
  )));
});

test('connected browser receives a high-power warning without a Home Assistant event', async (t) => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whole-house-status-public-'));
  const optionsPath = path.join(publicDir, 'options.json');
  const haClient = new EventEmitter();
  haClient.connect = () => {};
  haClient.close = () => {};
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<h1>status</h1>');
  fs.writeFileSync(optionsPath, JSON.stringify({
    alerts: {
      default_on_duration_minutes: 1,
      high_power_rules: [{
        entity_id: 'switch.water_heater',
        power_sensor: 'sensor.water_heater_power',
        threshold_w: 800,
        duration_minutes: 0.001
      }]
    }
  }));
  const app = createServer({
    useMockData: false,
    publicDir,
    optionsPath,
    refreshIntervalMs: 10,
    haClientFactory: () => haClient,
    logger: { warn: () => {}, error: () => {} }
  });
  const port = await listen(app.server);
  let browser;
  t.after(async () => {
    if (browser) {
      browser.terminate();
    }
    await close(app.server);
    fs.rmSync(publicDir, { recursive: true, force: true });
  });

  haClient.emit('connection', true);
  haClient.emit('states', [
    { entity_id: 'switch.water_heater', state: 'on', attributes: { friendly_name: 'Water Heater' } },
    { entity_id: 'sensor.water_heater_power', state: '900', attributes: { friendly_name: 'Water Heater Power' } }
  ]);

  const snapshots = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for a high-power warning snapshot'));
    }, 1_000);
    const received = [];
    browser = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    browser.on('error', reject);
    browser.on('message', (message) => {
      const snapshot = JSON.parse(message);
      received.push(snapshot);
      const warning = snapshot.alerts.find((device) => device.entity_id === 'switch.water_heater');
      if (warning && warning.reason === 'high_power') {
        clearTimeout(timeout);
        browser.close();
        resolve(received);
      }
    });
  });

  const initial = snapshots[0].devices.find((device) => device.entity_id === 'switch.water_heater');
  assert.equal(initial.reason, 'active');
  assert.ok(snapshots.some((snapshot) => (
    snapshot.alerts.some((device) => device.entity_id === 'switch.water_heater' && device.reason === 'high_power')
  )));
});

test('ordinary server close clears the refresh interval', async (t) => {
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  let refreshTimer;
  let refreshTimerCleared = false;
  global.setInterval = (...args) => {
    refreshTimer = originalSetInterval(...args);
    return refreshTimer;
  };
  global.clearInterval = (timer) => {
    if (timer === refreshTimer) {
      refreshTimerCleared = true;
    }
    return originalClearInterval(timer);
  };
  t.after(() => {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  });

  const app = createServer({ useMockData: true, refreshIntervalMs: 10 });
  await listen(app.server);
  await close(app.server);

  assert.equal(refreshTimerCleared, true);
});

test('ordinary server close stops refreshes before an open WebSocket disconnects', async (t) => {
  const app = createServer({ useMockData: true, refreshIntervalMs: 10 });
  const port = await listen(app.server);
  let browser;
  let serverClosed;
  t.after(async () => {
    if (browser) {
      browser.terminate();
    }
    if (serverClosed) {
      await serverClosed;
    } else {
      await close(app.server);
    }
  });

  const snapshots = [];
  await new Promise((resolve, reject) => {
    browser = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    browser.once('error', reject);
    browser.on('message', (message) => {
      snapshots.push(JSON.parse(message));
      if (snapshots.length === 1) {
        resolve();
      }
    });
  });

  const closeStartedAt = Date.now();
  serverClosed = close(app.server);
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(snapshots.filter((snapshot) => Date.parse(snapshot.updated_at) > closeStartedAt).length, 0);
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
