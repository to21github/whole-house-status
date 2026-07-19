# Runtime Room Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to drag room filter buttons in the running dashboard and persist the resulting order to Home Assistant's `rooms.order` option.

**Architecture:** Keep room-order validation and persistence-order construction in a pure server-side module. A dedicated Supervisor client performs the authenticated read-modify-write of add-on options, while `server.js` exposes the operation through the existing ingress WebSocket. The browser adds an explicit sort mode and Pointer Events-based reordering so normal filtering remains unchanged and touch devices work without a third-party library.

**Tech Stack:** Node.js built-in test runner, Node.js `http`, `ws`, static HTML/CSS/JavaScript, Playwright, Home Assistant Supervisor API.

---

## File Structure

- Create: `whole_house_status/src/roomOrder.js` - validates a displayed room sequence and produces a persisted `rooms.order` list.
- Create: `whole_house_status/src/supervisorOptionsClient.js` - reads and updates only the add-on options through `http://supervisor`.
- Create: `whole_house_status/test/roomOrder.test.js` - unit tests for sentinels, stale payloads, and hidden configured rooms.
- Create: `whole_house_status/test/supervisorOptionsClient.test.js` - HTTP contract tests for Supervisor option merging and error handling.
- Create: `whole_house_status/test/server.test.js` - WebSocket integration tests for successful and failed order updates.
- Create: `whole_house_status/test/frontend.spec.js` - desktop/touch sort-mode and mobile-layout coverage.
- Modify: `whole_house_status/src/server.js` - validate `set_room_order`, save through the client, and broadcast the accepted order.
- Modify: `whole_house_status/public/index.html` - add the sort-mode command beside existing filter controls.
- Modify: `whole_house_status/public/app.js` - manage sort mode, pointer dragging, pending saves, and result messages.
- Modify: `whole_house_status/public/styles.css` - style sortable buttons, fixed sentinels, and the compact sort command.
- Modify: `whole_house_status/config.yaml` - grant Supervisor API access and publish version `0.1.18`.
- Modify: `whole_house_status/package.json` and `whole_house_status/package-lock.json` - restore test scripts and the Playwright development dependency.
- Modify: `whole_house_status/translations/zh-Hans.yaml`, `whole_house_status/README.md`, and `whole_house_status/CHANGELOG.md` - document the runtime sorting behavior.

### Task 1: Restore the Narrow Test Toolchain

**Files:**
- Modify: `whole_house_status/package.json`
- Modify: `whole_house_status/package-lock.json`

- [ ] **Step 1: Restore the test scripts and browser-test dependency**

  Add these scripts and development dependency while leaving the production `ws` dependency unchanged:

  ```json
  {
    "scripts": {
      "start": "node src/server.js",
      "test": "node --test test/*.test.js",
      "test:unit": "node --test test/*.test.js",
      "test:frontend": "playwright test test/frontend.spec.js",
      "verify": "npm run test:unit && npm run test:frontend"
    },
    "devDependencies": {
      "@playwright/test": "^1.45.0"
    }
  }
  ```

- [ ] **Step 2: Install the declared development dependency and Chromium**

  Run:

  ```bash
  npm install
  npx playwright install chromium
  ```

  Expected: `node_modules/@playwright/test` exists and Playwright reports a Chromium installation without modifying production source files.

- [ ] **Step 3: Commit the test toolchain**

  ```bash
  git add whole_house_status/package.json whole_house_status/package-lock.json
  git commit -m "test: restore dashboard test tooling"
  ```

### Task 2: Define and Test Pure Room-Order Rules

**Files:**
- Create: `whole_house_status/test/roomOrder.test.js`
- Create: `whole_house_status/src/roomOrder.js`

- [ ] **Step 1: Write failing tests for accepted and rejected displayed orders**

  Create `test/roomOrder.test.js` with these exact expectations:

  ```js
  const test = require('node:test');
  const assert = require('node:assert/strict');
  const {
    FIRST_ROOM,
    LAST_ROOM,
    buildPersistedRoomOrder,
    isValidDisplayedRoomOrder
  } = require('../src/roomOrder');

  test('accepts a reordered current room list with fixed sentinels', () => {
    assert.equal(
      isValidDisplayedRoomOrder(
        ['全部', '厨房', '客厅', '未分组'],
        ['全部', '客厅', '厨房', '未分组']
      ),
      true
    );
  });

  test('rejects reordered sentinels, duplicates, and stale room names', () => {
    const displayed = ['全部', '客厅', '厨房', '未分组'];
    assert.equal(isValidDisplayedRoomOrder(['客厅', '全部', '厨房', '未分组'], displayed), false);
    assert.equal(isValidDisplayedRoomOrder(['全部', '客厅', '客厅', '未分组'], displayed), false);
    assert.equal(isValidDisplayedRoomOrder(['全部', '客厅', '书房', '未分组'], displayed), false);
  });

  test('persists moved visible rooms and retains hidden configured rooms', () => {
    assert.deepEqual(
      buildPersistedRoomOrder(
        ['全部', '厨房', '客厅', '未分组'],
        ['全部', '客厅', '门口', '厨房', '阳台']
      ),
      ['全部', '厨房', '客厅', '门口', '阳台']
    );
  });
  ```

