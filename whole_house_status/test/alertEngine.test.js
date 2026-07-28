const assert = require('node:assert/strict');
const test = require('node:test');

const { AlertEngine, STATUS } = require('../src/alertEngine');
const { normalizeOptions } = require('../src/options');

test('labels a wet moisture sensor as a water-leak alert', () => {
  const engine = new AlertEngine(normalizeOptions({}));

  const result = engine.evaluate({
    entity_id: 'binary_sensor.kitchen_water_leak',
    state: 'on',
    attributes: { device_class: 'moisture' }
  });

  assert.deepEqual(result, {
    status: STATUS.ERROR,
    label: '漏水',
    color: 'red',
    reason: 'water_detected'
  });
});

test('keeps other fault sensor classes labeled as faults', () => {
  const engine = new AlertEngine(normalizeOptions({}));

  const result = engine.evaluate({
    entity_id: 'binary_sensor.kitchen_smoke',
    state: 'on',
    attributes: { device_class: 'smoke' }
  });

  assert.deepEqual(result, {
    status: STATUS.ERROR,
    label: '故障',
    color: 'red',
    reason: 'fault'
  });
});
