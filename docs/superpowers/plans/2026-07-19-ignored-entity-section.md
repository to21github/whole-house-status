# 已忽略实体独立卡片区 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 勾选显示已忽略实体后，将当前房间的已忽略卡片独立放在未忽略异常卡片之前，避免两类异常混合。

**Architecture:** 在 `index.html` 增加一个无标题、默认隐藏的 `#ignored` 卡片容器和条件分隔线。`app.js` 在房间过滤后基于 `effectiveIgnored` 将 `alerts` 与 `devices` 分成已忽略、未忽略异常与未忽略普通设备三组，复用既有卡片渲染和实体忽略动作。

**Tech Stack:** HTML、JavaScript、Node.js、Playwright。

---

### Task 1: Add a failing ignored-section regression test

**Files:**
- Modify: `whole_house_status/test/frontend.spec.js` by adding a test after `shows ignored entities only when the display option is enabled`.
- Modify: `whole_house_status/test/frontend.spec.js` in the dashboard-ignore and externally-ignored tests to locate shown ignored cards in `#ignored`.

- [ ] **Step 1: Write the failing test**

Add a test named `separates ignored cards from unignored alerts in the selected room` with this model and assertions:

```js
test('separates ignored cards from unignored alerts in the selected room', async ({ page }) => {
  const model = {
    title: '全屋设备状态',
    selected_room: '全部',
    rooms: ['全部', '客厅', '主卧'],
    stats: { online: 2, on: 0, warning: 1, error: 1 },
    alerts: [{
      entity_id: 'switch.ignored_living_alert',
      name: '客厅已忽略离线开关', room: '客厅', status_label: '离线', status_color: 'red',
      ignored: true, show_entity_id: false
    }, {
      entity_id: 'switch.living_alert',
      name: '客厅高功率开关', room: '客厅', status_label: '高功率', status_color: 'orange',
      ignored: false, show_entity_id: false
    }, {
      entity_id: 'switch.ignored_bedroom_alert',
      name: '主卧已忽略离线开关', room: '主卧', status_label: '离线', status_color: 'red',
      ignored: true, show_entity_id: false
    }],
    devices: [{
      entity_id: 'light.ignored_living',
      name: '客厅已忽略灯', room: '客厅', status_label: '在线', status_color: '',
      ignored: true, show_entity_id: false
    }, {
      entity_id: 'light.living',
      name: '客厅可见灯', room: '客厅', status_label: '在线', status_color: '',
      ignored: false, show_entity_id: false
    }, {
      entity_id: 'light.bedroom',
      name: '主卧可见灯', room: '主卧', status_label: '在线', status_color: '',
      ignored: false, show_entity_id: false
    }],
    connection: { ha_connected: true, config_error: null }
  };
  await page.addInitScript(() => localStorage.removeItem('whole-house-status-show-ignored'));
  await mockWebSocket(page, [model]);
  await page.goto(`${baseUrl}/`);

  const ignored = page.locator('#ignored');
  const ignoredDivider = page.locator('#ignored-divider');
  await expect(ignored).toBeHidden();
  await expect(ignoredDivider).toBeHidden();

  await page.locator('.display-menu summary').click();
  await page.getByLabel('显示已忽略的实体').check();
  await expect(ignored).toContainText('客厅已忽略离线开关');
  await expect(ignored).toContainText('客厅已忽略灯');
  await expect(ignored).toContainText('主卧已忽略离线开关');
  await expect(page.locator('#alerts')).toContainText('客厅高功率开关');
  await expect(page.locator('#alerts')).not.toContainText('客厅已忽略离线开关');
  await expect(page.locator('#devices')).toContainText('客厅可见灯');
  await expect(page.locator('#devices')).not.toContainText('客厅已忽略灯');
  await expect(ignoredDivider).toBeVisible();

  await page.getByRole('button', { name: '客厅', exact: true }).click();
  await expect(ignored).toContainText('客厅已忽略离线开关');
  await expect(ignored).toContainText('客厅已忽略灯');
  await expect(ignored).not.toContainText('主卧已忽略离线开关');
  await expect(page.locator('#alerts')).toContainText('客厅高功率开关');
  await expect(page.locator('#devices')).toContainText('客厅可见灯');
  await expect(page.locator('#devices')).not.toContainText('主卧可见灯');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd whole_house_status && npx playwright test test/frontend.spec.js -g "separates ignored cards from unignored alerts"`

Expected: FAIL because `#ignored` and `#ignored-divider` do not exist and ignored alert cards are currently rendered inside `#alerts`.

