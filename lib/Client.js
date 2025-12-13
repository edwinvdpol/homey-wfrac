'use strict';

const fetch = require('node-fetch');
const http = require('http');
const { Mutex, withTimeout } = require('async-mutex');
const Coder = require('./Coder');
const { blank } = require('./Utils');

class Client {

  constructor(homey, store) {
    this.homey = homey;
    this.coder = new Coder();

    this.address = null;
    this.operatorId = store.operatorId;
    this.airconId = store.airconId;

    this.agent = new http.Agent({ keepAlive: true });
    this.lock = withTimeout(new Mutex(), 4000, new Error('error.timeout'));
  }

  // Return AirconStat
  async getAirconStat() {
    const result = await this.call('getAirconStat');

    result.airconStat = this.coder.fromBase64(result.airconStat);

    return result;
  }

  // Set AirconStat
  async setAirconStat(airconStat) {
    const nodes = ['electric', 'errorCode', 'indoorTemp', 'outdoorTemp'];

    // Delete nodes
    nodes.forEach((node) => delete airconStat[node]);

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
    if (blank(this.address)) return null;

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
      const url = `http://${this.address}:51443/beaver/command`;

      const res = await fetch(url, {
        method: 'POST',
        body: JSON.stringify(body),
        agent: this.agent,
        signal: AbortSignal.timeout(3000),
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

    this.homey.error(`[Client] [${this.address}] [${this.airconId}]`, ...args);
  }

  log(...args) {
    if (!this.homey) return;

    this.homey.log(`[Client] [${this.address}:${this.port}] [${this.airconId}]`, ...args);
  }

}

module.exports = Client;
