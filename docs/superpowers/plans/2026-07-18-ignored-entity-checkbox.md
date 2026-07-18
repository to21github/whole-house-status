# 显示已忽略实体复选框 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“显示已忽略的实体”选项改为 18px 的跨浏览器一致复选框，未选中显示浅灰描边，选中显示浅灰底和深色对勾，同时保持现有可访问性和显示逻辑。

**Architecture:** 保留真实的原生 checkbox 作为 label 内的键盘和屏幕阅读器控件，用可访问的视觉隐藏方式将其移出布局；在 input 后加入 `.checkbox-box` 视觉元素，由相邻 CSS 选择器响应 `:checked` 和 `:focus-visible`。只改 `index.html`、`styles.css` 与现有 Playwright 前端回归测试。

**Tech Stack:** HTML、CSS、Node.js、Playwright。

---

### Task 1: Add failing visual-state assertions

**Files:**
- Modify: `whole_house_status/test/frontend.spec.js:157-177` in the desktop dashboard test.

- [ ] **Step 1: Write the failing test**

在打开 `.show-ignored-option` 后，使用视觉方框而不是原生 input 计算选项宽度，并增加未选中状态断言；在点击文字勾选后增加选中状态和对勾伪元素断言：

```js
  const ignoredOption = page.locator('.show-ignored-option');
  const checkboxBox = ignoredOption.locator('.checkbox-box');
  await expect(checkboxBox).toHaveCSS('width', '18px');
  await expect(checkboxBox).toHaveCSS('height', '18px');
  await expect(checkboxBox).toHaveCSS('border-width', '1px');
  await expect(checkboxBox).toHaveCSS('border-color', 'rgb(189, 189, 189)');
  await expect(checkboxBox).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(checkboxBox).toHaveCSS('border-radius', '2px');
  const optionMetrics = await ignoredOption.evaluate((element) => {
    const box = element.querySelector('.checkbox-box');
    const label = element.querySelector('span:last-child');
    const styles = getComputedStyle(element);
    const requiredWidth = box.getBoundingClientRect().width
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
  await expect(ignoredOption).toHaveCSS('padding-top', '12px');
  await expect(ignoredOption).toHaveCSS('padding-left', '12px');
  await expect(ignoredOption).toHaveCSS('column-gap', '10px');
  await expect(ignoredOption).toHaveCSS('font-size', '18px');

  await page.getByText('显示已忽略的实体', { exact: true }).click();
  await expect(page.getByLabel('显示已忽略的实体')).toBeChecked();
  await expect(checkboxBox).toHaveCSS('background-color', 'rgb(213, 213, 213)');
  const checkedContent = await checkboxBox.evaluate((element) => (
    getComputedStyle(element, '::after').content
  ));
  expect(checkedContent).toBe('""');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd whole_house_status && npx playwright test test/frontend.spec.js -g "renders the dashboard on desktop"`

Expected: FAIL because the current label has no `.checkbox-box` element and the locator cannot find the expected visual control.

### Task 2: Implement the accessible custom checkbox

**Files:**
- Modify: `whole_house_status/public/index.html:39-43` to add the visual box between the input and text span.
- Modify: `whole_house_status/public/styles.css:224-229` to replace the 24px native appearance with the 18px visual control and focus/checked states.

- [ ] **Step 1: Write the minimal HTML structure**

Change the option label to:

```html
          <label class="show-ignored-option">
            <input id="show-ignored" type="checkbox">
            <span class="checkbox-box" aria-hidden="true"></span>
            <span>显示已忽略的实体</span>
          </label>
```

- [ ] **Step 2: Write the minimal CSS implementation**

Replace the input sizing rule and add the visual box rules:

```css
.show-ignored-option input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  border: 0;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.show-ignored-option .checkbox-box {
  position: relative;
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  border: 1px solid #bdbdbd;
  border-radius: 2px;
  background: transparent;
}

.show-ignored-option input:checked + .checkbox-box {
  border-color: #d5d5d5;
  background: #d5d5d5;
}

.show-ignored-option input:checked + .checkbox-box::after {
  position: absolute;
  top: 1px;
  left: 5px;
  width: 5px;
  height: 10px;
  border: solid #222;
  border-width: 0 2px 2px 0;
  content: '';
  transform: rotate(45deg);
}

.show-ignored-option input:focus-visible + .checkbox-box {
  outline: 2px solid var(--muted);
  outline-offset: 2px;
}
```

- [ ] **Step 3: Run the focused frontend test**

Run: `cd whole_house_status && npx playwright test test/frontend.spec.js -g "renders the dashboard on desktop"`

Expected: PASS, including the new unchecked and checked visual-state assertions.

### Task 3: Verify all behavior and repository hygiene

**Files:**
- No release metadata changes. This is a visual-only fix and does not change the Add-on version or changelog.

- [ ] **Step 1: Run the full verification suite**

Run: `cd whole_house_status && npm run verify`

Expected: all unit tests and all Playwright frontend tests pass with zero failures.

- [ ] **Step 2: Check the final diff and generated files**

Run: `git diff --check && git status --short && git diff --stat`

Expected: only the intended HTML, CSS, and frontend test changes are tracked; `whole_house_status/.playwright-cli/` remains untracked and is not staged.

- [ ] **Step 3: Commit the implementation**

Run:

```bash
git add whole_house_status/public/index.html whole_house_status/public/styles.css whole_house_status/test/frontend.spec.js
git commit -m "style: customize ignored entity checkbox"
```

Expected: one commit containing only the custom checkbox implementation and regression test.
