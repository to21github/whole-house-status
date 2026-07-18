const test = require('node:test');
const assert = require('node:assert/strict');
const { AlertEngine, STATUS } = require('../src/alertEngine');
const { normalizeOptions } = require('../src/options');

function entity(entityId, state, attributes = {}) {
  return { entity_id: entityId, state, attributes };
}

const MINUTE = 60 * 1000;

test('unavailable devices are error and override every other state', () => {
  const engine = new AlertEngine(normalizeOptions({}));
  const result = engine.evaluate(entity('switch.kitchen', 'unavailable'), {}, Date.now());

  assert.equal(result.status, STATUS.ERROR);
  assert.equal(result.label, '离线');
  assert.equal(result.color, 'red');
});

test('recognized binary sensor fault classes are error with fault label', () => {
  const engine = new AlertEngine(normalizeOptions({}));
  const faultClasses = [
    'problem',
    'safety',
    'tamper',
    'smoke',
    'gas',
    'carbon_monoxide',
    'moisture',
    'battery'
  ];

  for (const deviceClass of faultClasses) {
    const result = engine.evaluate(
      entity(`binary_sensor.${deviceClass}`, 'on', { device_class: deviceClass }),
      {},
      Date.now()
    );

    assert.equal(result.status, STATUS.ERROR, deviceClass);
    assert.equal(result.label, '故障', deviceClass);
    assert.equal(result.color, 'red', deviceClass);
    assert.equal(result.reason, 'fault', deviceClass);
  }
});

test('connectivity binary sensor off is a disconnected error', () => {
  const engine = new AlertEngine(normalizeOptions({}));
  const result = engine.evaluate(
    entity('binary_sensor.router', 'off', { device_class: 'connectivity' }),
    {},
    Date.now()
  );

  assert.equal(result.status, STATUS.ERROR);
  assert.equal(result.label, '离线');
  assert.equal(result.color, 'red');
  assert.equal(result.reason, 'disconnected');
});

test('normal binary sensor classes remain active when on', () => {
  const engine = new AlertEngine(normalizeOptions({}));

  for (const deviceClass of ['door', 'motion']) {
    const result = engine.evaluate(
      entity(`binary_sensor.${deviceClass}`, 'on', { device_class: deviceClass }),
      {},
      Date.now()
    );

    assert.equal(result.status, STATUS.ON, deviceClass);
    assert.equal(result.label, '开启', deviceClass);
    assert.equal(result.color, 'green', deviceClass);
    assert.equal(result.reason, 'active', deviceClass);
  }
});

test('fault error outranks warning and resets active timers', () => {
  const options = normalizeOptions({
    alerts: {
      on_duration_rules: [
        { entity_id: 'binary_sensor.entry', duration_minutes: 60 }
      ]
    }
  });
  const engine = new AlertEngine(options);
  const now = Date.parse('2026-07-17T08:00:00Z');

  const active = entity('binary_sensor.entry', 'on', { device_class: 'door' });
  const fault = entity('binary_sensor.entry', 'on', { device_class: 'problem' });

  engine.evaluate(active, {}, now);
  const faultResult = engine.evaluate(fault, {}, now + 61 * 60 * 1000);
  const recoveredResult = engine.evaluate(active, {}, now + 62 * 60 * 1000);

  assert.equal(faultResult.status, STATUS.ERROR);
  assert.equal(faultResult.label, '故障');
  assert.equal(faultResult.reason, 'fault');
  assert.equal(recoveredResult.status, STATUS.ON);
});

test('active switch is on before timeout threshold', () => {
  const options = normalizeOptions({
    alerts: { default_on_duration_minutes: 480 }
  });
  const engine = new AlertEngine(options);
  const now = Date.parse('2026-07-17T08:00:00Z');

  const first = engine.evaluate(entity('switch.water_heater', 'on'), {}, now);
  const second = engine.evaluate(entity('switch.water_heater', 'on'), {}, now + 60 * 60 * 1000);

  assert.equal(first.status, STATUS.ON);
  assert.equal(second.status, STATUS.ON);
  assert.equal(second.label, '开启');
});

