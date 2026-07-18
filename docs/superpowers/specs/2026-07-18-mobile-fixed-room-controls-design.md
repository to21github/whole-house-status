# Fixed-Width Mobile Room Controls

## Goal

Keep every mobile room selector, including a final `卫生间` item, at the shared
96px control width instead of stretching it across the remaining row space.

## Design

At the mobile breakpoint, replace the growing room-button flex rule with
`flex: 0 0 96px`. This preserves the 96px desktop control width, 42px height,
20px mobile label size, wrapping behavior, and 10px gaps. The display-menu
trigger remains an independent 108px-minimum control and is not stretched.

## Verification

Extend the mobile Playwright test with several room names and assert every
button has a 96px rendered width. The test must fail with the current growing
flex rule and pass after the CSS-only change. Existing mobile menu viewport and
desktop compact-control tests remain regression coverage.
