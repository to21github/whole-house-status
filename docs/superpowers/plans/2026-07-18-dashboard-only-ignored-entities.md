# Dashboard-Only Ignored Entities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, dashboard-only entity ignore list with card actions that never change Home Assistant's entity registry.

**Architecture:** A focused `IgnoredEntityStore` owns the Add-on's `/data/ignored-entities.json` file. `server.js` exposes it through a browser WebSocket command and passes its IDs into `buildViewModel`; the view model distinguishes dashboard-owned ignores from HA/configured exclusions. The browser optimistically filters dashboard-owned ignores, then reconciles from server snapshots and result messages.

**Tech Stack:** Node.js CommonJS, `node:test`, `ws`, browser JavaScript/CSS, Playwright.

---

## File Structure

- Create: `whole_house_status/src/ignoredEntityStore.js` - validates, loads, and atomically persists the Add-on-owned entity-ID set.
- Create: `whole_house_status/test/ignoredEntityStore.test.js` - unit tests for the persistent store.
- Modify: `whole_house_status/src/viewModel.js` - adds dashboard ignore ownership to device payloads and keeps statistics correct.
- Modify: `whole_house_status/test/viewModel.test.js` - verifies dashboard and external ignore sources.
- Modify: `whole_house_status/src/server.js` - replaces HA registry writes with Add-on store updates and browser results.
- Modify: `whole_house_status/src/haClient.js` - removes the no-longer-authorized registry-update method.
- Modify: `whole_house_status/test/server.test.js` - verifies persistence, broadcasts, validation, and no HA mutation.
- Modify: `whole_house_status/test/haClient.test.js` - removes the obsolete HA registry-update expectation.
- Modify: `whole_house_status/public/app.js` - sends dashboard-only commands, handles optimistic visibility, and shows actionable card controls.
- Modify: `whole_house_status/public/styles.css` - retains the compact upper-right card action and reserves title space.
- Modify: `whole_house_status/public/index.html` - retains the exact menu label `显示已忽略的实体`.
- Modify: `whole_house_status/test/frontend.spec.js` - verifies card actions, immediate filtering, restoration, and command names.
- Modify: `whole_house_status/config.yaml` and `whole_house_status/CHANGELOG.md` - release version `0.1.7` and describe the changed ownership behavior.

### Task 1: Persisted Dashboard Ignore Store

**Files:**
- Create: `whole_house_status/src/ignoredEntityStore.js`
- Test: `whole_house_status/test/ignoredEntityStore.test.js`

- [ ] **Step 1: Write failing store tests for validation, reload, and failed writes**

```js
test('IgnoredEntityStore persists only valid entity IDs and restores them on reload', (t) => {
  const filePath = path.join(createTempDirectory(t), 'ignored-entities.json');
  const store = new IgnoredEntityStore({ filePath, logger: { warn() {} } });

  assert.equal(store.setIgnored('switch.desk', true), true);
  assert.equal(store.setIgnored('bad entity id', true), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), ['switch.desk']);

  const restored = new IgnoredEntityStore({ filePath, logger: { warn() {} } });
  assert.equal(restored.has('switch.desk'), true);
});

test('IgnoredEntityStore ignores malformed persisted data and warns', (t) => {
  const filePath = path.join(createTempDirectory(t), 'ignored-entities.json');
  fs.writeFileSync(filePath, '{');
  const warnings = [];

  const store = new IgnoredEntityStore({ filePath, logger: { warn: (message) => warnings.push(message) } });

  assert.deepEqual([...store.getEntityIds()], []);
  assert.equal(warnings.length, 1);
});

test('IgnoredEntityStore preserves its previous set when persistence fails', (t) => {
  const directory = createTempDirectory(t);
  const parentFile = path.join(directory, 'not-a-directory');
  fs.writeFileSync(parentFile, 'block writes');
  const store = new IgnoredEntityStore({
    filePath: path.join(parentFile, 'ignored-entities.json'),
    logger: { warn() {} }
  });

  assert.throws(() => store.setIgnored('switch.desk', true));
  assert.equal(store.has('switch.desk'), false);
});
```

