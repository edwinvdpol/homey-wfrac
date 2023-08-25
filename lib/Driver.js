'use strict';

const Homey = require('homey');
const crypto = require('crypto');

class Driver extends Homey.Driver {

  /*
  | Driver events
  */

  // Driver initialized
  async onInit() {
    this.log('Initialized');
  }

  // Driver destroyed
  async onUninit() {
    this.log('Destroyed');
  }

  /*
  | Pairing functions
  */

  // Pair devices
  async onPairListDevices() {
    const strategy = this.getDiscoveryStrategy();
    const results = strategy.getDiscoveryResults();

    this.log('Listing devices', JSON.stringify(results));

    return Object.values(results).map((device) => this.getDeviceData(device));
  }

  // Get data to create the device
  getDeviceData(device) {
    return {
      name: device.name,
      data: {
        id: device.id,
      },
      store: {
        registered: false,
        operatorId: crypto.randomUUID(),
        airconId: device.id,
      },
    };
  }

}

module.exports = Driver;
