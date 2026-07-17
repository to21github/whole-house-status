# Whole House Status Add-on Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Home Assistant OS Add-on that shows a side-bar Ingress dashboard for real-time whole-house device status monitoring.

**Architecture:** A Node.js service runs inside the Add-on, connects to Home Assistant Core through the Supervisor-proxied WebSocket API, normalizes entity state, computes room grouping and alerts, then streams a view model to a static frontend over a local WebSocket. The frontend renders the confirmed first-version dark card-grid UI and never talks directly to Home Assistant.

**Tech Stack:** Home Assistant Add-on metadata, Docker, Node.js CommonJS, native `node:test`, `ws`, static HTML/CSS/JS, Playwright for visual smoke checks.

---

## File Structure

Create these files at the repository root:

- `config.yaml`: Home Assistant Add-on metadata, options, schema, Ingress, and API permissions.
- `Dockerfile`: Container build for the Node.js Add-on.
- `package.json`: Node scripts and dependencies.
- `src/options.js`: Load and normalize `/data/options.json`.
- `src/alertEngine.js`: Classify devices as online, on, warning, or error.
- `src/roomResolver.js`: Resolve rooms from configured overrides and HA registries.
- `src/stateStore.js`: Store current HA entity states and apply `state_changed` events.
- `src/viewModel.js`: Convert raw states into frontend-ready stats, rooms, alerts, and device cards.
- `src/haClient.js`: Connect to HA WebSocket, authenticate, load states and registries, subscribe to events.
- `src/server.js`: Serve static files, manage browser WebSocket clients, connect HA client to view model updates.
- `public/index.html`: App shell.
- `public/styles.css`: Confirmed first-version dark UI.
- `public/app.js`: Browser WebSocket client, room filtering, rendering.
- `test/options.test.js`: Options normalization tests.
- `test/alertEngine.test.js`: Alert and status priority tests.
- `test/roomResolver.test.js`: Room override and registry tests.
- `test/viewModel.test.js`: Stats, sorting, and filtering tests.
- `test/frontend.spec.js`: Playwright smoke and layout checks.

Do not commit `.superpowers/`, `node_modules/`, `coverage/`, or generated screenshots.

---

### Task 1: Add Add-on Metadata And Options Loader

**Files:**
- Create: `package.json`
- Create: `config.yaml`
- Create: `Dockerfile`
- Create: `src/options.js`
- Create: `test/options.test.js`

- [ ] **Step 1: Write the failing options test**

Create `test/options.test.js` with:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOptions, DEFAULT_OPTIONS } = require('../src/options');

test('normalizeOptions returns safe defaults', () => {
  const options = normalizeOptions({});

  assert.equal(options.display.title, '全屋设备状态');
  assert.deepEqual(options.entities.include_domains, ['switch', 'light', 'climate', 'binary_sensor']);
  assert.equal(options.alerts.default_on_duration_minutes, 480);
  assert.equal(options.rooms.order[0], '全部');
});

test('normalizeOptions supports object room overrides', () => {
  const options = normalizeOptions({
    rooms: {
      overrides: {
        'switch.men_ting_ding_deng': '门口'
      }
    }
  });

  assert.deepEqual(options.rooms.overrides, {
    'switch.men_ting_ding_deng': '门口'
  });
});

test('normalizeOptions supports array room overrides from add-on schema', () => {
  const options = normalizeOptions({
    rooms: {
      overrides: [
        { entity_id: 'light.kitchen', room: '厨房' },
        { entity_id: 'switch.balcony', room: '阳台' }
      ]
    }
  });

  assert.deepEqual(options.rooms.overrides, {
    'light.kitchen': '厨房',
    'switch.balcony': '阳台'
  });
});

test('normalizeOptions cleans invalid alert rules', () => {
  const options = normalizeOptions({
    alerts: {
      high_power_rules: [
        {
          entity_id: 'switch.water_heater',
          power_sensor: 'sensor.water_heater_power',
          threshold_w: '800',
          duration_minutes: '30'
        },
        {
          entity_id: '',
          power_sensor: 'sensor.bad',
          threshold_w: 'bad',
          duration_minutes: 1
        }
      ],
      on_duration_rules: [
        { entity_id: 'switch.computer_socket', duration_minutes: '480' },
        { entity_id: '', duration_minutes: 20 }
      ]
    }
  });

  assert.deepEqual(options.alerts.high_power_rules, [
    {
      entity_id: 'switch.water_heater',
      power_sensor: 'sensor.water_heater_power',
      threshold_w: 800,
      duration_minutes: 30
    }
  ]);
  assert.deepEqual(options.alerts.on_duration_rules, [
    {
      entity_id: 'switch.computer_socket',
      duration_minutes: 480
    }
  ]);
});

