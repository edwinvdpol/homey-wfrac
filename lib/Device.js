'use strict';

const Homey = require('homey');
const Client = require('./Client');

class Device extends Homey.Device {

  /*
  | Device events
  */

  // Device added
  async onAdded() {
    this.log('Added');
  }

  // Device deleted
  async onDeleted() {
    // Delete account from device
    await this.deleteAccount(true);

    // Unregister timer
    this.unregisterTimer().catch(this.error);

    // Clear variables
    this.client = null;
    this.contents = null;
    this.airconStat = null;

    this.log('Deleted');
  }

  // Device initialized
  async onInit() {
    this.setUnavailable(this.homey.__('status.wait')).catch(this.error);

    // Set registered from store
    this.setRegistered();

    const store = this.getStore();

    // Initialize
    this.client = new Client(store);
    this.accounts = null;
    this.firmware = null;
    this.operatorId = store.operatorId;

    // Register capability listeners
    this.registerCapabilityListeners();

    this.log('Initialized');
  }

  // Device destroyed
  async onUninit() {
    this.log('Destroyed');
  }

  /*
  | Synchronization function
  */

  // Synchronize
  async sync(data = null) {
    this.log('Sync data');

    try {
      await this.syncAirconStat(data);
      await this.syncCapabilities();
      await this.syncSettings();
      await this.syncAccount();
    } catch (err) {
      const msg = this.homey.__(err.message);

      this.error(err.message);
      this.setUnavailable(msg).catch(this.error);
    }
  }

  // Update device
  async updateDevice(properties) {
    // Device not available
    if (!this.getAvailable()) {
      return this.error('Update device: Device not available');
    }

    this.log('Updating device...');

    try {
      // Device not registered
      if (!this.registered) {
        throw new Error(this.getAccountWarning());
      }

      // Sync AirconStat
      await this.syncAirconStat();

      // Set properties
      for (const [key, value] of Object.entries(properties)) {
        this.airconStat[key] = value;
        this.log(`-- AirconStat '${key}' is now '${value}'`);
      }

      // Send update
      this.log('-- Send to device:', JSON.stringify(this.airconStat));
      const result = await this.client.setAirconStat(this.airconStat);
      this.log('Device updated');

      // Sync
      return this.sync(result);
    } catch (err) {
      const msg = this.homey.__(err.message);

      this.error('Update error:', err.message);
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

    this.log('Available');

    // Update network information
    this.setNetwork(result);

    // Set available
    this.setAvailable().catch(this.error);

    // Register timer
    await this.registerTimer();

    // Synchronize
    await this.sync();
  }

  // Device changed
  onDiscoveryAddressChanged(result) {
    this.log('Address changed');

    // Update network information
    this.setNetwork(result);
  }

  // Device offline
  onDiscoveryLastSeenChanged(result) {
    this.log('Last seen changed', `${result.address}:${result.port}`);
  }

  /*
  | Device functions
  */

  // Mark as registered
  setRegistered(registered = null) {
    if (registered === null) {
      registered = this.getStoreValue('registered');
    }

    this.setStoreValue('registered', registered).catch(this.error);
    this.registered = registered;

    if (registered) {
      return this.log('Device registered');
    }

    return this.log('Device unregistered');
  }

  // Set network information
  setNetwork(info) {
    this.log('Network information');
    this.log('-- IP address:', info.address);
    this.log('-- Port:', info.port);

    // Update client configuration
    this.client.address = info.address;
    this.client.port = info.port;

    // Update settings
    this.setSettings({
      ip_address: String(info.address),
      port: String(info.port),
    }).catch(this.error);
  }

  /*
  | Listener functions
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

  /*
  | Timer functions
  */

  // Register timer
  async registerTimer() {
    if (this.syncDeviceTimer) return;

    this.syncDeviceTimer = this.homey.setInterval(this.sync.bind(this), (1000 * 60));

    this.log('Timer registered');
  }

  // Unregister timer
  async unregisterTimer() {
    if (!this.syncDeviceTimer) return;

    this.homey.clearInterval(this.syncDeviceTimer);

    this.syncDeviceTimer = null;

    this.log('Timer unregistered');
  }

}

module.exports = Device;
