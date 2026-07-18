# Room Order, Display Icon, And Card Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep `未分组` last, make the display control icon-only, improve card hover readability, reduce statistic weight, and align mobile room controls before releasing Add-on `0.1.12`.

**Architecture:** Keep room ordering canonical in `src/roomResolver.js`, where the view model is built, and keep all responsive behavior in CSS. Preserve the existing HTML `details` interaction and add only accessibility metadata to the icon-only summary. Attach native `title` attributes to the existing card name and entity-meta elements, then verify each behavior through the existing Node and Playwright suites.

**Tech Stack:** Node.js built-in test runner, Playwright, static HTML/CSS, Home Assistant Add-on YAML and Markdown metadata.

---

## File Structure

- Modify: `whole_house_status/test/roomResolver.test.js` — prove `未分组` is always the final discovered room.
- Modify: `whole_house_status/src/roomResolver.js` — defer `未分组` until all other rooms have been ordered.
- Modify: `whole_house_status/test/frontend.spec.js` — cover the icon-only summary, statistic weight, native card titles, mobile grid columns, and display-control placement.
- Modify: `whole_house_status/public/index.html` — remove visible display text while retaining accessible summary metadata.
- Modify: `whole_house_status/public/app.js` — add native titles to full device names and entity IDs.
- Modify: `whole_house_status/public/styles.css` — reduce statistic numeric weight and use a fixed-column mobile room grid.
- Modify: `whole_house_status/test/repositoryLayout.test.js` — expect release `0.1.12`.
- Modify: `whole_house_status/config.yaml` — publish version `0.1.12`.
- Modify: `whole_house_status/CHANGELOG.md` — document the room, icon, and readability changes.

### Task 1: Keep Unassigned Room Last

**Files:**
- Modify: `whole_house_status/test/roomResolver.test.js` after the existing `buildRooms` tests.
- Modify: `whole_house_status/src/roomResolver.js:47-72`.

- [ ] **Step 1: Write the failing unit test**

  Add:

  ```js
  test('buildRooms always places 未分组 after every named room', () => {
    const options = normalizeOptions({
      rooms: { order: ['全部', '未分组', '门口', '客厅'] }
    });
    const rooms = buildRooms([
      { room: '未分组' },
      { room: '客厅' },
      { room: '门口' }
    ], options);

    assert.deepEqual(rooms, ['全部', '门口', '客厅', '未分组']);
  });
  ```

- [ ] **Step 2: Run the focused test and verify it fails**

  Run:

  ```bash
  node --test test/roomResolver.test.js
  ```

  Expected: FAIL because the current configured order places `未分组` before `门口` and `客厅`.

- [ ] **Step 3: Implement the canonical last-room ordering**

  In `buildRooms`, track whether `discovered` contains `未分组`, skip that room while processing both `options.rooms.order` and the discovered-room append loop, then append it once after all other rooms:

  ```js
  function buildRooms(devices, options) {
    const discovered = [...new Set(devices.map((device) => device.room).filter(Boolean))];
    const hasUnassigned = discovered.includes('未分组');
    const ordered = [];

    for (const room of options.rooms.order) {
      if (room === '未分组') {
        continue;
      }
      if ((room === '全部' || discovered.includes(room)) && !ordered.includes(room)) {
        ordered.push(room);
      }
    }

    if (!ordered.includes('全部')) {
      ordered.unshift('全部');
    }

    for (const room of discovered) {
      if (room !== '未分组' && !ordered.includes(room)) {
        ordered.push(room);
      }
    }

    if (hasUnassigned) {
      ordered.push('未分组');
    }

    return ordered;
  }
  ```

- [ ] **Step 4: Run the focused test and verify it passes**

  Run:

  ```bash
  node --test test/roomResolver.test.js
  ```

  Expected: all room resolver tests pass, including the new ordering assertion.

- [ ] **Step 5: Commit the room-order behavior**

  ```bash
  git add whole_house_status/src/roomResolver.js whole_house_status/test/roomResolver.test.js
  git commit -m "fix: keep unassigned room last"
  ```

### Task 2: Prove Frontend Readability And Mobile Layout Requirements

**Files:**
- Modify: `whole_house_status/test/frontend.spec.js:136-170` and `475-496`.

- [ ] **Step 1: Add failing desktop assertions**

  In `renders the dashboard on desktop`, after creating `displayTrigger`, add:

  ```js
  await expect(displayTrigger).not.toContainText('显示');
  await expect(displayTrigger).toHaveAttribute('aria-label', '显示');
  await expect(displayTrigger).toHaveAttribute('title', '显示选项');
  await expect(displayTrigger).toHaveCSS('justify-content', 'center');
  await expect(page.locator('.stat strong').first()).toHaveCSS('font-weight', '600');

  const firstCard = page.locator('#devices .device-card').first();
  const cardName = firstCard.locator('.device-name');
  const cardMeta = firstCard.locator('.device-meta');
  await expect(cardName).toHaveAttribute('title', await cardName.textContent());
  await expect(cardMeta).toHaveAttribute('title', await cardMeta.textContent());
  ```