test('DEFAULT_OPTIONS is not mutated by normalizeOptions', () => {
  const before = JSON.stringify(DEFAULT_OPTIONS);
  normalizeOptions({
    display: { title: '门口设备状态' },
    rooms: { order: ['全部', '门口'] }
  });
  assert.equal(JSON.stringify(DEFAULT_OPTIONS), before);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- test/options.test.js
```

Expected: FAIL because `package.json` and `src/options.js` do not exist yet.

- [ ] **Step 3: Create `package.json`**

Create `package.json`:

```json
{
  "name": "whole-house-status-addon",
  "version": "0.1.0",
  "description": "Home Assistant Add-on for whole-house device status monitoring.",
  "main": "src/server.js",
  "type": "commonjs",
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test",
    "test:unit": "node --test test/*.test.js",
    "test:frontend": "playwright test test/frontend.spec.js",
    "verify": "npm run test:unit && npm run test:frontend"
  },
  "dependencies": {
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.45.0"
  }
}
```

- [ ] **Step 4: Create `config.yaml`**

Create `config.yaml`:

```yaml
name: Whole House Status
version: "0.1.0"
slug: whole_house_status
description: 全屋设备状态监控面板
url: https://github.com/local/whole-house-status-addon
arch:
  - aarch64
  - amd64
  - armhf
  - armv7
  - i386
startup: services
boot: auto
init: false
ingress: true
ingress_port: 8099
panel_icon: mdi:home-analytics
panel_title: 全屋设备状态
homeassistant_api: true
options:
  display:
    title: 全屋设备状态
    default_room: 全部
    show_entity_id: true
  entities:
    include_domains:
      - switch
      - light
      - climate
      - binary_sensor
    exclude_entities: []
  rooms:
    overrides: []
    order:
      - 全部
      - 门口
      - 客厅
      - 主卧
      - 次卧
      - 厨房
      - 阳台
      - 儿童房
      - 设备间
  alerts:
    default_on_duration_minutes: 480
    high_power_rules: []
    on_duration_rules: []
schema:
  display:
    title: str
    default_room: str
    show_entity_id: bool
  entities:
    include_domains:
      - str
    exclude_entities:
      - str
  rooms:
    overrides:
      - entity_id: str
        room: str
    order:
      - str
  alerts:
    default_on_duration_minutes: int
    high_power_rules:
      - entity_id: str
        power_sensor: str
        threshold_w: float
        duration_minutes: int
    on_duration_rules:
      - entity_id: str
        duration_minutes: int
```

- [ ] **Step 5: Create `Dockerfile`**

Create `Dockerfile`:

```Dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public

ENV PORT=8099
EXPOSE 8099

CMD ["node", "src/server.js"]
```

- [ ] **Step 6: Implement `src/options.js`**

Create `src/options.js`:

```js
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
```

- [ ] **Step 7: Run the options test and verify it passes**

Run:

```bash
npm install
npm test -- test/options.test.js
```

Expected: PASS for all tests in `test/options.test.js`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json config.yaml Dockerfile src/options.js test/options.test.js
git commit -m "feat: add addon metadata and options loader"
```

---

### Task 2: Implement Alert Engine

**Files:**
- Create: `src/alertEngine.js`
- Create: `test/alertEngine.test.js`

- [ ] **Step 1: Write the failing alert tests**

Create `test/alertEngine.test.js`:

```js
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
```

- [ ] **Step 2: Run the alert test and verify it fails**

Run:

```bash
npm test -- test/alertEngine.test.js
```

Expected: FAIL with module-not-found for `src/alertEngine.js`.

- [ ] **Step 3: Implement `src/alertEngine.js`**

Create `src/alertEngine.js`:

```js
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

function minutesToMs(minutes) {
  return minutes * 60 * 1000;
}

function isUnavailable(entity) {
  return !entity || ERROR_STATES.has(entity.state);
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
```

- [ ] **Step 4: Run the alert test and verify it passes**

Run:

```bash
npm test -- test/alertEngine.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/alertEngine.js test/alertEngine.test.js
git commit -m "feat: add device alert engine"
```

---

### Task 3: Implement Room Resolver And State Store

**Files:**
- Create: `src/roomResolver.js`
- Create: `src/stateStore.js`
- Create: `test/roomResolver.test.js`

- [ ] **Step 1: Write the failing room resolver tests**

Create `test/roomResolver.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOptions } = require('../src/options');
const { resolveRoom, buildRooms } = require('../src/roomResolver');
const { StateStore } = require('../src/stateStore');

test('room override wins over Home Assistant registries', () => {
  const options = normalizeOptions({
    rooms: {
      overrides: {
        'switch.men_ting_ding_deng': '门口'
      }
    }
  });
  const registries = {
    entity: [{ entity_id: 'switch.men_ting_ding_deng', area_id: 'living_room' }],
    device: [],
    area: [{ area_id: 'living_room', name: '客厅' }]
  };

  const room = resolveRoom({ entity_id: 'switch.men_ting_ding_deng' }, registries, options);
  assert.equal(room, '门口');
});

test('entity registry area is used when no override exists', () => {
  const options = normalizeOptions({});
  const registries = {
    entity: [{ entity_id: 'light.kitchen_ceiling', area_id: 'kitchen' }],
    device: [],
    area: [{ area_id: 'kitchen', name: '厨房' }]
  };

  const room = resolveRoom({ entity_id: 'light.kitchen_ceiling' }, registries, options);
  assert.equal(room, '厨房');
});

test('device registry area is used when entity has only device_id', () => {
  const options = normalizeOptions({});
  const registries = {
    entity: [{ entity_id: 'binary_sensor.balcony_motion', device_id: 'device-1' }],
    device: [{ id: 'device-1', area_id: 'balcony' }],
    area: [{ area_id: 'balcony', name: '阳台' }]
  };

  const room = resolveRoom({ entity_id: 'binary_sensor.balcony_motion' }, registries, options);
  assert.equal(room, '阳台');
});

test('unknown entities are placed into 未分组', () => {
  const options = normalizeOptions({});
  const room = resolveRoom({ entity_id: 'switch.unknown' }, { entity: [], device: [], area: [] }, options);
  assert.equal(room, '未分组');
});

test('buildRooms keeps configured order and appends discovered rooms', () => {
  const options = normalizeOptions({
    rooms: { order: ['全部', '门口', '客厅'] }
  });
  const rooms = buildRooms([
    { room: '客厅' },
    { room: '厨房' },
    { room: '门口' }
  ], options);

  assert.deepEqual(rooms, ['全部', '门口', '客厅', '厨房']);
});

test('StateStore applies state_changed events', () => {
  const store = new StateStore();
  store.setStates([
    { entity_id: 'switch.a', state: 'off', attributes: {} }
  ]);
  store.applyStateChanged({
    data: {
      entity_id: 'switch.a',
      new_state: { entity_id: 'switch.a', state: 'on', attributes: {} }
    }
  });

  assert.equal(store.getStateMap()['switch.a'].state, 'on');
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npm test -- test/roomResolver.test.js
```

Expected: FAIL with module-not-found for `src/roomResolver.js` and `src/stateStore.js`.

- [ ] **Step 3: Implement `src/roomResolver.js`**

Create `src/roomResolver.js`:

```js
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
```

- [ ] **Step 4: Implement `src/stateStore.js`**

Create `src/stateStore.js`:

```js
class StateStore {
  constructor() {
    this.states = new Map();
  }

  setStates(states) {
    this.states.clear();
    for (const state of states) {
      if (state && state.entity_id) {
        this.states.set(state.entity_id, state);
      }
    }
  }

  applyStateChanged(event) {
    const newState = event && event.data && event.data.new_state;
    const entityId = event && event.data && event.data.entity_id;
    if (newState && newState.entity_id) {
      this.states.set(newState.entity_id, newState);
    } else if (entityId) {
      this.states.delete(entityId);
    }
  }

  getStateMap() {
    return Object.fromEntries(this.states.entries());
  }

  getStates() {
    return [...this.states.values()];
  }
}

module.exports = {
  StateStore
};
```

- [ ] **Step 5: Run the room and state tests**

Run:

```bash
npm test -- test/roomResolver.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/roomResolver.js src/stateStore.js test/roomResolver.test.js
git commit -m "feat: add room resolver and state store"
```

---

### Task 4: Build Frontend View Model

**Files:**
- Create: `src/viewModel.js`
- Create: `test/viewModel.test.js`

- [ ] **Step 1: Write the failing view-model tests**

Create `test/viewModel.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOptions } = require('../src/options');
const { AlertEngine } = require('../src/alertEngine');
const { buildViewModel } = require('../src/viewModel');

function entity(entityId, state, friendlyName) {
  return {
    entity_id: entityId,
    state,
    attributes: {
      friendly_name: friendlyName
    }
  };
}

test('buildViewModel computes stats and keeps alerts first', () => {
  const options = normalizeOptions({
    rooms: {
      overrides: {
        'switch.offline': '客厅',
        'switch.timeout': '门口',
        'light.door': '门口'
      }
    },
    alerts: {
      on_duration_rules: [
        { entity_id: 'switch.timeout', duration_minutes: 1 }
      ]
    }
  });
  const alertEngine = new AlertEngine(options);
  const now = Date.parse('2026-07-17T08:00:00Z');
  const states = {
    'switch.offline': entity('switch.offline', 'unavailable', '客厅主灯'),
    'switch.timeout': entity('switch.timeout', 'on', '电脑开关'),
    'light.door': entity('light.door', 'on', '门口顶灯'),
    'sensor.power': entity('sensor.power', '900', '功率')
  };

  alertEngine.evaluate(states['switch.timeout'], states, now);
  const model = buildViewModel({
    states,
    registries: { entity: [], device: [], area: [] },
    options,
    alertEngine,
    now: now + 2 * 60 * 1000,
    selectedRoom: '门口',
    haConnected: true
  });

  assert.equal(model.stats.error, 1);
  assert.equal(model.stats.warning, 1);
  assert.equal(model.stats.on, 1);
  assert.equal(model.stats.online, 2);
  assert.equal(model.alerts[0].entity_id, 'switch.offline');
  assert.equal(model.alerts[0].status, 'error');
  assert.equal(model.alerts[1].entity_id, 'switch.timeout');
  assert.equal(model.devices.length, 1);
  assert.equal(model.devices[0].entity_id, 'light.door');
});

test('buildViewModel excludes configured entities and unsupported domains', () => {
  const options = normalizeOptions({
    entities: {
      include_domains: ['switch', 'light'],
      exclude_entities: ['switch.hidden']
    }
  });
  const model = buildViewModel({
    states: {
      'switch.hidden': entity('switch.hidden', 'on', '隐藏开关'),
      'media_player.tv': entity('media_player.tv', 'on', '电视'),
      'light.visible': entity('light.visible', 'off', '可见灯')
    },
    registries: { entity: [], device: [], area: [] },
    options,
    alertEngine: new AlertEngine(options),
    now: Date.now(),
    selectedRoom: '全部',
    haConnected: true
  });

  assert.deepEqual(model.devices.map((device) => device.entity_id), ['light.visible']);
});

test('buildViewModel includes configured room order', () => {
  const options = normalizeOptions({
    rooms: {
      order: ['全部', '门口', '客厅'],
      overrides: { 'switch.a': '客厅' }
    }
  });
  const model = buildViewModel({
    states: {
      'switch.a': entity('switch.a', 'off', '开关 A')
    },
    registries: { entity: [], device: [], area: [] },
    options,
    alertEngine: new AlertEngine(options),
    now: Date.now(),
    selectedRoom: '全部',
    haConnected: false,
    configError: '配置解析失败'
  });

  assert.deepEqual(model.rooms, ['全部', '客厅']);
  assert.equal(model.connection.ha_connected, false);
  assert.equal(model.connection.config_error, '配置解析失败');
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npm test -- test/viewModel.test.js
```

Expected: FAIL with module-not-found for `src/viewModel.js`.

- [ ] **Step 3: Implement `src/viewModel.js`**

Create `src/viewModel.js`:

```js
const { STATUS } = require('./alertEngine');
const { resolveRoom, buildRooms } = require('./roomResolver');

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
  const allDisplayDevices = Object.values(stateMap)
    .filter((entity) => entity && entity.entity_id)
    .filter((entity) => includeEntity(entity, options))
    .map((entity) => {
      const room = resolveRoom(entity, registries, options);
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
```

- [ ] **Step 4: Run all unit tests**

Run:

```bash
npm run test:unit
```

Expected: PASS for `options`, `alertEngine`, `roomResolver`, and `viewModel` tests.

- [ ] **Step 5: Commit**

```bash
git add src/viewModel.js test/viewModel.test.js
git commit -m "feat: build dashboard view model"
```

---

### Task 5: Implement HA Client And Add-on Server

**Files:**
- Create: `src/haClient.js`
- Create: `src/server.js`

- [ ] **Step 1: Create `src/haClient.js`**

Create `src/haClient.js`:

```js
const EventEmitter = require('node:events');
const WebSocket = require('ws');

class HomeAssistantClient extends EventEmitter {
  constructor({
    url = process.env.HA_WS_URL || 'ws://supervisor/core/websocket',
    token = process.env.SUPERVISOR_TOKEN,
    reconnectBaseMs = 1000,
    reconnectMaxMs = 30000
  } = {}) {
    super();
    this.url = url;
    this.token = token;
    this.reconnectBaseMs = reconnectBaseMs;
    this.reconnectMaxMs = reconnectMaxMs;
    this.nextId = 1;
    this.pending = new Map();
    this.connected = false;
    this.retry = 0;
    this.ws = null;
    this.closedByUser = false;
  }

  connect() {
    if (!this.token) {
      throw new Error('SUPERVISOR_TOKEN is required unless USE_MOCK_DATA=true');
    }

    this.closedByUser = false;
    this.ws = new WebSocket(this.url);

    this.ws.on('message', (buffer) => this.handleMessage(buffer));
    this.ws.on('close', () => this.handleClose());
    this.ws.on('error', (error) => this.emit('error', error));
  }

  close() {
    this.closedByUser = true;
    if (this.ws) {
      this.ws.close();
    }
  }

  handleClose() {
    this.connected = false;
    this.emit('connection', false);
    for (const [, pending] of this.pending) {
      pending.reject(new Error('Home Assistant WebSocket closed'));
    }
    this.pending.clear();

    if (!this.closedByUser) {
      const delay = Math.min(this.reconnectBaseMs * 2 ** this.retry, this.reconnectMaxMs);
      this.retry += 1;
      setTimeout(() => this.connect(), delay);
    }
  }

  async handleMessage(buffer) {
    const message = JSON.parse(buffer.toString());

    if (message.type === 'auth_required') {
      this.ws.send(JSON.stringify({ type: 'auth', access_token: this.token }));
      return;
    }

    if (message.type === 'auth_ok') {
      this.connected = true;
      this.retry = 0;
      this.emit('connection', true);
      await this.loadInitialData();
      return;
    }

    if (message.type === 'auth_invalid') {
      this.emit('error', new Error(`Home Assistant authentication failed: ${message.message || 'auth_invalid'}`));
      this.close();
      return;
    }

    if (message.type === 'event' && message.event && message.event.event_type === 'state_changed') {
      this.emit('state_changed', message.event);
      return;
    }

    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.success === false) {
        pending.reject(new Error(message.error && message.error.message ? message.error.message : 'HA command failed'));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  send(type, payload = {}) {
    const id = this.nextId;
    this.nextId += 1;
    const message = { id, type, ...payload };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(message));
    });
  }

  async loadInitialData() {
    const [states, entityRegistry, deviceRegistry, areaRegistry] = await Promise.all([
      this.send('get_states'),
      this.send('config/entity_registry/list'),
      this.send('config/device_registry/list'),
      this.send('config/area_registry/list')
    ]);

    this.emit('registries', {
      entity: entityRegistry || [],
      device: deviceRegistry || [],
      area: areaRegistry || []
    });
    this.emit('states', states || []);

    await this.send('subscribe_events', { event_type: 'state_changed' });
  }
}

module.exports = {
  HomeAssistantClient
};
```

- [ ] **Step 2: Create `src/server.js`**

Create `src/server.js`:

```js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { loadOptions } = require('./options');
const { AlertEngine } = require('./alertEngine');
const { StateStore } = require('./stateStore');
const { buildViewModel } = require('./viewModel');
const { HomeAssistantClient } = require('./haClient');

const PORT = Number(process.env.PORT || 8099);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function createMockStates() {
  return [
    { entity_id: 'switch.ke_ting_zhu_deng', state: 'unavailable', attributes: { friendly_name: '客厅主灯' } },
    { entity_id: 'switch.dian_shi_kai_guan', state: 'on', attributes: { friendly_name: '电脑开关' } },
    { entity_id: 'switch.men_ting_ding_deng', state: 'on', attributes: { friendly_name: '门口顶灯' } },
    { entity_id: 'climate.qdhkl_cn_proxy_621130311_0101_ac', state: 'cool', attributes: { friendly_name: '门口空调' } },
    { entity_id: 'switch.xuan_guan_deng', state: 'off', attributes: { friendly_name: '玄关灯' } },
    { entity_id: 'switch.men_kou_deng_dai', state: 'off', attributes: { friendly_name: '门口灯带' } },
    { entity_id: 'switch.men_kou_ye_deng', state: 'off', attributes: { friendly_name: '门口夜灯' } },
    { entity_id: 'binary_sensor.men_kou_motion', state: 'off', attributes: { friendly_name: '门口人体' } }
  ];
}

function safeFilePath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split('?')[0]).replace(/\/$/, '/index.html');
  const requested = cleanPath === '/' ? '/index.html' : cleanPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return null;
  }
  return filePath;
}

function serveStatic(req, res) {
  const filePath = safeFilePath(req.url);
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(content);
  });
}

function main() {
  let options;
  let configError = null;
  try {
    options = loadOptions();
  } catch (error) {
    configError = error.message;
    options = loadOptions('/path-that-does-not-exist');
  }

  const store = new StateStore();
  const alertEngine = new AlertEngine(options);
  let registries = { entity: [], device: [], area: [] };
  let haConnected = false;

  if (process.env.USE_MOCK_DATA === 'true') {
    store.setStates(createMockStates());
  }

  const server = http.createServer(serveStatic);
  const browserWss = new WebSocket.Server({ noServer: true });
  const clients = new Set();

  function snapshot() {
    return buildViewModel({
      states: store.getStateMap(),
      registries,
      options,
      alertEngine,
      now: Date.now(),
      selectedRoom: options.display.default_room,
      haConnected,
      configError
    });
  }

  function send(client, payload) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(payload));
    }
  }

  function broadcast() {
    const payload = snapshot();
    for (const client of clients) {
      send(client, payload);
    }
  }

  browserWss.on('connection', (client) => {
    clients.add(client);
    send(client, snapshot());
    client.on('close', () => clients.delete(client));
  });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url.endsWith('/ws')) {
      socket.destroy();
      return;
    }
    browserWss.handleUpgrade(req, socket, head, (ws) => browserWss.emit('connection', ws, req));
  });

  if (process.env.USE_MOCK_DATA !== 'true') {
    const haClient = new HomeAssistantClient();
    haClient.on('connection', (connected) => {
      haConnected = connected;
      broadcast();
    });
    haClient.on('registries', (nextRegistries) => {
      registries = nextRegistries;
      broadcast();
    });
    haClient.on('states', (states) => {
      store.setStates(states);
      broadcast();
    });
    haClient.on('state_changed', (event) => {
      store.applyStateChanged(event);
      broadcast();
    });
    haClient.on('error', (error) => {
      console.error(error.message);
    });
    haClient.connect();
  } else {
    haConnected = true;
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Whole House Status Add-on listening on ${PORT}`);
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  createMockStates
};
```

- [ ] **Step 3: Run unit tests**

Run:

```bash
npm run test:unit
```

Expected: PASS.

- [ ] **Step 4: Run server in mock mode**

Run:

```bash
USE_MOCK_DATA=true PORT=8099 npm start
```

Expected: terminal prints `Whole House Status Add-on listening on 8099`.

Stop the command with `Ctrl+C`.

- [ ] **Step 5: Commit**

```bash
git add src/haClient.js src/server.js
git commit -m "feat: add home assistant websocket server"
```

---

### Task 6: Implement Static Frontend

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`
- Create: `test/frontend.spec.js`

