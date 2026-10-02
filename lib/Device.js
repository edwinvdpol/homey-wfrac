'use strict';

const Homey = require('homey');
const Client = require('./Client');
const Coder = require('./Coder');
const { filled, blank, wait } = require('./Utils');
const Data = require('./Data');
const {
  AirFlowNames, HorizontalPositionNames, OperationModeNames, ThermostatMode, VerticalPositionNames,
} = require('./Enums');
const crypto = require('crypto');

class Device extends Homey.Device {

  static LOG_DEVICE_ID = ''; // Only log device with this ID
  static SYNC_INTERVAL = 30; // Seconds
  static SEND_INTERVAL = 1000; // Miliseconds
  static REFUSED_RESULTS = [1, 11, 12]; // Write lock held by another client, or declined by the unit
  static FAILED_SYNC_LIMIT = 3; // Failed syncs in a row before the device is unavailable
  static POWER_INTERVAL = 55; // Seconds, requested at most once a minute
  static FOREIGN_CONTROL_PAUSE = 180; // Seconds
  static WRITE_LOCK_DURATION = 60; // Seconds
  static VOLTAGE = 230; // Volts, used to estimate power from current

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

    // Initialize energy consumptions
    this.initEnergyConsumptions();

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
    this.errorCode = ('error_code' in data) ? data.error_code : null;
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
      this.error('[Sync] Skipped, no address found');

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
      await this.syncCapabilies(data);
      await this.syncSettings(data);
      await this.syncStore(data);
      await this.syncEnergy(data);
      await this.syncPower(data);
      await this.syncCapabilityValues(data);
      await this.syncAccount();
      await this.syncWarning();

      this.failedSyncs = 0;
      this.synced = true;

