'use strict';

const originalFetch = require('node-fetch');
const { HttpAgent, HttpsAgent } = require('agentkeepalive');
const { Mutex, withTimeout } = require('async-mutex');
const Coder = require('./Coder');
const { blank, wait, filled } = require('./Utils');
const fetch = require('fetch-retry')(originalFetch, {
  retryDelay(attempt) {
    return (2 ** attempt) * 1000; // 1000, 2000, 4000
  },
  retryOn(attempt, error, response) {
    if (attempt > 2) {
      console.log(`Failed on attempt #${attempt}`);

      if (error) console.error('error', error);
      if (response) console.error('Response', response);

      return false;
    }

    if (response && response.ok) return false;

    console.log(`Retry #${attempt + 1}`);

    return true;
  },
});

class Client {

  constructor(homey, settings) {
    this.homey = homey;

    this.address = settings.ip_address || null;
    this.protocol = settings.protocol || null;
    this.operator_id = settings.operator_id || '';
    this.aircon_id = settings.aircon_id;

    this.lock = withTimeout(new Mutex(), 7000, new Error('error.timeout'));
  }

  // Return AirconStat
  async getAirconStat() {
    return this.call('getAirconStat');
  }

  // Set AirconStat
  async setAirconStat(airconStat) {
    let coder = new Coder();
    const nodes = ['electric', 'errorCode', 'indoorTemp', 'outdoorTemp'];

    // Delete nodes
    nodes.forEach((node) => delete airconStat[node]);

    this.log('[Set]', JSON.stringify(airconStat));

    await this.call('setAirconStat', {
      airconId: this.aircon_id,
      airconStat: coder.toBase64(airconStat),
    });

    coder = null;
    airconStat = null;
  }

  // Update AccountInfo
  async updateAccountInfo() {
    await this.call('updateAccountInfo', {
      accountId: this.operator_id,
      airconId: this.aircon_id,
      remote: 0,
      timezone: 'Europe/Amsterdam',
    });
  }

  // Delete AccountInfo
  async deleteAccountInfo() {
    // Cancel lock
    this.lock.cancel();

    await this.call('deleteAccountInfo', {
      accountId: this.operator_id,
      airconId: this.aircon_id,
    });
  }

  // Make API call
  async call(command, contents = null) {
    if (blank(this.address)) return null;

    const release = await this.lock.acquire();

    try {
      if (this.protocol === null) {
        await this.setProtocol();
      }

      const body = this.getBody(command);

      if (contents) {
        body.contents = contents;
      }

      this.log('[Call]', JSON.stringify(body));

      const res = await fetch(`${this.protocol}://${this.address}:51443/beaver/command`, {
        method: 'POST',
        body: JSON.stringify(body),
        agent: this.agent(),
      });

      // Check response
      await this.responseCheck(res);

      const text = await res.text();
      this.log('[Response]', text);

      return JSON.parse(text);
    } catch (err) {
      return this.handleError(err);
    } finally {
      // Wait before process next call
      await wait();

      // Release lock
      release();
    }
  }

  getBody(command) {
    return {
      apiVer: '1.0',
      command,
      deviceId: this.aircon_id,
      operatorId: this.operator_id,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  // Check response status
  responseCheck = (res) => {
    if (res.ok) return res;

    this.error('[responseCheck]', res);

    if (res.status === 501) {
      throw new Error('error.not_supported');
    }

    throw new Error('error.connection');
  };

  // Handle network errors
  handleError = (err) => {
    this.error('[handleError]', err);

    if ('code' in err && err.code === 'EPROTO') {
      throw new Error('error.protocol');
    }

    if (err.type === 'system' || err.type === 'aborted') {
      throw new Error(`error.${err.type}`);
    }

    if (err.type === 'invalid-json') {
      throw new Error('error.not_supported');
    }

    throw new Error(err.message);
  };

  agent() {
    const options = {
      maxSockets: 2,
      maxFreeSockets: 1,
      timeout: 60000,
      freeSocketTimeout: 30000,
    };

    if (this.protocol === 'https') {
      options.rejectUnauthorized = false;

      return new HttpsAgent(options);
    }

    return new HttpAgent(options);
  }

  async setProtocol() {
    this.log('Setting protocol');

    try {
      this.log('Trying HTTP protocol...');

      await fetch(`http://${this.address}:51443/beaver/command`, {
        method: 'POST',
        body: JSON.stringify(this.getBody('getDeviceInfo')),
        agent: this.agent(),
      });

      this.protocol = 'http';
      this.log('HTTP protocol success!');
    } catch (err) {
      this.error('HTTP protocol failed', err);
    }

    if (filled(this.protocol)) return;

    // Wait before trying HTTPS protocol
    await wait();

    try {
      this.log('Trying HTTPS protocol...');

      this.protocol = 'https';

      await fetch(`https://${this.address}:51443/beaver/command`, {
        method: 'POST',
        body: JSON.stringify(this.getBody('getDeviceInfo')),
        agent: this.agent(),
      });

      this.log('HTTPS protocol success!');
    } catch (err) {
      this.error('HTTPS protocol failed', err);
      this.protocol = null;
    }
  }

  /*
  | Log functions
  */

  error(...args) {
    if (!this.homey) return;

    this.homey.error(`[Client] [${this.address}] [${this.aircon_id}] [${this.protocol}]`, ...args);
  }

  log(...args) {
    if (!this.homey) return;

    this.homey.log(`[Client] [${this.address}] [${this.aircon_id}] [${this.protocol}]`, ...args);
  }

}

module.exports = Client;