- [ ] **Step 1: Create `public/index.html`**

Create `public/index.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>全屋设备状态</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <main class="page">
    <h1 id="title" class="title">全屋设备状态</h1>

    <section class="stats" aria-label="设备状态统计">
      <article class="stat">
        <div class="stat-label">在线</div>
        <div id="stat-online" class="stat-value">0</div>
      </article>
      <article class="stat">
        <div class="stat-label">开启</div>
        <div id="stat-on" class="stat-value green">0</div>
      </article>
      <article class="stat">
        <div class="stat-label">超时/高功率</div>
        <div id="stat-warning" class="stat-value orange">0</div>
      </article>
      <article class="stat">
        <div class="stat-label">离线/故障</div>
        <div id="stat-error" class="stat-value red">0</div>
      </article>
    </section>

    <nav id="rooms" class="rooms" aria-label="房间筛选"></nav>
    <div id="connection" class="connection" hidden></div>
    <div class="divider"></div>
    <section id="alerts" class="cards alerts" aria-label="异常设备"></section>
    <div id="alerts-divider" class="divider"></div>
    <section id="devices" class="cards" aria-label="设备列表"></section>
  </main>

  <script src="./app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `public/styles.css`**

Create `public/styles.css` with the confirmed first-version UI:

```css
:root {
  color-scheme: dark;
  --bg: #101010;
  --panel: #191919;
  --line: #343434;
  --divider: #3a3a3a;
  --text: #d6d6d6;
  --muted: #a6a6a6;
  --green: #00ff4c;
  --orange: #f3a11a;
  --red: #ff001e;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  letter-spacing: 0;
}