- [ ] **Step 3: Update existing ignored-card location expectations**

In `immediately hides and restores dashboard ignored cards without a Home Assistant command`, replace:

```js
  const ignoredCard = page.locator('#devices .device-card', { hasText: '可见开关' });
```

with:

```js
  const ignoredCard = page.locator('#ignored .device-card', { hasText: '可见开关' });
```

In `does not offer dashboard restore controls for externally ignored cards`, replace:

```js
  const card = page.locator('#devices .device-card', { hasText: '配置忽略开关' });
```

with:

```js
  const card = page.locator('#ignored .device-card', { hasText: '配置忽略开关' });
```

These assertions must fail before the implementation because `#ignored` does not yet exist.

- [ ] **Step 4: Update the display-toggle test expectations**

In `shows ignored entities only when the display option is enabled`, replace the post-check assertions:

```js
  await expect(page.locator('#alerts')).toContainText('已忽略离线开关');
  await expect(page.locator('#alerts')).toContainText('已忽略');
```

with:

```js
  await expect(page.locator('#ignored')).toContainText('已忽略离线开关');
  await expect(page.locator('#ignored')).toContainText('已忽略');
  await expect(page.locator('#alerts')).not.toContainText('已忽略离线开关');
```

Replace its final assertion with:

```js
  await expect(page.locator('#ignored')).toBeHidden();
```

This preserves the original toggle behavior test while asserting the new section boundary.

### Task 2: Add the conditional ignored card container

**Files:**
- Modify: `whole_house_status/public/index.html:39-48` to add the ignored card container before the existing alerts section.
- Modify: `whole_house_status/public/app.js:32-42` and `whole_house_status/public/app.js:192-240` to partition the three card lists and render the conditional section.

- [ ] **Step 1: Add the no-title markup**

Insert the following immediately before the current `#alerts` section:

```html
      <section id="ignored" class="cards" aria-label="已忽略的实体" hidden></section>
      <hr id="ignored-divider" class="divider" hidden>
```

- [ ] **Step 2: Add the DOM references**

Add these entries to the `elements` object:

```js
    ignored: document.getElementById('ignored'),
    ignoredDivider: document.getElementById('ignored-divider'),
```

- [ ] **Step 3: Partition and render cards after room filtering**

Replace the current `isVisibleInSelectedRoom`, `visibleAlerts`, and `visibleDevices` declarations with:

```js
    const isInSelectedRoom = (device) => (
      state.selectedRoom === '全部' || device.room === state.selectedRoom
    );
    const ignoredDevices = state.showIgnored
      ? [...alerts, ...devices].filter((device) => (
        isInSelectedRoom(device) && effectiveIgnored(device)
      ))
      : [];
    const visibleAlerts = alerts.filter((device) => (
      isInSelectedRoom(device) && !effectiveIgnored(device)
    ));
    const visibleDevices = devices.filter((device) => (
      isInSelectedRoom(device) && !effectiveIgnored(device)
    ));
```

Immediately before rendering `visibleAlerts`, render and toggle the ignored section:

```js
    const hasIgnoredDevices = ignoredDevices.length > 0;
    elements.ignored.hidden = !hasIgnoredDevices;
    elements.ignoredDivider.hidden = !hasIgnoredDevices;
    renderCards(elements.ignored, ignoredDevices, false, setDashboardEntityIgnored);
```

Keep the existing `renderCards(elements.alerts, visibleAlerts, true, setDashboardEntityIgnored);` call so it receives only unignored alert cards.

- [ ] **Step 4: Run the focused frontend test**

Run: `cd whole_house_status && npx playwright test test/frontend.spec.js -g "separates ignored cards from unignored alerts"`

Expected: PASS; ignored cards appear only in the no-title section when enabled, and room selection filters all three sections.

### Task 3: Verify and commit the implementation

**Files:**
- No release metadata changes. Bump the Add-on version only after the user requests a release.

- [ ] **Step 1: Run full verification**

Run: `cd whole_house_status && npm run verify`

Expected: all unit tests and all Playwright frontend tests pass with zero failures.

- [ ] **Step 2: Inspect final changes**

Run: `git diff --check && git status --short && git diff --stat`

Expected: only `whole_house_status/public/index.html`, `whole_house_status/public/app.js`, and `whole_house_status/test/frontend.spec.js` are tracked implementation changes.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git add whole_house_status/public/index.html whole_house_status/public/app.js whole_house_status/test/frontend.spec.js
git commit -m "feat: separate ignored entity cards"
```

Expected: one commit containing the conditional ignored entity card section and its Playwright regression test.
