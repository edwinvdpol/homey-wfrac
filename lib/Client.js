'use strict';

const originalFetch = require('node-fetch');
const { HttpAgent } = require('agentkeepalive');
const { Mutex, withTimeout } = require('async-mutex');
const Coder = require('./Coder');
const fetch = require('fetch-retry')(originalFetch, {
  retryDelay(attempt) {
    return (2 ** attempt) * 1000; // 1000, 2000, 4000
  },
  retryOn(attempt, error, response) {
    if (attempt > 3) {
      console.log(`Failed after ${attempt} attemps`);

      if (error) console.error('error', error);
      if (response) console.error('Response', response);

      return false;
    }

    if (response && response.ok) return false;

    console.log(`Retrying, attempt number ${attempt + 1}`);

    return true;
  },
});

class Client {

  constructor(homey, store) {
    this.homey = homey;
    this.coder = new Coder();

    this.address = null;
    this.operatorId = store.operatorId;
    this.airconId = store.airconId;
    this.port = null;

    this.agent = new HttpAgent({
      maxSockets: 2,
      maxFreeSockets: 1,
      timeout: 60000,
      freeSocketTimeout: 30000,
    });

    this.lock = withTimeout(new Mutex(), 6000, new Error('error.timeout'));
  }

  // Return AirconStat
  async getAirconStat() {
    const result = await this.call('getAirconStat');

    result.airconStat = this.coder.fromBase64(result.airconStat);

    return result;
  }

  // Set AirconStat
  async setAirconStat(airconStat) {
    this.log('[Set]', JSON.stringify(airconStat));

    await this.call('setAirconStat', {
      airconId: this.airconId,
      airconStat: this.coder.toBase64(airconStat),
    });
  }

  // Update AccountInfo
  async updateAccountInfo() {
    await this.call('updateAccountInfo', {
      accountId: this.operatorId,
      airconId: this.airconId,
      remote: 0,
      timezone: 'Europe/Amsterdam',
    });
  }

  // Delete AccountInfo
  async deleteAccountInfo() {
    // Cancel lock
    this.lock.cancel();

    await this.call('deleteAccountInfo', {
      accountId: this.operatorId,
      airconId: this.airconId,
    });
  }

  // Make API call
  async call(command, contents = null) {
    if (!this.address || !this.port) return null;

    const release = await this.lock.acquire();

    const body = {
      apiVer: '1.0',
      command,
      deviceId: this.airconId,
      operatorId: this.operatorId,
      timestamp: Math.floor(Date.now() / 1000),
    };

    if (contents) {
      body.contents = contents;
    }

    try {
      const url = `http://${this.address}:${this.port}/beaver/command`;

      const res = await fetch(url, {
        method: 'POST',
        body: JSON.stringify(body),
        agent: this.agent,
      });

      // Check response
      await this.responseCheck(res);

      // Parse JSON data
      const data = await res.json();

      return data.contents || null;
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
    this.error(JSON.stringify(this.agent.getCurrentStatus()));

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

    this.homey.error(`[Client] [${this.address}:${this.port}] [${this.airconId}]`, ...args);
  }

  log(...args) {
    if (!this.homey) return;

    this.homey.log(`[Client] [${this.address}:${this.port}] [${this.airconId}]`, ...args);
  }

}

module.exports = Client;
