'use strict';

const Homey = require('homey');
const Aircon = require('./Aircon');

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

    return Object.values(results).map((device) => new Aircon(device).device);
  }

}

module.exports = Driver;
