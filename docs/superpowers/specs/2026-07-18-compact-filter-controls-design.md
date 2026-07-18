# Compact Filter Controls

## Goal

Reduce the visual footprint of the room selectors and the display-menu trigger
without changing their text size, behavior, or responsive filtering workflow.

## Scope

- Desktop room buttons change from `118 x 54px` to `96 x 42px`.
- The display-menu trigger changes from a `132px` minimum width and `54px`
  minimum height to `108px` and `42px`.
- Mobile room selectors keep their three-column layout and existing font size,
  while their outer height follows the shared `42px` minimum.
- Labels, selected-state colors, keyboard focus, checkbox menu, and room
  filtering logic are unchanged.

## Implementation And Verification

Only `public/styles.css` changes. The existing Playwright desktop test gains
computed-style assertions for the compact room and display controls; it must
fail with the current dimensions and pass after the CSS update. The full
frontend suite then verifies mobile wrapping and menu placement remain intact.
