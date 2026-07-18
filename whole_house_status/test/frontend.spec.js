const { spawn } = require('node:child_process');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const startupPattern = /Whole House Status Add-on listening on ([1-9]\d*)/;
let baseUrl;
let serverProcess;

function waitForStartup(process) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let output = '';
    const timeout = setTimeout(() => {
      finish(new Error(`Server did not start within 10 seconds: ${output}`));
    }, 10_000);

    function finish(error, port) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      process.stdout.off('data', onOutput);
      process.stderr.off('data', onOutput);
      process.off('error', onError);
      process.off('exit', onExit);
      if (error) {
        reject(error);
        return;
      }
      resolve(port);
    }

    function onOutput(chunk) {
      output += chunk.toString();
      const match = output.match(startupPattern);
      if (match) {
        finish(null, Number(match[1]));
      }
    }

    function onError(error) {
      finish(new Error(`Server error before startup: ${error.message}: ${output}`));
    }

    function onExit(code, signal) {
      finish(new Error(`Server exited before startup (code ${code}, signal ${signal}): ${output}`));
    }

    process.stdout.on('data', onOutput);
    process.stderr.on('data', onOutput);
    process.once('error', onError);
    process.once('exit', onExit);
  });
}

function stopServer(process) {
  return new Promise((resolve) => {
    if (!process || process.exitCode !== null || process.signalCode !== null) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      process.kill('SIGKILL');
    }, 5_000);
    process.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    process.kill('SIGTERM');
  });
}

async function mockWebSocket(page, viewModels) {
  await page.addInitScript((models) => {
    class MockWebSocket extends EventTarget {
      constructor() {
        super();
        this.readyState = MockWebSocket.OPEN;
        models.forEach((model, index) => {
          window.setTimeout(() => {
            this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(model) }));
          }, index * 20);
        });
      }

      close() {
        this.readyState = MockWebSocket.CLOSED;
        this.dispatchEvent(new Event('close'));
      }
    }
    MockWebSocket.CONNECTING = 0;
    MockWebSocket.OPEN = 1;
    MockWebSocket.CLOSED = 3;
    window.WebSocket = MockWebSocket;
  }, viewModels);
}