.page {
  min-height: 100vh;
  padding: 28px 5vw 64px;
}

.title {
  text-align: center;
  font-size: clamp(30px, 3vw, 44px);
  font-weight: 500;
  margin: 0 0 28px;
  padding-bottom: 24px;
  border-bottom: 1px solid #292929;
  color: #d0d0d0;
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(180px, 274px));
  gap: 16px;
  margin-bottom: 16px;
}

.stat,
.device {
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
}

.stat {
  min-height: 96px;
  padding: 12px 16px;
}

.stat-label {
  font-size: 22px;
  line-height: 1.25;
}

.stat-value {
  margin-top: 2px;
  font-size: 40px;
  line-height: 1;
  font-weight: 700;
}

.green {
  color: var(--green);
}

.orange {
  color: var(--orange);
}

.red {
  color: var(--red);
}

.rooms {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-bottom: 20px;
}

.room {
  width: 118px;
  height: 54px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
  color: var(--text);
  font: inherit;
  font-size: 23px;
  cursor: pointer;
}

.room.active {
  background: #d5d5d5;
  color: #222;
  box-shadow: inset 0 0 0 1px #eeeeee;
}

.connection {
  border: 1px solid var(--orange);
  color: var(--orange);
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 14px;
  background: rgba(243, 161, 26, 0.08);
  font-size: 16px;
}

