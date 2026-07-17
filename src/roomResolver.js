function indexBy(items = [], key) {
  return items.reduce((result, item) => {
    if (item && item[key]) {
      result[item[key]] = item;
    }
    return result;
  }, {});
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

  const entityById = indexBy(registries.entity, 'entity_id');
  const deviceById = indexBy(registries.device, 'id');
  const areaById = indexBy(registries.area, 'area_id');
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
  const ordered = options.rooms.order.filter((room) => room === '全部' || discovered.includes(room));

  if (!ordered.includes('全部')) {
    ordered.unshift('全部');
  }

  for (const room of discovered) {
    if (!ordered.includes(room)) {
      ordered.push(room);
    }
  }

  return ordered;
}

module.exports = {
  resolveRoom,
  buildRooms
};
