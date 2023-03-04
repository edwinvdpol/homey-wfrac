'use strict';

const Driver = require('../../lib/Driver');

class WFRACDriver extends Driver {

  /*
  | Device events
  */

  // Driver initialized
  async onInit() {
    this.log('Initialized');
  }

  // Driver destroyed
  async onUninit() {
    this.log('Destroyed');
  }

}

module.exports = WFRACDriver;
