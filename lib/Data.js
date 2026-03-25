'use strict';

const crypto = require('crypto');
const { clean } = require('./Utils');
const Coder = require('./Coder');
const { AirFlow, HorizontalPosition, OperationMode, VerticalPosition } = require('./Enums');

class Data {

  constructor(raw) {
    Object.assign(this, clean({
      ...this.fromApiData(raw),
      ...this.fromDiscoveryData(raw),
    }));
  }

  get device() {
    return {
      name: this.name,
      data: { id: this.id },
      settings: {
        operator_id: crypto.randomUUID(),
        aircon_id: this.id,
      },
      store: {
        registered: false,
      },
    };
  }

  fromAirconStatString(raw) {
    if (typeof raw !== 'string') return {};

    let coder = new Coder();
    raw = coder.fromBase64(raw);

    const data = { airconStat: raw };

    if ('entrust' in raw) data['3d_auto'] = raw.entrust;
    if ('airFlow' in raw) data.fan_speed = AirFlow[raw.airFlow];
    if ('windDirectionLR' in raw) data.horizontal_position = HorizontalPosition[raw.windDirectionLR];
    if ('operationMode' in raw) data.operating_mode = OperationMode[raw.operationMode];
    if ('operation' in raw) data.onoff = raw.operation;
    if ('presetTemp' in raw) data.target_temperature = raw.presetTemp;
    if ('indoorTemp' in raw) data.measure_temperature = raw.indoorTemp;
    if ('outdoorTemp' in raw) data['measure_temperature.outdoor'] = raw.outdoorTemp;
    if ('windDirectionUD' in raw) data.vertical_position = VerticalPosition[raw.windDirectionUD];

    coder = null;
    raw = null;

    return data;
  }

  fromApiData(raw) {
    if (!('contents' in raw)) return {};

    let data = {};
    let { contents } = raw;

    if ('airconStat' in contents) data = this.fromAirconStatString(contents.airconStat);
    if ('firmType' in contents) data.firmware_type = String(contents.firmType);
    if ('mcu' in contents && 'firmVer' in contents.mcu) data.mcu_firmware = String(contents.mcu.firmVer);
    if ('numOfAccount' in contents) data.accounts = String(contents.numOfAccount);
    if ('wireless' in contents && 'firmVer' in contents.wireless) data.wifi_firmware = String(contents.wireless.firmVer);

    raw = null;
    contents = null;

    return data;
  }

  fromDiscoveryData(raw) {
    const data = {};

    if ('id' in raw) data.id = String(raw.id);
    if ('id' in raw) data.aircon_id = String(raw.id);
    if ('address' in raw) data.ip_address = String(raw.address);
    if ('address' in raw) data.ip_address_discovered = String(raw.address);
    if ('port' in raw) data.port = raw.port;
    if ('name' in raw) data.name = raw.name;

    raw = null;

    return data;
  }

}

module.exports = Data;
