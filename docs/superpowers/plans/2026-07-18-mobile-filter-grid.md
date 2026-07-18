# 移动端房间筛选网格 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在移动端让房间筛选栏填满与统计卡片相同的内容宽度，并将显示图标排在“未分组”右侧的同一行。

**Architecture:** 仅在现有 `max-width: 920px` 媒体查询中，把 `.filter-bar` 从纵向 Flex 容器改为三列等宽 Grid。将 `.rooms` 设为 `display: contents`，使动态渲染的房间按钮与 `.display-menu` 都成为同一网格的项目，保持既有 HTML、JavaScript 和桌面布局不变。

**Tech Stack:** CSS、JavaScript、Node.js、Playwright。

---

### Task 1: Add failing mobile grid layout assertions

**Files:**
- Modify: `whole_house_status/test/frontend.spec.js:507-545` in the mobile room-control test.

- [ ] **Step 1: Write the failing test**

将测试模型更新为十个房间，使“未分组”独占最后一行第一列；替换固定 `96px` 宽度断言，加入如下布局断言：

```js
  const filterBar = page.locator('.filter-bar');
  const stats = page.locator('.stats');
  await expect(page.locator('#rooms button')).toHaveCount(10);
  await expect(filterBar).toHaveCSS('display', 'grid');
  await expect(page.locator('#rooms')).toHaveCSS('display', 'contents');
  const filterColumns = await filterBar.evaluate((element) => (
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length
  ));
  expect(filterColumns).toBe(3);

  const [filterBox, statsBox] = await Promise.all([
    filterBar.boundingBox(),
    stats.boundingBox()
  ]);
  expect(Math.abs(filterBox.x - statsBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs((filterBox.x + filterBox.width) - (statsBox.x + statsBox.width))).toBeLessThanOrEqual(1);

  const roomBoxes = await page.locator('#rooms button').evaluateAll((buttons) => (
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    })
  ));
  expect(roomBoxes.every((box) => Math.abs(box.width - roomBoxes[0].width) <= 1)).toBe(true);
  expect(Math.abs(roomBoxes[0].x - roomBoxes[3].x)).toBeLessThanOrEqual(1);
  expect(Math.abs(roomBoxes[0].x - roomBoxes[6].x)).toBeLessThanOrEqual(1);
  expect(Math.abs(roomBoxes[0].x - roomBoxes[9].x)).toBeLessThanOrEqual(1);

  const lastRoomBox = roomBoxes.at(-1);
  const displayBox = await page.locator('.display-menu summary').boundingBox();
  expect(Math.abs(displayBox.y - lastRoomBox.y)).toBeLessThanOrEqual(1);
  expect(displayBox.x).toBeGreaterThan(lastRoomBox.x + lastRoomBox.width);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd whole_house_status && npx playwright test test/frontend.spec.js -g "keeps mobile room controls fixed width when the final row is incomplete"`

Expected: FAIL because the mobile filter bar is currently a column Flex container, the room navigation is its own fixed-width grid, and the display icon is on a separate row.

### Task 2: Make mobile controls a unified three-column grid

**Files:**
- Modify: `whole_house_status/public/styles.css:433-461` in the `max-width: 920px` media query.
- Test: `whole_house_status/test/frontend.spec.js:507-545`.

- [ ] **Step 1: Replace the mobile filter layout rules**

Replace the mobile `.rooms`, `.filter-bar`, `.display-menu`, and `.rooms button` rules with:

```css
  .filter-bar {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: stretch;
    gap: 10px;
    margin-top: 24px;
  }

  .rooms {
    display: contents;
  }

  .display-menu {
    align-self: start;
    order: 2;
  }

  .rooms button {
    width: 100%;
    min-width: 0;
    min-height: 42px;
    font-size: 20px;
  }
```

These rules override only the mobile media-query declarations. The display menu remains after every room button because it has `order: 2`, while room buttons keep their default order.

- [ ] **Step 2: Run the focused frontend test**

Run: `cd whole_house_status && npx playwright test test/frontend.spec.js -g "keeps mobile room controls fixed width when the final row is incomplete"`

Expected: PASS, with a full-width three-column filter grid and the display icon alongside the final “未分组” button.

### Task 3: Verify the complete Add-on package

**Files:**
- No release metadata changes for this implementation task. Versioning is handled only after the user requests a release.

- [ ] **Step 1: Run all automated tests**

Run: `cd whole_house_status && npm run verify`

Expected: all unit tests and all Playwright tests pass with zero failures.

- [ ] **Step 2: Inspect the final diff**

Run: `git diff --check && git status --short && git diff --stat`

Expected: only `whole_house_status/public/styles.css` and `whole_house_status/test/frontend.spec.js` are tracked implementation changes; `whole_house_status/.playwright-cli/` stays untracked and unstaged.

- [ ] **Step 3: Commit the implementation**

Run:

```bash
git add whole_house_status/public/styles.css whole_house_status/test/frontend.spec.js
git commit -m "style: align mobile room filter grid"
```

Expected: one commit containing the mobile grid CSS and its regression test.