test('blank and non-string power sensor states are invalid', () => {
  const now = Date.parse('2026-07-17T08:00:00Z');
  const invalidStates = ['', '   ', null, undefined, 900];

  for (const sensorState of invalidStates) {
    const options = normalizeOptions({
      alerts: {
        high_power_rules: [
          {
            entity_id: 'switch.test_socket',
            power_sensor: 'sensor.test_power',
            threshold_w: 1,
            duration_minutes: 1
          }
        ]
      }
    });
    options.alerts.high_power_rules[0].threshold_w = -1;
    const engine = new AlertEngine(options);
    const activeEntity = entity('switch.test_socket', 'on');
    const states = {
      'sensor.test_power': entity('sensor.test_power', sensorState)
    };

    engine.evaluate(activeEntity, states, now);
    const result = engine.evaluate(activeEntity, states, now + MINUTE);

    assert.equal(result.status, STATUS.ON, String(sensorState));
  }
});

test('power equal to threshold does not count as high power', () => {
  const options = normalizeOptions({
    alerts: {
      high_power_rules: [
        {
          entity_id: 'switch.water_heater',
          power_sensor: 'sensor.water_heater_power',
          threshold_w: 800,
          duration_minutes: 1
        }
      ]
    }
  });
  const engine = new AlertEngine(options);
  const now = Date.parse('2026-07-17T08:00:00Z');
  const activeEntity = entity('switch.water_heater', 'on');
  const states = {
    'sensor.water_heater_power': entity('sensor.water_heater_power', '800')
  };

  engine.evaluate(activeEntity, states, now);
  const result = engine.evaluate(activeEntity, states, now + MINUTE);

  assert.equal(result.status, STATUS.ON);
});

test('dropping below the power threshold resets high-power duration', () => {
  const options = normalizeOptions({
    alerts: {
      high_power_rules: [
        {
          entity_id: 'switch.water_heater',
          power_sensor: 'sensor.water_heater_power',
          threshold_w: 800,
          duration_minutes: 1
        }
      ]
    }
  });
  const engine = new AlertEngine(options);
  const now = Date.parse('2026-07-17T08:00:00Z');
  const activeEntity = entity('switch.water_heater', 'on');
  const highPower = {
    'sensor.water_heater_power': entity('sensor.water_heater_power', '900')
  };
  const lowPower = {
    'sensor.water_heater_power': entity('sensor.water_heater_power', '700')
  };

  engine.evaluate(activeEntity, highPower, now);
  engine.evaluate(activeEntity, lowPower, now + 30 * 1000);
  const restarted = engine.evaluate(activeEntity, highPower, now + MINUTE);
  const warning = engine.evaluate(activeEntity, highPower, now + 2 * MINUTE);

  assert.equal(restarted.status, STATUS.ON);
  assert.equal(warning.status, STATUS.WARNING);
  assert.equal(warning.reason, 'high_power');
});

test('past last_changed starts active duration before first observation', () => {
  const options = normalizeOptions({
    alerts: {
      on_duration_rules: [
        { entity_id: 'switch.computer_socket', duration_minutes: 60 }
      ]
    }
  });
  const engine = new AlertEngine(options);
  const now = Date.parse('2026-07-17T08:00:00Z');
  const activeEntity = {
    ...entity('switch.computer_socket', 'on'),
    last_changed: new Date(now - 60 * MINUTE).toISOString()
  };

  const result = engine.evaluate(activeEntity, {}, now);

  assert.equal(result.status, STATUS.WARNING);
  assert.equal(result.reason, 'on_duration');
});

test('invalid or future last_changed falls back to observation time', () => {
  const now = Date.parse('2026-07-17T08:00:00Z');
  const invalidTimestamps = [
    null,
    'not-a-date',
    new Date(now + MINUTE).toISOString()
  ];

  for (const lastChanged of invalidTimestamps) {
    const options = normalizeOptions({
      alerts: {
        on_duration_rules: [
          { entity_id: 'switch.computer_socket', duration_minutes: 1 }
        ]
      }
    });
    const engine = new AlertEngine(options);
    const activeEntity = {
      ...entity('switch.computer_socket', 'on'),
      last_changed: lastChanged
    };

    const first = engine.evaluate(activeEntity, {}, now);
    const second = engine.evaluate(activeEntity, {}, now + MINUTE);

    assert.equal(first.status, STATUS.ON, String(lastChanged));
    assert.equal(second.status, STATUS.WARNING, String(lastChanged));
  }
});

test('climate auto and heat_cool states are active', () => {
  const engine = new AlertEngine(normalizeOptions({}));

  for (const state of ['auto', 'heat_cool']) {
    const result = engine.evaluate(entity(`climate.${state}`, state), {}, Date.now());

    assert.equal(result.status, STATUS.ON, state);
    assert.equal(result.color, 'green', state);
  }
});