      this.setAvailable().catch(this.error);
    } catch (err) {
      this.failedSyncs++;
      this.error(`[Sync] Failed (${this.failedSyncs}x)`, err.message);

      // The WiFi module drops off the network briefly now and then, so only
      // mark the device unavailable after a few failed syncs in a row
      if (!this.synced || this.failedSyncs >= this.constructor.FAILED_SYNC_LIMIT) {
        this.setUnavailable(this.homey.__(err.message)).catch(this.error);
      }
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
    if (typeof this.accounts !== 'number') {
      return this.error('[Sync] [Account] Number of accounts not set');
    }

    // Check number of accounts
    if (this.accounts >= 4) {
      return this.error('[Sync] [Account] Limit reached');
    }

    try {
      // Register account
      await this.registerAccount();
    } catch (err) {
      this.error('[Sync] [Account]', err.message);
    }
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

    data = null;
  }

  // Set capability values
  async syncCapabilityValues(data) {
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

  // Set energy
  // The unit counts energy per run in steps of 0.25 kWh, holds the value
  // while it is off and clears it at every power-on. Only the increases of
  // that counter are added to the total, so meter_power never decreases.
  async syncEnergy(data) {
    if (!('energy_counter' in data)) return;
    if (data.energy_counter < 0) return;

    const counter = data.energy_counter;

    if (this.lastEnergyCounter === counter) {
      data.meter_power = this.totalEnergy;
      return;
    }

    if (this.lastEnergyCounter === null) {
      this.log(`[Energy] First counter value: ${counter} kWh`);
    } else if (counter > this.lastEnergyCounter) {
      this.totalEnergy += counter - this.lastEnergyCounter;
    } else {
      // Counter was cleared by a power-on
      this.log(`[Energy] Counter reset from ${this.lastEnergyCounter} to ${counter} kWh`);
      this.totalEnergy += counter;
    }

    this.lastEnergyCounter = counter;
    data.meter_power = this.totalEnergy;

    // Persist to app-level settings (survives device deletion)
    this.homey.settings.set(this.getEnergyKey('totalEnergy'), this.totalEnergy);
    this.homey.settings.set(this.getEnergyKey('lastCounter'), this.lastEnergyCounter);
  }

  // Set estimated power from the operating current
  async syncPower(data) {
    if (!this.hasCapability('measure_power')) return;
    if (!('onoff' in data)) return;

    // Some indoor units switch off on a request without set-bits, stop
    // requesting when that happened after two requests in a row
    if (this.powerRequestedWhileOn && !data.onoff && this.lastWriteAt < this.lastPowerRequestAt) {
      this.powerOffCount++;

      if (this.powerOffCount >= 2) {
        this.powerSupported = false;
        this.error('[Sync] [Power] Unit switched off after operation data requests, disabled');
      }
    } else if (this.powerRequestedWhileOn && data.onoff) {
      this.powerOffCount = 0;
    }

    this.powerRequestedWhileOn = false;

    const now = Date.now();

    // Someone else is using the unit (app or remote control) when its write
    // lock moved beyond the one we hold, leave it to them for a while
    if (this.isForeignControlled(data)) {
      this.powerPausedUntil = now + this.constructor.FOREIGN_CONTROL_PAUSE * 1000;
      this.log('[Sync] [Power] Unit operated by another client, pausing requests');
    }

    // Unit is off
    if (!data.onoff) {
      data.measure_power = 0;
      return;
    }

    if (!this.powerSupported || !this.registered) return;
    if (now < this.powerPausedUntil) return;

    if (now - this.lastPowerRequestAt < this.constructor.POWER_INTERVAL * 1000) return;

    // Keep the full write lock of own commands, a backdated
    // request would shorten it to a few seconds
    const backdate = (now - this.lastWriteAt >= this.constructor.WRITE_LOCK_DURATION * 1000);

    this.lastPowerRequestAt = now;
    this.powerRequestedWhileOn = true;

    try {
      const stat = await this.client.requestOperationData(this.airconStat, [Coder.OPERATING_CURRENT], backdate);

      if (stat && typeof stat.operatingCurrent === 'number') {
        data.measure_power = Math.round(stat.operatingCurrent * this.constructor.VOLTAGE);
      }
    } catch (err) {
      this.error('[Sync] [Power]', err.message);
    }
  }

  // Whether another client or the remote control took the write lock
  // since the last sync
  isForeignControlled(data) {
    if (typeof data.lock_expires !== 'number') return false;

    const expires = data.lock_expires;
    const previous = this.lastLockExpires;
    this.lastLockExpires = expires;

    if (expires <= this.client.ownLockExpires + 2) return false;

    // First sync, only a lock that is still running counts
    if (previous === null) return expires > Date.now() / 1000;

    return expires !== previous;
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
      await this.setSettings(settings);
    }

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

  // Set warning
  async syncWarning() {
    if (!this.getAvailable()) return;

    // Not registered
    if (!this.registered) {
      return this.setWarning(this.homey.__('warning.unregistered'));
    }

    // Unit reports an error
    if (filled(this.errorCode) && this.errorCode !== '00') {
      return this.setWarning(this.homey.__('error.code', { code: this.errorCode }));
    }

    // Remove warning
    await this.unsetWarning();
  }

  // Queue update
  async queue(properties) {
    // Device not registered
    if (!this.registered) throw new Error(this.homey.__('warning.unregistered'));

    const shouldUpdate = blank(this.updates);

    for (const key of Object.keys(properties)) {
      this.airconStat[key] = properties[key];
    }

    // Waiting to retry a refused update, which sends these values as well
    if (this.retryTimeout) {
      this.retryProperties = { ...this.retryProperties, ...properties };

      return;
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
    let raw;

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
      const json = await this.client.setAirconStat(this.airconStat);

      // Refused, the unit is locked for 60 seconds after it was operated
      // by the remote control or another app
      if (this.constructor.REFUSED_RESULTS.includes(json.result)) {
        this.handleRefused(json, properties);

        return;
      }

      this.retryAfterRefused = false;
      this.lastWriteAt = Date.now();

      this.log('[Update] Done');
    } catch (err) {
      if (err.message === 'warning.unregistered') {
        await this.setRegistered(false);
      }

      const msg = this.homey.__(err.message);
      this.error('[Update]', err.message);
      throw new Error(msg);
    } finally {
      // Register timer, unless waiting to retry (a sync would overwrite the queued values)
      if (!this.retryTimeout) {
        this.registerTimer();
      }

      properties = null;
      raw = null;
    }
  }

  // Retry a refused update once, after the write lock expired
  handleRefused(json, properties) {
    if (this.retryAfterRefused) {
      this.retryAfterRefused = false;
      this.error('[Update] Refused again, giving up');
      this.setWarning(this.homey.__('warning.refused')).catch(this.error);

      return;
    }

    // The unit reports when its lock expires, in its own clock (our timestamp)
    let remaining = this.constructor.WRITE_LOCK_DURATION;

    if (json.contents && typeof json.contents.expires === 'number' && typeof json.timestamp === 'number') {
      remaining = json.contents.expires - json.timestamp;
    }

    const delay = Math.min(Math.max(remaining + 2, 2), this.constructor.WRITE_LOCK_DURATION + 2);

    this.log(`[Update] Refused (result ${json.result}), retrying in ${delay} seconds`);

    this.retryAfterRefused = true;
    this.retryProperties = properties;
    this.retryTimeout = this.homey.setTimeout(() => {
      this.retryRefused().catch(this.error);
    }, delay * 1000);
  }

  // Retry the refused properties on top of the current state, which may
  // have been changed by the remote control while waiting
  async retryRefused() {
    this.retryTimeout = null;

    let raw;
    let data;

    const properties = this.retryProperties;
    this.retryProperties = {};

    try {
      raw = await this.client.call('getAirconStat');

      // Create data object
      data = new Data(raw);

      if (filled(data.airconStat)) {
        this.airconStat = data.airconStat;
      }
    } catch (err) {
      this.error('[Update] Refreshing state before retry failed', err.message);
    } finally {
      data = null;
      raw = null;
    }

    await this.queue(properties);
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

    await this.queue({ entrust: value });
  }

  // Fan speed capability changed
  async onCapabilityFanSpeed(value) {
    this.log(`User changed capability 'fan_speed' to '${value}'`);

    await this.queue({ airFlow: AirFlowNames[value] });
  }

  // Horizontal position capability changed
  async onCapabilityHorizontalPosition(value) {
    this.log(`User changed capability 'horizontal_position' to '${value}'`);

    await this.queue({
      windDirectionLR: HorizontalPositionNames[value],
      entrust: false,
    });
  }

  // On/off capability changed
  async onCapabilityOnOff(value) {
    this.log(`User changed capability 'onoff' to '${value}'`);

    await this.setThermostatMode(value, this.getCapabilityValue('operating_mode'));
    await this.queue({ operation: value });
  }

  // Operating mode capability changed
  async onCapabilityOperatingMode(value) {
    this.log(`User changed capability 'operating_mode' to '${value}'`);

    await this.setThermostatMode(this.getCapabilityValue('onoff'), value);
    await this.queue({ operationMode: OperationModeNames[value] });
  }

  // Thermostat mode capability changed, switches the unit like on/off
  // and operating mode do
  async onCapabilityThermostatMode(value) {
    this.log(`User changed capability 'thermostat_mode' to '${value}'`);

    if (value === 'off') {
      await this.setCapabilityValue('onoff', false);
      await this.queue({ operation: false });

      return;
    }

    await this.setCapabilityValue('onoff', true);
    await this.setCapabilityValue('operating_mode', value);
    await this.queue({ operation: true, operationMode: OperationModeNames[value] });
  }

  // Show the thermostat mode of the given state, without it Homey shows the
  // unit as heating whenever the room is below target, even when it is off
  async setThermostatMode(operation, operatingMode) {
    if (!this.hasCapability('thermostat_mode')) return;

    const mode = operation ? (ThermostatMode[operatingMode] || 'auto') : 'off';

    await this.setCapabilityValue('thermostat_mode', mode).catch(this.error);
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

    await this.queue(props);
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

    await this.queue({
      isVacantProperty: value,
      operationMode: OperationModeNames[mode],
      presetTemp: temp,
    });
  }

  // Vertical position capability changed
  async onCapabilityVerticalPosition(value) {
    this.log(`User changed capability 'vertical_position' to '${value}'`);

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

    await this.setStoreValue('registered', registered);
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

    try {
      // Send account to device
      await this.client.updateAccountInfo();

      this.log('[Account] Registered');

      // Mark as registered
      await this.setRegistered(true);
    } catch (err) {
      // Mark as unregistered
      await this.setRegistered(false);

      throw err;
    }
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

    // Add meter power capabilities
    if (!this.hasCapability('meter_power')) {
      await this.addCapability('meter_power');
      this.log(`[Migrate] Added meter_power capability`);
    }

    // Add compressor active capability
    if (!this.hasCapability('compressor_active')) {
      await this.addCapability('compressor_active');
      this.log('[Migrate] Added compressor_active capability');
    }

    // Add thermostat mode capability
    if (!this.hasCapability('thermostat_mode')) {
      await this.addCapability('thermostat_mode');
      this.log('[Migrate] Added thermostat_mode capability');
    }

    // Add error alarm capability
    if (!this.hasCapability('alarm_generic')) {
      await this.addCapability('alarm_generic');
      this.log('[Migrate] Added alarm_generic capability');
    }

    // Add measure power capability
    if (!this.hasCapability('measure_power')) {
      await this.addCapability('measure_power');
      this.log('[Migrate] Added measure_power capability');
    }

    // Migrate store and settings
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

    if (this.hasCapability('thermostat_mode')) {
      this.registerCapabilityListener('thermostat_mode', this.onCapabilityThermostatMode.bind(this));
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
    this.updates = {};
    this.accounts = null;
    this.failedSyncs = 0;
    this.synced = false;
    this.errorCode = null;
    this.airconStat = null;
    this.retryTimeout = null;
    this.retryAfterRefused = false;
    this.retryProperties = {};
    this.lastWriteAt = 0;

    // Energy tracking
    this.totalEnergy = 0;
    this.lastEnergyCounter = null;

    // Power tracking
    this.powerSupported = true;
    this.powerRequestedWhileOn = false;
    this.powerOffCount = 0;
    this.lastPowerRequestAt = 0;
    this.powerPausedUntil = 0;
    this.lastLockExpires = null;
  }

  // Validate IP address
  validateIP(value, allowEmpty = true) {
    if (allowEmpty && blank(value)) return true;

    return (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(value));
  }

  /*
  | Energy tracking functions
  */

  // Get energy key for device
  getEnergyKey(key) {
    return `energy_${this._id}_${key}`;
  }

  // Initialize energy consumptions
  initEnergyConsumptions() {
    this.totalEnergy = this.homey.settings.get(this.getEnergyKey('totalEnergy')) || 0;
    this.lastEnergyCounter = this.homey.settings.get(this.getEnergyKey('lastCounter')) ?? null;

    // Migrate day based tracking, which kept the last counter value
    // outside the total (meter_power was total + last counter value)
    const lastDailyEnergy = this.homey.settings.get(this.getEnergyKey('lastDailyEnergy'));

    if (typeof lastDailyEnergy === 'number') {
      this.totalEnergy += lastDailyEnergy;
      this.lastEnergyCounter = lastDailyEnergy;

      this.homey.settings.set(this.getEnergyKey('totalEnergy'), this.totalEnergy);
      this.homey.settings.set(this.getEnergyKey('lastCounter'), this.lastEnergyCounter);

      for (const key of ['lastDay', 'lastHour', 'hourStartEnergy', 'lastDailyEnergy']) {
        this.homey.settings.unset(this.getEnergyKey(key));
      }

      this.log('[Energy] Migrated day based tracking');
    }

    this.log(`[Energy] Initialized - Total: ${this.totalEnergy}, last counter: ${this.lastEnergyCounter}`);
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

    super.log(`[IP:${this.client?.address || ''}] [REG:${this.registered}] [${this._id}]`, ...args);
  }

  logPrefix() {
    const settings = this.getSettings();

    return `[${settings.firmware_type || ''}] `
      + `[WIFI:${settings.wifi_firmware || ''}] `
      + `[MCU:${settings.mcu_firmware || ''}] `
      + `[IP:${this.client?.address || ''}] `
      + `[REG:${this.registered}] `
      + `[${this._id}]`;
  }

}

module.exports = Device;
