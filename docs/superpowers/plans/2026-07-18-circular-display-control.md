# Circular Display Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the icon-only display control into a `42px` circular button without changing its dropdown behavior, then publish Add-on `0.1.13`.

**Architecture:** Keep the existing `details`/`summary` interaction, accessibility metadata, icon markup, and content-sized dropdown. Only the summary's box model changes: explicit square dimensions, zero horizontal padding, centered icon, and a circular border radius. Add desktop and mobile Playwright assertions, then bump the Add-on release metadata.

**Tech Stack:** Static CSS/HTML, Playwright, Node.js built-in test runner, Home Assistant Add-on YAML and Markdown metadata.

---

## File Structure

- Modify: `whole_house_status/test/frontend.spec.js` — assert circular dimensions on desktop and mobile while retaining dropdown interaction coverage.
- Modify: `whole_house_status/public/styles.css` — set the summary to a `42px` square circle with no horizontal padding.
- Modify: `whole_house_status/test/repositoryLayout.test.js` — expect release `0.1.13`.
- Modify: `whole_house_status/config.yaml` — publish version `0.1.13`.
- Modify: `whole_house_status/CHANGELOG.md` — document the circular display control.

### Task 1: Prove Circular Control Requirements

**Files:**
- Modify: `whole_house_status/test/frontend.spec.js:136-146` and `463-480`.

- [ ] **Step 1: Update the desktop assertions to require a circle**

  In `renders the dashboard on desktop`, replace the existing `min-width` assertion and add the explicit shape checks:

  ```js
  await expect(displayTrigger).toHaveCSS('width', '42px');
  await expect(displayTrigger).toHaveCSS('min-width', '42px');
  await expect(displayTrigger).toHaveCSS('height', '42px');
  await expect(displayTrigger).toHaveCSS('min-height', '42px');
  await expect(displayTrigger).toHaveCSS('border-radius', '50%');
  await expect(displayTrigger).toHaveCSS('justify-content', 'center');
  ```

- [ ] **Step 2: Add mobile shape assertions**

  In `keeps the ignored-entities display menu inside the mobile viewport`, before opening the summary, add:

  ```js
  const displayTrigger = page.locator('.display-menu summary');
  await expect(displayTrigger).toHaveCSS('width', '42px');
  await expect(displayTrigger).toHaveCSS('height', '42px');
  await expect(displayTrigger).toHaveCSS('border-radius', '50%');
  ```

- [ ] **Step 3: Run the focused browser tests and verify they fail**

  Run:

  ```bash
  npx playwright test test/frontend.spec.js --grep "renders the dashboard on desktop|keeps the ignored-entities display menu inside the mobile viewport"
  ```

  Expected: FAIL because the current summary is `108px` wide with a `42px` minimum height and `8px` corner radius.

### Task 2: Implement The Circular Summary

**Files:**
- Modify: `whole_house_status/public/styles.css:153-168`.

- [ ] **Step 1: Set the explicit circular box model**

  Update `.display-menu summary` to use:

  ```css
  .display-menu summary {
    display: flex;
    width: 42px;
    min-width: 42px;
    height: 42px;
    min-height: 42px;
    align-items: center;
    justify-content: center;
    gap: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 50%;
    background: var(--panel);
    color: var(--text);
    cursor: pointer;
    list-style: none;
  }
  ```

  Leave the icon markup, hover/focus border color, summary accessibility metadata, and `.show-ignored-option` dropdown unchanged.

- [ ] **Step 2: Run the focused browser tests and verify they pass**

  Run:

  ```bash
  npx playwright test test/frontend.spec.js --grep "renders the dashboard on desktop|keeps the ignored-entities display menu inside the mobile viewport"
  ```

  Expected: PASS with `42px` width and height, `50%` radius, centered icon, and the existing dropdown opening successfully.

- [ ] **Step 3: Run the complete frontend suite**

  Run:

  ```bash
  npm run test:frontend
  ```

  Expected: all 14 frontend tests pass, including ignored-entity display behavior and mobile viewport bounds.

- [ ] **Step 4: Commit the circular control behavior**

  ```bash
  git add whole_house_status/public/styles.css whole_house_status/test/frontend.spec.js
  git commit -m "style: make display control circular"
  ```

### Task 3: Publish Add-on 0.1.13

**Files:**
- Modify: `whole_house_status/test/repositoryLayout.test.js:56-57`.
- Modify: `whole_house_status/config.yaml:2`.
- Modify: `whole_house_status/CHANGELOG.md:3`.

- [ ] **Step 1: Write the failing release expectation**

  Change the repository test expectations to:

  ```js
  assert.match(config, /^version: "0\.1\.13"$/m);
  assert.match(changelog, /^## 0\.1\.13$/m);
  ```

- [ ] **Step 2: Run the focused metadata test and verify it fails**

  Run:

  ```bash
  node --test test/repositoryLayout.test.js
  ```

  Expected: FAIL because the manifest and changelog still declare `0.1.12`.

- [ ] **Step 3: Update manifest and changelog**

  Set the manifest version to:

  ```yaml
  version: "0.1.13"
  ```

  Insert below `# Changelog`:

  ```markdown
  ## 0.1.13

  - Make the display control a circular icon button.
  ```

- [ ] **Step 4: Run the focused metadata test and verify it passes**

  Run:

  ```bash
  node --test test/repositoryLayout.test.js
  ```

  Expected: PASS.

- [ ] **Step 5: Run full verification**

  Run:

  ```bash
  npm run verify
  ```

  Expected: all unit and frontend tests pass with zero failures.

- [ ] **Step 6: Commit and push the release**

  ```bash
  git add whole_house_status/config.yaml whole_house_status/CHANGELOG.md whole_house_status/test/repositoryLayout.test.js
  git commit -m "chore: release addon version 0.1.13"
  git push origin HEAD:main
  ```

  Expected: `origin/main` points to the new `0.1.13` release commit.
