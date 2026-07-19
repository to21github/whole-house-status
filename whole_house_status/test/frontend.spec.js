const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const dashboardUrl = pathToFileURL(path.join(__dirname, '../public/index.html')).href;

function model(overrides = {}) {
  return {
    title: '测试状态',
    rooms: ['全部', '客厅', '厨房', '未分组'],
    selected_room: '全部',
    stats: { online: 2, on: 1, warning: 0, error: 0 },
    alerts: [],
    devices: [
      {
        entity_id: 'switch.living_room',
        name: '客厅开关',
        room: '客厅',
        status_label: '在线',
        status_color: 'green',
        show_entity_id: false
      },
      {
        entity_id: 'switch.kitchen',
        name: '厨房开关',
        room: '厨房',
        status_label: '开启',
        status_color: 'green',
        show_entity_id: false
      }
    ],
    connection: { ha_connected: true, config_error: null },
    ...overrides
  };
}

async function openDashboard(page, response = model()) {
  await page.addInitScript(() => {
    class MockWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;

      constructor() {
        super();
        this.readyState = MockWebSocket.OPEN;
        window.__mockSockets = window.__mockSockets || [];
        window.__mockSockets.push(this);
      }

      send(message) {
        window.__socketMessages = window.__socketMessages || [];
        window.__socketMessages.push(JSON.parse(message));
      }

      close() {
        this.readyState = 3;
        this.dispatchEvent(new Event('close'));
      }

      receive(message) {
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
      }
    }

    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      value: MockWebSocket
    });
  });

  await page.goto(dashboardUrl);
  await page.evaluate((payload) => window.__mockSockets[0].receive(payload), response);
}

async function dragRoomWithMouse(page, fromRoom, toRoom) {
  const source = page.locator('.room-button', { hasText: fromRoom });
  const target = page.locator('.room-button', { hasText: toRoom });
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
  await page.mouse.up();
}

async function dragRoomWithTouch(page, fromRoom, toRoom) {
  await page.evaluate(({ fromRoom: from, toRoom: to }) => {
    const source = [...document.querySelectorAll('.room-button')].find((button) => button.textContent === from);
    const target = [...document.querySelectorAll('.room-button')].find((button) => button.textContent === to);
    const sourceBox = source.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    const pointerId = 21;
    source.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId,
      pointerType: 'touch',
      isPrimary: true,
      clientX: sourceBox.x + sourceBox.width / 2,
      clientY: sourceBox.y + sourceBox.height / 2
    }));
    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      pointerId,
      pointerType: 'touch',
      clientX: targetBox.x + targetBox.width / 2,
      clientY: targetBox.y + targetBox.height / 2
    }));
    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      pointerId,
      pointerType: 'touch',
      clientX: targetBox.x + targetBox.width / 2,
      clientY: targetBox.y + targetBox.height / 2
    }));
  }, { fromRoom, toRoom });
}

async function sentMessages(page) {
  return page.evaluate(() => window.__socketMessages || []);
}

async function displayMenuFitsViewport(page) {
  return page.locator('.show-ignored-option').evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const padding = 12;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    return (
      bounds.left >= padding
      && bounds.right <= viewportWidth - padding
      && bounds.top >= padding
      && bounds.bottom <= viewportHeight - padding
    );
  });
}

const mobileRooms = ['全部', '门口', '餐桌', '厨房', '客厅', '卫生间', '主卧', '次卧', '儿童房', '未分组'];

test('mouse drag sends the complete reordered room list and disables controls while pending', async ({ page }) => {
  await openDashboard(page);
  await page.getByRole('button', { name: '排序房间' }).click();

  await dragRoomWithMouse(page, '客厅', '厨房');

  await expect.poll(() => sentMessages(page)).toEqual([
    { type: 'set_room_order', rooms: ['全部', '厨房', '客厅', '未分组'] }
  ]);
  await expect(page.getByRole('button', { name: '全部' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '排序房间' })).toBeDisabled();
});

test('touch Pointer Events send the complete reordered room list', async ({ page }) => {
  await openDashboard(page);
  await page.getByRole('button', { name: '排序房间' }).click();

  await dragRoomWithTouch(page, '客厅', '厨房');

  await expect.poll(() => sentMessages(page)).toEqual([
    { type: 'set_room_order', rooms: ['全部', '厨房', '客厅', '未分组'] }
  ]);
});