- [ ] **Step 2: Run the new unit test and verify the expected red state**

  Run:

  ```bash
  npm run test:unit -- test/roomOrder.test.js
  ```

  Expected: failure with `Cannot find module '../src/roomOrder'`.

- [ ] **Step 3: Implement the pure validation and merge helpers**

  Create `src/roomOrder.js`:

  ```js
  const FIRST_ROOM = '全部';
  const LAST_ROOM = '未分组';

  function isRoomName(room) {
    return typeof room === 'string' && room === room.trim() && room.length > 0;
  }

  function isValidDisplayedRoomOrder(candidate, displayed) {
    if (!Array.isArray(candidate) || !Array.isArray(displayed) || candidate.length !== displayed.length) {
      return false;
    }
    if (!candidate.every(isRoomName) || new Set(candidate).size !== candidate.length) {
      return false;
    }
    if (candidate[0] !== FIRST_ROOM || candidate.at(-1) !== (displayed.includes(LAST_ROOM) ? LAST_ROOM : candidate.at(-1))) {
      return false;
    }
    const displayedRooms = new Set(displayed);
    return candidate.every((room) => displayedRooms.has(room));
  }

  function buildPersistedRoomOrder(displayedOrder, configuredOrder) {
    const displayedMovableRooms = displayedOrder.filter((room) => room !== FIRST_ROOM && room !== LAST_ROOM);
    const displayedSet = new Set(displayedMovableRooms);
    const hiddenConfiguredRooms = (Array.isArray(configuredOrder) ? configuredOrder : [])
      .filter(isRoomName)
      .filter((room) => room !== FIRST_ROOM && room !== LAST_ROOM && !displayedSet.has(room));
    return [FIRST_ROOM, ...new Set([...displayedMovableRooms, ...hiddenConfiguredRooms])];
  }

  module.exports = {
    FIRST_ROOM,
    LAST_ROOM,
    buildPersistedRoomOrder,
    isValidDisplayedRoomOrder
  };
  ```

- [ ] **Step 4: Run the focused unit test and verify green**

  Run:

  ```bash
  npm run test:unit -- test/roomOrder.test.js
  ```

  Expected: all three room-order tests pass.

- [ ] **Step 5: Commit the pure ordering rules**

  ```bash
  git add whole_house_status/src/roomOrder.js whole_house_status/test/roomOrder.test.js
  git commit -m "feat: define room order validation"
  ```

### Task 3: Add the Supervisor Options Client

**Files:**
- Create: `whole_house_status/test/supervisorOptionsClient.test.js`
- Create: `whole_house_status/src/supervisorOptionsClient.js`

- [ ] **Step 1: Write a failing HTTP contract test**

  Start a local `http.createServer` in `test/supervisorOptionsClient.test.js`. Make `GET /addons/self/options/config` return:

  ```json
  {"display":{"title":"全屋设备状态"},"rooms":{"overrides":[],"order":["全部","客厅","门口"]}}
  ```

  Assert that `await client.setRoomOrder(['全部', '门口', '客厅'])` performs a `POST /addons/self/options` with exactly:

  ```json
  {"options":{"display":{"title":"全屋设备状态"},"rooms":{"overrides":[],"order":["全部","门口","客厅"]}}}
  ```

  Add a second test where the POST returns status `400` and assert rejection matching `/Supervisor options request failed: 400/`.

- [ ] **Step 2: Run the contract test and verify red**

  Run:

  ```bash
  npm run test:unit -- test/supervisorOptionsClient.test.js
  ```

  Expected: failure with `Cannot find module '../src/supervisorOptionsClient'`.