test('entity objects without a usable entity id are invalid errors', () => {
  const engine = new AlertEngine(normalizeOptions({}));
  const invalidEntities = [
    { state: 'on', attributes: {} },
    entity('', 'on'),
    entity('   ', 'on')
  ];

  for (const invalidEntity of invalidEntities) {
    const result = engine.evaluate(invalidEntity, {}, Date.now());

    assert.equal(result.status, STATUS.ERROR);
    assert.equal(result.label, '故障');
    assert.equal(result.color, 'red');
    assert.equal(result.reason, 'invalid_entity');
  }

  assert.equal(engine.activeSince.has(undefined), false);
});

test('missing entities are invalid errors without shared timer keys', () => {
  const engine = new AlertEngine(normalizeOptions({}));
  const result = engine.evaluate(null, {}, Date.now());

  assert.equal(result.status, STATUS.ERROR);
  assert.equal(result.label, '故障');
  assert.equal(result.color, 'red');
  assert.equal(result.reason, 'invalid_entity');
  assert.equal(engine.activeSince.has(undefined), false);
  assert.equal(engine.powerSince.has(undefined), false);
  assert.equal(engine.lastObservedAt.has(undefined), false);
});

test('prune removes active and high-power timers for absent entities', () => {
  const options = normalizeOptions({
    alerts: {
      on_duration_rules: [
        { entity_id: 'switch.removed', duration_minutes: 60 }
      ],
      high_power_rules: [
        {
          entity_id: 'switch.removed',
          power_sensor: 'sensor.removed_power',
          threshold_w: 800,
          duration_minutes: 30
        }
      ]
    }
  });
  const engine = new AlertEngine(options);
  const now = Date.parse('2026-07-17T08:00:00Z');
  const activeEntity = entity('switch.removed', 'on');
  const highPower = {
    'sensor.removed_power': entity('sensor.removed_power', '900')
  };

  engine.evaluate(activeEntity, highPower, now);
  assert.equal(typeof engine.prune, 'function');
  engine.prune(new Set());
  const restarted = engine.evaluate(activeEntity, highPower, now + 61 * MINUTE);
  const warning = engine.evaluate(activeEntity, highPower, now + 91 * MINUTE);

  assert.equal(restarted.status, STATUS.ON);
  assert.equal(warning.status, STATUS.WARNING);
  assert.equal(warning.reason, 'high_power');
});

test('prune removes observation clocks for absent entities', () => {
  const options = normalizeOptions({
    alerts: {
      on_duration_rules: [
        { entity_id: 'switch.removed', duration_minutes: 60 }
      ]
    }
  });
  const engine = new AlertEngine(options);
  const now = Date.parse('2026-07-17T08:00:00Z');
  const activeEntity = entity('switch.removed', 'on');

  engine.evaluate(activeEntity, {}, now);
  engine.evaluate(activeEntity, {}, now + 120 * MINUTE);
  assert.equal(typeof engine.prune, 'function');
  engine.prune([]);
  engine.evaluate(activeEntity, {}, now + 30 * MINUTE);
  const result = engine.evaluate(activeEntity, {}, now + 90 * MINUTE);

  assert.equal(result.status, STATUS.WARNING);
  assert.equal(result.reason, 'on_duration');
});

test('out-of-order observation times cannot reverse a duration warning', () => {
  const options = normalizeOptions({
    alerts: {
      on_duration_rules: [
        { entity_id: 'switch.computer_socket', duration_minutes: 60 }
      ]
    }
  });
  const engine = new AlertEngine(options);
  const now = Date.parse('2026-07-17T08:00:00Z');
  const activeEntity = entity('switch.computer_socket', 'on');

  engine.evaluate(activeEntity, {}, now);
  const atBoundary = engine.evaluate(activeEntity, {}, now + 60 * MINUTE);
  const afterRollback = engine.evaluate(activeEntity, {}, now + 30 * MINUTE);

  assert.equal(atBoundary.status, STATUS.WARNING);
  assert.equal(afterRollback.status, STATUS.WARNING);
});

