# Fixed Mobile Room Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent mobile room selectors from stretching when a final row contains fewer than three controls.

**Architecture:** The mobile flex item changes from a growing basis to a fixed 96px basis. A Playwright test renders five rooms at a 390px viewport and validates every button's computed width, including the last `卫生间` control.

**Tech Stack:** CSS, Playwright, Node.js test runner, Home Assistant Add-on metadata.

---

### Task 1: Reproduce the Stretched Last Mobile Room

**Files:**
- Modify: `whole_house_status/test/frontend.spec.js:435-456`

- [ ] **Step 1: Render a final mobile room row and assert fixed button widths**

```js
const model = {
  title: '全屋设备状态',
  selected_room: '全部',
  rooms: ['全部', '客厅', '门口', '主卧', '卫生间'],
  stats: { online: 0, on: 0, warning: 0, error: 0 },
  alerts: [],
  devices: [],
  connection: { ha_connected: true, config_error: null }
};

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${baseUrl}/`);
const widths = await page.locator('#rooms button').evaluateAll((buttons) => (
  buttons.map((button) => getComputedStyle(button).width)
));
expect(widths).toEqual(['96px', '96px', '96px', '96px', '96px']);
```

- [ ] **Step 2: Run the focused test to verify the current flex rule stretches controls**

Run: `npx playwright test test/frontend.spec.js --grep "keeps mobile room controls fixed width"`

Expected: FAIL because the final-row room width is greater than `96px`.

- [ ] **Step 3: Commit the recorded failing regression test**

```bash
git add whole_house_status/test/frontend.spec.js
git commit -m "test: cover fixed mobile room controls"
```

### Task 2: Stop Mobile Flex Growth

**Files:**
- Modify: `whole_house_status/public/styles.css:413-417`
- Test: `whole_house_status/test/frontend.spec.js:435-456`

- [ ] **Step 1: Replace the mobile flex declaration only**

```css
@media (max-width: 920px) {
  .rooms button {
    flex: 0 0 96px;
    min-width: 96px;
    font-size: 20px;
  }
}
```

Retain the 10px mobile gap, 42px inherited minimum height, 20px mobile label
size, and all existing non-mobile declarations. Do not alter the current page
padding or ignored-entity menu dimensions in the same file.

- [ ] **Step 2: Run the focused mobile regression test**

Run: `npx playwright test test/frontend.spec.js --grep "keeps mobile room controls fixed width"`

Expected: PASS with all five room buttons computed at `96px`.

- [ ] **Step 3: Run the full frontend suite and commit the CSS change**

Run: `npm run test:frontend`

Expected: PASS, including display-menu viewport and compact desktop-control tests.

```bash
git add whole_house_status/public/styles.css
git commit -m "fix: keep mobile room controls fixed width"
```

### Task 3: Release Version 0.1.9

**Files:**
- Modify: `whole_house_status/config.yaml:2`
- Modify: `whole_house_status/CHANGELOG.md:3`
- Modify: `whole_house_status/test/repositoryLayout.test.js:54-57`

- [ ] **Step 1: Require the new release metadata before changing it**

```js
assert.match(config, /^version: "0\.1\.9"$/m);
assert.match(changelog, /^## 0\.1\.9$/m);
```

- [ ] **Step 2: Run the repository layout test and verify it fails at 0.1.8**

Run: `node --test test/repositoryLayout.test.js`

Expected: FAIL because `config.yaml` still declares `0.1.8`.

- [ ] **Step 3: Add the release metadata**

```yaml
version: "0.1.9"
```

```markdown
## 0.1.9

- Keep mobile room selector controls at a fixed width when their final row is incomplete.
```

- [ ] **Step 4: Run the complete verification suite and release commit**

Run: `npm run verify`

Expected: 92 unit tests and 13 Playwright tests pass.

```bash
git diff --check
git add whole_house_status/config.yaml whole_house_status/CHANGELOG.md whole_house_status/test/repositoryLayout.test.js
git commit -m "chore: release addon version 0.1.9"
```
