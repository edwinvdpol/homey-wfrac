'use strict';

const originalFetch = require('node-fetch');
const { HttpAgent, HttpsAgent } = require('agentkeepalive');
const { Mutex, withTimeout } = require('async-mutex');
const Coder = require('./Coder');
const { blank, wait, filled } = require('./Utils');
const fetch = require('fetch-retry')(originalFetch, {
  retryDelay(attempt) {
    return (2 ** attempt) * 1000; // 1000, 2000
  },
  retryOn(attempt, error, response) {
    if (attempt > 1) {
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

  constructor(homey, settings, logId = null) {
    this.homey = homey;
    this.logId = logId;

    this.address = settings.ip_address || null;
    this.protocol = settings.protocol || null;
    this.operator_id = settings.operator_id || '';
    this.aircon_id = settings.aircon_id;

    this.lock = withTimeout(new Mutex(), 7000, new Error('error.timeout'));
  }

  // Return HTTP agent based on protocol
  agent() {
    const options = {
      maxSockets: 2,
      maxFreeSockets: 1,
      freeSocketTimeout: 30000,
    };

    if (this.protocol === 'https') {
      options.rejectUnauthorized = false;

      return new HttpsAgent(options);
    }

    return new HttpAgent(options);
  }

  // Make API call
  async call(command, contents = null) {
    if (blank(this.address)) return null;
    if (blank(this.operator_id)) throw new Error('error.operator_id');

    const release = await this.lock.acquire();

    let body;
    let json;
    let text;
    let response;

    try {
      if (this.protocol !== 'http' && this.protocol !== 'https') {
        await this.setProtocol();
      }

      body = this.getBody(command);

      if (contents) {
        body.contents = contents;
      }

      this.log('[Call]', JSON.stringify(body));

      response = await fetch(`${this.protocol}://${this.address}:51443/beaver/command/${command}`, {
        method: 'POST',
        body: JSON.stringify(body),
        agent: this.agent(),
      });

      // Check response
      await this.responseCheck(response);

      text = await response.text();
      this.log('[Response]', text);
      json = JSON.parse(text);

      // Check JSON response
      if ('result' in json && json.result === 2) throw new Error('warning.unregistered');

      return json;
    } catch (err) {
      this.error('[Response]', err);

      if (err.message === 'warning.unregistered') throw err;
      if ('code' in err && err.code === 'EPROTO') throw new Error('error.protocol');

      throw new Error('error.connection');
    } finally {
      body = null;
      json = null;
      text = null;
      response = null;

      // Wait before process next call
      await wait();

      // Release lock
      release();
    }
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

  async setProtocol() {
    this.log('Setting protocol');
    this.protocol = null;

    try {
      this.log('Trying HTTP protocol...');

      await originalFetch(`http://${this.address}:51443/beaver/command/getDeviceInfo`, {
        method: 'POST',
        body: JSON.stringify(this.getBody('getDeviceInfo')),
        agent: this.agent(),
      });

      this.protocol = 'http';
      this.log('HTTP protocol success!');
    } catch (err) {
      this.error('HTTP protocol failed', err);
    }

    if (this.protocol === 'http') return;

    // Wait before trying HTTPS protocol
    await wait();

    try {
      this.log('Trying HTTPS protocol...');

      this.protocol = 'https';

      await originalFetch(`https://${this.address}:51443/beaver/command/getDeviceInfo`, {
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
    if (filled(this.logId) && this.aircon_id !== this.logId) return;

    this.homey.error(`[Client] [${this.address}] [${this.aircon_id}] [${this.protocol}]`, ...args);
  }

  log(...args) {
    if (!this.homey) return;
    if (filled(this.logId) && this.aircon_id !== this.logId) return;

    this.homey.log(`[Client] [${this.address}] [${this.aircon_id}] [${this.protocol}]`, ...args);
  }

}

module.exports = Client;
