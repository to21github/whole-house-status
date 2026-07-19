const http = require('node:http');

class SupervisorOptionsClient {
  constructor({
    baseUrl = process.env.SUPERVISOR_URL || 'http://supervisor',
    token = process.env.SUPERVISOR_TOKEN,
    requestTimeoutMs = 10_000
  } = {}) {
    if (typeof token !== 'string' || token.trim() === '') {
      throw new Error('Supervisor token is required');
    }

    this.baseUrl = baseUrl;
    this.token = token;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async setRoomOrder(order) {
    const currentOptions = await this.request('GET', '/addons/self/options/config');
    const options = {
      ...currentOptions,
      rooms: {
        ...currentOptions.rooms,
        order: [...order]
      }
    };

    await this.request('POST', '/addons/self/options', { options });
  }

  request(method, path, body) {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.token}`
    };

    if (payload !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let request;
      const settle = (callback, value) => {
        if (settled) {
          return;
        }

        settled = true;
        request.setTimeout(0);
        callback(value);
      };
      const fail = (error) => settle(reject, error);
      request = http.request(new URL(path, this.baseUrl), { method, headers }, (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.once('aborted', () => {
          fail(new Error('Supervisor options response was aborted'));
        });
        response.once('error', () => {
          fail(new Error('Supervisor options response failed'));
        });
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            fail(new Error(`Supervisor options request failed: ${response.statusCode}`));
            return;
          }

          try {
            settle(resolve, JSON.parse(responseBody));
          } catch {
            fail(new Error('Supervisor options response contained invalid JSON'));
          }
        });
      });

      request.once('error', fail);
      request.setTimeout(this.requestTimeoutMs, () => {
        fail(new Error('Supervisor options request timed out'));
        request.destroy();
      });
      if (payload !== null) {
        request.write(payload);
      }
      request.end();
    });
  }
}

module.exports = {
  SupervisorOptionsClient
};