test.beforeAll(async () => {
  serverProcess = spawn('npm', ['start'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, USE_MOCK_DATA: 'true', PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const port = await waitForStartup(serverProcess);
  baseUrl = `http://127.0.0.1:${port}`;
});

test.afterAll(async () => {
  await stopServer(serverProcess);
});

test('renders the dashboard on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`${baseUrl}/`);

  await expect(page.locator('#title')).toHaveText('全屋设备状态');
  await expect(page.locator('#stat-online')).toHaveText(/[1-9]\d*/);
  const allRoomsButton = page.getByRole('button', { name: '全部', exact: true });
  await expect(allRoomsButton).toHaveAttribute('aria-pressed', 'true');
  await expect(allRoomsButton).toHaveCSS('background-color', 'rgb(213, 213, 213)');
  await expect(allRoomsButton).toHaveCSS('color', 'rgb(34, 34, 34)');
  await expect(page.locator('#alerts .device-card')).toHaveCount(1);
  await expect(page.locator('#devices .device-card').first()).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(16, 16, 16)');
  expect(await page.locator('.stats').evaluate((element) => (
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length
  ))).toBe(4);
  await expect(page.locator('.stat').first()).toHaveCSS('display', 'flex');
  await expect(page.locator('.stat').first()).toHaveCSS('justify-content', 'space-between');
  const statLabel = await page.locator('.stat').first().locator('p').boundingBox();
  const statValue = await page.locator('.stat').first().locator('strong').boundingBox();
  expect(statLabel.x + statLabel.width).toBeLessThanOrEqual(statValue.x);
  expect(await page.locator('#devices').evaluate((element) => (
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length
  ))).toBe(5);
});

test('ignores invalid messages before the first selected room model', async ({ page }) => {
  const model = {
    title: '全屋设备状态',
    selected_room: '客厅',
    rooms: ['全部', '客厅', '卧室'],
    stats: { online: 3, on: 1, warning: 1, error: 0 },
    alerts: [{
      entity_id: 'switch.bedroom_alert',
      name: '卧室告警设备',
      room: '卧室',
      status_label: '超时',
      status_color: 'orange',
      show_entity_id: false
    }],
    devices: [{
      entity_id: 'switch.living_room_lamp',
      name: '客厅台灯',
      room: '客厅',
      status_label: '开启',
      status_color: 'green',
      show_entity_id: false
    }, {
      entity_id: 'switch.bedroom_lamp',
      name: '卧室台灯',
      room: '卧室',
      status_label: '在线',
      status_color: '',
      show_entity_id: false
    }],
    connection: { ha_connected: true, config_error: null }
  };
  const modelWithoutSelectedRoom = { ...model };
  delete modelWithoutSelectedRoom.selected_room;
  await mockWebSocket(page, [modelWithoutSelectedRoom, model]);

  await page.goto(`${baseUrl}/`);

  await expect(page.getByRole('button', { name: '客厅', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#devices')).toContainText('客厅台灯');
  await expect(page.locator('#devices')).not.toContainText('卧室台灯');
  await expect(page.locator('#alerts')).not.toContainText('卧室告警设备');
});

test('filters normal and alert entities by Home Assistant Area after changing rooms', async ({ page }) => {
  const model = {
    title: '全屋设备状态',
    selected_room: '客厅',
    rooms: ['全部', '客厅', '卧室'],
    stats: { online: 3, on: 1, warning: 1, error: 1 },
    alerts: [{
      entity_id: 'switch.living_room_alert',
      name: '客厅高功率设备',
      room: '客厅',
      status_label: '高功率',
      status_color: 'orange',
      show_entity_id: false
    }, {
      entity_id: 'switch.bedroom_alert',
      name: '卧室离线设备',
      room: '卧室',
      status_label: '离线',
      status_color: 'red',
      show_entity_id: false
    }],
    devices: [{
      entity_id: 'switch.living_room_lamp',
      name: '客厅台灯',
      room: '客厅',
      status_label: '开启',
      status_color: 'green',
      show_entity_id: false
    }, {
      entity_id: 'switch.bedroom_lamp',
      name: '卧室台灯',
      room: '卧室',
      status_label: '在线',
      status_color: '',
      show_entity_id: false
    }],
    connection: { ha_connected: true, config_error: null }
  };
  await mockWebSocket(page, [model]);
  await page.goto(`${baseUrl}/`);

  await expect(page.getByRole('button', { name: '客厅', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#devices')).toContainText('客厅台灯');
  await expect(page.locator('#devices')).not.toContainText('卧室台灯');
  await expect(page.locator('#alerts')).toContainText('客厅高功率设备');
  await expect(page.locator('#alerts')).not.toContainText('卧室离线设备');

  await page.getByRole('button', { name: '卧室', exact: true }).click();
  await expect(page.getByRole('button', { name: '卧室', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#devices')).toContainText('卧室台灯');
  await expect(page.locator('#devices')).not.toContainText('客厅台灯');
  await expect(page.locator('#alerts')).toContainText('卧室离线设备');
  await expect(page.locator('#alerts')).not.toContainText('客厅高功率设备');
});

test('keeps warning and error cards on the standard border', async ({ page }) => {
  const model = {
    title: '全屋设备状态',
    selected_room: '全部',
    rooms: ['全部', '客厅'],
    stats: { online: 1, on: 0, warning: 1, error: 1 },
    alerts: [{
      entity_id: 'switch.warning',
      name: '高功率设备',
      room: '客厅',
      status_label: '高功率',
      status_color: 'orange',
      show_entity_id: false
    }, {
      entity_id: 'switch.error',
      name: '离线设备',
      room: '客厅',
      status_label: '离线',
      status_color: 'red',
      show_entity_id: false
    }],
    devices: [],
    connection: { ha_connected: true, config_error: null }
  };
  await mockWebSocket(page, [model]);
  await page.goto(`${baseUrl}/`);

  const alertCards = page.locator('#alerts .device-card');
  await expect(alertCards).toHaveCount(2);
  await expect(alertCards.nth(0)).toHaveCSS('border-color', 'rgb(52, 52, 52)');
  await expect(alertCards.nth(1)).toHaveCSS('border-color', 'rgb(52, 52, 52)');
  await expect(page.locator('#alerts .device-status.orange')).toHaveCSS('color', 'rgb(243, 161, 26)');
  await expect(page.locator('#alerts .device-status.red')).toHaveCSS('color', 'rgb(255, 0, 30)');
});

test('shows ignored entities only when the display option is enabled', async ({ page }) => {
  const model = {
    title: '全屋设备状态',
    selected_room: '全部',
    rooms: ['全部', '客厅'],
    stats: { online: 1, on: 0, warning: 0, error: 0 },
    alerts: [{
      entity_id: 'switch.ignored_offline',
      name: '已忽略离线开关',
      room: '客厅',
      status_label: '离线',
      status_color: 'red',
      ignored: true,
      show_entity_id: false
    }],
    devices: [{
      entity_id: 'light.visible',
      name: '可见灯',
      room: '客厅',
      status_label: '在线',
      status_color: '',
      ignored: false,
      show_entity_id: false
    }],
    connection: { ha_connected: true, config_error: null }
  };
  await page.addInitScript(() => localStorage.removeItem('whole-house-status-show-ignored'));
  await mockWebSocket(page, [model]);
  await page.goto(`${baseUrl}/`);

  await expect(page.locator('#devices')).toContainText('可见灯');
  await expect(page.locator('#alerts')).not.toContainText('已忽略离线开关');

  await page.getByText('显示', { exact: true }).click();
  const showIgnored = page.getByLabel('显示已忽略的');
  await expect(showIgnored).not.toBeChecked();
  await page.getByText('显示已忽略的', { exact: true }).click();
  await expect(showIgnored).toBeChecked();
  await expect(page.locator('#alerts')).toContainText('已忽略离线开关');
  await expect(page.locator('#alerts')).toContainText('已忽略');

  await page.getByText('显示已忽略的', { exact: true }).click();
  await expect(showIgnored).not.toBeChecked();
  await expect(page.locator('#alerts')).not.toContainText('已忽略离线开关');
});

test('keeps the ignored-entities display menu inside the mobile viewport', async ({ page }) => {
  const model = {
    title: '全屋设备状态',
    selected_room: '全部',
    rooms: ['全部'],
    stats: { online: 0, on: 0, warning: 0, error: 0 },
    alerts: [],
    devices: [],
    connection: { ha_connected: true, config_error: null }
  };
  await mockWebSocket(page, [model]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/`);

  await page.locator('summary').click();
  const option = page.locator('.show-ignored-option');
  await expect(option).toBeVisible();
  const box = await option.boundingBox();

  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});

test('ignores nested invalid devices before a later valid model', async ({ page }) => {
  const validModel = {
    title: '全屋设备状态',
    selected_room: '全部',
    rooms: ['全部'],
    stats: { online: 2, on: 1, warning: 1, error: 0 },
    alerts: [{
      entity_id: 'switch.alert',
      name: '告警设备',
      room: '客厅',
      status_label: '超时',
      status_color: 'orange',
      show_entity_id: false
    }],
    devices: [{
      entity_id: 'switch.visible',
      name: '正常设备',
      room: '客厅',
      status_label: '开启',
      status_color: 'green',
      show_entity_id: false
    }],
    connection: { ha_connected: true, config_error: null }
  };
  const invalidModel = { ...validModel, alerts: [null], devices: [null] };
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await mockWebSocket(page, [invalidModel, validModel]);
  await page.goto(`${baseUrl}/`);

  await expect(page.locator('#devices')).toContainText('正常设备');
  await expect(page.locator('#alerts')).toContainText('告警设备');
  expect(pageErrors).toEqual([]);
});

test('keeps a long status label inside its device card', async ({ page }) => {
  const model = {
    title: '全屋设备状态',
    selected_room: '全部',
    rooms: ['全部'],
    stats: { online: 1, on: 0, warning: 0, error: 0 },
    alerts: [],
    devices: [{
      entity_id: 'switch.long_status',
      name: '状态文本设备',
      room: '客厅',
      status_label: 'X'.repeat(520),
      status_color: '',
      show_entity_id: false
    }],
    connection: { ha_connected: true, config_error: null }
  };
  await mockWebSocket(page, [model]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/`);

  const status = page.locator('.device-status');
  await expect(status).toBeVisible();
  await expect(status).toHaveCSS('overflow-x', 'hidden');
  await expect(status).toHaveCSS('text-overflow', 'ellipsis');
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
});

test('wraps long dynamic titles and configuration errors on mobile', async ({ page }) => {
  const longText = 'X'.repeat(1000);
  const model = {
    title: longText,
    selected_room: '全部',
    rooms: ['全部'],
    stats: { online: 0, on: 0, warning: 0, error: 0 },
    alerts: [],
    devices: [],
    connection: { ha_connected: true, config_error: longText }
  };
  await mockWebSocket(page, [model]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/`);

  await expect(page.locator('#title')).toHaveText(longText);
  await expect(page.locator('#connection')).toHaveText(`配置错误：${longText}`);
  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.viewportWidth);
});

test('uses the root socket when index.html is loaded directly', async ({ page }) => {
  await page.goto(`${baseUrl}/index.html`);

  await expect(page.locator('#stat-online')).toHaveText(/[1-9]\d*/);
});

test('keeps the dashboard cards within the mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/`);

  await expect(page.locator('.stat').first()).toBeVisible();
  await expect(page.locator('#rooms button').first()).toBeVisible();
  const card = page.locator('#devices .device-card').first();
  await expect(card).toBeVisible();
  expect((await card.boundingBox()).width).toBeLessThanOrEqual(354);
  expect(await page.evaluate(() => {
    const columnCount = (selector) => (
      getComputedStyle(document.querySelector(selector)).gridTemplateColumns
        .trim().split(/\s+/).filter(Boolean).length
    );
    return { stats: columnCount('.stats'), cards: columnCount('.cards') };
  })).toEqual({ stats: 2, cards: 1 });
});