- [ ] **Step 3: Implement authenticated read-modify-write behavior**

  Create `src/supervisorOptionsClient.js` with a `SupervisorOptionsClient` class. Its constructor accepts `{ baseUrl = process.env.SUPERVISOR_URL || 'http://supervisor', token = process.env.SUPERVISOR_TOKEN }`. Reject construction without a token. Implement `requestJson(method, pathname, body)` using `node:http.request`, the `Authorization: Bearer <token>` and JSON content headers, JSON response parsing, and a rejection message of `Supervisor options request failed: <statusCode>` for non-2xx responses. Implement `setRoomOrder(order)` as:

  ```js
  async setRoomOrder(order) {
    const currentOptions = await this.requestJson('GET', '/addons/self/options/config');
    const rooms = currentOptions && currentOptions.rooms && typeof currentOptions.rooms === 'object'
      ? currentOptions.rooms
      : {};
    await this.requestJson('POST', '/addons/self/options', {
      options: { ...currentOptions, rooms: { ...rooms, order: [...order] } }
    });
  }
  ```

  Export `{ SupervisorOptionsClient }`. Do not log tokens or option payloads.

- [ ] **Step 4: Run the focused client tests and verify green**

  Run:

  ```bash
  npm run test:unit -- test/supervisorOptionsClient.test.js
  ```

  Expected: both HTTP contract tests pass.

- [ ] **Step 5: Commit the Supervisor client**

  ```bash
  git add whole_house_status/src/supervisorOptionsClient.js whole_house_status/test/supervisorOptionsClient.test.js
  git commit -m "feat: persist room order through supervisor"
  ```

### Task 4: Handle Room-Order Commands in the Dashboard Server

**Files:**
- Modify: `whole_house_status/test/server.test.js`
- Modify: `whole_house_status/src/server.js`

- [ ] **Step 1: Write failing WebSocket integration tests**

  In `test/server.test.js`, create a server with an injected `roomOrderStore` whose `setRoomOrder` records its input. Seed states and registries for `客厅`, `厨房`, and an unassigned device. From a browser WebSocket send:

  ```json
  {"type":"set_room_order","rooms":["全部","厨房","客厅","未分组"]}
  ```

  Assert that the injected store receives `['全部', '厨房', '客厅']`, that a subsequent view-model message lists `['全部', '厨房', '客厅', '未分组']`, and that the originating socket receives:

  ```json
  {"type":"room_order_result","rooms":["全部","厨房","客厅","未分组"]}
  ```

  Add a second test using `['厨房', '全部', '客厅', '未分组']` and assert no save occurs plus a `room_order_result` containing an `error` string. Add a third test whose injected `setRoomOrder` rejects and assert the snapshot remains unchanged with an error result.

- [ ] **Step 2: Run the integration tests and verify red**

  Run:

  ```bash
  npm run test:unit -- test/server.test.js
  ```

  Expected: the command is ignored because `server.js` currently accepts only `set_dashboard_entity_ignored`.

- [ ] **Step 3: Add command validation, persistence, and broadcast**

  In `src/server.js`:

  1. Import `normalizeOptions`, `SupervisorOptionsClient`, and the two helpers from `roomOrder.js`.
  2. Extend `createServer` with an optional `roomOrderStore` argument. Set `const effectiveRoomOrderStore = roomOrderStore || (token ? new SupervisorOptionsClient({ token }) : null)` so `USE_MOCK_DATA=true` still starts without a Supervisor token; return an error result rather than saving when the effective store is absent.
  3. Add `isRoomOrderCommand(command, displayedRooms)` that requires `type === 'set_room_order'` and `isValidDisplayedRoomOrder(command.rooms, displayedRooms)`.
  4. In `handleBrowserCommand`, calculate `const displayedRooms = snapshot().rooms` before accepting a room-order command. Reject a malformed command with `room_order_result` and an error message. Reject a second command while `roomOrderSavePending` is true with the same result shape.
  5. For a valid command, reject when `effectiveRoomOrderStore` is absent; otherwise set the pending flag, calculate `const persistedOrder = buildPersistedRoomOrder(command.rooms, options.rooms.order)`, await `effectiveRoomOrderStore.setRoomOrder(persistedOrder)`, then set:

     ```js
     options = normalizeOptions({
       ...options,
       rooms: { ...options.rooms, order: persistedOrder }
     });
     ```

     Call `broadcast()` and send `{ type: 'room_order_result', rooms: snapshot().rooms }`. In `catch`, send the same result with `error: error.message || 'Unable to save room order'`; in `finally`, clear the pending flag.
  6. Export `isRoomOrderCommand` with the existing server helpers for direct unit testing.