.divider {
  height: 1px;
  background: var(--divider);
  margin: 8px 0 20px;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(274px, 1fr));
  gap: 14px 16px;
  max-width: 1720px;
}

.alerts {
  grid-template-columns: repeat(auto-fill, minmax(274px, 274px));
  margin-bottom: 18px;
}

.device {
  min-height: 96px;
  padding: 14px 16px 12px;
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 18px;
}

.device-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 12px;
}

.name {
  min-width: 0;
  font-size: 24px;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.state {
  font-size: 22px;
  line-height: 1.2;
  font-weight: 700;
  white-space: nowrap;
}

.entity {
  min-width: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  align-self: end;
}

.empty {
  color: var(--muted);
  font-size: 18px;
  padding: 18px 0;
}

@media (max-width: 920px) {
  .page {
    padding: 20px 18px 48px;
  }

  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .room {
    width: calc(33.333% - 10px);
    min-width: 96px;
    font-size: 20px;
  }

  .cards,
  .alerts {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 3: Create `public/app.js`**

Create `public/app.js`:

```js
const state = {
  model: null,
  selectedRoom: '全部',
  reconnectTimer: null
};

function $(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  $(id).textContent = String(value);
}

function wsUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const pathname = window.location.pathname.endsWith('/')
    ? window.location.pathname.slice(0, -1)
    : window.location.pathname;
  const base = pathname.endsWith('/index.html') ? pathname.slice(0, -11) : pathname;
  return `${protocol}//${window.location.host}${base}/ws`;
}

function deviceCard(device) {
  const card = document.createElement('article');
  card.className = 'device';

  const top = document.createElement('div');
  top.className = 'device-top';

  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = device.name;

  const status = document.createElement('div');
  status.className = `state ${device.status_color === 'green' ? 'green' : ''} ${device.status_color === 'orange' ? 'orange' : ''} ${device.status_color === 'red' ? 'red' : ''}`.trim();
  status.textContent = device.status_label;

  top.append(name, status);
  card.append(top);

  const entity = document.createElement('div');
  entity.className = 'entity';
  entity.textContent = device.show_entity_id ? device.entity_id : device.room;
  card.append(entity);

  return card;
}

function renderRooms(model) {
  const rooms = $('rooms');
  rooms.replaceChildren();
  const selected = state.selectedRoom || model.selected_room || '全部';

  for (const room of model.rooms) {
    const button = document.createElement('button');
    button.className = room === selected ? 'room active' : 'room';
    button.type = 'button';
    button.textContent = room;
    button.addEventListener('click', () => {
      state.selectedRoom = room;
      render();
    });
    rooms.append(button);
  }
}

function renderCards(containerId, devices) {
  const container = $(containerId);
  container.replaceChildren();

  if (devices.length === 0 && containerId === 'devices') {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '当前房间没有可显示设备';
    container.append(empty);
    return;
  }

  for (const device of devices) {
    container.append(deviceCard(device));
  }
}

function renderConnection(model) {
  const connection = $('connection');
  const messages = [];
  if (!model.connection.ha_connected) {
    messages.push('HA WebSocket 未连接，正在使用最后一次状态');
  }
  if (model.connection.config_error) {
    messages.push(`配置错误：${model.connection.config_error}`);
  }

  if (messages.length === 0) {
    connection.hidden = true;
    connection.textContent = '';
    return;
  }

  connection.hidden = false;
  connection.textContent = messages.join('；');
}

function filteredDevices(model) {
  const selected = state.selectedRoom || model.selected_room || '全部';
  if (selected === '全部') {
    return model.devices;
  }
  return model.devices.filter((device) => device.room === selected);
}

function render() {
  const model = state.model;
  if (!model) {
    return;
  }

  $('title').textContent = model.title;
  setText('stat-online', model.stats.online);
  setText('stat-on', model.stats.on);
  setText('stat-warning', model.stats.warning);
  setText('stat-error', model.stats.error);
  renderConnection(model);
  renderRooms(model);
  renderCards('alerts', model.alerts);
  renderCards('devices', filteredDevices(model));
}

function scheduleReconnect() {
  if (state.reconnectTimer) {
    return;
  }
  state.reconnectTimer = window.setTimeout(() => {
    state.reconnectTimer = null;
    connect();
  }, 1500);
}

function connect() {
  const socket = new WebSocket(wsUrl());

  socket.addEventListener('message', (event) => {
    state.model = JSON.parse(event.data);
    if (!state.selectedRoom) {
      state.selectedRoom = state.model.selected_room || '全部';
    }
    render();
  });

  socket.addEventListener('close', scheduleReconnect);
  socket.addEventListener('error', () => socket.close());
}

connect();
```

- [ ] **Step 4: Create `test/frontend.spec.js`**

Create `test/frontend.spec.js`:

```js
const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');

let server;

test.beforeAll(async () => {
  server = spawn('npm', ['start'], {
    env: {
      ...process.env,
      USE_MOCK_DATA: 'true',
      PORT: '8099'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server did not start')), 10000);
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('Whole House Status Add-on listening on 8099')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
    });
  });
});

test.afterAll(async () => {
  if (server) {
    server.kill('SIGTERM');
  }
});

test('dashboard renders dark card grid on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://127.0.0.1:8099/');

  await expect(page.locator('h1')).toHaveText('全屋设备状态');
  await expect(page.locator('#stat-online')).not.toHaveText('0');
  await expect(page.locator('.room.active')).toHaveText('全部');
  await expect(page.locator('#alerts .device')).toHaveCount(1);
  await expect(page.locator('#devices .device').first()).toBeVisible();

  const background = await page.locator('body').evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(background).toBe('rgb(16, 16, 16)');
});

