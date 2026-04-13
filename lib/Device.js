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

    // Set registered from store
    await this.setRegistered();

    // Wait for application
    await this.homey.ready();

    // Initialize
    this.client = new Client(this.homey, this.getSettings(), this.constructor.LOG_DEVICE_ID);

    // Migrate
    await this.migrate();

    // Initialize energy tracking from store
    this.initEnergyTracking();

    // Register capability listeners
    await this.registerCapabilityListeners();

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

  // Set variables
  async setVariables(data) {
    this.airconStat = ('airconStat' in data) ? data.airconStat : null;
    this.accounts = ('accounts' in data) ? Number(data.accounts) : null;
  }

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
      await this.syncCapabilies(data);
      await this.setVariables(data);
      await this.syncSettings(data);
      await this.syncStore(data);
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

  // Set capabilities
  async syncCapabilies(data) {
    // Add vacant property mode capability
    if (!this.hasCapability('vacant_property_mode') && 'vacant_property_mode' in data) {
      await this.addCapability('vacant_property_mode');
      this.registerCapabilityListener('vacant_property_mode', this.onCapabilityVacantPropertyMode.bind(this));
      this.log('[Sync] Added vacant property mode capability');
    }

    // Remove vacant property mode capability
    if (this.hasCapability('vacant_property_mode') && !('vacant_property_mode' in data)) {
      await this.removeCapability('vacant_property_mode');
      this.log('[Sync] Removed vacant property mode capability');
    }

    // Add energy capabilities if not present (for existing devices)
    for (const name of ['meter_power', 'meter_power.today', 'meter_power.hour']) {
      if (!this.hasCapability(name)) {
        await this.addCapability(name);
        this.log(`[Sync] Added ${name} capability`);
      }
    }

    data = null;
  }

  // Set capability values
  async syncCapabilityValues(data) {
    data.meter_power = this.getTotalEnergy();
    data['meter_power.hour'] = this.getHourEnergy();

    for (const name of this.getCapabilities()) {
      if (name in data && data[name] !== this.getCapabilityValue(name)) {
        if (typeof data[name] === 'number' && data[name] < 0) {
          this.error(`[Sync] Invalid '${name}' capability value: '${data[name]}'`);
          continue;
        }

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

  // Set store
  async syncStore(data) {
    for (const [name, old] of Object.entries(this.getStore())) {
      if (name in data && old !== data[name]) {
        this.log(`Device changed store '${name}' to '${data[name]}'`);
        this.setStoreValue(name, data[name]).catch(this.error);
      }
    }
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

    const hasVacant = this.hasCapability('vacant_property_mode');

    let props = {};

    if (hasVacant) {
      let vacantProperty;
      let operatingMode;

      if (value < 10) value = 10;
      if (value > 33) value = 33;

      if (value < 18) {
        vacantProperty = true;
        operatingMode = 'heat';
        await this.setStoreValue('vacant_target_temperature', value);
      } else if (value > 30) {
        vacantProperty = true;
        operatingMode = 'cool';
        await this.setStoreValue('vacant_target_temperature', value);
      } else {
        vacantProperty = false;
        operatingMode = this.getStoreValue('normal_operating_mode');
        await this.setStoreValue('normal_target_temperature', value);
      }

      await this.setCapabilityValue('operating_mode', operatingMode);
      await this.setCapabilityValue('vacant_property_mode', vacantProperty);

      props.isVacantProperty = vacantProperty;
      props.operationMode = OperationModeNames[operatingMode];
    }

    if (!hasVacant) {
      if (value < 18) value = 18;
      if (value > 30) value = 30;
    }

    props.presetTemp = value;

    await this.setCapabilityValue('target_temperature', value);

    this.queue(props).catch(this.error);
  }

  // Vacant property mode capability changed
  async onCapabilityVacantPropertyMode(value) {
    this.log(`User changed capability 'vacant_property_mode' to '${value}'`);

    const temp = this.getStoreValue(value ? 'vacant_target_temperature' : 'normal_target_temperature');
    let mode = this.getStoreValue('normal_operating_mode');

    if (value) {
      if (temp < 18) mode = 'heat';
      if (temp > 30) mode = 'cool';
    }

    await this.setCapabilityValue('operating_mode', mode);
    await this.setCapabilityValue('target_temperature', temp);

    this.queue({
      isVacantProperty: value,
      operationMode: OperationModeNames[mode],
      presetTemp: temp,
    }).catch(this.error);
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
    this.log('[Migrate] Started');

    let store = this.getStore();
    let settings = {
      aircon_id: String(this._id),
    };

    // Remove operatorId from store
    if ('operatorId' in store) {
      settings.operator_id = String(store.operatorId);
      await this.unsetStoreValue('operatorId');
    }

    // Remove operator_id from store
    if ('operator_id' in store) {
      settings.operator_id = String(store.operator_id);
      await this.unsetStoreValue('operator_id');
    }

    // Add normal operating mode to store
    if (!('normal_operating_mode' in store)) {
      await this.setStoreValue('normal_operating_mode', 'cool');
    }

    // Add normal target temperature to store
    if (!('normal_target_temperature' in store)) {
      await this.setStoreValue('normal_target_temperature', 18);
    }

    // Add vacant target temperature to store
    if (!('vacant_target_temperature' in store)) {
      await this.setStoreValue('vacant_target_temperature', 10);
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

    this.log('[Migrate] Finished');
  }

  // Register capability listeners
  async registerCapabilityListeners() {
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

    if (this.hasCapability('vacant_property_mode')) {
      this.registerCapabilityListener('vacant_property_mode', this.onCapabilityVacantPropertyMode.bind(this));
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
    // Energy tracking
    this.totalEnergy = 0;
    this.lastDay = null;
    this.lastHour = null;
    this.hourStartEnergy = 0;
    this.lastDailyEnergy = 0;
  }

  // Validate IP address
  validateIP(value, allowEmpty = true) {
    if (allowEmpty && blank(value)) return true;

    return (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(value));
  }

  /*
  | Energy tracking functions
  */

  // Get app-level settings key with device ID prefix
  getEnergyKey(key) {
    return `energy_${this._id}_${key}`;
  }

  // Initialize energy tracking from app-level settings
  initEnergyTracking() {
    // First try to migrate from device store to app settings (for existing installs)
    this.migrateEnergyToAppSettings();

    this.totalEnergy = this.homey.settings.get(this.getEnergyKey('totalEnergy')) || 0;
    this.lastDay = this.homey.settings.get(this.getEnergyKey('lastDay')) || null;
    this.lastHour = this.homey.settings.get(this.getEnergyKey('lastHour')) || null;
    this.hourStartEnergy = this.homey.settings.get(this.getEnergyKey('hourStartEnergy')) || 0;
    this.lastDailyEnergy = this.homey.settings.get(this.getEnergyKey('lastDailyEnergy')) || 0;
    this.log(`[Energy] Initialized from app settings: total=${this.totalEnergy}, lastDay=${this.lastDay}, lastHour=${this.lastHour}`);
  }

  // Migrate energy data from device store to app settings (one-time migration)
  migrateEnergyToAppSettings() {
    // Check if we already migrated
    if (this.homey.settings.get(this.getEnergyKey('migrated'))) {
      return;
    }

    // Check if there's data in device store to migrate
    const oldTotal = this.getStoreValue('totalEnergy');
    if (oldTotal !== null && oldTotal !== undefined) {
      this.log('[Energy] Migrating energy data from device store to app settings...');

      // Copy all values to app settings
      this.homey.settings.set(this.getEnergyKey('totalEnergy'), oldTotal);
      this.homey.settings.set(this.getEnergyKey('lastDay'), this.getStoreValue('lastDay'));
      this.homey.settings.set(this.getEnergyKey('lastHour'), this.getStoreValue('lastHour'));
      this.homey.settings.set(this.getEnergyKey('hourStartEnergy'), this.getStoreValue('hourStartEnergy'));
      this.homey.settings.set(this.getEnergyKey('lastDailyEnergy'), this.getStoreValue('lastDailyEnergy'));

      this.log(`[Energy] Migrated: total=${oldTotal} kWh`);
    }

    // Mark as migrated
    this.homey.settings.set(this.getEnergyKey('migrated'), true);
  }

  // Update energy tracking based on device data
  updateEnergyTracking(dailyEnergy) {
    if (typeof dailyEnergy !== 'number' || dailyEnergy < 0) return;

    const now = new Date();
    const currentDay = now.toDateString();
    const currentHour = now.getHours();

    // Detect new day (daily energy reset)
    if (this.lastDay && this.lastDay !== currentDay) {
      // Add yesterday's final energy to total
      if (this.lastDailyEnergy > 0) {
        this.totalEnergy += this.lastDailyEnergy;
        this.log(`[Energy] New day detected. Added ${this.lastDailyEnergy} kWh to total. New total: ${this.totalEnergy} kWh`);
      }
      // Reset hour tracking for new day
      this.hourStartEnergy = 0;
      this.lastHour = currentHour;
    }

    // Detect new hour
    if (this.lastHour !== null && this.lastHour !== currentHour) {
      // Store energy at start of new hour
      this.hourStartEnergy = dailyEnergy;
      this.log(`[Energy] New hour detected (${currentHour}). Hour start energy: ${this.hourStartEnergy} kWh`);
    }

    // Initialize on first run
    if (this.lastDay === null) {
      this.lastDay = currentDay;
      this.lastHour = currentHour;
      this.hourStartEnergy = dailyEnergy;
      this.log(`[Energy] First run. Day: ${currentDay}, Hour: ${currentHour}, Daily: ${dailyEnergy} kWh`);
    }

    // Update tracking variables
    this.lastDay = currentDay;
    this.lastHour = currentHour;
    this.lastDailyEnergy = dailyEnergy;

    // Persist to app-level settings (survives device deletion)
    this.homey.settings.set(this.getEnergyKey('totalEnergy'), this.totalEnergy);
    this.homey.settings.set(this.getEnergyKey('lastDay'), this.lastDay);
    this.homey.settings.set(this.getEnergyKey('lastHour'), this.lastHour);
    this.homey.settings.set(this.getEnergyKey('hourStartEnergy'), this.hourStartEnergy);
    this.homey.settings.set(this.getEnergyKey('lastDailyEnergy'), this.lastDailyEnergy);
  }

  // Get cumulative total energy (total + current day)
  getTotalEnergy() {
    return this.totalEnergy + (this.lastDailyEnergy || 0);
  }

  // Get energy consumed this hour
  getHourEnergy() {
    const dailyEnergy = this.lastDailyEnergy || 0;
    const hourStart = this.hourStartEnergy || 0;
    return Math.max(0, dailyEnergy - hourStart);
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
