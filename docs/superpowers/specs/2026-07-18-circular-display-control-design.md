# Circular Display Control

## Goal

Make the icon-only display control visually circular without changing its
interaction, placement, or dropdown contents.

## Scope

- The `.display-menu summary` control becomes a `42px` by `42px` circle with
  `border-radius: 50%`.
- The filter icon remains centered and keeps its existing dimensions and color.
- The control keeps its current accessible name, native hover title, and click
  behavior. Its previous `108px` minimum width is intentionally replaced by
  the explicit `42px` circle dimensions.
- The `.show-ignored-option` dropdown remains a rectangular content-sized
  panel with unchanged checkbox, text, and viewport behavior.
- The Add-on version increases from `0.1.12` to `0.1.13` with a changelog
  entry.

## Verification

The desktop and mobile Playwright coverage will assert the circular summary
dimensions, `border-radius: 50%`, centered icon, and unchanged dropdown
interaction. Existing room ordering, ignore behavior, viewport, and card
readability tests must remain passing. The full `npm run verify` suite must pass
before publishing `0.1.13`.
