const { STATUS } = require('./alertEngine');
const { resolveRoom, buildRooms, createRegistryIndexes } = require('./roomResolver');

function domainOf(entityId) {
  return typeof entityId === 'string' ? entityId.split('.')[0] : '';
}

function hasUsableEntityId(entityId) {
  if (typeof entityId !== 'string' || entityId !== entityId.trim()) {
    return false;
  }
  const separator = entityId.indexOf('.');
  return separator > 0 && separator < entityId.length - 1;
}

function friendlyName(entity) {
  const name = entity.attributes && entity.attributes.friendly_name;
  return typeof name === 'string' && name.trim() ? name.trim() : entity.entity_id;
}

function includeEntity(entity, options) {
  if (!entity || !hasUsableEntityId(entity.entity_id)) {
    return false;
  }
  const domain = domainOf(entity.entity_id);
  return options.entities.include_domains.includes(domain);
}

function isIgnoredEntity(entity, options, registryIndexes) {
  const registryEntity = registryIndexes.entityById[entity.entity_id];
  return Boolean(registryEntity && registryEntity.hidden_by)
    || options.entities.exclude_entities.includes(entity.entity_id);
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
  const nameComparison = a.name.localeCompare(b.name, 'zh-CN');
  return nameComparison || a.entity_id.localeCompare(b.entity_id, 'zh-CN');
}

function createDevice(entity, room, statusResult, options, ignored) {
  return {
    entity_id: entity.entity_id,
    name: friendlyName(entity),
    room,
    raw_state: entity.state,
    status: statusResult.status,
    status_label: statusResult.label,
    status_color: statusResult.color,
    reason: statusResult.reason,
    ignored,
    show_entity_id: options.display.show_entity_id
  };
}

function normalizeRegistries(registries) {
  return registries && typeof registries === 'object' && !Array.isArray(registries)
    ? registries
    : { entity: [], device: [], area: [] };
}

function normalizeTimestamp(now) {
  if (typeof now === 'number' && Number.isFinite(now)) {
    return now;
  }
  if (typeof now === 'string') {
    const timestamp = Date.parse(now);
    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
  }
  return Date.now();
}

function alertEngineFailure(reason) {
  return {
    status: STATUS.ERROR,
    label: '故障',
    color: 'red',
    reason
  };
}

function prepareAlertEngine(alertEngine, entityIds) {
  if (!alertEngine || (typeof alertEngine !== 'object' && typeof alertEngine !== 'function')) {
    return { failureReason: 'alert_engine_unavailable' };
  }

  try {
    if (typeof alertEngine.prune !== 'function' || typeof alertEngine.evaluate !== 'function') {
      return { failureReason: 'alert_engine_unavailable' };
    }
    alertEngine.prune(entityIds);
  } catch {
    return { failureReason: 'alert_engine_error' };
  }

  return { alertEngine };
}

function evaluateSafely(preparedAlertEngine, entity, stateMap, now) {
  if (preparedAlertEngine.failureReason) {
    return alertEngineFailure(preparedAlertEngine.failureReason);
  }

  try {
    const result = preparedAlertEngine.alertEngine.evaluate(entity, stateMap, now);
    if (!result || typeof result !== 'object') {
      return alertEngineFailure('alert_engine_error');
    }
    return result;
  } catch {
    return alertEngineFailure('alert_engine_error');
  }
}

function buildViewModel({
  states,
  registries = { entity: [], device: [], area: [] },
  options,
  alertEngine,
  now,
  selectedRoom = options.display.default_room,
  haConnected = true,
  configError = null
}) {
  const stateMap = states || {};
  const effectiveNow = normalizeTimestamp(now);
  const preparedAlertEngine = prepareAlertEngine(alertEngine, Object.keys(stateMap));
  const registryIndexes = createRegistryIndexes(normalizeRegistries(registries));
  const allDisplayDevices = Object.values(stateMap)
    .filter((entity) => includeEntity(entity, options))
    .map((entity) => {
      const room = resolveRoom(entity, registryIndexes, options);
      const statusResult = evaluateSafely(preparedAlertEngine, entity, stateMap, effectiveNow);
      return createDevice(entity, room, statusResult, options, isIgnoredEntity(entity, options, registryIndexes));
    })
    .sort(sortByStatusAndName);

  const alerts = allDisplayDevices
    .filter((device) => device.status === STATUS.ERROR || device.status === STATUS.WARNING);

  const selected = selectedRoom || '全部';
  const devices = allDisplayDevices
    .filter((device) => device.status !== STATUS.ERROR && device.status !== STATUS.WARNING);
  const rooms = buildRooms(allDisplayDevices, options);
  if (!rooms.includes(selected)) {
    rooms.push(selected);
  }

  const stats = {
    online: 0,
    on: 0,
    warning: 0,
    error: 0
  };
  for (const device of allDisplayDevices) {
    if (device.ignored) {
      continue;
    }
    if (device.status !== STATUS.ERROR) {
      stats.online += 1;
    }
    if (device.status === STATUS.ON || device.status === STATUS.WARNING || device.status === STATUS.ERROR) {
      stats[device.status] += 1;
    }
  }

  return {
    title: options.display.title,
    selected_room: selected,
    rooms,
    stats,
    alerts,
    devices,
    connection: {
      ha_connected: haConnected,
      config_error: configError
    },
    updated_at: new Date(effectiveNow).toISOString()
  };
}

module.exports = {
  buildViewModel,
  domainOf,
  includeEntity,
  isIgnoredEntity
};
