# Compact Ignored Menu And Title Spacing

## Goal

Make the ignored-entities menu visually proportional to its single checkbox
and reduce the empty space above the dashboard title on wide displays.

## Scope

- The `显示已忽略的实体` menu changes from `284px` wide with `20px` padding to
  `232px` wide with `12px` padding and a `10px` control gap.
- The menu text stays at `18px`, the checkbox remains `24px`, and mobile
  viewport clamping remains active.
- The page top padding changes from a maximum `64px` to a maximum `40px`.
  Horizontal padding remains unchanged; mobile top padding can reduce to `20px`.
- The title's font size, its bottom divider, statistics, room selectors, and
  display-menu behavior are unchanged.

## Verification

Playwright tests assert the compact menu width, padding, gap, text size, and
desktop page top padding. Existing mobile menu placement tests cover the
viewport constraint. The Add-on release is bumped after the full test suite
passes.
