'use strict';

const Device = require('../../lib/Device');
const { filled, blank } = require('../../lib/Utils');
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

    return this.error(warning);
  }

  // Set AirconStat
  async syncAirconStat(data = null) {
    if (!data) {
      data = await this.client.getAirconStat();

      if (blank(data)) return;
    }

    // Set available
    this.setAvailable().catch(this.error);

    // Set decoded AirconStat
    this.airconStat = data.airconStat;
    this.log('airconStat:', JSON.stringify(this.airconStat));

    delete data.airconStat;

    // Set contents
    this.contents = data;
    this.log('Contents:', JSON.stringify(this.contents));

    // Set number of accounts and firmware type
    this.accounts = Number(data.numOfAccount) || null;
    this.firmware = data.firmType || null;

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

    // 3D AUTO
    if ('entrust' in stat) {
      this.setCapabilityValue('3d_auto', stat.entrust).catch(this.error);
    }

    // Fan speed
    if ('airFlow' in stat) {
      this.setCapabilityValue('fan_speed', AirFlow[stat.airFlow]).catch(this.error);
    }

    // Horizontal position
    if ('windDirectionLR' in stat) {
      this.setCapabilityValue('horizontal_position', HorizontalPosition[stat.windDirectionLR]).catch(this.error);
    }

    // Indoor temperature
    if ('indoorTemp' in stat) {
      this.setCapabilityValue('measure_temperature', stat.indoorTemp).catch(this.error);
    }

    // Operation
    if ('operation' in stat) {
      this.setCapabilityValue('onoff', stat.operation).catch(this.error);
    }

    // Operating mode
    if ('operationMode' in stat) {
      this.setCapabilityValue('operating_mode', OperationMode[stat.operationMode]).catch(this.error);
    }

    // Outdoor temperature
    if ('outdoorTemp' in stat) {
      this.setCapabilityValue('measure_temperature.outdoor', stat.outdoorTemp).catch(this.error);
    }

    // Preset temperature
    if ('presetTemp' in stat) {
      this.setCapabilityValue('target_temperature', stat.presetTemp).catch(this.error);
    }

    // Vertical position
    if ('windDirectionUD' in stat) {
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

    const settings = {};

    // Number of accounts
    if (this.accounts) {
      settings.accounts = String(this.accounts);
    }

    // Firmware type
    if (filled(this.firmware)) {
      settings.firmware_type = this.firmware;
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

    // Firmware has warning
    if (this.setFirmwareWarning()) {
      return;
    }

    // Remove warning
    this.unsetWarning().catch(this.error);
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

  // 3D AUTO capability changed
  async onCapability3dAuto(value) {
    this.log(`3D AUTO changed to '${value}'`);

    await this.updateDevice({ entrust: value });
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
    if (!this.registered || !this.client) return;

    this.log('[Account] Deleting');
    this.log('-- Operator ID:', this.operatorId);

    // Delete account from device
    if (this.client) {
      this.log('Delete device account');
      await this.client.deleteAccountInfo();
    }

    this.log('[Account] Deleted');

    // Mark as unregistered
    if (!uninit) {
      this.setRegistered(false);
    }
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

  /*
  | Warning functions
  */

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

  // Set firmware version not supported warning
  setFirmwareWarning() {
    if (!this.firmware) return false;
    if (this.firmware === 'WF-RAC') return false;

    const warning = this.homey.__('status.wrongFirmware', { firmware: this.firmware });

    this.error(`Firmware '${this.firmware}' is not supported`);
    this.setWarning(warning).catch(this.error);

    return true;
  }

}

module.exports = WFRACDevice;