- [ ] **Step 2: Run the focused test to verify it fails because the module is absent**

Run: `node --test test/ignoredEntityStore.test.js`

Expected: FAIL with `Cannot find module '../src/ignoredEntityStore'`.

- [ ] **Step 3: Implement the minimal store with atomic replacement writes**

```js
const fs = require('node:fs');
const path = require('node:path');

const ENTITY_ID_PATTERN = /^[^.]+\.[^.]+$/;

function isEntityId(value) {
  return typeof value === 'string' && value === value.trim() && ENTITY_ID_PATTERN.test(value);
}

class IgnoredEntityStore {
  constructor({ filePath = process.env.IGNORED_ENTITIES_PATH || '/data/ignored-entities.json', logger = console } = {}) {
    this.filePath = filePath;
    this.logger = logger;
    this.entityIds = this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) return new Set();
    try {
      return new Set(JSON.parse(fs.readFileSync(this.filePath, 'utf8')).filter(isEntityId));
    } catch (error) {
      this.logger.warn(`Unable to load ignored entities from ${this.filePath}: ${error.message}`);
      return new Set();
    }
  }

  getEntityIds() {
    return new Set(this.entityIds);
  }

  has(entityId) {
    return this.entityIds.has(entityId);
  }

  setIgnored(entityId, ignored) {
    if (!isEntityId(entityId) || typeof ignored !== 'boolean') return false;
    const next = new Set(this.entityIds);
    ignored ? next.add(entityId) : next.delete(entityId);
    const temporaryPath = `${this.filePath}.tmp`;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(temporaryPath, `${JSON.stringify([...next].sort())}\n`, 'utf8');
    fs.renameSync(temporaryPath, this.filePath);
    this.entityIds = next;
    return true;
  }
}

module.exports = { IgnoredEntityStore, isEntityId };
```

- [ ] **Step 4: Run the focused store test to verify it passes**

Run: `node --test test/ignoredEntityStore.test.js`

Expected: PASS with all store tests passing.

- [ ] **Step 5: Commit the store implementation and tests**

```bash
git add whole_house_status/src/ignoredEntityStore.js whole_house_status/test/ignoredEntityStore.test.js
git commit -m "feat: persist dashboard ignored entities"
```

### Task 2: Represent Ignore Ownership in the View Model

**Files:**
- Modify: `whole_house_status/src/viewModel.js:29-61,125-145`
- Modify: `whole_house_status/test/viewModel.test.js:63-143`

- [ ] **Step 1: Write a failing view-model test for dashboard-owned ignores**

```js
test('buildViewModel marks dashboard ignored entities as restorable without changing external exclusions', () => {
  const options = normalizeOptions({
    entities: { include_domains: ['switch'], exclude_entities: ['switch.configured'] }
  });
  const model = buildViewModel({
    states: {
      'switch.dashboard': entity('switch.dashboard', 'off', '面板忽略'),
      'switch.configured': entity('switch.configured', 'off', '配置忽略')
    },
    registries: { entity: [], device: [], area: [] },
    dashboardIgnoredEntityIds: new Set(['switch.dashboard']),
    options,
    alertEngine: new AlertEngine(options),
    now: Date.now(),
    selectedRoom: '全部'
  });

  assert.deepEqual(model.devices.map(({ entity_id, ignored, dashboard_ignored }) => ({ entity_id, ignored, dashboard_ignored })), [
    { entity_id: 'switch.configured', ignored: true, dashboard_ignored: false },
    { entity_id: 'switch.dashboard', ignored: true, dashboard_ignored: true }
  ]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails on the missing ownership field**

Run: `node --test test/viewModel.test.js`

Expected: FAIL because `dashboard_ignored` is absent or `dashboardIgnoredEntityIds` is ignored.

- [ ] **Step 3: Add a single ignore-state helper and include it in each device**

```js
function getIgnoreState(entity, options, registryIndexes, dashboardIgnoredEntityIds) {
  const dashboard_ignored = dashboardIgnoredEntityIds.has(entity.entity_id);
  const registryEntity = registryIndexes.entityById[entity.entity_id];
  const externalIgnored = Boolean(registryEntity && registryEntity.hidden_by)
    || options.entities.exclude_entities.includes(entity.entity_id);
  return { ignored: dashboard_ignored || externalIgnored, dashboard_ignored };
}

