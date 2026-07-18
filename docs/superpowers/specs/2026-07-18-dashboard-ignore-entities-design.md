# Dashboard-Only Ignored Entities

## Goal

Let a user hide an entity from the Whole House Status dashboard without
changing the entity's visibility anywhere else in Home Assistant. The choice
must survive Add-on and Home Assistant restarts and apply to every browser
using this Add-on.

## User Experience

- The display menu contains the checkbox `显示已忽略的实体`; it is off by default.
- Every visible entity card has a compact `忽略` action in its upper-right corner.
- Selecting `忽略` immediately removes the entity from the default dashboard view.
- When `显示已忽略的实体` is enabled, dashboard-ignored cards are visible with a
  `不再忽略` action. Selecting it restores the entity to the normal view.
- Entity actions must show a clear failure notice and leave the previous state
  intact when persistence cannot be updated.

## Data Ownership

The Add-on owns a persisted JSON list at `/data/ignored-entities.json`. It
contains only validated entity IDs and is read when the server starts. An
atomic write updates the file whenever a dashboard ignore action succeeds.

This list is intentionally independent of Home Assistant's entity registry:
the Add-on must not send `config/entity_registry/update`, set `hidden_by`, or
otherwise change Home Assistant's entity visibility.

Existing exclusions retain their current behavior:

- Entities hidden natively in Home Assistant remain ignored in the dashboard.
- Entities in `entities.exclude_entities` remain ignored in the dashboard.
- Those external/configured exclusions are read-only from the card action,
  because this dashboard must not mutate their source of truth.

## Server and Client Flow

1. The browser sends a validated `set_dashboard_entity_ignored` message with
   an entity ID and boolean ignored value.
2. The server validates the request, updates the Add-on-owned store, rebuilds
   the view model, and broadcasts it to connected browsers.
3. The server sends an action result to the requester so the button can leave
   its pending state or surface an error.
4. The view model identifies whether an entity is dashboard-ignored or ignored
   by an external/configured source. The client only renders `不再忽略` for the
   former.

## Tests

- Store tests cover empty, malformed, validated, and persisted entity-ID lists.
- Server tests cover dashboard-only state updates, persistence, broadcasts,
  validation failures, and the absence of Home Assistant registry writes.
- View-model tests cover the two ignore sources and statistics filtering.
- Playwright tests cover the label, upper-right button, immediate filtering,
  show-ignored checkbox, restoration, and reload persistence.
