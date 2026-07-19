# 已忽略实体独立卡片区 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 勾选显示已忽略实体时，将当前房间的所有已忽略卡片放在未忽略异常卡片前的无标题独立区域，避免两类卡片混合。

**Architecture:** 增加一个条件显示的 `#ignored` cards 容器及其后分隔线。前端在应用房间筛选后，用 `effectiveIgnored` 将 alerts 与 devices 分别划分为已忽略和未忽略数据；已忽略数据合并渲染进新容器，已有异常和普通设备容器只渲染未忽略数据。

**Tech Stack:** HTML、JavaScript、Node.js、Playwright。

---

### Task 1: Add a failing separation regression test

**Files:**
- Modify: `whole_house_status/test/frontend.spec.js` after the existing `shows ignored entities only when the display option is enabled` test.

- [ ] **Step 1: Write the failing test**

Add a Playwright test named `separates ignored entities from unignored alerts and devices in the selected room` with this model and assertions:

```js
  const model = {
    title: '全屋设备状态',
    selected_room: '全部',
    rooms: ['全部', '客厅', '卧室'],
    stats: { online: 2, on: 0, warning: 1, error: 1 },
    alerts: [{
      entity_id: 'switch.ignored_offline',
      name: '已忽略离线开关',
      room: '客厅',
      status_label: '离线',
      status_color: 'red',
      ignored: true,
      show_entity_id: false
    }, {
      entity_id: 'switch.visible_warning',
      name: '未忽略高功率开关',
      room: '客厅',
      status_label: '高功率',
      status_color: 'orange',
      ignored: false,
      show_entity_id: false
    }, {
      entity_id: 'switch.other_room_ignored',
      name: '卧室已忽略开关',
      room: '卧室',
      status_label: '离线',
      status_color: 'red',
      ignored: true,
      show_entity_id: false
    }],
    devices: [{
      entity_id: 'light.ignored',
      name: '已忽略客厅灯',
      room: '客厅',
      status_label: '在线',
      status_color: '',
      ignored: true,
      show_entity_id: false
    }, {
      entity_id: 'light.visible',
      name: '未忽略客厅灯',
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

  const ignored = page.locator('#ignored');
  const ignoredDivider = page.locator('#ignored-divider');
  await expect(ignored).toBeHidden();
  await expect(ignoredDivider).toBeHidden();
  await expect(page.locator('#alerts')).toContainText('未忽略高功率开关');
  await expect(page.locator('#alerts')).not.toContainText('已忽略离线开关');

  await page.locator('.display-menu summary').click();
  await page.getByLabel('显示已忽略的实体').check();
  await page.getByRole('button', { name: '客厅', exact: true }).click();

  await expect(ignored).toBeVisible();
  await expect(ignoredDivider).toBeVisible();
  await expect(ignored).toContainText('已忽略离线开关');
  await expect(ignored).toContainText('已忽略客厅灯');
  await expect(ignored).not.toContainText('卧室已忽略开关');
  await expect(page.locator('#alerts')).toContainText('未忽略高功率开关');
  await expect(page.locator('#alerts')).not.toContainText('已忽略离线开关');
  await expect(page.locator('#devices')).toContainText('未忽略客厅灯');
  await expect(page.locator('#devices')).not.toContainText('已忽略客厅灯');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd whole_house_status && npx playwright test test/frontend.spec.js -g "separates ignored entities"`

Expected: FAIL because `#ignored` does not exist and ignored cards are still rendered in `#alerts` or `#devices`.

- [ ] **Step 3: Update existing ignored-card container assertions**

In `shows ignored entities only when the display option is enabled`, replace the post-check assertions with:

```js
  await expect(page.locator('#ignored')).toContainText('已忽略离线开关');
  await expect(page.locator('#ignored')).toContainText('已忽略');
  await expect(page.locator('#alerts')).not.toContainText('已忽略离线开关');
```

Replace the final ignored-card assertion with:

```js
  await expect(page.locator('#ignored')).toBeHidden();
```

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

These updated assertions must fail before the new section is implemented.