test('dashboard keeps cards readable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:8099/');

  await expect(page.locator('.stats')).toBeVisible();
  await expect(page.locator('.room').first()).toBeVisible();
  await expect(page.locator('#devices .device').first()).toBeVisible();

  const firstCardBox = await page.locator('#devices .device').first().boundingBox();
  expect(firstCardBox.width).toBeLessThanOrEqual(354);
});
```

- [ ] **Step 5: Run frontend smoke tests**

Install browser binaries once:

```bash
npx playwright install chromium
```

Run:

```bash
npm run test:frontend
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/styles.css public/app.js test/frontend.spec.js
git commit -m "feat: add dark dashboard frontend"
```

---

### Task 7: Add Final Verification And Docker Build

**Files:**
- Modify: `Dockerfile`
- Modify: `package.json`

- [ ] **Step 1: Run all automated tests**

Run:

```bash
npm run verify
```

Expected: PASS for all unit and frontend tests.

- [ ] **Step 2: Build the Docker image**

Run:

```bash
docker build -t whole-house-status-addon:local .
```

Expected: Docker build completes successfully and tags `whole-house-status-addon:local`.

- [ ] **Step 3: Run the image in mock mode**

Run:

```bash
docker run --rm -p 8099:8099 -e USE_MOCK_DATA=true whole-house-status-addon:local
```

Expected: container logs `Whole House Status Add-on listening on 8099`.

Open `http://127.0.0.1:8099/` and confirm the dashboard renders.