// buildViewModel receives dashboardIgnoredEntityIds = new Set() and passes
// getIgnoreState(...) into createDevice.
function createDevice(entity, room, statusResult, options, ignoreState) {
  return {
    entity_id: entity.entity_id,
    name: friendlyName(entity),
    room,
    raw_state: entity.state,
    status: statusResult.status,
    status_label: statusResult.label,
    status_color: statusResult.color,
    reason: statusResult.reason,
    ignored: ignoreState.ignored,
    dashboard_ignored: ignoreState.dashboard_ignored,
    show_entity_id: options.display.show_entity_id
  };
}
```

- [ ] **Step 4: Run view-model tests to verify statistics still exclude both sources**

Run: `node --test test/viewModel.test.js`

Expected: PASS with all existing view-model tests plus the ownership test.

- [ ] **Step 5: Commit the view-model change**

```bash
git add whole_house_status/src/viewModel.js whole_house_status/test/viewModel.test.js
git commit -m "feat: identify dashboard ignored entities"
```

### Task 3: Replace HA Registry Writes With Add-on Commands

**Files:**
- Modify: `whole_house_status/src/server.js:93-228`
- Modify: `whole_house_status/src/haClient.js:168-178`
- Modify: `whole_house_status/test/server.test.js:252-322`
- Modify: `whole_house_status/test/haClient.test.js:80-102`

- [ ] **Step 1: Write a failing server test for a dashboard-only ignore request**

```js
function createTempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whole-house-status-ignored-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('browser dashboard-ignore requests persist locally and never update Home Assistant', async (t) => {
  const ignoredEntitiesPath = path.join(createTempDirectory(t), 'ignored-entities.json');
  const haClient = new EventEmitter();
  let registryUpdates = 0;
  haClient.connect = () => {};
  haClient.close = () => {};
  haClient.setEntityHidden = async () => { registryUpdates += 1; };
  const app = createServer({
    useMockData: false,
    ignoredEntitiesPath,
    haClientFactory: () => haClient,
    logger: { warn() {}, error() {} }
  });
  const port = await listen(app.server);
  let browser;
  t.after(async () => {
    if (browser) browser.terminate();
    await close(app.server);
  });

  haClient.emit('connection', true);
  haClient.emit('registries', { entity: [{ entity_id: 'switch.desk' }], device: [], area: [] });
  haClient.emit('states', [
    { entity_id: 'switch.desk', state: 'off', attributes: { friendly_name: 'Desk Switch' } }
  ]);

  const messages = await new Promise((resolve, reject) => {
    const received = [];
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for dashboard ignore result')), 1_000);
    browser = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    browser.on('error', reject);
    browser.on('message', (message) => {
      const payload = JSON.parse(message);
      received.push(payload);
      if (received.length === 1) {
        browser.send(JSON.stringify({
          type: 'set_dashboard_entity_ignored',
          entity_id: 'switch.desk',
          ignored: true
        }));
      }
      if (payload.type === 'dashboard_entity_ignored_result') {
        clearTimeout(timeout);
        browser.close();
        resolve(received);
      }
    });
  });

  assert.equal(registryUpdates, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(ignoredEntitiesPath, 'utf8')), ['switch.desk']);
  assert.ok(messages.some((payload) => (
    payload.devices && payload.devices.some((device) => (
      device.entity_id === 'switch.desk' && device.dashboard_ignored === true
    ))
  )));
});
```

- [ ] **Step 2: Run the focused server test to verify the new command is rejected**

Run: `node --test test/server.test.js`

Expected: FAIL by timing out waiting for `dashboard_entity_ignored_result`.

- [ ] **Step 3: Route the validated command through `IgnoredEntityStore`**

```js
const { IgnoredEntityStore, isEntityId } = require('./ignoredEntityStore');

