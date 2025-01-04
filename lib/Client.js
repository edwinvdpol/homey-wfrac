'use strict';

const fetch = require('node-fetch');
const { Mutex, withTimeout } = require('async-mutex');
const Coder = require('./Coder');

class Client {

  constructor(store) {
    this.coder = new Coder();

    this.address = null;
    this.operatorId = store.operatorId;
    this.airconId = store.airconId;
    this.port = null;

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

    const release = await this.lock.acquire();
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 3000);

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
        signal: controller.signal,
        body: JSON.stringify(body),
      });

      // Check response
      await this.responseCheck(res);

      // Parse JSON data
      const data = await res.json();

      return data.contents || null;
    } catch (err) {
      return this.handleError(err);
    } finally {
      clearTimeout(timeout);

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

  async wait(seconds = 1) {
    return new Promise((resolve) => setTimeout(resolve, 1000 * seconds));
  }

}

module.exports = Client;