### Task 2: Add the conditional ignored-entity card section

**Files:**
- Modify: `whole_house_status/public/index.html:43-46` to add the empty ignored container above alerts.
- Modify: `whole_house_status/public/app.js:32-42` and `whole_house_status/public/app.js:192-240` to split and render card groups.
- Test: `whole_house_status/test/frontend.spec.js`.

- [ ] **Step 1: Add the new page elements**

Replace the first cards section after the filter bar with:

```html
      <hr class="divider">
      <section id="ignored" class="cards" aria-label="已忽略的实体" hidden></section>
      <hr id="ignored-divider" class="divider" hidden>
      <section id="alerts" class="cards alerts" aria-label="异常设备"></section>
```

- [ ] **Step 2: Add ignored container references**

Extend `elements` with:

```js
    ignored: document.getElementById('ignored'),
    ignoredDivider: document.getElementById('ignored-divider'),
```

- [ ] **Step 3: Split visible devices in render**

Replace the shared `isVisibleInSelectedRoom`, `visibleAlerts`, and `visibleDevices` declarations with:

```js
    const isInSelectedRoom = (device) => (
      state.selectedRoom === '全部' || device.room === state.selectedRoom
    );
    const selectedAlerts = alerts.filter(isInSelectedRoom);
    const selectedDevices = devices.filter(isInSelectedRoom);
    const isIgnored = (device) => effectiveIgnored(device);
    const ignoredDevices = state.showIgnored
      ? [...selectedAlerts.filter(isIgnored), ...selectedDevices.filter(isIgnored)]
      : [];
    const visibleAlerts = selectedAlerts.filter((device) => !isIgnored(device));
    const visibleDevices = selectedDevices.filter((device) => !isIgnored(device));
```

- [ ] **Step 4: Render and hide the ignored section**

Before rendering alerts, add:

```js
    const hasIgnoredDevices = ignoredDevices.length > 0;
    elements.ignored.hidden = !hasIgnoredDevices;
    elements.ignoredDivider.hidden = !hasIgnoredDevices;
    renderCards(elements.ignored, ignoredDevices, false, setDashboardEntityIgnored);
```

Keep the existing `renderCards(elements.alerts, visibleAlerts, true, setDashboardEntityIgnored)` call so alerts and normal cards contain only unignored entities.

- [ ] **Step 5: Run the focused frontend test**

Run: `cd whole_house_status && npx playwright test test/frontend.spec.js -g "separates ignored entities"`

Expected: PASS, with room-scoped ignored cards visible only in `#ignored` after the display option is checked.

### Task 3: Verify and publish the implementation

**Files:**
- Modify: `whole_house_status/config.yaml`, `whole_house_status/CHANGELOG.md`, and `whole_house_status/test/repositoryLayout.test.js` for Add-on version `0.1.16`.

- [ ] **Step 1: Run the full test suite**

Run: `cd whole_house_status && npm run verify`

Expected: all unit tests and all Playwright tests pass with zero failures.

- [ ] **Step 2: Inspect the implementation diff**

Run: `git diff --check && git status --short && git diff --stat`

Expected: the HTML, frontend JavaScript, and frontend test changes are present; no generated test output is staged.

- [ ] **Step 3: Commit the implementation**

Run:

```bash
git add whole_house_status/public/index.html whole_house_status/public/app.js whole_house_status/test/frontend.spec.js
git commit -m "feat: separate ignored entity cards"
```

Expected: one implementation commit.

- [ ] **Step 4: Release version 0.1.16**

Set the manifest and repository-layout assertion to `0.1.16`, prepend this changelog entry, then verify, commit, and push:

```markdown
## 0.1.16

- Separate ignored entity cards from active warnings and errors.
```

Run:

```bash
cd whole_house_status && npm run verify
cd ..
git add whole_house_status/config.yaml whole_house_status/CHANGELOG.md whole_house_status/test/repositoryLayout.test.js
git commit -m "chore: release addon version 0.1.16"
git push origin main
```

Expected: `origin/main` contains the `0.1.16` manifest and changelog entry.