- [ ] **Step 4: Confirm verification did not modify tracked files**

Run:

```bash
git status --short
```

Expected: no output. If this command prints changed files, inspect those changes before continuing because verification should not rewrite source files.

---

### Task 8: Manual HA OS Installation Notes

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

Create `README.md`:

```markdown
# Whole House Status Add-on

Home Assistant OS Add-on for monitoring whole-house device status from the HA sidebar.

## Features

- Ingress sidebar panel.
- Real-time Home Assistant WebSocket state updates.
- Room filters with HA Area priority and Add-on override support.
- Offline and warning devices pinned above normal devices.
- Status colors:
  - Green: on or running.
  - Gray-white: online and idle.
  - Orange: timeout or sustained high power.
  - Red: unavailable, unknown, or fault.
- First version is monitor-only and does not control devices.

## Local Development

```bash
npm install
USE_MOCK_DATA=true PORT=8099 npm start
```

Open `http://127.0.0.1:8099/`.

## Verification

```bash
npm run verify
docker build -t whole-house-status-addon:local .
```

## Home Assistant OS Installation

1. Copy this folder into the Home Assistant add-ons directory or publish it through a local add-on repository.
2. In Home Assistant, go to Settings > Add-ons > Add-on Store.
3. Reload local add-ons.
4. Install `Whole House Status`.
5. Keep Ingress enabled and start the Add-on.
6. Open `全屋设备状态` from the sidebar.

