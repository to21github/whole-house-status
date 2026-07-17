const test = require('node:test');
const assert = require('node:assert/strict');
const { AlertEngine, STATUS } = require('../src/alertEngine');
const { normalizeOptions } = require('../src/options');

function entity(entityId, state, attributes = {}) {
  return { entity_id: entityId, state, attributes };
}

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
