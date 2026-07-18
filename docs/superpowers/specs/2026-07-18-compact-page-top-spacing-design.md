# Compact Page Top Spacing

## Goal

Remove excessive desktop whitespace above the Whole House Status title while
preserving title typography, horizontal gutters, bottom spacing, and mobile
layout.

## Scope

- Set the desktop `.page` top padding to `24px`.
- Keep the existing horizontal and bottom padding values unchanged.
- Keep the mobile `.page` rule at `20px 18px 48px`; mobile already has the
  requested compact top spacing.
- Do not alter the pending display-menu sizing changes in `styles.css`.

## Verification

The desktop Playwright test will assert a computed `.page` top padding of
`24px` and retain the existing title font-size assertion. The full frontend
suite verifies the mobile viewport and controls continue to fit their layouts.
