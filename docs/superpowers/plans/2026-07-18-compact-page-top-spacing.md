# Compact Page Top Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the desktop whitespace above the dashboard title to 24px without changing title typography or mobile page spacing.

**Architecture:** The existing desktop Playwright test already validates page padding and menu dimensions. Update its top-padding assertion first, then make the minimal `.page` CSS adjustment. The existing uncommitted menu CSS hunk is included unchanged because the committed `0.1.9` test already requires those exact dimensions; publishing without it would leave remote main inconsistent with its tests.

**Tech Stack:** CSS, Playwright, Node.js test runner, Home Assistant Add-on metadata.

---

### Task 1: Create a Failing Desktop Top-Padding Regression Test

**Files:**
- Modify: `whole_house_status/test/frontend.spec.js:125-147`

- [ ] **Step 1: Change the desktop page padding assertion from 40px to 24px**

```js
await expect(page.locator('.page')).toHaveCSS('padding-top', '24px');
```

- [ ] **Step 2: Run the focused test and confirm the current 40px top padding fails**

Run: `npx playwright test test/frontend.spec.js --grep "renders the dashboard on desktop"`

Expected: FAIL with received `padding-top` of `40px`.

- [ ] **Step 3: Commit the failing regression test after recording the red result**

```bash
git add whole_house_status/test/frontend.spec.js
git commit -m "test: cover compact page top spacing"
```

### Task 2: Apply the Compact Page Padding and Complete Existing Menu CSS

**Files:**
- Modify: `whole_house_status/public/styles.css:36-41,202-218`
- Test: `whole_house_status/test/frontend.spec.js:125-147`

- [ ] **Step 1: Set the desktop top padding to 24px while preserving side and bottom values**

```css
.page {
  width: 100%;
  max-width: 1500px;
  margin: 0 auto;
  padding: 24px clamp(28px, 5vw, 64px) clamp(28px, 5vw, 64px);
}
```

- [ ] **Step 2: Retain the committed-test menu dimensions in the pending CSS hunk**

```css
.show-ignored-option {
  width: 232px;
  gap: 10px;
  padding: 12px;
}
```

The mobile `.page { padding: 20px 18px 48px; }` rule remains unchanged.

- [ ] **Step 3: Run the focused test and verify it passes**

Run: `npx playwright test test/frontend.spec.js --grep "renders the dashboard on desktop"`

Expected: PASS with 24px page top padding, unchanged 32px title font, and the
existing 232px menu assertions.

- [ ] **Step 4: Run all frontend tests and commit the CSS hunk**

Run: `npm run test:frontend`

Expected: PASS with mobile viewport checks intact.

```bash
git add whole_house_status/public/styles.css
git commit -m "style: compact dashboard page spacing"
```

### Task 3: Release the Completed CSS Change

**Files:**
- Modify: `whole_house_status/config.yaml:2`
- Modify: `whole_house_status/CHANGELOG.md:3`
- Modify: `whole_house_status/test/repositoryLayout.test.js:56-57`

- [ ] **Step 1: Update release assertions to version 0.1.10**

```js
assert.match(config, /^version: "0\.1\.10"$/m);
assert.match(changelog, /^## 0\.1\.10$/m);
```

- [ ] **Step 2: Run the repository layout test and confirm it fails at 0.1.9**

Run: `node --test test/repositoryLayout.test.js`

Expected: FAIL because the Add-on currently declares `0.1.9`.

- [ ] **Step 3: Write release metadata**

```yaml
version: "0.1.10"
```

```markdown
## 0.1.10

- Reduce dashboard top spacing and publish the compact ignored-entity display menu.
```

- [ ] **Step 4: Verify and release**

Run: `npm run verify`

Expected: all unit and Playwright tests exit `0`.

```bash
git diff --check
git add whole_house_status/config.yaml whole_house_status/CHANGELOG.md whole_house_status/test/repositoryLayout.test.js
git commit -m "chore: release addon version 0.1.10"
git push origin HEAD:main
```
