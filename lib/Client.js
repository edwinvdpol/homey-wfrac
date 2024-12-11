'use strict';

const fetch = require('node-fetch');
const { Mutex } = require('async-mutex');
const Coder = require('./Coder');

class Client {

  static RELEASE_INTERVAL = 1; // Seconds

  constructor(store) {
    this.coder = new Coder();

    this.operatorId = store.operatorId;
    this.airconId = store.airconId;
    this.address = null;
    this.port = null;

    this.lock = new Mutex(new Error('error.timeout'));
  }

  // Return AirconStat
  async getAirconStat() {
    const result = await this.call('getAirconStat');

    result.airconStat = this.coder.fromBase64(result.airconStat);

    return result;
  }

  // Set AirconStat
  async setAirconStat(airconStat) {
    const result = await this.call('setAirconStat', {
      airconId: this.airconId,
      airconStat: this.coder.toBase64(airconStat),
    });

    result.airconStat = this.coder.fromBase64(result.airconStat);

    return result;
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

    // Wait for unlock...
    await this.lock.waitForUnlock();

    let body = {
      apiVer: '1.0',
      command,
      deviceId: this.airconId,
      operatorId: this.operatorId,
      timestamp: Math.floor(Date.now() / 1000),
    };

    if (contents) {
      body.contents = contents;
    }

    let data;
    let result;
    let controller = new AbortController();

    const release = await this.lock.acquire();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      result = await fetch(`http://${this.address}:${this.port}/beaver/command`, {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify(body),
      });

      // Check response
      await this.responseCheck(result);

      // Parse JSON data
      data = await result.json();

      return data.contents || null;
    } catch (err) {
      return this.handleError(err);
    } finally {
      clearTimeout(timeout);

      // Cleanup
      controller = null;
      result = null;
      body = null;
      data = null;

      // Wait for lock release
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

    throw new Error('error.connection');
  };

  // Handle network errors
  handleError = (err) => {
    if (err.type === 'system' || err.type === 'aborted') {
      throw new Error('error.connection');
    }

    if (err.type === 'invalid-json') {
      throw new Error('error.not_supported');
    }

    throw new Error(err.message);
  };

  // Wait release interval
  async wait() {
    const interval = 1000 * this.constructor.RELEASE_INTERVAL;

    return new Promise((resolve) => setTimeout(resolve, interval));
  }

}

module.exports = Client;
