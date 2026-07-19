const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { SupervisorOptionsClient } = require('../src/supervisorOptionsClient');

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

function rejectIfUnsettled(promise, timeoutMs) {
  let timeout;
  const deadline = new Promise((resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('Supervisor request did not settle before the test timeout'));
    }, timeoutMs);
  });

  return Promise.race([promise, deadline]).finally(() => clearTimeout(timeout));
}

test('reads current options and persists only the updated room order', async (t) => {
  const currentOptions = {
    display: { title: '全屋设备状态' },
    rooms: { overrides: [], order: ['全部', '客厅', '门口'] }
  };
  const requests = [];
  const server = await startServer(async (req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      accept: req.headers.accept,
      contentType: req.headers['content-type']
    });

    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(currentOptions));
      return;
    }

    const body = await readJson(req);
    requests[requests.length - 1].body = body;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({}));
  });
  t.after(() => server.close());

  const client = new SupervisorOptionsClient({
    baseUrl: server.baseUrl,
    token: 'test-token'
  });
  await client.setRoomOrder(['全部', '门口', '客厅']);

  assert.deepEqual(requests, [
    {
      method: 'GET',
      url: '/addons/self/options/config',
      authorization: 'Bearer test-token',
      accept: 'application/json',
      contentType: undefined
    },
    {
      method: 'POST',
      url: '/addons/self/options',
      authorization: 'Bearer test-token',
      accept: 'application/json',
      contentType: 'application/json',
      body: {
        options: {
          display: { title: '全屋设备状态' },
          rooms: { overrides: [], order: ['全部', '门口', '客厅'] }
        }
      }
    }
  ]);
});

test('rejects a non-2xx Supervisor options response', async (t) => {
  const server = await startServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rooms: { overrides: [], order: ['全部', '客厅'] } }));
      return;
    }

    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Invalid options' }));
  });
  t.after(() => server.close());

  const client = new SupervisorOptionsClient({
    baseUrl: server.baseUrl,
    token: 'test-token'
  });

  await assert.rejects(
    client.setRoomOrder(['全部', '客厅']),
    /Supervisor options request failed: 400/
  );
});

test('requires a Supervisor token', () => {
  assert.throws(
    () => new SupervisorOptionsClient({ baseUrl: 'http://127.0.0.1:1' }),
    /Supervisor token is required/
  );
  assert.throws(
    () => new SupervisorOptionsClient({ token: '' }),
    /Supervisor token is required/
  );
});

test('rejects an invalid JSON success response with context', async (t) => {
  const server = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('not JSON');
  });
  t.after(() => server.close());

  const client = new SupervisorOptionsClient({
    baseUrl: server.baseUrl,
    token: 'test-token'
  });

  await assert.rejects(
    client.setRoomOrder(['全部', '客厅']),
    /Supervisor options response contained invalid JSON/
  );
});

test('rejects an interrupted Supervisor response instead of waiting indefinitely', async (t) => {
  const server = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.flushHeaders();
    res.write('{"rooms":');
    setTimeout(() => res.destroy(), 10);
  });
  t.after(() => server.close());

  const client = new SupervisorOptionsClient({
    baseUrl: server.baseUrl,
    token: 'test-token'
  });

  await assert.rejects(
    rejectIfUnsettled(client.setRoomOrder(['全部', '客厅']), 200),
    /Supervisor options response was aborted/
  );
});

test('times out a Supervisor request that never responds', async (t) => {
  const server = await startServer(() => {});
  t.after(() => server.close());

  const client = new SupervisorOptionsClient({
    baseUrl: server.baseUrl,
    token: 'test-token',
    requestTimeoutMs: 20
  });

  await assert.rejects(
    rejectIfUnsettled(client.setRoomOrder(['全部', '客厅']), 200),
    (error) => error.message === 'Supervisor options request timed out'
  );
});
