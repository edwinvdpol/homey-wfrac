'use strict';

const Homey = require('homey');
const Client = require('./Client');
const { filled, blank } = require('./Utils');
const Aircon = require('./Aircon');
const {
  AirFlowNames, HorizontalPositionNames, OperationModeNames, VerticalPositionNames,
} = require('./Enums');

class Device extends Homey.Device {

  static LOG_DEVICE_ID = ''; // Only log device with this ID
  static SYNC_INTERVAL = 30; // Seconds
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
    this.operator_id = store.operator_id || store.operatorId || null;

    // Update network information
    await this.setNetwork();

    this.log('Initialized');
  }

  // Device settings changed
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('[Settings] Updating');

    for (const name of changedKeys) {
      this.log(`[Settings] User changed '${name}' from '${oldSettings[name]}' to '${newSettings[name]}'`);
    }

    this.log('[Settings] Updated');
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
  async sync(raw = null) {
    if (!this.getAddress()) return;

    let aircon;

    // Skip when data is empty and lock is acquired
    if (!raw && this.client.lock.isLocked()) {
      this.log('[Sync] Skipped, lock is acquired');

      return;
    }

    // Update client configuration
    this.client.address = this.getAddress();

    try {
      if (blank(raw)) {
        raw = await this.client.getAirconStat();
      }

      // Get aircon with raw data
      aircon = new Aircon(raw);

      // Check if data is valid
      if (blank(aircon)) return;

      this.log('[Sync]', JSON.stringify(aircon));

      await this.setVariables(aircon);
      await this.syncStore(aircon);
      await this.syncSettings(aircon);
      await this.syncCapabilityValues(aircon);
      await this.syncAccount();
    } catch (err) {
      const msg = this.homey.__(err.message);

      this.error('[Sync]', err.message);
      this.setUnavailable(msg).catch(this.error);
    } finally {
      aircon = null;
      raw = null;
    }
  }

  // Set variables
  async setVariables(data) {
    this.airconStat = ('airconStat' in data) ? data.airconStat : null;
    this.accounts = ('accounts' in data) ? data.accounts : null;
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

    // Register account (or force register if limit reached)
    if (this.accounts >= 4) {
      this.log('[Sync] [Account] Limit reached, forcing registration...');
    }

    try {
      await this.registerAccount();
    } catch (err) {
      // If registration fails, mark as registered anyway to allow control
      this.log('[Sync] [Account] Force registration failed, continuing in limited mode');

      await this.setRegistered(true);
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

  // Set capability values
  async syncCapabilityValues(data) {
    for (const name of this.getCapabilities()) {
      if (blank(data[name])) continue;
      if (data[name] === this.getCapabilityValue(name)) continue;

      this.setCapabilityValue(name, data[name]).catch(this.error);

      this.log(`[Sync] Device changed capability '${name}' to '${data[name]}'`);
    }

    // Clear memory
    data = null;
  }

  // Set settings
  async syncSettings(data) {
    let settings = {};

    for (const [name, value] of Object.entries(this.getSettings())) {
      if (blank(data[name])) continue;
      if (data[name] === value) continue;

      settings[name] = data[name];

      this.log(`[Sync] Device changed setting '${name}' from '${value}' to '${data[name]}'`);
    }

    // Update settings
    if (filled(settings)) {
      this.setSettings(settings).catch(this.error);
    }

    // Clear memory
    data = null;
    settings = null;

    // Remove warning
    this.unsetWarning().catch(this.error);
  }

  // Set store
  async syncStore(data) {
    // eslint-disable-next-line prefer-const
    for (let [name, value] of Object.entries(this.getStore())) {
      if (name === 'airconId') name = 'aircon_id';
      if (name === 'operatorId') name = 'operator_id';

      if (blank(data[name])) continue;
      if (data[name] === value) continue;

      this.setStoreValue(name, data[name]).catch(this.error);

      this.log(`[Sync] Device changed store '${name}' from '${value}' to '${data[name]}'`);
    }

    // Clear memory
    data = null;
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
    this.discoveredAddress = result?.address;

    // Device is already online
    if (this.getAvailable()) return;

    this.log('Discovery available', JSON.stringify(result));

    // Update network information
    await this.setNetwork();
  }

  // Device changed
  onDiscoveryAddressChanged(result) {
    this.log('Discovery address changed', JSON.stringify(result));

    this.discoveredAddress = result?.address;

    // Update network information
    this.setNetwork().catch(this.error);
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
  async setNetwork() {
    const address = this.getAddress();
    if (!address) return;

    this.log('[Network]', address);

    // Update settings
    await this.setSettings({ ip_address: String(address) });

    // Set available
    this.setAvailable().catch(this.error);

    // Register timer
    this.registerTimer(true);

    // Synchronize
    await this.sync();
  }

  /*
  | Account functions
  */

  // Delete account
  async deleteAccount(uninit = false) {
    if (!this.registered || !this.client) return;

    this.log('[Account] Deleting');
    this.log('-- Operator ID:', this.operator_id);

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
    this.log('[Account] Operator ID:', this.operator_id);

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
    if (this.registered || !this.accounts) return null;

    // Too many accounts
    if (this.accounts > 3) {
      return 'warning.accounts';
    }

    // Account not registered yet
    return 'warning.unregistered';
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

  // Return manual IP address
  getDiscoveredIAddress() {
    return filled(this.discoveredAddress) ? this.discoveredAddress : null;
  }

  // Return IP address
  getAddress() {
    if (this.getManualAddress()) return this.getManualAddress();
    if (this.getDiscoveredIAddress()) return this.getDiscoveredIAddress();

    return null;
  }

  // Return manual IP address
  getManualAddress() {
    const address = this.getSetting('ip_address_manual');

    return filled(address) && address !== 'undefined' ? address : null;
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
    this.updates = {};
    this.airconStat = null;
    this.discoveredAddress = null;
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
      `[${this.getAddress() || ''}]`,
      `[${this.getData().id}]`,
    ];
  }

}

module.exports = Device;
