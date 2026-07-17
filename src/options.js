const fs = require('node:fs');

const DEFAULT_OPTIONS = Object.freeze({
  display: Object.freeze({
    title: '全屋设备状态',
    default_room: '全部',
    show_entity_id: true
  }),
  entities: Object.freeze({
    include_domains: Object.freeze(['switch', 'light', 'climate', 'binary_sensor']),
    exclude_entities: Object.freeze([])
  }),
  rooms: Object.freeze({
    overrides: Object.freeze({}),
    order: Object.freeze(['全部', '门口', '客厅', '主卧', '次卧', '厨房', '阳台', '儿童房', '设备间'])
  }),
  alerts: Object.freeze({
    default_on_duration_minutes: 480,
    high_power_rules: Object.freeze([]),
    on_duration_rules: Object.freeze([])
  })
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeOverrides(value) {
  if (Array.isArray(value)) {
    return value.reduce((result, item) => {
      if (item && typeof item.entity_id === 'string' && item.entity_id && typeof item.room === 'string' && item.room) {
        result[item.entity_id] = item.room;
      }
      return result;
    }, {});
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((result, [entityId, room]) => {
      if (typeof entityId === 'string' && entityId && typeof room === 'string' && room) {
        result[entityId] = room;
      }
      return result;
    }, {});
  }

  return {};
}

function normalizeOptions(raw = {}) {
  const base = clone(DEFAULT_OPTIONS);
  const display = raw.display || {};
  const entities = raw.entities || {};
  const rooms = raw.rooms || {};
  const alerts = raw.alerts || {};

  base.display.title = typeof display.title === 'string' && display.title ? display.title : base.display.title;
  base.display.default_room = typeof display.default_room === 'string' && display.default_room ? display.default_room : base.display.default_room;
  base.display.show_entity_id = typeof display.show_entity_id === 'boolean' ? display.show_entity_id : base.display.show_entity_id;

  base.entities.include_domains = asArray(entities.include_domains)
    .filter((domain) => typeof domain === 'string' && domain)
    .map((domain) => domain.trim())
    .filter(Boolean);
  if (base.entities.include_domains.length === 0) {
    base.entities.include_domains = clone(DEFAULT_OPTIONS.entities.include_domains);
  }

  base.entities.exclude_entities = asArray(entities.exclude_entities)
    .filter((entityId) => typeof entityId === 'string' && entityId);

  base.rooms.overrides = normalizeOverrides(rooms.overrides);
  base.rooms.order = asArray(rooms.order).filter((room) => typeof room === 'string' && room);
  if (!base.rooms.order.includes('全部')) {
    base.rooms.order.unshift('全部');
  }
  if (base.rooms.order.length === 0) {
    base.rooms.order = clone(DEFAULT_OPTIONS.rooms.order);
  }

  base.alerts.default_on_duration_minutes = asPositiveNumber(
    alerts.default_on_duration_minutes,
    DEFAULT_OPTIONS.alerts.default_on_duration_minutes
  );
  base.alerts.high_power_rules = asArray(alerts.high_power_rules)
    .map((rule) => ({
      entity_id: rule && typeof rule.entity_id === 'string' ? rule.entity_id : '',
      power_sensor: rule && typeof rule.power_sensor === 'string' ? rule.power_sensor : '',
      threshold_w: Number(rule && rule.threshold_w),
      duration_minutes: Number(rule && rule.duration_minutes)
    }))
    .filter((rule) => (
      rule.entity_id &&
      rule.power_sensor &&
      Number.isFinite(rule.threshold_w) &&
      rule.threshold_w > 0 &&
      Number.isFinite(rule.duration_minutes) &&
      rule.duration_minutes > 0
    ));
  base.alerts.on_duration_rules = asArray(alerts.on_duration_rules)
    .map((rule) => ({
      entity_id: rule && typeof rule.entity_id === 'string' ? rule.entity_id : '',
      duration_minutes: Number(rule && rule.duration_minutes)
    }))
    .filter((rule) => rule.entity_id && Number.isFinite(rule.duration_minutes) && rule.duration_minutes > 0);

  return base;
}

function loadOptions(path = process.env.OPTIONS_PATH || '/data/options.json') {
  if (!fs.existsSync(path)) {
    return normalizeOptions({});
  }

  const parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
  return normalizeOptions(parsed);
}

module.exports = {
  DEFAULT_OPTIONS,
  normalizeOptions,
  loadOptions
};
