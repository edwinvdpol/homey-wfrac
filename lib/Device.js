'use strict';

const Homey = require('homey');
const Client = require('./Client');
const { filled, blank } = require('./Utils');
const {
  AirFlow, AirFlowNames,
  HorizontalPosition, HorizontalPositionNames,
  OperationMode, OperationModeNames,
  VerticalPosition, VerticalPositionNames,
} = require('./Enums');

class Device extends Homey.Device {

  static LOG_DEVICE_ID = ''; // Only log device with this ID
  static SYNC_INTERVAL = 60; // Seconds
  static SEND_INTERVAL = 1000; // Miliseconds

  /*
  | Device events
  */

  // Device added
  async onAdded() {
    this.log('Added');
  }

  // Device deleted
  async onDeleted() {
    this.log('Deleted');
  }

  // Device initialized
  async onInit() {
    // Connecting to device
    await this.setUnavailable(this.homey.__('authentication.connecting'));

    // Set default data
    this.setDefaults();

    // Register capability listeners
    this.registerCapabilityListeners();

    // Set registered from store
    await this.setRegistered();

    // Wait for application
    await this.homey.ready();

    const store = this.getStore();

    // Initialize
    this.client = new Client(this.homey, store);
    this.operatorId = store.operatorId;

    this.log('Initialized');
  }

  // Device destroyed
  async onUninit() {
    // Unregister timer
    this.unregisterTimer(true);

    // Delete account from device
    await this.deleteAccount(true);

    // Clear data
    this.setDefaults();

    this.log('Destroyed');
  }

  /*
  | Synchronization function
  */

  // Synchronize
  async sync(data = null) {
    // Skip when data is empty and lock is acquired
    if (!data && this.client.lock.isLocked()) {
      this.log('[Sync] Skipped, lock is acquired');

      return;
    }

    try {
      await this.syncAirconStat(data);
      await this.syncCapabilities();
      await this.syncSettings();
      await this.syncAccount();
    } catch (err) {
      const msg = this.homey.__(err.message);

      this.error('[Sync]', err.message);
      this.setUnavailable(msg).catch(this.error);
    }
  }

  // Set account
  async syncAccount() {
    if (this.registered) return null;
    if (!this.getAvailable()) return null;

    // Number of accounts not set
    if (!this.accounts) {
      return this.error('[Sync] [Account] Number of accounts not set');
    }

    this.log(`[Sync] [Account] ${this.accounts} accounts`);

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
    }

    if (blank(data)) return;

    this.log('[Sync]', JSON.stringify(data));

    // Set available
    this.setAvailable().catch(this.error);

    // Set data
    this.airconStat = data.airconStat;
    delete data.airconStat;
    this.contents = data;

    // Set number of accounts and firmware type
    this.accounts = ('numOfAccount' in data) ? Number(data.numOfAccount) : null;
    this.firmware = ('firmType' in data) ? data.firmType : null;