test('a cancelled touch drag restores the draft without saving', async ({ page }) => {
  await openDashboard(page);
  await page.getByRole('button', { name: '排序房间' }).click();

  await page.evaluate(() => {
    const source = [...document.querySelectorAll('.room-button')].find((button) => button.textContent === '客厅');
    const target = [...document.querySelectorAll('.room-button')].find((button) => button.textContent === '厨房');
    const sourceBox = source.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    const pointerId = 22;
    source.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId,
      pointerType: 'touch',
      isPrimary: true,
      clientX: sourceBox.x + sourceBox.width / 2,
      clientY: sourceBox.y + sourceBox.height / 2
    }));
    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      pointerId,
      pointerType: 'touch',
      clientX: targetBox.x + targetBox.width / 2,
      clientY: targetBox.y + targetBox.height / 2
    }));
    window.dispatchEvent(new PointerEvent('pointercancel', {
      bubbles: true,
      pointerId,
      pointerType: 'touch'
    }));
  });

  await expect.poll(() => sentMessages(page)).toEqual([]);
  await expect(page.locator('.room-button')).toHaveText(['全部', '客厅', '厨房', '未分组']);
  await expect(page.locator('#rooms')).toHaveClass(/sorting/);
  await expect(page.getByRole('button', { name: '排序房间' })).toBeEnabled();
});

test('Alt+Arrow reorders the focused room and saves through the pending flow', async ({ page }) => {
  await openDashboard(page);
  await page.getByRole('button', { name: '排序房间' }).click();
  const livingRoom = page.getByRole('button', { name: '客厅' });

  await expect(livingRoom).toHaveAttribute('aria-description', '按 Alt 加方向键调整顺序');
  await livingRoom.focus();
  await page.keyboard.press('Alt+ArrowRight');

  await expect.poll(() => sentMessages(page)).toEqual([
    { type: 'set_room_order', rooms: ['全部', '厨房', '客厅', '未分组'] }
  ]);
  await expect(page.getByRole('button', { name: '排序房间' })).toBeDisabled();
});

test('a non-primary pointer cannot replace the active room drag', async ({ page }) => {
  await openDashboard(page);
  await page.getByRole('button', { name: '排序房间' }).click();

  await page.evaluate(() => {
    const livingRoom = [...document.querySelectorAll('.room-button')].find((button) => button.textContent === '客厅');
    const kitchen = [...document.querySelectorAll('.room-button')].find((button) => button.textContent === '厨房');
    const livingBox = livingRoom.getBoundingClientRect();
    const kitchenBox = kitchen.getBoundingClientRect();
    const primaryPointerId = 31;
    const secondaryPointerId = 32;
    livingRoom.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: primaryPointerId,
      pointerType: 'touch',
      isPrimary: true,
      clientX: livingBox.x + livingBox.width / 2,
      clientY: livingBox.y + livingBox.height / 2
    }));
    kitchen.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: secondaryPointerId,
      pointerType: 'touch',
      isPrimary: false,
      clientX: kitchenBox.x + kitchenBox.width / 2,
      clientY: kitchenBox.y + kitchenBox.height / 2
    }));
    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: secondaryPointerId,
      pointerType: 'touch',
      clientX: livingBox.x + livingBox.width / 2,
      clientY: livingBox.y + livingBox.height / 2
    }));
    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: secondaryPointerId,
      pointerType: 'touch'
    }));
    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: primaryPointerId,
      pointerType: 'touch',
      clientX: kitchenBox.x + kitchenBox.width / 2,
      clientY: kitchenBox.y + kitchenBox.height / 2
    }));
    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: primaryPointerId,
      pointerType: 'touch'
    }));
  });

  await expect.poll(() => sentMessages(page)).toEqual([
    { type: 'set_room_order', rooms: ['全部', '厨房', '客厅', '未分组'] }
  ]);
});

test('sort mode fixes the all and ungrouped sentinels', async ({ page }) => {
  await openDashboard(page);
  await page.getByRole('button', { name: '排序房间' }).click();

  await expect(page.locator('#rooms')).toHaveClass(/sorting/);
  await expect(page.getByRole('button', { name: '全部' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '未分组' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '客厅' })).toBeEnabled();
});

