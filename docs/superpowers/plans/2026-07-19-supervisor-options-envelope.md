# Supervisor Options Envelope Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist reordered rooms by extracting the configured options from the Supervisor API response envelope before updating `rooms.order`.

**Architecture:** `SupervisorOptionsClient` remains the sole integration boundary. Its `setRoomOrder` method will validate the successful GET response, extract its object-valued `data`, then submit that data with only `rooms.order` replaced. Tests run a local HTTP server that mirrors the Supervisor response envelope, proving the POST payload contains no API metadata.

**Tech Stack:** Node.js CommonJS, `node:test`, `node:http`, Home Assistant Supervisor REST API.

---

### Task 1: Capture the Supervisor response contract in tests

**Files:**
- Modify: `whole_house_status/test/supervisorOptionsClient.test.js:43-130`
- Test: `whole_house_status/test/supervisorOptionsClient.test.js`

- [ ] **Step 1: Make the successful GET response use the Supervisor API envelope**

  Replace the success fixture and GET response with:

  ```js
  const currentOptions = {
    display: { title: '全屋设备状态' },
    rooms: { overrides: [], order: ['全部', '客厅', '门口'] }
  };
  const supervisorResponse = {
    result: 'ok',
    data: currentOptions
  };
  ```

  ```js
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(supervisorResponse));
    return;
  }
  ```

- [ ] **Step 2: Update the non-2xx POST fixture to use the same GET envelope**

  In `rejects a non-2xx Supervisor options response`, return:

  ```js
  res.end(JSON.stringify({
    result: 'ok',
    data: { rooms: { overrides: [], order: ['全部', '客厅'] } }
  }));
  ```

  This ensures the test reaches the POST request after the client begins validating the GET response.

- [ ] **Step 3: Run the focused test to verify it fails for the expected payload mismatch**

  Run:

  ```bash
  cd whole_house_status && node --test --test-name-pattern='reads current options' test/supervisorOptionsClient.test.js
  ```

  Expected: FAIL because the current implementation places `result` and `data` under `options`, rather than submitting the object in `data`.

### Task 2: Extract and validate Supervisor configuration data

**Files:**
- Modify: `whole_house_status/src/supervisorOptionsClient.js:20-31`
- Test: `whole_house_status/test/supervisorOptionsClient.test.js`

- [ ] **Step 1: Add a failing test for a successful response without configuration data**

  Add this test after the non-2xx response test:

  ```js
  test('rejects a Supervisor options response without configuration data', async (t) => {
    const server = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: 'ok' }));
    });
    t.after(() => server.close());

    const client = new SupervisorOptionsClient({
      baseUrl: server.baseUrl,
      token: 'test-token'
    });

    await assert.rejects(
      client.setRoomOrder(['全部', '客厅']),
      /Supervisor options response did not contain configuration data/
    );
  });
  ```

- [ ] **Step 2: Run the focused missing-data test to verify it fails**

  Run:

  ```bash
  cd whole_house_status && node --test --test-name-pattern='without configuration data' test/supervisorOptionsClient.test.js
  ```

  Expected: FAIL because the existing client accepts the complete response as a configuration object.

- [ ] **Step 3: Implement the smallest response-unwrapping change**

  Replace the beginning of `setRoomOrder` with:

  ```js
  async setRoomOrder(order) {
    const response = await this.request('GET', '/addons/self/options/config');
    const currentOptions = response && typeof response.data === 'object' && !Array.isArray(response.data)
      ? response.data
      : null;
    if (!currentOptions) {
      throw new Error('Supervisor options response did not contain configuration data');
    }

    const options = {
      ...currentOptions,
      rooms: {
        ...currentOptions.rooms,
        order: [...order]
      }
    };

    await this.request('POST', '/addons/self/options', { options });
  }
  ```

- [ ] **Step 4: Run the focused client tests to verify the fix**

  Run:

  ```bash
  cd whole_house_status && node --test test/supervisorOptionsClient.test.js
  ```

  Expected: PASS. The success test verifies the correct payload, the 400 test verifies POST failures still propagate, and the missing-data test verifies malformed success responses fail explicitly.

- [ ] **Step 5: Commit the implementation**

  ```bash
  git add whole_house_status/src/supervisorOptionsClient.js whole_house_status/test/supervisorOptionsClient.test.js
  git commit -m "fix: unwrap supervisor options response"
  ```

### Task 3: Run regression verification

**Files:**
- Verify only: `whole_house_status/test/*.test.js`

- [ ] **Step 1: Run the complete Node test suite**

  Run:

  ```bash
  cd whole_house_status && npm test
  ```

  Expected: PASS with every `node:test` suite green.

- [ ] **Step 2: Check the final diff contains only the planned client and test changes**

  Run:

  ```bash
  git diff --check HEAD~1 HEAD
  git status --short
  ```

  Expected: no whitespace errors; only the user's pre-existing `.reasonix/` directory remains untracked.