test('non-finite observation times use a finite current fallback', () => {
  for (const invalidNow of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const options = normalizeOptions({
      alerts: {
        on_duration_rules: [
          { entity_id: 'switch.computer_socket', duration_minutes: 60 }
        ]
      }
    });
    const engine = new AlertEngine(options);
    const activeEntity = entity('switch.computer_socket', 'on');
    const beforeObservation = Date.now();

    const first = engine.evaluate(activeEntity, {}, invalidNow);
    const second = engine.evaluate(activeEntity, {}, beforeObservation + 61 * MINUTE);

    assert.equal(first.status, STATUS.ON, String(invalidNow));
    assert.equal(second.status, STATUS.WARNING, String(invalidNow));
  }
});

test('high-power duration starts from process observation, not last_changed', () => {
  const options = normalizeOptions({
    alerts: {
      default_on_duration_minutes: 1440,
      high_power_rules: [
        {
          entity_id: 'switch.water_heater',
          power_sensor: 'sensor.water_heater_power',
          threshold_w: 800,
          duration_minutes: 30
        }
      ]
    }
  });
  const engine = new AlertEngine(options);
  const now = Date.parse('2026-07-17T08:00:00Z');
  const activeEntity = {
    ...entity('switch.water_heater', 'on'),
    last_changed: new Date(now - 120 * MINUTE).toISOString()
  };
  const states = {
    'sensor.water_heater_power': entity('sensor.water_heater_power', '900')
  };

  const first = engine.evaluate(activeEntity, states, now);
  const second = engine.evaluate(activeEntity, states, now + 30 * MINUTE);

  assert.equal(first.status, STATUS.ON);
  assert.equal(second.status, STATUS.WARNING);
  assert.equal(second.reason, 'high_power');
});

test('on-duration warning starts at the configured duration boundary', () => {
  const options = normalizeOptions({
    alerts: {
      on_duration_rules: [
        { entity_id: 'switch.computer_socket', duration_minutes: 60 }
      ]
    }
  });
  const engine = new AlertEngine(options);
  const now = Date.parse('2026-07-17T08:00:00Z');
  const activeEntity = entity('switch.computer_socket', 'on');

  engine.evaluate(activeEntity, {}, now);
  const result = engine.evaluate(activeEntity, {}, now + 60 * MINUTE);

  assert.equal(result.status, STATUS.WARNING);
  assert.equal(result.reason, 'on_duration');
});

test('on duration rule turns active device warning after configured minutes', () => {
  const options = normalizeOptions({
    alerts: {
      default_on_duration_minutes: 480,
      on_duration_rules: [
        { entity_id: 'switch.computer_socket', duration_minutes: 60 }
      ]
    }
  });
  const engine = new AlertEngine(options);
  const now = Date.parse('2026-07-17T08:00:00Z');

  engine.evaluate(entity('switch.computer_socket', 'on'), {}, now);
  const result = engine.evaluate(entity('switch.computer_socket', 'on'), {}, now + 61 * 60 * 1000);

  assert.equal(result.status, STATUS.WARNING);
  assert.equal(result.label, '超时');
  assert.equal(result.color, 'orange');
});

test('high power rule turns active device warning after sustained threshold', () => {
  const options = normalizeOptions({
    alerts: {
      high_power_rules: [
        {
          entity_id: 'switch.water_heater',
          power_sensor: 'sensor.water_heater_power',
          threshold_w: 800,
          duration_minutes: 30
        }
      ]
    }
  });
  const engine = new AlertEngine(options);
  const now = Date.parse('2026-07-17T08:00:00Z');
  const states = {
    'sensor.water_heater_power': entity('sensor.water_heater_power', '820')
  };

  engine.evaluate(entity('switch.water_heater', 'on'), states, now);
  const result = engine.evaluate(entity('switch.water_heater', 'on'), states, now + 31 * 60 * 1000);

  assert.equal(result.status, STATUS.WARNING);
  assert.equal(result.label, '高功率');
});

test('turning off resets duration timers', () => {
  const options = normalizeOptions({
    alerts: {
      on_duration_rules: [
        { entity_id: 'switch.computer_socket', duration_minutes: 60 }
      ]
    }
  });
  const engine = new AlertEngine(options);
  const now = Date.parse('2026-07-17T08:00:00Z');

  engine.evaluate(entity('switch.computer_socket', 'on'), {}, now);
  engine.evaluate(entity('switch.computer_socket', 'off'), {}, now + 30 * 60 * 1000);
  const result = engine.evaluate(entity('switch.computer_socket', 'on'), {}, now + 61 * 60 * 1000);

  assert.equal(result.status, STATUS.ON);
});