- [ ] **Step 4: Run the server tests and verify green**

  Run:

  ```bash
  npm run test:unit -- test/server.test.js
  ```

  Expected: valid updates persist and broadcast; malformed and failed updates leave the current order unchanged.

- [ ] **Step 5: Commit the WebSocket server behavior**

  ```bash
  git add whole_house_status/src/server.js whole_house_status/test/server.test.js
  git commit -m "feat: accept dashboard room reordering"
  ```

### Task 5: Add Sort Mode and Pointer Dragging to the Dashboard

**Files:**
- Modify: `whole_house_status/public/index.html`
- Modify: `whole_house_status/public/app.js`
- Modify: `whole_house_status/public/styles.css`
- Create: `whole_house_status/test/frontend.spec.js`

- [ ] **Step 1: Write failing browser tests for sorting and normal filtering**

  Create `test/frontend.spec.js` with a mock WebSocket that supplies rooms `['全部', '客厅', '厨房', '未分组']` and records sent commands. When its `send` method receives `set_room_order`, it must dispatch an updated view-model message followed by `{ type: 'room_order_result', rooms: command.rooms }`; in the failure test it must instead dispatch `{ type: 'room_order_result', rooms: originalRooms, error: '保存失败' }`. Cover these behaviors:

  ```js
  await page.getByRole('button', { name: '排序房间' }).click();
  await expect(page.locator('#rooms')).toHaveClass(/sorting/);
  await expect(page.getByRole('button', { name: '全部', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '未分组', exact: true })).toBeDisabled();

  await dragRoom(page, '厨房', '客厅', 'mouse');
  expect(await page.locator('#rooms button').allTextContents()).toEqual(['全部', '厨房', '客厅', '未分组']);
  expect(await sentCommands(page)).toContainEqual({
    type: 'set_room_order',
    rooms: ['全部', '厨房', '客厅', '未分组']
  });
  ```

  Define `dragRoom` with `dispatchEvent` for `pointerdown`, `pointermove`, and `pointerup`; pass `pointerType: 'touch'` in a second test after setting a `390 x 844` viewport. Assert the mobile page has no horizontal overflow and that normal mode still selects `厨房` without emitting a sort command. Add a failure-result message and assert the room sequence returns to the server-provided order and `#connection` shows the error.

- [ ] **Step 2: Run the frontend test and verify red**

  Run:

  ```bash
  npm run test:frontend -- --grep "sorting"
  ```

  Expected: failure because no `排序房间` button exists.

- [ ] **Step 3: Add the sort-mode control and state**

  In `public/index.html`, insert this control immediately after the room `<nav>`:

  ```html
  <button id="room-order" class="room-order-control" type="button" aria-label="排序房间" aria-pressed="false" title="调整房间顺序">
    排序
  </button>
  ```

  In `public/app.js`, add `roomSortMode`, `roomSortOrder`, `pendingRoomOrder`, and `roomOrderError` to `state`; add `roomOrder` to `elements`; and update `renderConnection` to append `排序保存失败：${state.roomOrderError}` when present. `renderRooms` must use `state.roomSortOrder || model.rooms`, set every generated button's class to `room-button`, and disable `全部` and `未分组` in sort mode plus every room button while `pendingRoomOrder` is set. Retain the original click-to-filter handler only when sort mode is off. It must also call `elements.rooms.classList.toggle('sorting', state.roomSortMode)` and set the sort command's `aria-pressed` and `disabled` states from `roomSortMode` and `pendingRoomOrder`.

- [ ] **Step 4: Implement pointer reordering and WebSocket result handling**

  Add `beginRoomDrag(button, event)`, `moveRoomDrag(event)`, and `finishRoomDrag(event)` in `public/app.js`.

  - Start only while `roomSortMode` is true, `pendingRoomOrder` is null, and the button is not disabled.
  - Use `setPointerCapture(event.pointerId)` and `document.elementFromPoint(event.clientX, event.clientY)` to identify another `.room-button` in `#rooms`.
  - Insert the dragged button before or after the target based on its vertical midpoint, then update `state.roomSortOrder` from `#rooms .room-button` text in DOM order.
  - On pointer up, if the sequence changed, set `pendingRoomOrder`, send `{ type: 'set_room_order', rooms: state.roomSortOrder }`, and keep the sort control disabled until its result arrives.
  - In the WebSocket handler, process `room_order_result` before view models. On success clear all sort state and render the broadcast model; on failure clear sort state, store the error text, and render the latest server model.

  Attach `pointerdown`, `pointermove`, `pointerup`, and `pointercancel` only to buttons created in sort mode. The sort control toggles mode, initializes `roomSortOrder` from the view model when entering, and does nothing while a save is pending.