// Add ignoredEntitiesPath and ignoredEntityStore optional createServer arguments.
const dashboardIgnoreStore = ignoredEntityStore || new IgnoredEntityStore({
  filePath: ignoredEntitiesPath,
  logger
});

function isDashboardIgnoreCommand(command) {
  return Boolean(command && command.type === 'set_dashboard_entity_ignored'
    && isEntityId(command.entity_id) && typeof command.ignored === 'boolean');
}

// snapshot passes dashboardIgnoreStore.getEntityIds() as dashboardIgnoredEntityIds.
// handleBrowserCommand calls dashboardIgnoreStore.setIgnored(), broadcasts on
// success, and sends { type: 'dashboard_entity_ignored_result', entity_id, ignored }.
// On a thrown write error, send the same result shape with error and do not broadcast.
```

Delete `updateEntityRegistry`, `isEntityHiddenCommand`, and the
`haClient.setEntityHidden` method/test. Do not call `config/entity_registry/update`
from any production path.

- [ ] **Step 4: Run server and HA-client tests to verify the command persists locally**

Run: `node --test test/server.test.js test/haClient.test.js`

Expected: PASS, including the local persistence assertion and no remaining test
expecting `config/entity_registry/update`.

- [ ] **Step 5: Commit the server command change**

```bash
git add whole_house_status/src/server.js whole_house_status/src/haClient.js whole_house_status/test/server.test.js whole_house_status/test/haClient.test.js
git commit -m "feat: keep entity ignores inside dashboard"
```

### Task 4: Reconcile Card Actions in the Browser

**Files:**
- Modify: `whole_house_status/public/app.js:22-300`
- Modify: `whole_house_status/public/styles.css:261-324`
- Modify: `whole_house_status/public/index.html:37-43`
- Modify: `whole_house_status/test/frontend.spec.js:281-374`

- [ ] **Step 1: Replace the existing action test with a failing dashboard-only interaction test**

```js
test('immediately hides and restores dashboard ignored cards without a Home Assistant command', async ({ page }) => {
  const visibleModel = {
    title: '全屋设备状态',
    selected_room: '全部',
    rooms: ['全部'],
    stats: { online: 1, on: 0, warning: 0, error: 0 },
    alerts: [],
    devices: [{
      entity_id: 'switch.visible', name: '可见开关', room: '客厅',
      status_label: '在线', status_color: '', ignored: false,
      dashboard_ignored: false, show_entity_id: false
    }],
    connection: { ha_connected: true, config_error: null }
  };
  const ignoredModel = {
    ...visibleModel,
    stats: { online: 0, on: 0, warning: 0, error: 0 },
    devices: [{ ...visibleModel.devices[0], ignored: true, dashboard_ignored: true }]
  };
  await page.addInitScript(() => localStorage.removeItem('whole-house-status-show-ignored'));
  await mockWebSocket(page, [visibleModel]);
  await page.goto(`${baseUrl}/`);

  await page.getByRole('button', { name: '忽略' }).click();
  await expect(page.locator('#devices')).not.toContainText('可见开关');
  await expect.poll(() => page.evaluate(() => window.__wholeHouseStatusMockSockets[0].sent)).toEqual([
    { type: 'set_dashboard_entity_ignored', entity_id: 'switch.visible', ignored: true }
  ]);

  await page.evaluate((model) => {
    window.__wholeHouseStatusMockSockets[0].dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify(model) })
    );
  }, ignoredModel);
  await page.getByText('显示', { exact: true }).click();
  await page.getByLabel('显示已忽略的实体').check();
  await expect(page.getByRole('button', { name: '不再忽略' })).toBeVisible();
  await page.getByRole('button', { name: '不再忽略' }).click();
  await expect.poll(() => page.evaluate(() => window.__wholeHouseStatusMockSockets[0].sent)).toEqual([
    { type: 'set_dashboard_entity_ignored', entity_id: 'switch.visible', ignored: true },
    { type: 'set_dashboard_entity_ignored', entity_id: 'switch.visible', ignored: false }
  ]);
  await page.evaluate((model) => {
    window.__wholeHouseStatusMockSockets[0].dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify(model) })
    );
  }, visibleModel);
  await page.getByLabel('显示已忽略的实体').uncheck();
  await expect(page.locator('#devices')).toContainText('可见开关');
});
```

- [ ] **Step 2: Run the focused Playwright test to verify it fails on the old command and non-optimistic rendering**

Run: `npx playwright test test/frontend.spec.js --grep "immediately hides and restores"`

Expected: FAIL because the browser sends `set_entity_hidden` and leaves the card visible.

- [ ] **Step 3: Rename the client state and render from optimistic dashboard changes**

```js
// State
pendingDashboardIgnoreChanges: new Map(),

