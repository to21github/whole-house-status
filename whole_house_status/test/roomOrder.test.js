const assert = require('node:assert/strict');
const test = require('node:test');

const {
  FIRST_ROOM,
  LAST_ROOM,
  buildPersistedRoomOrder,
  isValidDisplayedRoomOrder
} = require('../src/roomOrder');

test('accepts a reorder that keeps the displayed room set and sentinels', () => {
  const displayed = [FIRST_ROOM, '客厅', '厨房', LAST_ROOM];
  const candidate = [FIRST_ROOM, '厨房', '客厅', LAST_ROOM];

  assert.equal(isValidDisplayedRoomOrder(candidate, displayed), true);
});

test('rejects moved, duplicated, and unknown displayed rooms', () => {
  const displayed = [FIRST_ROOM, '客厅', '厨房', LAST_ROOM];

  assert.equal(isValidDisplayedRoomOrder(['厨房', FIRST_ROOM, '客厅', LAST_ROOM], displayed), false);
  assert.equal(isValidDisplayedRoomOrder([FIRST_ROOM, '客厅', '客厅', LAST_ROOM], displayed), false);
  assert.equal(isValidDisplayedRoomOrder([FIRST_ROOM, '厨房', '书房', LAST_ROOM], displayed), false);
});

test('rejects malformed displayed room submissions', () => {
  const displayed = [FIRST_ROOM, '客厅', '厨房', LAST_ROOM];

  assert.equal(isValidDisplayedRoomOrder([FIRST_ROOM, '客厅', '厨房'], displayed), false);
  assert.equal(isValidDisplayedRoomOrder([FIRST_ROOM, LAST_ROOM, '客厅', '厨房'], displayed), false);
  assert.equal(isValidDisplayedRoomOrder([FIRST_ROOM, '客厅 ', '厨房', LAST_ROOM], displayed), false);
  assert.equal(isValidDisplayedRoomOrder(null, displayed), false);
});

test('rejects sparse displayed room submissions', () => {
  const displayed = [FIRST_ROOM, '客厅', '厨房'];
  const candidate = [FIRST_ROOM, , '厨房'];

  assert.equal(isValidDisplayedRoomOrder(candidate, displayed), false);
});

test('accepts a displayed reorder without an unassigned-room sentinel', () => {
  const displayed = [FIRST_ROOM, '客厅', '厨房'];
  const candidate = [FIRST_ROOM, '厨房', '客厅'];

  assert.equal(isValidDisplayedRoomOrder(candidate, displayed), true);
});

test('builds persisted room order from submitted rooms and configured fallbacks', () => {
  const displayed = [FIRST_ROOM, '厨房', '客厅', LAST_ROOM];
  const configured = [FIRST_ROOM, '客厅', '门口', '厨房', '阳台'];

  assert.deepEqual(
    buildPersistedRoomOrder(displayed, configured),
    [FIRST_ROOM, '厨房', '客厅', '门口', '阳台']
  );
});

test('builds a unique persisted order without an unassigned room', () => {
  const displayed = [FIRST_ROOM, '厨房', '客厅'];
  const configured = [FIRST_ROOM, '客厅', '门口', '客厅', LAST_ROOM, '', '厨房', '阳台', FIRST_ROOM];

  assert.deepEqual(
    buildPersistedRoomOrder(displayed, configured),
    [FIRST_ROOM, '厨房', '客厅', '门口', '阳台']
  );
});
