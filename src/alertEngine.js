const STATUS = Object.freeze({
  ERROR: 'error',
  WARNING: 'warning',
  ON: 'on',
  IDLE: 'idle'
});

const ACTIVE_STATES = new Set([
  'on',
  'open',
  'opening',
  'running',
  'playing',
  'heat',
  'cool',
  'dry',
  'fan_only',
  'heating',
  'cooling'
]);

const ERROR_STATES = new Set(['unavailable', 'unknown']);

const FAULT_DEVICE_CLASSES = new Set([
  'problem',
  'safety',
  'tamper',
  'smoke',
  'gas',
  'carbon_monoxide',
  'moisture',
  'battery'
]);

function minutesToMs(minutes) {
  return minutes * 60 * 1000;
}

function isUnavailable(entity) {
  return !entity || ERROR_STATES.has(entity.state);
}

function isBinarySensor(entity) {
  return Boolean(entity && typeof entity.entity_id === 'string' && entity.entity_id.startsWith('binary_sensor.'));
}

function isFault(entity) {
  return Boolean(
    isBinarySensor(entity) &&
    entity.state === 'on' &&
    FAULT_DEVICE_CLASSES.has(entity.attributes && entity.attributes.device_class)
  );
}

function isDisconnected(entity) {
  return Boolean(
    isBinarySensor(entity) &&
    entity.state === 'off' &&
    entity.attributes &&
    entity.attributes.device_class === 'connectivity'
  );
}

function isActive(entity) {
  return Boolean(entity && ACTIVE_STATES.has(entity.state));
}

function parsePower(entity) {
  if (!entity) {
    return null;
  }
  const number = Number(entity.state);
  return Number.isFinite(number) ? number : null;
}

class AlertEngine {
  constructor(options) {
    this.options = options;
    this.activeSince = new Map();
    this.powerSince = new Map();
  }

  reset(entityId) {
    this.activeSince.delete(entityId);
    this.powerSince.delete(entityId);
  }

  getOnDurationRule(entityId) {
    const explicit = this.options.alerts.on_duration_rules.find((rule) => rule.entity_id === entityId);
    if (explicit) {
      return explicit;
    }
    return {
      entity_id: entityId,
      duration_minutes: this.options.alerts.default_on_duration_minutes
    };
  }

  getHighPowerRule(entityId) {
    return this.options.alerts.high_power_rules.find((rule) => rule.entity_id === entityId);
  }

  evaluate(entity, statesById = {}, now = Date.now()) {
    const entityId = entity && entity.entity_id;

    if (isUnavailable(entity)) {
      if (entityId) {
        this.reset(entityId);
      }
      return {
        status: STATUS.ERROR,
        label: '离线',
        color: 'red',
        reason: 'unavailable'
      };
    }

    if (isDisconnected(entity)) {
      this.reset(entityId);
      return {
        status: STATUS.ERROR,
        label: '离线',
        color: 'red',
        reason: 'disconnected'
      };
    }

    if (isFault(entity)) {
      this.reset(entityId);
      return {
        status: STATUS.ERROR,
        label: '故障',
        color: 'red',
        reason: 'fault'
      };
    }

    const active = isActive(entity);

    if (!active) {
      this.reset(entityId);
      return {
        status: STATUS.IDLE,
        label: '在线',
        color: 'idle',
        reason: 'idle'
      };
    }

    if (!this.activeSince.has(entityId)) {
      this.activeSince.set(entityId, now);
    }

    const highPowerRule = this.getHighPowerRule(entityId);
    if (highPowerRule) {
      const power = parsePower(statesById[highPowerRule.power_sensor]);
      if (power !== null && power > highPowerRule.threshold_w) {
        if (!this.powerSince.has(entityId)) {
          this.powerSince.set(entityId, now);
        }
        if (now - this.powerSince.get(entityId) >= minutesToMs(highPowerRule.duration_minutes)) {
          return {
            status: STATUS.WARNING,
            label: '高功率',
            color: 'orange',
            reason: 'high_power',
            power_w: power
          };
        }
      } else {
        this.powerSince.delete(entityId);
      }
    }

    const onDurationRule = this.getOnDurationRule(entityId);
    if (now - this.activeSince.get(entityId) >= minutesToMs(onDurationRule.duration_minutes)) {
      return {
        status: STATUS.WARNING,
        label: '超时',
        color: 'orange',
        reason: 'on_duration'
      };
    }

    return {
      status: STATUS.ON,
      label: '开启',
      color: 'green',
      reason: 'active'
    };
  }
}

module.exports = {
  AlertEngine,
  STATUS,
  isUnavailable,
  isActive
};
