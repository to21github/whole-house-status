# Supervisor Options Envelope Handling

## Goal

Persist a runtime room-order change through the Home Assistant Supervisor
without submitting Supervisor response metadata as add-on configuration.

## Design

`GET /addons/self/options/config` returns the add-on configuration inside the
Supervisor API response envelope: `{ "result": "ok", "data": { ... } }`.
`SupervisorOptionsClient` will extract `data`, preserve all fields in that
configuration, replace only `rooms.order`, and continue to submit the result
as the `options` member of the existing `POST /addons/self/options` payload.

The client will reject a successful HTTP response that lacks an object-valued
`data` field. This prevents malformed Supervisor responses from being written
back as configuration.

## Verification

The existing client test will model the Supervisor response envelope and assert
that the POST body contains the original configuration fields plus only the
new room order. Before the implementation changes, that test must fail because
the current client nests the envelope incorrectly. The focused test and full
Node test suite must pass after the fix.
