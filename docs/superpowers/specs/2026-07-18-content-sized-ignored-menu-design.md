# Content-Sized Ignored Menu

## Goal

Remove the unused space to the right of the `显示已忽略的实体` option while
keeping the `显示` trigger unchanged.

## Scope

- The `.show-ignored-option` panel uses its checkbox and label as its intrinsic
  width instead of a fixed `232px` width.
- The label remains on one line, with the existing `12px` padding, `10px` gap,
  `24px` checkbox, and `18px` text unchanged.
- The `.display-menu summary` trigger keeps its existing minimum width,
  height, typography, and icon.
- The mobile left alignment and `max-width: calc(100vw - 36px)` viewport
  guard remain unchanged.

## Behavior

Opening the `显示` menu presents a compact, single-line checkbox option with
no avoidable right-side space. Toggling the checkbox and all room filtering
behavior are unchanged.

## Verification

The desktop Playwright test will assert that the option width matches the
content-sized layout, while retaining the existing trigger size and option
typography checks. Existing mobile placement coverage will continue to verify
that the panel stays within the viewport.
