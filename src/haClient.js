const EventEmitter = require('node:events');
const WebSocket = require('ws');

class HomeAssistantClient extends EventEmitter {
  constructor({
    url = process.env.HA_WS_URL || 'ws://supervisor/core/websocket',
    token = process.env.SUPERVISOR_TOKEN,
    reconnectBaseMs = 1000,
    reconnectMaxMs = 30000,
    WebSocket: WebSocketFactory = WebSocket
  } = {}) {
    super();
    this.url = url;
    this.token = token;
    this.reconnectBaseMs = reconnectBaseMs;
    this.reconnectMaxMs = reconnectMaxMs;
    this.WebSocket = WebSocketFactory;
    this.nextId = 1;
    this.pending = new Map();
    this.connected = false;
    this.retry = 0;
    this.ws = null;
    this.closedByUser = false;
    this.reconnectTimer = null;
  }

  connect() {
    if (!this.token) {
      throw new Error('SUPERVISOR_TOKEN is required unless USE_MOCK_DATA=true');
    }

    if (this.ws && (this.ws.readyState === this.WebSocket.OPEN || this.ws.readyState === this.WebSocket.CONNECTING)) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closedByUser = false;

    const ws = new this.WebSocket(this.url);
    this.ws = ws;
    ws.on('message', (buffer) => this.handleMessage(buffer, ws));
    ws.on('close', () => this.handleClose(ws));
    ws.on('error', (error) => {
      if (this.ws === ws) {
        this.emit('error', error);
      }
    });
  }

  close() {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
    }
  }

  handleClose(ws = this.ws) {
    if (this.ws !== ws) {
      return;
    }

    this.ws = null;
    this.connected = false;
    this.emit('connection', false);
    for (const [, pending] of this.pending) {
      pending.reject(new Error('Home Assistant WebSocket closed'));
    }
    this.pending.clear();

    if (!this.closedByUser) {
      const delay = Math.min(this.reconnectBaseMs * 2 ** this.retry, this.reconnectMaxMs);
      this.retry += 1;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (!this.closedByUser && !this.ws) {
          this.connect();
        }
      }, delay);
    }
  }

  async handleMessage(buffer, ws = this.ws) {
    let message;
    try {
      message = JSON.parse(buffer.toString());
    } catch {
      return;
    }

    if (this.ws !== ws) {
      return;
    }

    if (message.type === 'auth_required') {
      ws.send(JSON.stringify({ type: 'auth', access_token: this.token }));
      return;
    }

    if (message.type === 'auth_ok') {
      this.connected = true;
      this.retry = 0;
      this.emit('connection', true);
      try {
        await this.loadInitialData();
      } catch (error) {
        this.emit('error', error);
      }
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
    if (!this.ws || this.ws.readyState !== this.WebSocket.OPEN) {
      return Promise.reject(new Error('Home Assistant WebSocket is not connected'));
    }

    const id = this.nextId;
    this.nextId += 1;
    const message = { id, type, ...payload };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
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
