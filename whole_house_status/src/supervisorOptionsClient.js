const http = require('node:http');

class SupervisorOptionsClient {
  constructor({
    baseUrl = process.env.SUPERVISOR_URL || 'http://supervisor',
    token = process.env.SUPERVISOR_TOKEN
  } = {}) {
    if (typeof token !== 'string' || token.trim() === '') {
      throw new Error('Supervisor token is required');
    }

    this.baseUrl = baseUrl;
    this.token = token;
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
      const request = http.request(new URL(path, this.baseUrl), { method, headers }, (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Supervisor options request failed: ${response.statusCode}`));
            return;
          }

          try {
            resolve(JSON.parse(responseBody));
          } catch {
            reject(new Error('Supervisor options response contained invalid JSON'));
          }
        });
      });

      request.on('error', reject);
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
