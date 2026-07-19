(() => {
  'use strict';

  const SHOW_IGNORED_STORAGE_KEY = 'whole-house-status-show-ignored';

  function loadShowIgnored() {
    try {
      return window.localStorage.getItem(SHOW_IGNORED_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  function persistShowIgnored(value) {
    try {
      window.localStorage.setItem(SHOW_IGNORED_STORAGE_KEY, String(value));
    } catch {
      // The dashboard remains usable when browser storage is unavailable.
    }
  }

  const state = {
    model: null,
    selectedRoom: '全部',
    showIgnored: loadShowIgnored(),
    pendingDashboardIgnoreChanges: new Map(),
    entityActionError: null,
    reconnectTimer: null
  };
  let socket = null;

  const elements = {
    title: document.getElementById('title'),
    online: document.getElementById('stat-online'),
    on: document.getElementById('stat-on'),
    warning: document.getElementById('stat-warning'),
    error: document.getElementById('stat-error'),
    rooms: document.getElementById('rooms'),
    showIgnored: document.getElementById('show-ignored'),
    connection: document.getElementById('connection'),
    ignored: document.getElementById('ignored'),
    ignoredDivider: document.getElementById('ignored-divider'),
    alerts: document.getElementById('alerts'),
    devices: document.getElementById('devices')
  };

  function websocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const pathname = window.location.pathname;
    const pagePath = pathname.endsWith('/index.html')
      ? pathname.slice(0, -'index.html'.length)
      : pathname;
    const basePath = pagePath === '/' ? '/' : `${pagePath.replace(/\/+$/, '')}/`;
    return `${protocol}//${window.location.host}${basePath}ws`;
  }

  function statusClass(color) {
    return color === 'green' || color === 'orange' || color === 'red' ? color : '';
  }

  function isViewModel(model) {
    const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
    const isDevice = (device) => (
      isObject(device)
      && typeof device.entity_id === 'string'
      && typeof device.name === 'string'
      && typeof device.room === 'string'
      && typeof device.status_label === 'string'
      && typeof device.status_color === 'string'
      && (device.ignored === undefined || typeof device.ignored === 'boolean')
      && (device.dashboard_ignored === undefined || typeof device.dashboard_ignored === 'boolean')
      && typeof device.show_entity_id === 'boolean'
    );
    return isObject(model)
      && Array.isArray(model.rooms)
      && model.rooms.length > 0
      && model.rooms.every((room) => typeof room === 'string' && room)
      && typeof model.selected_room === 'string'
      && model.selected_room.trim().length > 0
      && model.rooms.includes(model.selected_room)
      && isObject(model.stats)
      && ['online', 'on', 'warning', 'error'].every((key) => Number.isFinite(model.stats[key]))
      && Array.isArray(model.alerts)
      && Array.isArray(model.devices)
      && model.alerts.every(isDevice)
      && model.devices.every(isDevice)
      && isObject(model.connection)
      && typeof model.connection.ha_connected === 'boolean'
      && (model.connection.config_error == null || typeof model.connection.config_error === 'string');
  }

  function createTextElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    element.textContent = text || '';
    return element;
  }

  function effectiveIgnored(device) {
    return state.pendingDashboardIgnoreChanges.has(device.entity_id)
      ? state.pendingDashboardIgnoreChanges.get(device.entity_id)
      : device.ignored;
  }

  function canToggleDashboardIgnore(device) {
    return !device.ignored || device.dashboard_ignored === true;
  }

  function createDeviceCard(device, isAlert, onSetDashboardIgnored) {
    const ignored = effectiveIgnored(device);
    const card = document.createElement('article');
    card.className = [
      'device-card',
      isAlert ? 'alert-card' : '',
      ignored ? 'ignored-card' : ''
    ].filter(Boolean).join(' ');

    const name = createTextElement('h2', 'device-name', device.name);
    const detail = device.show_entity_id ? device.entity_id : device.room;
    const meta = createTextElement('p', 'device-meta', detail);
    name.title = device.name;
    meta.title = device.entity_id;
    const status = createTextElement('p', `device-status ${statusClass(device.status_color)}`, device.status_label);
    if (canToggleDashboardIgnore(device)) {
      const action = document.createElement('button');
      const nextIgnored = !ignored;
      action.type = 'button';
      action.className = 'entity-ignore-action';
      action.textContent = nextIgnored ? '忽略' : '不再忽略';
      action.title = nextIgnored ? `忽略 ${device.name}` : `不再忽略 ${device.name}`;
      action.disabled = state.pendingDashboardIgnoreChanges.has(device.entity_id);
      action.addEventListener('click', () => onSetDashboardIgnored(device, nextIgnored));
      card.append(action);
    }

    card.append(name, meta);
    if (ignored) {
      card.append(createTextElement('p', 'device-ignored', '已忽略'));
    }
    card.append(status);
    return card;
  }

  function renderRooms(rooms) {
    const fragment = document.createDocumentFragment();
    for (const room of rooms) {
      const button = document.createElement('button');
      const active = room === state.selectedRoom;
      button.type = 'button';
      button.className = active ? 'active' : '';
      button.setAttribute('aria-pressed', String(active));
      button.textContent = room;
      button.addEventListener('click', () => {
        state.selectedRoom = room;
        render();
      });
      fragment.append(button);
    }
    elements.rooms.replaceChildren(fragment);
  }

  function renderConnection(connection) {
    const notices = [];
    if (connection.config_error) {
      notices.push(`配置错误：${connection.config_error}`);
    }
    if (connection.ha_connected === false) {
      notices.push('HA WebSocket 未连接，正在使用最后一次状态');
    }
    if (state.entityActionError) {
      notices.push(`实体操作失败：${state.entityActionError}`);
    }
    elements.connection.hidden = notices.length === 0;
    elements.connection.textContent = notices.join('\n');
  }

  function renderCards(container, devices, isAlert, onSetDashboardIgnored) {
    const fragment = document.createDocumentFragment();
    for (const device of devices) {
      fragment.append(createDeviceCard(device, isAlert, onSetDashboardIgnored));
    }
    container.replaceChildren(fragment);
  }

  function render() {
    if (!state.model) {
      return;
    }

    const model = state.model;
    const rooms = Array.isArray(model.rooms) ? model.rooms : [];
    const stats = model.stats || {};
    const alerts = Array.isArray(model.alerts) ? model.alerts : [];
    const devices = Array.isArray(model.devices) ? model.devices : [];
    const connection = model.connection || {};
    const isInSelectedRoom = (device) => (
      state.selectedRoom === '全部' || device.room === state.selectedRoom
    );
    const ignoredDevices = state.showIgnored
      ? [...alerts, ...devices].filter((device) => (
        isInSelectedRoom(device) && effectiveIgnored(device)
      ))
      : [];
    const visibleAlerts = alerts.filter((device) => (
      isInSelectedRoom(device) && !effectiveIgnored(device)
    ));
    const visibleDevices = devices.filter((device) => (
      isInSelectedRoom(device) && !effectiveIgnored(device)
    ));

    elements.title.textContent = model.title || '全屋设备状态';
    document.title = elements.title.textContent;
    elements.online.textContent = String(stats.online || 0);
    elements.on.textContent = String(stats.on || 0);
    elements.warning.textContent = String(stats.warning || 0);
    elements.error.textContent = String(stats.error || 0);
    elements.showIgnored.checked = state.showIgnored;
    renderRooms(rooms);
    renderConnection(connection);
    const setDashboardEntityIgnored = (device, ignored) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        state.entityActionError = 'HA WebSocket 未连接';
        render();
        return;
      }
      state.entityActionError = null;
      state.pendingDashboardIgnoreChanges.set(device.entity_id, ignored);
      render();
      try {
        socket.send(JSON.stringify({
          type: 'set_dashboard_entity_ignored',
          entity_id: device.entity_id,
          ignored
        }));
      } catch {
        state.pendingDashboardIgnoreChanges.delete(device.entity_id);
        state.entityActionError = '无法发送请求';
        render();
      }
    };
    const hasIgnoredDevices = ignoredDevices.length > 0;
    elements.ignored.hidden = !hasIgnoredDevices;
    elements.ignoredDivider.hidden = !hasIgnoredDevices;
    renderCards(elements.ignored, ignoredDevices, false, setDashboardEntityIgnored);
    renderCards(elements.alerts, visibleAlerts, true, setDashboardEntityIgnored);

    if (visibleDevices.length === 0) {
      elements.devices.replaceChildren(createTextElement('p', 'empty-state', '当前房间没有可显示设备'));
      return;
    }
    renderCards(elements.devices, visibleDevices, false, setDashboardEntityIgnored);
  }

  elements.showIgnored.addEventListener('change', () => {
    state.showIgnored = elements.showIgnored.checked;
    persistShowIgnored(state.showIgnored);
    render();
  });

  function scheduleReconnect() {
    if (state.reconnectTimer !== null) {
      return;
    }
    state.reconnectTimer = window.setTimeout(() => {
      state.reconnectTimer = null;
      connect();
    }, 1500);
  }

  function connect() {
    if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
      return;
    }

    let client;
    try {
      client = new WebSocket(websocketUrl());
    } catch {
      scheduleReconnect();
      return;
    }

    socket = client;
    client.addEventListener('message', (event) => {
      let model;
      try {
        model = JSON.parse(event.data);
      } catch {
        return;
      }
      if (model && model.type === 'dashboard_entity_ignored_result') {
        state.pendingDashboardIgnoreChanges.delete(model.entity_id);
        state.entityActionError = typeof model.error === 'string' ? model.error : null;
        render();
        return;
      }
      if (!isViewModel(model)) {
        return;
      }

      const rooms = Array.isArray(model.rooms) ? model.rooms : [];
      const selectedRoom = typeof model.selected_room === 'string' && rooms.includes(model.selected_room)
        ? model.selected_room
        : '全部';
      const isFirstModel = state.model === null;
      state.model = model;
      for (const [entityId, ignored] of state.pendingDashboardIgnoreChanges) {
        const device = [...model.alerts, ...model.devices].find((candidate) => candidate.entity_id === entityId);
        if (device && device.dashboard_ignored === ignored) {
          state.pendingDashboardIgnoreChanges.delete(entityId);
        }
      }
      if (isFirstModel || !rooms.includes(state.selectedRoom)) {
        state.selectedRoom = selectedRoom;
      }
      render();
    });
    client.addEventListener('close', () => {
      if (socket === client) {
        socket = null;
        scheduleReconnect();
      }
    });
  }

  window.addEventListener('beforeunload', () => {
    if (state.reconnectTimer !== null) {
      window.clearTimeout(state.reconnectTimer);
    }
    if (socket) {
      socket.close();
    }
  });

  connect();
})();
