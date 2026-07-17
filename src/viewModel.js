const { STATUS } = require('./alertEngine');
const { resolveRoom, buildRooms, createRegistryIndexes } = require('./roomResolver');

function domainOf(entityId) {
  return entityId.split('.')[0];
}

function friendlyName(entity) {
  return (entity.attributes && entity.attributes.friendly_name) || entity.entity_id;
}

function includeEntity(entity, options) {
  const domain = domainOf(entity.entity_id);
  return (
    options.entities.include_domains.includes(domain) &&
    !options.entities.exclude_entities.includes(entity.entity_id)
  );
}

function sortByStatusAndName(a, b) {
  const rank = {
    [STATUS.ERROR]: 0,
    [STATUS.WARNING]: 1,
    [STATUS.ON]: 2,
    [STATUS.IDLE]: 3
  };
  if (rank[a.status] !== rank[b.status]) {
    return rank[a.status] - rank[b.status];
  }
  return a.name.localeCompare(b.name, 'zh-CN');
}

function createDevice(entity, room, statusResult, options) {
  return {
    entity_id: entity.entity_id,
    name: friendlyName(entity),
    room,
    raw_state: entity.state,
    status: statusResult.status,
    status_label: statusResult.label,
    status_color: statusResult.color,
    reason: statusResult.reason,
    show_entity_id: options.display.show_entity_id
  };
}

function buildViewModel({
  states,
  registries = { entity: [], device: [], area: [] },
  options,
  alertEngine,
  now = Date.now(),
  selectedRoom = options.display.default_room,
  haConnected = true,
  configError = null
}) {
  const stateMap = states || {};
  alertEngine.prune(Object.keys(stateMap));
  const registryIndexes = createRegistryIndexes(registries);
  const allDisplayDevices = Object.values(stateMap)
    .filter((entity) => entity && entity.entity_id)
    .filter((entity) => includeEntity(entity, options))
    .map((entity) => {
      const room = resolveRoom(entity, registryIndexes, options);
      const statusResult = alertEngine.evaluate(entity, stateMap, now);
      return createDevice(entity, room, statusResult, options);
    })
    .sort(sortByStatusAndName);

  const alerts = allDisplayDevices
    .filter((device) => device.status === STATUS.ERROR || device.status === STATUS.WARNING)
    .sort(sortByStatusAndName);

  const selected = selectedRoom || '全部';
  const devices = allDisplayDevices
    .filter((device) => device.status !== STATUS.ERROR && device.status !== STATUS.WARNING)
    .filter((device) => selected === '全部' || device.room === selected)
    .sort(sortByStatusAndName);

  const stats = {
    online: allDisplayDevices.filter((device) => device.status !== STATUS.ERROR).length,
    on: allDisplayDevices.filter((device) => device.status === STATUS.ON).length,
    warning: allDisplayDevices.filter((device) => device.status === STATUS.WARNING).length,
    error: allDisplayDevices.filter((device) => device.status === STATUS.ERROR).length
  };

  return {
    title: options.display.title,
    selected_room: selected,
    rooms: buildRooms(allDisplayDevices, options),
    stats,
    alerts,
    devices,
    connection: {
      ha_connected: haConnected,
      config_error: configError
    },
    updated_at: new Date(now).toISOString()
  };
}

module.exports = {
  buildViewModel,
  domainOf,
  includeEntity
};
