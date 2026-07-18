# Compact Ignored Menu And Title Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the ignored-entities menu frame and desktop title top spacing without changing text sizes or mobile behavior.

**Architecture:** The change is limited to `public/styles.css`; computed-style assertions in the existing desktop Playwright test lock the exact desktop values. The current mobile menu viewport test remains the regression guard for the media-query layout.

**Tech Stack:** CSS, Playwright, Node.js test runner, Home Assistant Add-on metadata.

---

### Task 1: Add Failing Visual Regression Assertions

**Files:**
- Modify: `whole_house_status/test/frontend.spec.js:121-150`

- [ ] **Step 1: Assert the compact menu and desktop title spacing**

```js
await expect(page.locator('.page')).toHaveCSS('padding-top', '40px');
await displayTrigger.click();
const ignoredOption = page.locator('.show-ignored-option');
await expect(ignoredOption).toHaveCSS('width', '232px');
await expect(ignoredOption).toHaveCSS('padding-top', '12px');
await expect(ignoredOption).toHaveCSS('padding-left', '12px');
await expect(ignoredOption).toHaveCSS('column-gap', '10px');
await expect(ignoredOption).toHaveCSS('font-size', '18px');
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx playwright test test/frontend.spec.js --grep "renders the dashboard on desktop"`

Expected: FAIL because the page top padding is `64px` and the ignored menu is
`284px` wide with `20px` padding.

- [ ] **Step 3: Commit the recorded failing test**

```bash
git add whole_house_status/test/frontend.spec.js
git commit -m "test: cover compact ignored menu spacing"
```

### Task 2: Apply the Compact Menu And Desktop Spacing

**Files:**
- Modify: `whole_house_status/public/styles.css:36-41,202-219`
- Test: `whole_house_status/test/frontend.spec.js:121-150`

- [ ] **Step 1: Replace only the relevant CSS declarations**

```css
.page {
  padding: 40px clamp(28px, 5vw, 64px) clamp(28px, 5vw, 64px);
}

.show-ignored-option {
  width: 232px;
  gap: 10px;
  padding: 12px;
  font-size: 18px;
}
```

Do not change the `@media (max-width: 920px)` page padding, the menu's
`max-width` constraint, checkbox size, or text sizes.

- [ ] **Step 2: Run the focused desktop test**

Run: `npx playwright test test/frontend.spec.js --grep "renders the dashboard on desktop"`

Expected: PASS with `40px` title top spacing and a `232px` ignored menu.

- [ ] **Step 3: Run all frontend tests**

Run: `npm run test:frontend`

Expected: PASS, including the mobile viewport menu test.

- [ ] **Step 4: Commit the CSS update**

```bash
git add whole_house_status/public/styles.css
git commit -m "style: compact ignored menu and title spacing"
```

### Task 3: Release Version 0.1.9

**Files:**
- Modify: `whole_house_status/config.yaml:2`
- Modify: `whole_house_status/CHANGELOG.md:3`
- Modify: `whole_house_status/test/repositoryLayout.test.js:54-57`

- [ ] **Step 1: Update the release assertion first**

```js
assert.match(config, /^version: "0\.1\.9"$/m);
assert.match(changelog, /^## 0\.1\.9$/m);
```

- [ ] **Step 2: Run the repository test and verify it fails at version `0.1.8`**

Run: `node --test test/repositoryLayout.test.js`

Expected: FAIL because the Add-on declares `0.1.8`.

- [ ] **Step 3: Write the release metadata**

```yaml
version: "0.1.9"
```

```markdown
## 0.1.9

- Compact the ignored-entities menu and reduce desktop title top spacing.
```

- [ ] **Step 4: Run full verification and create the release commit**

Run: `npm run verify`

Expected: all unit and Playwright tests pass.

```bash
git diff --check
git add whole_house_status/config.yaml whole_house_status/CHANGELOG.md whole_house_status/test/repositoryLayout.test.js
git commit -m "chore: release addon version 0.1.9"
```
