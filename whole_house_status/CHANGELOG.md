# Changelog

## 0.1.24 - 2026-07-20

- Keep the selected room's highlight while it is hovered.
- Apply background-only hover feedback to the room-sort and display controls.

## 0.1.23 - 2026-07-20

- Allow several room-order adjustments in one sorting session and save the final order when the sort control is closed.
- Change room-filter hover feedback to a background color only, without a highlighted border.

## 0.1.22 - 2026-07-19

- Use the document's usable viewport for display-menu placement so desktop scrollbars cannot obscure it.
- Keep the display-menu frame and label within the available viewport, including narrow or short screens.

## 0.1.21 - 2026-07-19

- Position the display menu within the viewport automatically, including when the filter controls are at an edge or the viewport is short.

## 0.1.20 - 2026-07-19

- Keep mobile room sort and display controls together, and prevent the display menu from extending beyond the viewport.

## 0.1.19 - 2026-07-19

- Fix runtime room-order saves by unwrapping the Supervisor options response before updating the add-on configuration.

## 0.1.18 - 2026-07-19

- Add dashboard drag sorting for room filters and persist the resulting `rooms.order` through the Supervisor API.
- Keep `全部` first and `未分组` last while sorting rooms at runtime.

## 0.1.17

- Add Simplified Chinese labels and descriptions for Add-on configuration fields.
- Simplify the source package by removing development plans and test tooling.

## 0.1.16

- Separate ignored entity cards from active warnings and errors.

## 0.1.15

- Align the mobile room filter grid with the statistics cards and keep the display icon beside the final room.

## 0.1.14

- Use a compact custom checkbox for showing ignored entities.

## 0.1.13

- Make the display control a circular icon button.

## 0.1.12

- Keep unassigned rooms last, align mobile room controls, and improve display and card readability.

## 0.1.11

- Fit the ignored-entity display option to its content.

## 0.1.10

- Reduce dashboard top spacing and compact the ignored-entity display menu.

## 0.1.9

- Keep mobile room selector controls at a fixed width when their final row is incomplete.

## 0.1.8

- Compact room selector and display control frames without changing text sizes.

## 0.1.7

- Add persistent dashboard-only entity ignore actions without changing Home Assistant visibility.

## 0.1.6

- Release an updated Home Assistant Add-on package.

## 0.1.5

- Add the Home Assistant Add-on changelog required for Supervisor updates.

## 0.1.4

- Reduce the dashboard title size.

## 0.1.3

- Keep five entity cards per row at standard desktop widths.

## 0.1.2

- Use compact horizontal statistic cards and a five-column desktop entity grid.

## 0.1.1

- Treat Home Assistant hidden entities as ignored dashboard entities.

## 0.1.0

- Initial Home Assistant Add-on release.
