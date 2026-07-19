const FIRST_ROOM = '全部';
const LAST_ROOM = '未分组';

function isRoomName(value) {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function isValidRoomList(rooms) {
  if (!Array.isArray(rooms)) {
    return false;
  }

  for (let index = 0; index < rooms.length; index += 1) {
    if (!Object.hasOwn(rooms, index) || !isRoomName(rooms[index])) {
      return false;
    }
  }

  return new Set(rooms).size === rooms.length;
}

function hasValidSentinelPositions(rooms) {
  return rooms[0] === FIRST_ROOM && (!rooms.includes(LAST_ROOM) || rooms.at(-1) === LAST_ROOM);
}

function isValidDisplayedRoomOrder(candidate, displayed) {
  if (!isValidRoomList(candidate) || !isValidRoomList(displayed) || candidate.length !== displayed.length) {
    return false;
  }

  if (!hasValidSentinelPositions(candidate) || !hasValidSentinelPositions(displayed)) {
    return false;
  }

  const displayedRooms = new Set(displayed);
  return candidate.every((room) => displayedRooms.has(room));
}

function buildPersistedRoomOrder(displayedOrder, configuredOrder) {
  const order = [FIRST_ROOM];
  const included = new Set(order);

  function appendRoom(room) {
    if (!isRoomName(room) || room === FIRST_ROOM || room === LAST_ROOM || included.has(room)) {
      return;
    }

    included.add(room);
    order.push(room);
  }

  for (const room of Array.isArray(displayedOrder) ? displayedOrder : []) {
    appendRoom(room);
  }

  for (const room of Array.isArray(configuredOrder) ? configuredOrder : []) {
    appendRoom(room);
  }

  return order;
}

module.exports = {
  FIRST_ROOM,
  LAST_ROOM,
  buildPersistedRoomOrder,
  isValidDisplayedRoomOrder
};
