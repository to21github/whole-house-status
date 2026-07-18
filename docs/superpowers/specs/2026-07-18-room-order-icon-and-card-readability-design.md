# Room Order, Display Icon, And Card Readability

## Goal

Improve room navigation and desktop card readability without changing device
filtering or ignore behavior.

## Scope

- `未分组` remains available whenever it is discovered, but is always appended
  after every other room, regardless of configured room order or discovery order.
- The display control keeps its current size and behavior but removes the
  visible `显示` label, leaving the filter icon as the control content. It
  retains an accessible name and native hover title.
- On mobile, room buttons use fixed-width CSS Grid columns so every row shares
  the same left and right column edges. The display icon remains in its own
  row after the complete room grid, including `未分组`.
- Desktop device names and entity identifiers keep ellipsis inside cards and
  gain native browser hover titles containing their full values.
- Statistics retain their current font size and colors, but the numeric weight
  changes from `700` to `600` so the four values read less heavily.
- The Add-on version increases from `0.1.11` to `0.1.12` with a changelog
  entry.

## Implementation Boundaries

- Server-side room ordering is handled in `src/roomResolver.js`, keeping the
  view model canonical for both desktop and mobile clients.
- The display summary markup remains in `public/index.html`; only its visible
  text and accessibility metadata change.
- Card hover metadata is attached while creating card elements in
  `public/app.js`, so it reflects the exact rendered device name and entity ID.
- Mobile alignment and typography are CSS-only; no viewport-specific JavaScript
  is introduced.

## Verification

- Unit tests prove `buildRooms` puts `未分组` last even if configured earlier.
- Playwright tests prove the display summary has no visible text, statistics
  use weight `600`, card name/meta elements expose full native titles, and the
  mobile room grid keeps fixed columns with the display control below the last
  room row.
- The existing filtering, ignore, mobile viewport, and five-column desktop
  card tests remain passing.
- `npm run verify` must pass before publishing `0.1.12`.
