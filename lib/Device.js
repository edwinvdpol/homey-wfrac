'use strict';

const Homey = require('homey');
const Client = require('./Client');
const { filled, blank, wait } = require('./Utils');
const Data = require('./Data');
const { AirFlowNames, HorizontalPositionNames, OperationModeNames, VerticalPositionNames } = require('./Enums');
const crypto = require('crypto');

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

    // Set device ID
    this._id = this.getData().id;

    // Set default data
    this.setDefaults();

    // Register capability listeners
    this.registerCapabilityListeners();

    // Set registered from store
    await this.setRegistered();

    // Wait for application
    await this.homey.ready();

    // Initialize
    this.client = new Client(this.homey, this.getSettings(), this.constructor.LOG_DEVICE_ID);

    // Migrate
    await this.migrate();

    // Update network information
    await this.setNetwork();

    this.log('Initialized');
  }

  // Device settings changed
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('[Settings] Updating');

    for (const name of changedKeys) {
      if (name === 'ip_address_manual' && !this.validateIP(newSettings[name])) {
        this.error('[Settings] Invalid manual IP address', newSettings[name]);
        throw new Error(this.homey.__('error.invalid_ip'));
      }

      this.log(`[Settings] User changed '${name}' from '${oldSettings[name]}' to '${newSettings[name]}'`);

      if (name === 'protocol') this.client.protocol = newSettings[name];
    }

    this.log('[Settings] Updated');
  }

  // Device destroyed
  async onUninit() {
    // Unregister timer
    this.unregisterTimer(true);

    // Delete account from device
    await this.deleteAccount();

    // Clear data
    this.setDefaults();

    this.log('Destroyed');
  }

  /*
  | Synchronization function
  */

  // Synchronize
  async sync() {
    // Skip when lock is acquired
    if (this.client.lock.isLocked()) {
      this.log('[Sync] Skipped, lock is acquired');

      return;
    }

    const address = this.getAddress();

    if (blank(address)) {
      this.log('[Sync] Skipped, no address found');

      return;
    }

    // Update client configuration
    this.client.address = address;

    let raw;
    let data;

    try {
      raw = await this.client.call('getAirconStat');

      // Create data object
      data = new Data(raw);

      // Enrich data with other data
      if (filled(this.client.address)) data.ip_address = this.client.address;
      if (filled(this.client.protocol)) data.protocol = this.client.protocol;

      // Synchronize data
      await this.setVariables(data);
      await this.syncSettings(data);
      await this.syncCapabilityValues(data);
      await this.syncAccount();

      this.setAvailable().catch(this.error);
    } catch (err) {
      this.error('[Sync]', err.message);
      this.setUnavailable(this.homey.__(err.message)).catch(this.error);
    } finally {
      data = null;
      raw = null;
    }
  }

  // Set variables
  async setVariables(data) {
    this.airconStat = ('airconStat' in data) ? data.airconStat : null;
    this.accounts = ('accounts' in data) ? Number(data.accounts) : null;
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
      this.error('[Sync] [Account] Force registration failed, continuing in limited mode');
      this.error('[Sync] [Account]', err.message);

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
      if (name in data && data[name] !== this.getCapabilityValue(name)) {
        this.setCapabilityValue(name, data[name]).catch(this.error);
        this.log(`[Sync] Device changed capability '${name}' to '${data[name]}'`);
      }
    }

    data = null;
  }

  // Set settings
  async syncSettings(data) {
    let settings = {};

    for (const [name, old] of Object.entries(this.getSettings())) {
      if (name in data && old !== data[name]) {
        if (data[name] === 'undefined') continue;

        this.log(`[Sync] Device changed setting '${name}' from '${old}' to '${data[name]}'`);
        settings[name] = data[name];
      }
    }

    // Update settings
    if (filled(settings)) {
      this.setSettings(settings).catch(this.error);
    }

    // Remove warning
    this.unsetWarning().catch(this.error);

    settings = null;
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
    let properties;

    try {
      this.log('[Update] Starting');

      // Unregister timer
      this.unregisterTimer();

      // Wait for more updates...
      await wait(this.constructor.SEND_INTERVAL);

      this.log('[Update] Started');

      // Clone and reset updates
      properties = { ...this.updates };
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

      properties = null;
    }
  }

  /*
  | Discovery events
  */

  onDiscoveryResult(result) {
    return result.id === this._id;
  }

  // Device found
  onDiscoveryAvailable(result) {
    this.log('Discovery available', JSON.stringify(result));

    if ('address' in result && filled(result.address)) {
      this.setSettings({ ip_address_discovered: String(result.address) }).catch(this.error);
    }
  }

  // Device changed
  onDiscoveryAddressChanged(result) {
    this.log('Discovery address changed', JSON.stringify(result));

    if ('address' in result && filled(result.address)) {
      this.setSettings({ ip_address_discovered: String(result.address) }).catch(this.error);
    }
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
    const address = this.getAddress(false);
    if (blank(address)) return;

    const current = this.getSetting('ip_address');

    // Update settings
    if (current !== address) {
      this.log(`[Network] Update IP address in settings from '${current}' to '${address}'`);
      this.setSettings({ ip_address: address }).catch(this.error);
    }

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
  async deleteAccount() {
    if (!this.registered || !this.client) return;

    // Delete account from device
    if (this.client) {
      this.log('[Account] Deleting');

      await this.client.deleteAccountInfo();

      this.log('[Account] Deleted');
    }
  }

  // Register account
  async registerAccount() {
    this.log('[Account] Registering');

    // Send account to device
    await this.client.updateAccountInfo();

    this.log('[Account] Registered');

    // Mark as registered
    await this.setRegistered(true);
  }

  /*
  | Warning functions
  */

  // Return warning message for account
  getAccountWarning() {
    if (this.registered || !this.accounts) return null;

    // Too many accounts
    if (this.accounts > 3) {
      this.log('[Account] Too many accounts');
      return 'warning.accounts';
    }

    // Account not registered yet
    this.log('[Account] Account not registered yet');
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

  // Return IP address
  getAddress(log = true) {
    const manual = this.getIP(this.getSetting('ip_address_manual'));

    if (filled(manual)) {
      if (log) this.log('Using manual address from settings', manual);
      return manual;
    }

    const discovered = this.getIP(this.getSetting('ip_address_discovered'));

    if (filled(discovered)) {
      if (log) this.log('Using discovered address', discovered);
      return discovered;
    }

    const settingIP = this.getIP(this.getSetting('ip_address'));

    if (filled(settingIP)) {
      if (log) this.log('Using address from settings', settingIP);
      return settingIP;
    }

    this.error('No usable address found');
    return null;
  }

  // Get IP address from string
  getIP(str) {
    return this.validateIP(str, false) ? str : null;
  }

  // Migrate device properties
  async migrate() {
    let store = this.getStore();
    let settings = {
      aircon_id: String(this._id),
    };

    if ('operatorId' in store) {
      settings.operator_id = String(store.operatorId);
      this.unsetStoreValue('operatorId').catch(this.error);
    }

    if ('operator_id' in store) {
      settings.operator_id = String(store.operator_id);
      this.unsetStoreValue('operator_id').catch(this.error);
    }

    if (filled(settings)) {
      this.log('[Migrate] Settings', JSON.stringify(settings));
      await this.setSettings(settings);
    }

    settings = null;
    store = null;

    // Wait for a second
    await wait();

    // Register new account if needed
    if (blank(this.getSetting('operator_id'))) {
      this.log('[Migrate] Registering new account');

      let operator_id = crypto.randomUUID();

      try {
        this.client.operator_id = operator_id;

        await this.registerAccount();
        await this.setSettings({ operator_id: operator_id });
      } catch (err) {
        this.client.operator_id = '';
        this.error('[Migrate] Failed to register new account:', err.message);
      } finally {
        operator_id = null;
      }
    }

    this.log('[Migrate] Done');
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
    this.updates = {};
    this.airconStat = null;
  }

  // Validate IP address
  validateIP(value, allowEmpty = true) {
    if (allowEmpty && blank(value)) return true;

    return (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(value));
  }

  /*
  | Logging functions
  */

  error(...args) {
    if (filled(this.constructor.LOG_DEVICE_ID) && this._id !== this.constructor.LOG_DEVICE_ID) return;

    super.error(this.logPrefix(), ...args);
  }

  log(...args) {
    if (filled(this.constructor.LOG_DEVICE_ID) && this._id !== this.constructor.LOG_DEVICE_ID) return;

    super.log(`[IP:${this.client?.address || ''}] [${this._id}]`, ...args);
  }

  logPrefix() {
    const settings = this.getSettings();

    return `[${settings.firmware_type || ''}] `
      + `[WIFI:${settings.wifi_firmware || ''}] `
      + `[MCU:${settings.mcu_firmware || ''}] `
      + `[IP:${this.client?.address || ''}] `
      + `[${this._id}]`;
  }

}

module.exports = Device;
