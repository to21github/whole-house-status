# Compact Filter Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce room-selector and display-trigger outer boxes while preserving all label font sizes and responsive behavior.

**Architecture:** This is a CSS-only visual change backed by computed-style Playwright assertions. The existing desktop smoke test becomes the regression test, and the existing mobile viewport tests protect the three-column room layout and display menu placement.

**Tech Stack:** CSS, Playwright, Node.js test runner, Home Assistant Add-on metadata.

---

### Task 1: Lock Compact Control Dimensions With a Failing Browser Test

**Files:**
- Modify: `whole_house_status/test/frontend.spec.js:121-146`

- [ ] **Step 1: Add exact desktop dimension and unchanged-font assertions**

```js
await expect(allRoomsButton).toHaveCSS('width', '96px');
await expect(allRoomsButton).toHaveCSS('min-height', '42px');
await expect(allRoomsButton).toHaveCSS('font-size', '18px');
const displayTrigger = page.locator('.display-menu summary');
await expect(displayTrigger).toHaveCSS('min-width', '108px');
await expect(displayTrigger).toHaveCSS('min-height', '42px');
await expect(displayTrigger).toHaveCSS('font-size', '16px');
```

- [ ] **Step 2: Run the focused test and verify the old dimensions fail**

Run: `npx playwright test test/frontend.spec.js --grep "renders the dashboard on desktop"`

Expected: FAIL because the room button is `118px` wide and `54px` high.

- [ ] **Step 3: Commit the failing test only after recording the red result**

```bash
git add whole_house_status/test/frontend.spec.js
git commit -m "test: cover compact filter controls"
```

### Task 2: Compact the Filter Control Outer Boxes

**Files:**
- Modify: `whole_house_status/public/styles.css:121-167`
- Test: `whole_house_status/test/frontend.spec.js:121-146`

- [ ] **Step 1: Replace only the outer-size and padding declarations**

```css
.rooms button {
  width: 96px;
  min-height: 42px;
  padding: 0 8px;
  font-size: 18px;
}

.display-menu summary {
  gap: 12px;
  min-width: 108px;
  min-height: 42px;
  padding: 0 12px;
}
```

Keep the existing mobile `font-size: 20px` override, active-state colors,
border radius, and the three-column flex rule unchanged.

- [ ] **Step 2: Run the focused desktop regression test**

Run: `npx playwright test test/frontend.spec.js --grep "renders the dashboard on desktop"`

Expected: PASS with `96px` room width, `42px` minimum heights, and unchanged
`18px`/`16px` desktop font sizes.

- [ ] **Step 3: Run all frontend tests**

Run: `npm run test:frontend`

Expected: PASS, including mobile three-column and display-menu viewport tests.

- [ ] **Step 4: Commit the CSS update**

```bash
git add whole_house_status/public/styles.css
git commit -m "style: compact room and display controls"
```

### Task 3: Release the Visual Update

**Files:**
- Modify: `whole_house_status/config.yaml:2`
- Modify: `whole_house_status/CHANGELOG.md:3`
- Modify: `whole_house_status/test/repositoryLayout.test.js:54-57`

- [ ] **Step 1: Update the release test before metadata**

```js
assert.match(config, /^version: "0\.1\.8"$/m);
assert.match(changelog, /^## 0\.1\.8$/m);
```

- [ ] **Step 2: Run the repository layout test and confirm it fails at `0.1.7`**

Run: `node --test test/repositoryLayout.test.js`

Expected: FAIL because the Add-on still declares version `0.1.7`.

- [ ] **Step 3: Set the release metadata**

```yaml
version: "0.1.8"
```

```markdown
## 0.1.8

- Compact room selector and display control frames without changing text sizes.
```

- [ ] **Step 4: Run the full suite and review the release diff**

Run: `npm run verify`

Expected: unit and Playwright commands both exit `0`.

```bash
git diff --check
git add whole_house_status/config.yaml whole_house_status/CHANGELOG.md whole_house_status/test/repositoryLayout.test.js
git commit -m "chore: release addon version 0.1.8"
```