test('normal room clicks filter device cards', async ({ page }) => {
  await openDashboard(page);

  await page.getByRole('button', { name: '厨房' }).click();

  await expect(page.locator('#devices')).toContainText('厨房开关');
  await expect(page.locator('#devices')).not.toContainText('客厅开关');
});

test('a successful room order exits sort mode before the next model', async ({ page }) => {
  await openDashboard(page);
  await page.getByRole('button', { name: '排序房间' }).click();
  await dragRoomWithMouse(page, '客厅', '厨房');

  await page.evaluate(() => window.__mockSockets[0].receive({
    type: 'room_order_result',
    success: true
  }));

  await expect(page.locator('#rooms')).not.toHaveClass(/sorting/);
  await expect(page.getByRole('button', { name: '排序房间' })).toBeEnabled();
  await expect(page.locator('#connection')).toBeHidden();
});

test('a rejected room order restores the model and fits the mobile filter bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page);
  await page.getByRole('button', { name: '排序房间' }).click();
  await dragRoomWithMouse(page, '客厅', '厨房');

  await page.evaluate(() => window.__mockSockets[0].receive({
    type: 'room_order_result',
    error: '保存失败'
  }));

  await expect(page.locator('#rooms')).not.toHaveClass(/sorting/);
  await expect(page.locator('.room-button')).toHaveText(['全部', '客厅', '厨房', '未分组']);
  await expect(page.locator('#connection')).toContainText('房间排序失败：保存失败');
  await expect(page.getByRole('button', { name: '排序房间' })).toBeEnabled();
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);

  const lastRoom = await page.getByRole('button', { name: '未分组' }).boundingBox();
  const orderControl = await page.getByRole('button', { name: '排序房间' }).boundingBox();
  expect(orderControl.y).toBeGreaterThanOrEqual(lastRoom.y);
});

test('mobile room controls stay grouped after the final room button', async ({ page }) => {
  await page.setViewportSize({ width: 353, height: 760 });
  await openDashboard(page, model({ rooms: mobileRooms }));

  const ungroupedBox = await page.getByRole('button', { name: '未分组' }).boundingBox();
  const orderBox = await page.getByRole('button', { name: '排序房间' }).boundingBox();
  const displayBox = await page.locator('.display-menu summary').boundingBox();

  expect(orderBox.y).toBe(ungroupedBox.y);
  expect(displayBox.y).toBe(orderBox.y);
  expect(displayBox.x - (orderBox.x + orderBox.width)).toBeLessThanOrEqual(12);
});

test('mobile display menu remains within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 353, height: 760 });
  await openDashboard(page, model({ rooms: mobileRooms }));

  await page.locator('.display-menu summary').click();
  await expect.poll(() => displayMenuFitsViewport(page)).toBe(true);
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
});

test('mobile display menu adapts when controls are at the left edge', async ({ page }) => {
  await page.setViewportSize({ width: 353, height: 760 });
  await openDashboard(page, model({ rooms: ['全部', '未分组'] }));

  await page.locator('.display-menu summary').click();
  await expect.poll(() => displayMenuFitsViewport(page)).toBe(true);
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
});

test('mobile display menu opens above controls when the viewport is short', async ({ page }) => {
  await page.setViewportSize({ width: 353, height: 400 });
  await openDashboard(page, model({ rooms: ['全部', '未分组'] }));

  await page.locator('.display-menu summary').click();
  await expect.poll(() => displayMenuFitsViewport(page)).toBe(true);
});

test('desktop display menu respects the usable viewport beside a scrollbar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openDashboard(page);
  await page.evaluate(() => {
    Object.defineProperty(document.documentElement, 'clientWidth', {
      configurable: true,
      value: window.innerWidth - 15
    });
  });

  await page.locator('.display-menu summary').click();
  await expect.poll(() => displayMenuFitsViewport(page)).toBe(true);
});

test('a socket close while saving a room order restores filtering controls', async ({ page }) => {
  await openDashboard(page);
  await page.getByRole('button', { name: '排序房间' }).click();
  await dragRoomWithMouse(page, '客厅', '厨房');

  await page.evaluate(() => window.__mockSockets[0].close());

  await expect(page.locator('#rooms')).not.toHaveClass(/sorting/);
  await expect(page.getByRole('button', { name: '全部' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '排序房间' })).toBeEnabled();
  await expect(page.locator('#connection')).toContainText('房间排序失败：HA WebSocket 已断开');
});
