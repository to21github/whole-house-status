(() => {
  'use strict';

  const SHOW_IGNORED_STORAGE_KEY = 'whole-house-status-show-ignored';
  const DISPLAY_MENU_VIEWPORT_PADDING = 12;
  const DISPLAY_MENU_OFFSET = 8;

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
    roomOrderMode: false,
    roomOrderDraft: null,
    roomOrderPending: false,
    roomOrderError: null,
    roomOrderDrag: null,
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
    roomOrder: document.getElementById('room-order'),
    displayMenu: document.querySelector('.display-menu'),
    displayMenuTrigger: document.querySelector('.display-menu summary'),
    showIgnoredOption: document.querySelector('.show-ignored-option'),
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

  function clearDisplayMenuPosition() {
    elements.showIgnoredOption.style.removeProperty('position');
    elements.showIgnoredOption.style.removeProperty('top');
    elements.showIgnoredOption.style.removeProperty('right');
    elements.showIgnoredOption.style.removeProperty('left');
    elements.showIgnoredOption.style.removeProperty('max-width');
    elements.showIgnoredOption.style.removeProperty('max-height');
    elements.showIgnoredOption.style.removeProperty('overflow-y');
  }

  function positionDisplayMenu() {
    if (!elements.displayMenu.open) {
      return;
    }

    const option = elements.showIgnoredOption;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    option.style.position = 'fixed';
    option.style.top = '0px';
    option.style.right = 'auto';
    option.style.left = '0px';
    option.style.maxWidth = `${Math.max(0, viewportWidth - DISPLAY_MENU_VIEWPORT_PADDING * 2)}px`;
    option.style.maxHeight = `${Math.max(0, viewportHeight - DISPLAY_MENU_VIEWPORT_PADDING * 2)}px`;
    option.style.overflowY = 'auto';

    const triggerBounds = elements.displayMenuTrigger.getBoundingClientRect();
    const optionBounds = option.getBoundingClientRect();
    const maximumLeft = Math.max(
      DISPLAY_MENU_VIEWPORT_PADDING,
      viewportWidth - optionBounds.width - DISPLAY_MENU_VIEWPORT_PADDING
    );
    const left = Math.min(
      Math.max(triggerBounds.left, DISPLAY_MENU_VIEWPORT_PADDING),
      maximumLeft
    );
    const below = triggerBounds.bottom + DISPLAY_MENU_OFFSET;
    const above = triggerBounds.top - optionBounds.height - DISPLAY_MENU_OFFSET;
    const top = below + optionBounds.height <= viewportHeight - DISPLAY_MENU_VIEWPORT_PADDING
      ? below
      : Math.max(DISPLAY_MENU_VIEWPORT_PADDING, above);

    option.style.left = `${Math.round(left)}px`;
    option.style.top = `${Math.round(top)}px`;
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

  function isFixedRoom(room) {
    return room === '全部' || room === '未分组';
  }

  function sameRooms(left, right) {
    return left.length === right.length && left.every((room, index) => room === right[index]);
  }

  function mergeRoomOrderDraft(draft, rooms) {
    const roomSet = new Set(rooms);
    const draftMovableRooms = draft.filter((room) => !isFixedRoom(room) && roomSet.has(room));
    const addedMovableRooms = rooms.filter((room) => (
      !isFixedRoom(room) && !draftMovableRooms.includes(room)
    ));
    return [
      ...(rooms.includes('全部') ? ['全部'] : []),
      ...draftMovableRooms,
      ...addedMovableRooms,
      ...(rooms.includes('未分组') ? ['未分组'] : [])
    ];
  }

  function renderRoomOrderControl() {
    elements.roomOrder.disabled = state.roomOrderPending;
    elements.roomOrder.setAttribute('aria-pressed', String(state.roomOrderMode));
  }

  function renderRooms(rooms) {
    const displayedRooms = state.roomOrderMode && state.roomOrderDraft
      ? state.roomOrderDraft
      : rooms;
    const fragment = document.createDocumentFragment();
    elements.rooms.classList.toggle('sorting', state.roomOrderMode);
    for (const room of displayedRooms) {
      const button = document.createElement('button');
      const active = room === state.selectedRoom;
      button.type = 'button';
      button.className = [
        'room-button',
        active ? 'active' : '',
        state.roomOrderMode && isFixedRoom(room) ? 'fixed' : '',
        state.roomOrderMode && !isFixedRoom(room) ? 'movable' : '',
        state.roomOrderDrag && state.roomOrderDrag.room === room ? 'dragging' : ''
      ].filter(Boolean).join(' ');
      button.setAttribute('aria-pressed', String(active));
      button.dataset.room = room;
      button.textContent = room;
      button.disabled = state.roomOrderPending || (state.roomOrderMode && isFixedRoom(room));
      if (state.roomOrderMode && !isFixedRoom(room)) {
        button.setAttribute('aria-description', '按 Alt 加方向键调整顺序');
      }
      button.addEventListener('click', () => {
        if (state.roomOrderMode || state.roomOrderPending) {
          return;
        }
        state.selectedRoom = room;
        render();
      });
      button.addEventListener('pointerdown', startRoomOrderDrag);
      button.addEventListener('keydown', moveRoomOrderWithKeyboard);
      fragment.append(button);
    }
    elements.rooms.replaceChildren(fragment);
    renderRoomOrderControl();
  }

  function startRoomOrderDrag(event) {
    const button = event.currentTarget;
    const room = button.dataset.room;
    if (!state.roomOrderMode || state.roomOrderPending || isFixedRoom(room)
      || state.roomOrderDrag || event.isPrimary === false) {
      return;
    }
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    event.preventDefault();
    state.roomOrderDrag = {
      pointerId: event.pointerId,
      room,
      initialOrder: [...state.roomOrderDraft]
    };
    button.classList.add('dragging');
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic touch Pointer Events do not always have an active pointer capture target.
    }
  }

  function movableRoomAtPosition(clientX, clientY) {
    for (const button of elements.rooms.querySelectorAll('.room-button.movable')) {
      const bounds = button.getBoundingClientRect();
      if (clientX >= bounds.left && clientX <= bounds.right
        && clientY >= bounds.top && clientY <= bounds.bottom) {
        return button;
      }
    }
    return null;
  }

  function moveDraftRoom(draggedRoom, targetButton, clientX, clientY) {
    const order = [...state.roomOrderDraft];
    const draggedIndex = order.indexOf(draggedRoom);
    const targetRoom = targetButton.dataset.room;
    if (draggedIndex === -1 || targetRoom === draggedRoom) {
      return false;
    }

    const targetBounds = targetButton.getBoundingClientRect();
    const horizontalDistance = Math.abs(clientX - (targetBounds.left + targetBounds.width / 2));
    const verticalDistance = Math.abs(clientY - (targetBounds.top + targetBounds.height / 2));
    const insertAfter = verticalDistance > horizontalDistance
      ? clientY >= targetBounds.top + targetBounds.height / 2
      : clientX >= targetBounds.left + targetBounds.width / 2;
    order.splice(draggedIndex, 1);
    const targetIndex = order.indexOf(targetRoom);
    order.splice(targetIndex + (insertAfter ? 1 : 0), 0, draggedRoom);
    if (sameRooms(order, state.roomOrderDraft)) {
      return false;
    }
    state.roomOrderDraft = order;
    return true;
  }

  function moveDraftRoomByOffset(room, offset) {
    const order = [...state.roomOrderDraft];
    const movableIndexes = order.reduce((indexes, candidate, index) => {
      if (!isFixedRoom(candidate)) {
        indexes.push(index);
      }
      return indexes;
    }, []);
    const currentIndex = movableIndexes.findIndex((index) => order[index] === room);
    const targetIndex = currentIndex + offset;
    if (currentIndex === -1 || targetIndex < 0 || targetIndex >= movableIndexes.length) {
      return false;
    }

    const currentRoomIndex = movableIndexes[currentIndex];
    const targetRoomIndex = movableIndexes[targetIndex];
    [order[currentRoomIndex], order[targetRoomIndex]] = [order[targetRoomIndex], order[currentRoomIndex]];
    state.roomOrderDraft = order;
    return true;
  }

  function finishRoomOrder(success, error) {
    state.roomOrderMode = false;
    state.roomOrderDraft = null;
    state.roomOrderPending = false;
    state.roomOrderDrag = null;
    state.roomOrderError = success ? null : error || '无法保存房间排序';
    render();
  }

  function sendRoomOrder() {
    const rooms = [...state.roomOrderDraft];
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      finishRoomOrder(false, 'HA WebSocket 未连接');
      return;
    }

    state.roomOrderPending = true;
    render();
    try {
      socket.send(JSON.stringify({ type: 'set_room_order', rooms }));
    } catch {
      finishRoomOrder(false, '无法发送排序请求');
    }
  }

  function endRoomOrderDrag(event) {
    const drag = state.roomOrderDrag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    state.roomOrderDrag = null;
    render();
  }

  function cancelRoomOrderDrag(event) {
    const drag = state.roomOrderDrag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    state.roomOrderDrag = null;
    state.roomOrderDraft = state.model
      ? mergeRoomOrderDraft(drag.initialOrder, state.model.rooms)
      : drag.initialOrder;
    render();
  }

  function moveRoomOrderWithKeyboard(event) {
    const room = event.currentTarget.dataset.room;
    if (!state.roomOrderMode || state.roomOrderPending || isFixedRoom(room) || !event.altKey) {
      return;
    }

    const offset = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
      ? -1
      : event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : 0;
    if (offset === 0) {
      return;
    }

    event.preventDefault();
    if (moveDraftRoomByOffset(room, offset)) {
      render();
      const movedRoomButton = [...elements.rooms.querySelectorAll('.room-button')]
        .find((button) => button.dataset.room === room);
      movedRoomButton?.focus();
    }
  }

  function moveRoomOrderDrag(event) {
    const drag = state.roomOrderDrag;
    if (!drag || drag.pointerId !== event.pointerId || state.roomOrderPending) {
      return;
    }
    const target = movableRoomAtPosition(event.clientX, event.clientY);
    if (target && moveDraftRoom(drag.room, target, event.clientX, event.clientY)) {
      render();
    }
  }

  function toggleRoomOrder() {
    if (state.roomOrderPending || !state.model) {
      return;
    }
    if (state.roomOrderMode) {
      if (state.roomOrderDraft && !sameRooms(state.roomOrderDraft, state.model.rooms)) {
        sendRoomOrder();
        return;
      }
      finishRoomOrder(true);
      return;
    }
    state.roomOrderMode = true;
    state.roomOrderDraft = [...state.model.rooms];
    state.roomOrderError = null;
    render();
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
    if (state.roomOrderError) {
      notices.push(`房间排序失败：${state.roomOrderError}`);
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
  elements.roomOrder.addEventListener('click', toggleRoomOrder);
  elements.displayMenuTrigger.addEventListener('click', () => {
    window.requestAnimationFrame(positionDisplayMenu);
  });
  elements.displayMenu.addEventListener('toggle', () => {
    if (elements.displayMenu.open) {
      positionDisplayMenu();
      return;
    }
    clearDisplayMenuPosition();
  });
  window.addEventListener('resize', positionDisplayMenu);
  window.addEventListener('scroll', positionDisplayMenu, true);
  window.addEventListener('pointermove', moveRoomOrderDrag);
  window.addEventListener('pointerup', endRoomOrderDrag);
  window.addEventListener('pointercancel', cancelRoomOrderDrag);

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
      if (model && model.type === 'room_order_result') {
        if (state.roomOrderPending) {
          finishRoomOrder(!model.error && model.success !== false, model.error);
        }
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
      if (state.roomOrderMode && state.roomOrderDraft) {
        state.roomOrderDraft = mergeRoomOrderDraft(state.roomOrderDraft, rooms);
      }
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
        if (state.roomOrderPending) {
          finishRoomOrder(false, 'HA WebSocket 已断开');
        }
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