## Options

Room overrides use explicit entity mappings:

```yaml
rooms:
  overrides:
    - entity_id: switch.men_ting_ding_deng
      room: 门口
```

High-power rules bind a switch-like entity to a power sensor:

```yaml
alerts:
  high_power_rules:
    - entity_id: switch.water_heater
      power_sensor: sensor.water_heater_power
      threshold_w: 800
      duration_minutes: 30
```

On-duration rules mark active devices as warning after a configured duration:

```yaml
alerts:
  on_duration_rules:
    - entity_id: switch.computer_socket
      duration_minutes: 480
```
```

- [ ] **Step 2: Run final verification**

Run:

```bash
npm run verify
git status --short
```

Expected: tests pass; `git status` shows only `README.md` uncommitted.

- [ ] **Step 3: Commit README**

```bash
git add README.md
git commit -m "docs: add addon usage notes"
```

---

## Self-Review Checklist

- Spec coverage: This plan implements the Node.js backend, static frontend, Add-on Ingress metadata, HA WebSocket connection, room grouping, alert rules, status colors, tests, Docker build, and HA OS usage notes.
- Completeness scan: Every task names exact files, commands, expected outcomes, and concrete code content.
- Type consistency: Shared names are `normalizeOptions`, `AlertEngine`, `StateStore`, `resolveRoom`, `buildRooms`, `buildViewModel`, and `HomeAssistantClient`.
- Scope control: Device control, history, notifications, Lovelace cards, and brand-specific private integrations remain outside first version.