- [ ] **Step 5: Style the command and sortable state without changing normal layout**

  In `public/styles.css`, give `.room-order-control` the same 42px circular dimensions, border, and hover/focus behavior as `.display-menu summary`. Add `.rooms.sorting .room-button:not(:disabled) { cursor: grab; touch-action: none; }`, `.rooms.sorting .room-button.dragging { cursor: grabbing; opacity: 0.65; }`, and `.rooms.sorting .room-button:disabled { cursor: not-allowed; opacity: 0.55; }`. In the existing mobile media query, set `.room-order-control { align-self: start; order: 2; }` and change `.display-menu` to `order: 3` so the room grid remains three fixed columns with both controls following the room buttons.

- [ ] **Step 6: Run the focused frontend tests and verify green**

  Run:

  ```bash
  npm run test:frontend -- --grep "sorting|touch|filtering|failure"
  ```

  Expected: desktop and touch pointer tests submit the expected order, sentinels stay fixed, failed saves restore server order, and normal filtering remains intact.

- [ ] **Step 7: Commit the browser interaction**

  ```bash
  git add whole_house_status/public/index.html whole_house_status/public/app.js whole_house_status/public/styles.css whole_house_status/test/frontend.spec.js
  git commit -m "feat: drag room buttons in sort mode"
  ```

### Task 6: Enable the Supervisor API and Document the Feature

**Files:**
- Modify: `whole_house_status/config.yaml`
- Modify: `whole_house_status/translations/zh-Hans.yaml`
- Modify: `whole_house_status/README.md`
- Modify: `whole_house_status/CHANGELOG.md`

- [ ] **Step 1: Write a manifest regression test**

  Add a Node test that reads `config.yaml` as text and asserts it contains `version: "0.1.18"` and a standalone `hassio_api: true` line. This test guards the runtime permission required by `SupervisorOptionsClient` without introducing a YAML parser dependency.

- [ ] **Step 2: Run the manifest test and verify red**

  Run:

  ```bash
  npm run test:unit -- test/server.test.js
  ```

  Expected: the new assertion fails because `config.yaml` is still version `0.1.17` and has no `hassio_api` flag.

- [ ] **Step 3: Update manifest and user-facing documentation**

  In `config.yaml`, add `hassio_api: true` adjacent to `homeassistant_api: true` and set `version: "0.1.18"`. Change the Chinese translation for `rooms.order` to explain that the running dashboard can save its drag order back to this field. Add a README paragraph stating that the dashboard's `排序` control saves room-button order automatically and keeps `全部` first and `未分组` last. Add a `0.1.18` changelog section dated `2026-07-19` covering runtime drag sorting and Supervisor-backed persistence.

- [ ] **Step 4: Run the manifest test and verify green**

  Run:

  ```bash
  npm run test:unit -- test/server.test.js
  ```

  Expected: the manifest assertion and previously added server tests pass.

- [ ] **Step 5: Commit manifest and documentation changes**

  ```bash
  git add whole_house_status/config.yaml whole_house_status/translations/zh-Hans.yaml whole_house_status/README.md whole_house_status/CHANGELOG.md whole_house_status/test/server.test.js
  git commit -m "docs: describe runtime room sorting"
  ```

### Task 7: Perform End-to-End Verification

**Files:**
- Verify only: all files changed by Tasks 1-6

- [ ] **Step 1: Run the complete automated suite**

  Run:

  ```bash
  npm run verify
  ```

  Expected: all Node tests and all Playwright tests pass.

- [ ] **Step 2: Inspect desktop and mobile rendering**

  Run the dashboard with `USE_MOCK_DATA=true PORT=8099 npm start`, open it at `http://127.0.0.1:8099/`, and capture Playwright screenshots at `1254 x 1080` and `390 x 844`. Verify that the sort command is visible, no text overlaps its controls, the fixed sentinels are visibly disabled in sort mode, and the mobile page has no horizontal overflow.

- [ ] **Step 3: Check the final diff**

  Run:

  ```bash
  git diff --check HEAD~6..HEAD
  git status --short
  ```

  Expected: no whitespace errors; only this feature's tracked files are changed or committed; any pre-existing `.reasonix/` remains untouched.

- [ ] **Step 4: Commit any verification-only corrections**

  If a correction was needed, stage only the corrected tracked files and commit it as:

  ```bash
  git commit -m "test: verify runtime room ordering"
  ```
