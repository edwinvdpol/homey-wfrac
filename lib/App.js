'use strict';

const Homey = require('homey');
const { Log } = require('homey-log');

class App extends Homey.App {

  /*
  | Application events
  */

  // Application initialized
  async onInit() {
    // Sentry logging
    this.homeyLog = new Log({ homey: this.homey });

    // Register flow cards
    this.registerFlowCards();

    this.log('Initialized');
  }

  /*
  | Support functions
  */

  // Register flow cards
  registerFlowCards() {
    this.log('Registering flow cards...');

    // Action flow cards
    // ... then turn off 3D AUTO ...
    this.homey.flow.getActionCard('3d_auto_off').registerRunListener(async ({ device }) => {
      await device.onCapability3dAuto(false);
    });

    // ... then turn on 3D AUTO ...
    this.homey.flow.getActionCard('3d_auto_on').registerRunListener(async ({ device }) => {
      await device.onCapability3dAuto(true);
    });

    // ... then set fan speed to ...
    this.homey.flow.getActionCard('fan_speed_set').registerRunListener(async ({ device, speed }) => {
      await device.onCapabilityFanSpeed(speed);
    });

    // ... then set horizontal position to ...
    this.homey.flow.getActionCard('horizontal_position_set').registerRunListener(async ({ device, position }) => {
      await device.onCapabilityHorizontalPosition(position);
    });

    // ... then set operating mode to ...
    this.homey.flow.getActionCard('operating_mode_set').registerRunListener(async ({ device, mode }) => {
      await device.onCapabilityOperatingMode(mode);
    });

    // ... then set vertical position to ...
    this.homey.flow.getActionCard('vertical_position_set').registerRunListener(async ({ device, position }) => {
      await device.onCapabilityVerticalPosition(position);
    });

    // Condition flow cards
    // ... and 3D AUTO is ...
    this.homey.flow.getConditionCard('3d_auto_is').registerRunListener(async ({ device, onoff }) => {
      return device.getCapabilityValue('3d_auto') === onoff;
    });

    // ... and fan speed is ...
    this.homey.flow.getConditionCard('fan_speed_is').registerRunListener(async ({ device, speed }) => {
      return device.getCapabilityValue('fan_speed') === speed;
    });

    // ... and horizontal position is ...
    this.homey.flow.getConditionCard('horizontal_position_is').registerRunListener(async ({ device, position }) => {
      return device.getCapabilityValue('horizontal_position') === position;
    });

    // ... and operating mode is ...
    this.homey.flow.getConditionCard('operating_mode_is').registerRunListener(async ({ device, mode }) => {
      return device.getCapabilityValue('operating_mode') === mode;
    });

    // ... and vertical position is ...
    this.homey.flow.getConditionCard('vertical_position_is').registerRunListener(async ({ device, position }) => {
      return device.getCapabilityValue('vertical_position') === position;
    });

    this.log('Flow cards registered');
  }

}

module.exports = App;
