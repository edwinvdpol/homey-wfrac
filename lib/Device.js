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

  static SYNC_INTERVAL = 30; // Seconds
  static SEND_INTERVAL = 500; // Miliseconds

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
    this.setUnavailable(this.homey.__('status.waiting')).catch(this.error);

    // Set default data
    this.setDefaults();

    // Register capability listeners
    this.registerCapabilityListeners();

    // Set registered from store
    await this.setRegistered();

    const store = this.getStore();

    // Initialize
    this.client = new Client(store);
    this.operatorId = store.operatorId;

    this.log('Initialized');
  }

  // Device destroyed
  async onUninit() {
    // Unregister timer
    this.unregisterTimer();

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
    if (!data && this.client.lock.isLocked()) return;

    try {
      await this.syncAirconStat(data);
      await this.syncCapabilities();
      await this.syncSettings();
      await this.syncAccount();
    } catch (err) {
      const msg = this.homey.__(err.message);

      this.error('[Sync]', err.toString());
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
    if (!this.airconStat) return;

    let stat = this.airconStat;

    // 3D AUTO
    if ('entrust' in stat && this.hasCapability('3d_auto')) {
      this.setCapabilityValue('3d_auto', stat.entrust).catch(this.error);
    }

    // Fan speed
    if ('airFlow' in stat && this.hasCapability('fan_speed')) {
      this.setCapabilityValue('fan_speed', AirFlow[stat.airFlow]).catch(this.error);
    }

    // Horizontal position
    if ('windDirectionLR' in stat && this.hasCapability('horizontal_position')) {
      this.setCapabilityValue('horizontal_position', HorizontalPosition[stat.windDirectionLR]).catch(this.error);
    }

    // Indoor temperature
    if ('indoorTemp' in stat && this.hasCapability('measure_temperature')) {
      this.setCapabilityValue('measure_temperature', stat.indoorTemp).catch(this.error);
    }

    // Operation
    if ('operation' in stat && this.hasCapability('onoff')) {
      this.setCapabilityValue('onoff', stat.operation).catch(this.error);
    }

    // Operating mode
    if ('operationMode' in stat && this.hasCapability('operating_mode')) {
      this.setCapabilityValue('operating_mode', OperationMode[stat.operationMode]).catch(this.error);
    }

    // Outdoor temperature
    if ('outdoorTemp' in stat && this.hasCapability('measure_temperature')) {
      this.setCapabilityValue('measure_temperature.outdoor', stat.outdoorTemp).catch(this.error);
    }

    // Preset temperature
    if ('presetTemp' in stat && this.hasCapability('target_temperature')) {
      this.setCapabilityValue('target_temperature', stat.presetTemp).catch(this.error);
    }

    // Vertical position
    if ('windDirectionUD' in stat && this.hasCapability('vertical_position')) {
      this.setCapabilityValue('vertical_position', VerticalPosition[stat.windDirectionUD]).catch(this.error);
    }

    stat = null;
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

      // Wait for more updates...
      await this.wait();

      this.log('[Update] Started');

      // Clone and reset updates
      const properties = { ...this.updates };
      this.updates = {};

      this.log('[Update]', JSON.stringify(properties));

      // Set full data
      const full = { ...this.airconStat, ...properties };

      // Send update
      this.log('[Update] Full:', JSON.stringify(full));
      const result = await this.client.setAirconStat(full);
      this.log('[Update] Done');

      // Sync
      await this.sync(result);
    } catch (err) {
      const msg = this.homey.__(err.message);

      this.error('[Update]', err.toString());
      throw new Error(msg);
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

    // Update network information
    await this.setNetwork(result);

    // Set available
    this.setAvailable().catch(this.error);

    // Register timer
    this.registerTimer();

    // Synchronize
    await this.sync();
  }

  // Device changed
  onDiscoveryAddressChanged(result) {
    this.log('Address changed');

    // Update network information
    this.setNetwork(result).catch(this.error);
  }

  // Device offline
  onDiscoveryLastSeenChanged(result) {
    this.log('Last seen changed', `${result.address}:${result.port}`);
  }

  /*
  | Capability events
  */

  // 3D AUTO capability changed
  async onCapability3dAuto(value) {
    this.log(`3D AUTO changed to '${value}'`);

    await this.queue({ entrust: value });
  }

  // Fan speed capability changed
  async onCapabilityFanSpeed(value) {
    this.log(`Fan speed changed to '${value}'`);

    await this.queue({ airFlow: AirFlowNames[value] });
  }

  // Horizontal position capability changed
  async onCapabilityHorizontalPosition(value) {
    this.log(`Horizontal position changed to '${value}'`);

    await this.queue({
      windDirectionLR: HorizontalPositionNames[value],
      entrust: false,
    });
  }

  // On/off capability changed
  async onCapabilityOnOff(value) {
    this.log(`Operation changed to '${value}'`);

    await this.queue({ operation: value });
  }

  // Operating mode capability changed
  async onCapabilityOperatingMode(value) {
    this.log(`Operating mode changed to '${value}'`);

    await this.queue({ operationMode: OperationModeNames[value] });
  }

  // Target temperature capability changed
  async onCapabilityTargetTemperature(value) {
    this.log(`Target temperature changed to '${value}°C'`);

    await this.queue({ presetTemp: value });
  }

  // Vertical position capability changed
  async onCapabilityVerticalPosition(value) {
    this.log(`Vertical position changed to '${value}'`);

    await this.queue({
      windDirectionUD: VerticalPositionNames[value],
      entrust: false,
    });
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
  registerTimer() {
    if (this.syncDeviceTimer) return;

    const interval = 1000 * this.constructor.SYNC_INTERVAL;

    this.syncDeviceTimer = this.homey.setInterval(this.sync.bind(this), interval);

    this.log('[Timer] Registered');
  }

  // Unregister timer
  unregisterTimer() {
    if (!this.syncDeviceTimer) return;

    this.homey.clearInterval(this.syncDeviceTimer);

    this.syncDeviceTimer = null;

    this.log('[Timer] Unregistered');
  }

  /*
  | Support functions
  */

  // Register capability listeners
  registerCapabilityListeners() {
    this.registerCapabilityListener('3d_auto', this.onCapability3dAuto.bind(this));
    this.registerCapabilityListener('fan_speed', this.onCapabilityFanSpeed.bind(this));
    this.registerCapabilityListener('horizontal_position', this.onCapabilityHorizontalPosition.bind(this));
    this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));
    this.registerCapabilityListener('operating_mode', this.onCapabilityOperatingMode.bind(this));
    this.registerCapabilityListener('target_temperature', this.onCapabilityTargetTemperature.bind(this));
    this.registerCapabilityListener('vertical_position', this.onCapabilityVerticalPosition.bind(this));

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
    return new Promise((resolve) => setTimeout(resolve, this.constructor.SEND_INTERVAL));
  }

}

module.exports = Device;
