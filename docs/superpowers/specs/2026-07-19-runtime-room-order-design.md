# Runtime Room Ordering

## Goal

Let a user reorder room filter buttons from the running Whole House Status
dashboard. The resulting order must persist to the add-on's `rooms.order`
option without changing any other add-on configuration.

## Interaction

- The filter bar gains a room-order control. In its normal state, room buttons
  continue to select a filter exactly as they do today.
- Activating the control enters sort mode. Regular room buttons can then be
  reordered with pointer input, covering mouse, pen, and touch devices.
- `全部` is always fixed first and `未分组` is always fixed last. Neither is
  draggable in sort mode.
- Dropping a button submits the new visible order immediately. The control
  exits sort mode after the successful update. While a save is outstanding,
  no second sort can start.

## Data Flow

1. The browser submits `set_room_order` over the existing ingress WebSocket,
   including the complete current list of visible rooms.
2. The server rejects malformed, duplicate, stale, or sentinel-reordered
   lists. It derives `rooms.order` from the movable rooms and retains any
   configured rooms that are not currently visible.
3. A Supervisor client reads the add-on's current options and posts the same
   object with only `rooms.order` replaced to `/addons/self/options`. The
   add-on manifest enables `hassio_api` for this authenticated request.
4. After the Supervisor accepts the update, the server updates its in-memory
   options and broadcasts a fresh view model to all connected browsers.

## Failure Handling

The client keeps its pre-save view model while an update is pending. A failed
response clears the pending state, restores the server order, and displays a
configuration error. The server does not change in-memory ordering before the
Supervisor accepts the write.

## Verification

- Node tests cover command validation, preservation of hidden configured
  rooms, Supervisor option merging, success broadcasts, and failures.
- Browser tests cover sorting mode, desktop and touch drag reordering, fixed
  sentinel positions, command payloads, and restored ordering on failure.
- Existing filtering and compact mobile room-grid behavior remain covered.