- [ ] **Step 2: Extend the mobile room-control test**

  Change its model room list to include `未分组` as the last item:

  ```js
  rooms: ['全部', '客厅', '门口', '主卧', '卫生间', '未分组'],
  ```

  Replace the expected button count and append these assertions after the fixed-width assertion:

  ```js
  await expect(page.locator('#rooms button')).toHaveCount(6);
  await expect(page.locator('#rooms')).toHaveCSS('display', 'grid');
  const roomColumns = await page.locator('#rooms').evaluate((element) => (
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length
  ));
  expect(roomColumns).toBe(3);

  const roomNames = await page.locator('#rooms button').allTextContents();
  expect(roomNames.at(-1)).toBe('未分组');
  const roomBoxes = await page.locator('#rooms button').evaluateAll((buttons) => (
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    })
  ));
  expect(Math.abs(roomBoxes[0].x - roomBoxes[3].x)).toBeLessThanOrEqual(1);
  const displayBox = await page.locator('.display-menu summary').boundingBox();
  const lastRoomBox = roomBoxes.at(-1);
  expect(displayBox.y).toBeGreaterThanOrEqual(lastRoomBox.y + lastRoomBox.height);
  ```

- [ ] **Step 3: Run the focused frontend tests and verify they fail**

  Run:

  ```bash
  npx playwright test test/frontend.spec.js --grep "renders the dashboard on desktop|keeps mobile room controls fixed width"
  ```

  Expected: FAIL because the summary still contains visible text, the statistic weight is `700`, card elements have no titles, and the mobile room container is still flex layout.

### Task 3: Implement Frontend Controls And Readability

**Files:**
- Modify: `whole_house_status/public/index.html:30-33`.
- Modify: `whole_house_status/public/app.js:116-135`.
- Modify: `whole_house_status/public/styles.css:80-105` and `330-390`.

- [ ] **Step 1: Make the summary icon-only with accessible metadata**

  Replace the summary markup with:

  ```html
  <summary aria-label="显示" title="显示选项">
    <span class="filter-icon" aria-hidden="true"><i></i><i></i><i></i></span>
  </summary>
  ```

- [ ] **Step 2: Add native hover titles to card name and entity ID**

  In `createDeviceCard`, after creating `name` and `meta`, add:

  ```js
  name.title = device.name;
  meta.title = device.entity_id;
  ```

- [ ] **Step 3: Reduce numeric statistic weight and switch mobile rooms to Grid**

  Center the remaining icon without changing the summary dimensions:

  ```css
  .display-menu summary {
    justify-content: center;
    gap: 0;
  }
  ```

  Change the base statistic value weight:

  ```css
  .stat strong {
    flex: 0 0 auto;
    margin: 0;
    color: var(--text);
    font-size: 42px;
    font-weight: 600;
    line-height: 1;
  }
  ```

  In the mobile media query, replace the `.rooms` flex override with:

  ```css
  .rooms {
    display: grid;
    flex: 0 0 auto;
    grid-template-columns: repeat(auto-fit, minmax(96px, 96px));
    gap: 10px;
  }
  ```

  Add explicit mobile ordering so the control remains after the full room grid:

  ```css
  .display-menu {
    align-self: flex-start;
    order: 2;
  }
  ```

- [ ] **Step 4: Run the focused frontend tests and verify they pass**

  Run:

  ```bash
  npx playwright test test/frontend.spec.js --grep "renders the dashboard on desktop|keeps mobile room controls fixed width"
  ```

  Expected: PASS; the desktop summary has only the icon, values use weight `600`, card text has native titles, and mobile rooms use three aligned 96px columns with the display control below the final row.

- [ ] **Step 5: Run the complete frontend suite**

  Run:

  ```bash
  npm run test:frontend
  ```

  Expected: all existing frontend tests pass, including ignore behavior, mobile viewport bounds, five-column desktop cards, and long-text overflow checks.

- [ ] **Step 6: Commit the frontend behavior**

  ```bash
  git add whole_house_status/public/index.html whole_house_status/public/app.js whole_house_status/public/styles.css whole_house_status/test/frontend.spec.js
  git commit -m "style: improve room controls and card readability"
  ```

### Task 4: Publish Add-on 0.1.12

**Files:**
- Modify: `whole_house_status/test/repositoryLayout.test.js:56-57`.
- Modify: `whole_house_status/config.yaml:2`.
- Modify: `whole_house_status/CHANGELOG.md:3`.

- [ ] **Step 1: Write the failing release expectation**

  Change the repository test expectations to:

  ```js
  assert.match(config, /^version: "0\.1\.12"$/m);
  assert.match(changelog, /^## 0\.1\.12$/m);
  ```

- [ ] **Step 2: Run the focused metadata test and verify it fails**

  Run:

  ```bash
  node --test test/repositoryLayout.test.js
  ```

  Expected: FAIL because the manifest and changelog still declare `0.1.11`.

- [ ] **Step 3: Update manifest and changelog**

  Set the manifest version to:

  ```yaml
  version: "0.1.12"
  ```

  Insert below `# Changelog`:

  ```markdown
  ## 0.1.12

  - Keep unassigned rooms last, align mobile room controls, and improve display and card readability.
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

  Expected: 0 failures across all unit and frontend tests.

- [ ] **Step 6: Commit and push the release**

  ```bash
  git add whole_house_status/config.yaml whole_house_status/CHANGELOG.md whole_house_status/test/repositoryLayout.test.js
  git commit -m "chore: release addon version 0.1.12"
  git push origin HEAD:main
  ```

  Expected: `origin/main` points to the new `0.1.12` release commit.
