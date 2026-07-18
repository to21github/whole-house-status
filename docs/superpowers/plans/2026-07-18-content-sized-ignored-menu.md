# Content-Sized Ignored Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `显示已忽略的实体` menu option fit its checkbox and label while keeping the `显示` trigger unchanged.

**Architecture:** Retain the current `details`/`summary` markup and interaction logic. Replace only the option panel's fixed CSS width with an intrinsic content width and a no-wrap label, then prove that rendered width equals the control's required width in the existing desktop Playwright scenario. Release the visual adjustment as Add-on version `0.1.11`.

**Tech Stack:** Static HTML/CSS, browser-native `details`, Playwright, Node.js built-in test runner, Home Assistant Add-on manifest.

---

## File Structure

- Modify: `whole_house_status/test/frontend.spec.js` — assert that the open ignored-entity option has no avoidable horizontal space.
- Modify: `whole_house_status/public/styles.css` — use intrinsic width and preserve a single-line option label.
- Modify: `whole_house_status/test/repositoryLayout.test.js` — expect the `0.1.11` release metadata.
- Modify: `whole_house_status/config.yaml` — publish version `0.1.11`.
- Modify: `whole_house_status/CHANGELOG.md` — document the menu width adjustment.

### Task 1: Prove Content-Sized Menu Layout

**Files:**
- Modify: `whole_house_status/test/frontend.spec.js:141-146`
- Modify: `whole_house_status/public/styles.css:202-219`

- [ ] **Step 1: Write the failing desktop layout assertion**

  Replace the fixed-width expectation in the `renders the dashboard on desktop` test with this assertion after `const ignoredOption = page.locator('.show-ignored-option');`:

  ```js
  const optionMetrics = await ignoredOption.evaluate((element) => {
    const checkbox = element.querySelector('input');
    const label = element.querySelector('span');
    const styles = getComputedStyle(element);
    const requiredWidth = checkbox.getBoundingClientRect().width
      + Number.parseFloat(styles.columnGap)
      + label.getBoundingClientRect().width
      + Number.parseFloat(styles.paddingLeft)
      + Number.parseFloat(styles.paddingRight)
      + Number.parseFloat(styles.borderLeftWidth)
      + Number.parseFloat(styles.borderRightWidth);

    return {
      actualWidth: element.getBoundingClientRect().width,
      requiredWidth
    };
  });
  expect(Math.abs(optionMetrics.actualWidth - optionMetrics.requiredWidth)).toBeLessThanOrEqual(1);
  ```

- [ ] **Step 2: Run the focused browser test and verify it fails**

  Run:

  ```bash
  npx playwright test test/frontend.spec.js --grep "renders the dashboard on desktop"
  ```

  Expected: FAIL because the fixed `232px` panel is wider than the checkbox, label, gap, padding, and borders require.

- [ ] **Step 3: Implement the intrinsic panel width**

  In `.show-ignored-option` in `whole_house_status/public/styles.css`, replace:

  ```css
  width: 232px;
  ```

  with:

  ```css
  width: max-content;
  white-space: nowrap;
  ```

  Leave the existing desktop right alignment and mobile `max-width: calc(100vw - 36px)` rule intact.

- [ ] **Step 4: Run the focused browser test and verify it passes**

  Run:

  ```bash
  npx playwright test test/frontend.spec.js --grep "renders the dashboard on desktop"
  ```

  Expected: PASS; the trigger remains `108px` minimum width, and the option width equals its rendered content requirement.

- [ ] **Step 5: Commit the layout behavior**

  ```bash
  git add whole_house_status/public/styles.css whole_house_status/test/frontend.spec.js
  git commit -m "style: fit ignored entity menu to content"
  ```

### Task 2: Publish Version 0.1.11

**Files:**
- Modify: `whole_house_status/test/repositoryLayout.test.js:50-51`
- Modify: `whole_house_status/config.yaml:2`
- Modify: `whole_house_status/CHANGELOG.md:3`

- [ ] **Step 1: Write the failing release metadata expectation**

  In `whole_house_status/test/repositoryLayout.test.js`, change both `0.1.10` expectations to `0.1.11`:

  ```js
  assert.match(config, /^version: "0\.1\.11"$/m);
  assert.match(changelog, /^## 0\.1\.11$/m);
  ```

- [ ] **Step 2: Run the focused unit test and verify it fails**

  Run:

  ```bash
  node --test test/repositoryLayout.test.js
  ```

  Expected: FAIL because the manifest and changelog still declare `0.1.10`.

- [ ] **Step 3: Update release metadata**

  Set the manifest version:

  ```yaml
  version: "0.1.11"
  ```

  Insert this changelog section immediately below `# Changelog`:

  ```markdown
  ## 0.1.11

  - Fit the ignored-entity display option to its content.
  ```

- [ ] **Step 4: Run the focused unit test and verify it passes**

  Run:

  ```bash
  node --test test/repositoryLayout.test.js
  ```

  Expected: PASS; the manifest and changelog both declare `0.1.11`.

- [ ] **Step 5: Run the full verification suite**

  Run:

  ```bash
  npm run verify
  ```

  Expected: all Node unit tests and all Playwright frontend tests pass.

- [ ] **Step 6: Commit and publish the release**

  ```bash
  git add whole_house_status/config.yaml whole_house_status/CHANGELOG.md whole_house_status/test/repositoryLayout.test.js
  git commit -m "chore: release addon version 0.1.11"
  git push origin HEAD:main
  ```

  Expected: `origin/main` points to the `0.1.11` release commit.