function effectiveIgnored(device) {
  return state.pendingDashboardIgnoreChanges.has(device.entity_id)
    ? state.pendingDashboardIgnoreChanges.get(device.entity_id)
    : device.ignored;
}

function canToggleDashboardIgnore(device) {
  return !device.ignored || device.dashboard_ignored === true;
}

// The card action is shown only when canToggleDashboardIgnore(device) is true.
// It sends this exact browser message:
socket.send(JSON.stringify({
  type: 'set_dashboard_entity_ignored',
  entity_id: device.entity_id,
  ignored
}));
```

Use `effectiveIgnored(device)` in the room filter so an ignored card disappears
before the server broadcast. Handle `dashboard_entity_ignored_result`: clear the
pending map, show `实体操作失败：...` on an error, and render the last confirmed
model. Extend `isViewModel` to accept optional boolean `dashboard_ignored`.

Keep `.entity-ignore-action` absolutely positioned at the upper right with a
4px radius. Reserve title width with `padding-right` so long names do not
overlap the action. Leave the menu label exactly `显示已忽略的实体`.

- [ ] **Step 4: Run the focused Playwright interaction test**

Run: `npx playwright test test/frontend.spec.js --grep "immediately hides and restores"`

Expected: PASS, with the card disappearing immediately, the new command name,
and a visible `不再忽略` action after the ignored model arrives.

- [ ] **Step 5: Run all frontend tests and commit the browser changes**

Run: `npm run test:frontend`

Expected: PASS with all Playwright tests green.

```bash
git add whole_house_status/public/app.js whole_house_status/public/styles.css whole_house_status/public/index.html whole_house_status/test/frontend.spec.js
git commit -m "feat: manage ignored entities from dashboard cards"
```

### Task 5: Release and Verify the Add-on

**Files:**
- Modify: `whole_house_status/config.yaml:2`
- Modify: `whole_house_status/CHANGELOG.md:3`

- [ ] **Step 1: Add release expectations to the repository layout test**

```js
const config = fs.readFileSync(path.join(repositoryRoot, 'whole_house_status', 'config.yaml'), 'utf8');
const changelog = fs.readFileSync(path.join(repositoryRoot, 'whole_house_status', 'CHANGELOG.md'), 'utf8');
assert.match(config, /^version: "0\.1\.7"$/m);
assert.match(changelog, /^## 0\.1\.7$/m);
```

- [ ] **Step 2: Run the repository layout test and verify it fails on the old version**

Run: `node --test test/repositoryLayout.test.js`

Expected: FAIL because the Add-on is still `0.1.6`.

- [ ] **Step 3: Bump the release metadata and describe the user-visible behavior**

```yaml
# config.yaml
version: "0.1.7"
```

```markdown
## 0.1.7

- Add persistent dashboard-only entity ignore actions without changing Home Assistant visibility.
```

- [ ] **Step 4: Run the full verification suite**

Run: `npm run verify`

Expected: unit and Playwright test commands both exit `0`.

- [ ] **Step 5: Review the final diff and commit the release**

```bash
git diff --check
git status --short
git add whole_house_status/config.yaml whole_house_status/CHANGELOG.md whole_house_status/test/repositoryLayout.test.js
git commit -m "chore: release addon version 0.1.7"
```
