'use strict';

const originalFetch = require('node-fetch');
const { HttpAgent } = require('agentkeepalive');
const { Mutex, withTimeout } = require('async-mutex');
const Coder = require('./Coder');
const { blank } = require('./Utils');
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

  constructor(homey, store) {
    this.homey = homey;
    this.coder = new Coder();

    this.address = null;
    this.operator_id = store.operator_id || store.operatorId || '';
    this.aircon_id = store.aircon_id || store.airconId;

    this.agent = new HttpAgent({
      maxSockets: 2,
      maxFreeSockets: 1,
      timeout: 60000,
      freeSocketTimeout: 30000,
    });

    this.lock = withTimeout(new Mutex(), 7000, new Error('error.timeout'));
  }

  // Return AirconStat
  async getAirconStat() {
    return this.call('getAirconStat');
  }

  // Set AirconStat
  async setAirconStat(airconStat) {
    const nodes = ['electric', 'errorCode', 'indoorTemp', 'outdoorTemp'];

    // Delete nodes
    nodes.forEach((node) => delete airconStat[node]);

    this.log('[Set]', JSON.stringify(airconStat));

    await this.call('setAirconStat', {
      airconId: this.aircon_id,
      airconStat: this.coder.toBase64(airconStat),
    });
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

    const body = {
      apiVer: '1.0',
      command,
      deviceId: this.aircon_id,
      operatorId: this.operator_id,
      timestamp: Math.floor(Date.now() / 1000),
    };

    if (contents) {
      body.contents = contents;
    }

    try {
      const url = `http://${this.address}:51443/beaver/command`;

      this.log('[Call]', url);
      this.log('[Call]', JSON.stringify(body));

      const res = await fetch(url, {
        method: 'POST',
        body: JSON.stringify(body),
        agent: this.agent,
      });

      // Check response
      await this.responseCheck(res);

      // Return JSON data
      const result = await res.json();

      this.log('[Result]', JSON.stringify(result));

      return result;
    } catch (err) {
      return this.handleError(err);
    } finally {
      // Wait 1 second before process next call
      await this.wait();

      // Release lock
      release();
    }
  }

  // Check response status
  responseCheck = (res) => {
    if (res.ok) {
      return res;
    }

    if (res.status === 501) {
      throw new Error('error.not_supported');
    }

    this.error(JSON.stringify(res));

    throw new Error('error.connection');
  };

  // Handle network errors
  handleError = (err) => {
    this.error(err);

    if (err.type === 'system' || err.type === 'aborted') {
      throw new Error(`error.${err.type}`);
    }

    if (err.type === 'invalid-json') {
      throw new Error('error.not_supported');
    }

    throw new Error(err.message);
  };

  async wait(seconds = 1) {
    return new Promise((resolve) => setTimeout(resolve, 1000 * seconds));
  }

  /*
  | Log functions
  */

  error(...args) {
    if (!this.homey) return;

    this.homey.error(`[Client] [${this.address}] [${this.aircon_id}]`, ...args);
  }

  log(...args) {
    if (!this.homey) return;

    this.homey.log(`[Client] [${this.address}] [${this.aircon_id}]`, ...args);
  }

}

module.exports = Client;
