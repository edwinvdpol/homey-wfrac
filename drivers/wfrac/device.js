'use strict';

const Device = require('../../lib/Device');
const { filled } = require('../../lib/Utils');
const {
  AirFlow, AirFlowNames,
  HorizontalPosition, HorizontalPositionNames,
  OperationMode, OperationModeNames,
  VerticalPosition, VerticalPositionNames,
} = require('../../lib/Enums');

class WFRACDevice extends Device {

  /*
  | Synchronization function
  */

  // Set account
  async syncAccount() {
    if (this.registered) return null;

    // Device not available
    if (!this.getAvailable()) {
      return this.error('Sync account: Device not available');
    }

    // Number of accounts not set
    if (!this.accounts) {
      return this.error('Sync account: Number of accounts not set');
    }

    this.log('Syncing account');
    this.log('-- Number of accounts:', this.accounts);

    // Register account
    if (this.accounts < 4) {
      await this.registerAccount();
    }

    // Account warning
    const warning = this.getAccountWarning();

    if (!warning) {
      return this.unsetWarning().catch(this.error);
    }

    // Set warning message
    this.setWarning(this.homey.__(warning)).catch(this.error);

    return this.log('Warning!', this.homey.__(warning));
  }

  // Set AirconStat
  async syncAirconStat(data = null) {
    if (!data) {
      data = await this.client.getAirconStat();
    }

    // Set available
    this.setAvailable().catch(this.error);

    // Set decoded AirconStat
    this.airconStat = data.airconStat;
    this.log('New airconStat:', JSON.stringify(this.airconStat));

    delete data.airconStat;

    // Set contents
    this.contents = data;
    this.log('New contents:', JSON.stringify(this.contents));

    // Set number of accounts
    this.accounts = Number(data.numOfAccount) || null;

    data = null;
  }

  // Set capabilities
  async syncCapabilities() {
    // AirconStat not available
    if (!this.airconStat) {
      this.error('Sync capabilities: AirconStat not set');

      return;
    }

    let stat = this.airconStat;

    // Fan speed
    if (filled(stat.airFlow)) {
      this.setCapabilityValue('fan_speed', AirFlow[stat.airFlow]).catch(this.error);
    }

    // Horizontal position
    if (filled(stat.windDirectionLR)) {
      this.setCapabilityValue('horizontal_position', HorizontalPosition[stat.windDirectionLR]).catch(this.error);
    }

    // Indoor temperature
    if (filled(stat.indoorTemp)) {
      this.setCapabilityValue('measure_temperature', stat.indoorTemp).catch(this.error);
    }

    // Operation
    if (filled(stat.operation)) {
      this.setCapabilityValue('onoff', stat.operation).catch(this.error);
    }

    // Operating mode
    if (filled(stat.operationMode)) {
      this.setCapabilityValue('operating_mode', OperationMode[stat.operationMode]).catch(this.error);
    }

    // Outdoor temperature
    if (filled(stat.outdoorTemp)) {
      this.setCapabilityValue('measure_temperature.outdoor', stat.outdoorTemp).catch(this.error);
    }

    // Preset temperature
    if (filled(stat.presetTemp)) {
      this.setCapabilityValue('target_temperature', stat.presetTemp).catch(this.error);
    }

    // Vertical position
    if (filled(stat.windDirectionUD)) {
      this.setCapabilityValue('vertical_position', VerticalPosition[stat.windDirectionUD]).catch(this.error);
    }

    stat = null;
  }

  // Set settings
  async syncSettings() {
    // Contents not available
    if (!this.contents) {
      this.error('Sync settings: Contents not set');

      return;
    }

    this.error('Syncing settings');

    const settings = {};

    // Number of accounts
    if (this.accounts) {
      settings.accounts = String(this.accounts);
    }

    // Wireless firmware
    if (filled(this.contents.wireless.firmVer)) {
      settings.wifi_firmware = this.contents.wireless.firmVer;
    }

    // MCU firmware
    if (filled(this.contents.mcu.firmVer)) {
      settings.mcu_firmware = this.contents.mcu.firmVer;
    }

    // Update settings
    if (filled(settings)) {
      this.setSettings(settings).catch(this.error);
    }
  }

  /*
  | Capability actions
  */

  // Fan speed capability changed
  async onCapabilityFanSpeed(value) {
    this.log(`Fan speed changed to '${value}'`);

    await this.updateDevice({ airFlow: AirFlowNames[value] });
  }

  // Horizontal position capability changed
  async onCapabilityHorizontalPosition(value) {
    this.log(`Horizontal position changed to '${value}'`);

    await this.updateDevice({
      windDirectionLR: HorizontalPositionNames[value],
      entrust: false,
    });
  }

  // On/off capability changed
  async onCapabilityOnOff(value) {
    this.log(`Operation changed to '${value}'`);

    await this.updateDevice({ operation: value });
  }

  // Operating mode capability changed
  async onCapabilityOperatingMode(value) {
    this.log(`Operating mode changed to '${value}'`);

    await this.updateDevice({ operationMode: OperationModeNames[value] });
  }

  // Target temperature capability changed
  async onCapabilityTargetTemperature(value) {
    this.log(`Target temperature changed to '${value}°C'`);

    await this.updateDevice({ presetTemp: value });
  }

  // Vertical position capability changed
  async onCapabilityVerticalPosition(value) {
    this.log(`Vertical position changed to '${value}'`);

    await this.updateDevice({
      windDirectionUD: VerticalPositionNames[value],
      entrust: false,
    });
  }

  /*
  | Account functions
  */

  // Delete account
  async deleteAccount(uninit = false) {
    if (!this.registered) return null;

    // Device not available
    if (!this.getAvailable()) {
      return this.error('Delete account: Device not available');
    }

    this.log('Deleting account');
    this.log('-- Operator ID:', this.operatorId);

    // Delete account from device
    if (this.client) {
      this.log('Delete device account');
      await this.client.deleteAccountInfo();
    }

    this.log('Account deleted');

    // Mark as unregistered
    if (!uninit) {
      this.setRegistered(false);
    }

    return null;
  }

  // Register account
  async registerAccount() {
    // Device not available
    if (!this.getAvailable()) {
      return this.error('Register account: Device not available');
    }

    this.log('Registering account');
    this.log('-- Operator ID:', this.operatorId);

    // Send account to device
    await this.client.updateAccountInfo();

    this.log('Account registered');

    // Mark as registered
    return this.setRegistered(true);
  }

  // Return warning message for account
  getAccountWarning() {
    if (this.registered) return null;
    if (!this.accounts) return null;

    // Too many accounts
    if (this.accounts > 3) {
      return 'status.maxAccounts';
    }

    // Account not registered yet
    return 'status.notRegistered';
  }

}

module.exports = WFRACDevice;