    data = null;
  }

  // Set capabilities
  async syncCapabilities() {
    const capabilities = this.getCapabilityValuesFromStats();

    if (!capabilities) return;

    for (const name of this.getCapabilities()) {
      const value = capabilities[name];

      // New value is empty
      if (blank(value)) continue;

      // Old and new values are the same
      if (this.getCapabilityValue(name) === value) continue;

      // Update capability value
      this.log(`Device changed capability '${name}' to '${value}'`);
      this.setCapabilityValue(name, value).catch(this.error);
    }
  }

  // Set settings
  async syncSettings() {
    if (!this.contents) return;

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

  // Queue update
  async queue(properties) {
    // Device unavailable
    if (!this.getAvailable()) {
      throw new Error(this.homey.__('error.unavailable'));
    }

    // Device not registered
    if (!this.registered) {
      throw new Error(this.homey.__(this.getAccountWarning()));
    }

    const shouldUpdate = blank(this.updates);

    for (const key of Object.keys(properties)) {
      this.airconStat[key] = properties[key];
    }

    // Merge new properties with current
    this.updates = { ...this.updates, ...properties };

    if (shouldUpdate) {
      await this.updateDevice();
    }
  }

  // Update device
  async updateDevice() {
    try {
      this.log('[Update] Starting');

      // Unregister timer
      this.unregisterTimer();

      // Wait for more updates...
      await this.wait();

      this.log('[Update] Started');

      // Clone and reset updates
      const properties = { ...this.updates };
      this.updates = {};

      this.log('[Update]', JSON.stringify(properties));

      // Send update
      await this.client.setAirconStat(this.airconStat);

      this.log('[Update] Done');
    } catch (err) {
      const msg = this.homey.__(err.message);

      this.error('[Update]', err.message);
      throw new Error(msg);
    } finally {
      // Register timer
      this.registerTimer();
    }
  }

  /*
  | Discovery events
  */

  onDiscoveryResult(result) {
    return result.id === this.getData().id;
  }

  // Device found
  async onDiscoveryAvailable(result) {
    if (this.getAvailable()) return;

    this.log('Discovery available', JSON.stringify(result));

    // Update network information
    await this.setNetwork(result);

    // Set available
    this.setAvailable().catch(this.error);

    // Register timer
    this.registerTimer(true);

    // Synchronize
    await this.sync();
  }

  // Device changed
  onDiscoveryAddressChanged(result) {
    this.log('Discovery address changed', JSON.stringify(result));

    // Update network information
    this.setNetwork(result).catch(this.error);
  }

  // Device offline
  onDiscoveryLastSeenChanged(result) {
    this.log('Discovery last seen changed', JSON.stringify(result));
  }

  /*
  | Capability events
  */

  // 3D AUTO capability changed
  async onCapability3dAuto(value) {
    this.log(`User changed capability '3d_auto' to '${value}'`);

    this.queue({ entrust: value }).catch(this.error);
  }

  // Fan speed capability changed
  async onCapabilityFanSpeed(value) {
    this.log(`User changed capability 'fan_speed' to '${value}'`);

    this.queue({ airFlow: AirFlowNames[value] }).catch(this.error);
  }

  // Horizontal position capability changed
  async onCapabilityHorizontalPosition(value) {
    this.log(`User changed capability 'horizontal_position' to '${value}'`);

    this.queue({
      windDirectionLR: HorizontalPositionNames[value],
      entrust: false,
    }).catch(this.error);
  }

  // On/off capability changed
  async onCapabilityOnOff(value) {
    this.log(`User changed capability 'onoff' to '${value}'`);

    this.queue({ operation: value }).catch(this.error);
  }

  // Operating mode capability changed
  async onCapabilityOperatingMode(value) {
    this.log(`User changed capability 'operating_mode' to '${value}'`);

    this.queue({ operationMode: OperationModeNames[value] }).catch(this.error);
  }

  // Target temperature capability changed
  async onCapabilityTargetTemperature(value) {
    this.log(`User changed capability 'target_temperature' to '${value}°C'`);

    this.queue({ presetTemp: value }).catch(this.error);
  }

  // Vertical position capability changed
  async onCapabilityVerticalPosition(value) {
    this.log(`User changed capability 'vertical_position' to '${value}'`);

    this.queue({
      windDirectionUD: VerticalPositionNames[value],
      entrust: false,
    }).catch(this.error);
  }

  /*
  | Device functions
  */

  // Mark as registered
  async setRegistered(registered = null) {
    if (registered === null) {
      registered = this.getStoreValue('registered');
    }

    this.setStoreValue('registered', registered).catch(this.error);
    this.registered = registered;

    if (registered) {
      return this.log('Registered');
    }

    return this.log('Unregistered');
  }

  // Set network information
  async setNetwork(info) {
    this.log('[Network]', `${info.address}:${info.port}`);

    // Update client configuration
    this.client.address = info.address;
    this.client.port = info.port;

    // Update settings
    await this.setSettings({
      ip_address: String(info.address),
      port: String(info.port),
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
      await this.setRegistered(false);
    }
  }

  // Register account
  async registerAccount() {
    if (!this.getAvailable()) return null;

    this.log('[Account] Registering');
    this.log('[Account] Operator ID:', this.operatorId);

    // Send account to device
    await this.client.updateAccountInfo();

    this.log('[Account] Registered');

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
      return 'warning.accounts';
    }

    // Account not registered yet
    return 'warning.unregistered';
  }

  // Set firmware version not supported warning
  setFirmwareWarning() {
    if (!this.firmware) return false;
    if (this.firmware === 'WF-RAC') return false;

    const warning = this.homey.__('warning.firmware', { firmware: this.firmware });

    this.error(`Firmware '${this.firmware}' is not supported`);
    this.setWarning(warning).catch(this.error);

    return true;
  }

  /*
  | Timer functions
  */

  // Register timer
  registerTimer(log = false) {
    if (this.syncDeviceTimer) return;

    const interval = 1000 * this.constructor.SYNC_INTERVAL;

    this.syncDeviceTimer = this.homey.setInterval(this.sync.bind(this), interval);

    if (log) this.log('[Timer] Registered');
  }

  // Unregister timer
  unregisterTimer(log = false) {
    if (!this.syncDeviceTimer) return;

    this.homey.clearInterval(this.syncDeviceTimer);

    this.syncDeviceTimer = null;

    if (log) this.log('[Timer] Unregistered');
  }

  /*
  | Support functions
  */

  // Return capability values from airconStat
  getCapabilityValuesFromStats() {
    if (!this.airconStat) return null;

    return {
      '3d_auto': this.airconStat.entrust,
      fan_speed: AirFlow[this.airconStat.airFlow],
      horizontal_position: HorizontalPosition[this.airconStat.windDirectionLR],
      measure_temperature: this.airconStat.indoorTemp,
      'measure_temperature.outdoor': this.airconStat.outdoorTemp,
      onoff: this.airconStat.operation,
      operating_mode: OperationMode[this.airconStat.operationMode],
      target_temperature: this.airconStat.presetTemp,
      vertical_position: VerticalPosition[this.airconStat.windDirectionUD],
    };
  }

  // Register capability listeners
  registerCapabilityListeners() {
    if (this.hasCapability('3d_auto')) {
      this.registerCapabilityListener('3d_auto', this.onCapability3dAuto.bind(this));
    }

    if (this.hasCapability('fan_speed')) {
      this.registerCapabilityListener('fan_speed', this.onCapabilityFanSpeed.bind(this));
    }

    if (this.hasCapability('horizontal_position')) {
      this.registerCapabilityListener('horizontal_position', this.onCapabilityHorizontalPosition.bind(this));
    }

    if (this.hasCapability('onoff')) {
      this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));
    }

    if (this.hasCapability('operating_mode')) {
      this.registerCapabilityListener('operating_mode', this.onCapabilityOperatingMode.bind(this));
    }

    if (this.hasCapability('target_temperature')) {
      this.registerCapabilityListener('target_temperature', this.onCapabilityTargetTemperature.bind(this));
    }

    if (this.hasCapability('vertical_position')) {
      this.registerCapabilityListener('vertical_position', this.onCapabilityVerticalPosition.bind(this));
    }

    this.log('Capability listeners registered');
  }

  // Set default data
  setDefaults() {
    this.client = null;
    this.accounts = null;
    this.contents = null;
    this.firmware = null;
    this.updates = {};
    this.airconStat = null;
  }

  // Wait to send
  async wait() {
    this.log('Waiting a second before sending updates...');

    return new Promise((resolve) => setTimeout(resolve, this.constructor.SEND_INTERVAL));
  }

  /*
  | Logging functions
  */

  error(...args) {
    super.error(...[...this.logPrefix(), ...args]);
  }

  log(...args) {
    if (filled(this.constructor.LOG_DEVICE_ID) && this.getData().id !== this.constructor.LOG_DEVICE_ID) return;

    super.log(...[...this.logPrefix(), ...args]);
  }

  logPrefix() {
    const settings = this.getSettings();

    return [
      `[${settings.firmware_type || ''}]`,
      `[WIFI:${settings.wifi_firmware || ''}]`,
      `[MCU:${settings.mcu_firmware || ''}]`,
      `[${settings.ip_address || ''}:${settings.port || ''}]`,
      `[${this.getData().id}]`,
    ];
  }

}

module.exports = Device;
