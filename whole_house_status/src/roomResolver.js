function indexBy(items, key) {
  return (Array.isArray(items) ? items : []).reduce((result, item) => {
    if (item && item[key]) {
      result[item[key]] = item;
    }
    return result;
  }, {});
}

function createRegistryIndexes(registries = {}) {
  return {
    entityById: indexBy(registries.entity, 'entity_id'),
    deviceById: indexBy(registries.device, 'id'),
    areaById: indexBy(registries.area, 'area_id')
  };
}

function isPreparedIndexes(registries) {
  return Boolean(
    registries &&
    typeof registries === 'object' &&
    Object.hasOwn(registries, 'entityById') &&
    Object.hasOwn(registries, 'deviceById') &&
    Object.hasOwn(registries, 'areaById')
  );
}

function areaName(areaId, areaById) {
  if (!areaId) {
    return null;
  }
  const area = areaById[areaId];
  return area && area.name ? area.name : null;
}

function resolveRoom(entity, registries = {}, options) {
  const entityId = entity.entity_id;
  const override = options.rooms.overrides[entityId];
  if (override) {
    return override;
  }

  const { entityById, deviceById, areaById } = isPreparedIndexes(registries)
    ? registries
    : createRegistryIndexes(registries);
  const registryEntity = entityById[entityId];

  const fromEntityArea = areaName(registryEntity && registryEntity.area_id, areaById);
  if (fromEntityArea) {
    return fromEntityArea;
  }

  const registryDevice = registryEntity && registryEntity.device_id ? deviceById[registryEntity.device_id] : null;
  const fromDeviceArea = areaName(registryDevice && registryDevice.area_id, areaById);
  if (fromDeviceArea) {
    return fromDeviceArea;
  }

  return '未分组';
}

function buildRooms(devices, options) {
  const discovered = [...new Set(devices.map((device) => device.room).filter(Boolean))];
  const hasUnassigned = discovered.includes('未分组');
  const ordered = [];

  for (const room of options.rooms.order) {
    if (room === '未分组') {
      continue;
    }
    if ((room === '全部' || discovered.includes(room)) && !ordered.includes(room)) {
      ordered.push(room);
    }
  }

  if (!ordered.includes('全部')) {
    ordered.unshift('全部');
  }

  for (const room of discovered) {
    if (room !== '未分组' && !ordered.includes(room)) {
      ordered.push(room);
    }
  }

  if (hasUnassigned) {
    ordered.push('未分组');
  }

  return ordered;
}

module.exports = {
  createRegistryIndexes,
  resolveRoom,
  buildRooms
};
