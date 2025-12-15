'use strict';

const crypto = require('crypto');
const { clean } = require('./Utils');
const Coder = require('./Coder');
const {
  AirFlow, HorizontalPosition, OperationMode, VerticalPosition,
} = require('./Enums');

class Aircon {

  constructor(raw) {
    Object.assign(this, clean({
      ...this.fromApiData(raw),
      ...this.fromApiContentsData(raw),
      ...this.fromAirconStatData(raw),
      ...this.fromDiscoveryData(raw),
    }));

    this.ip_address = raw.ip_address;
  }

  fromDiscoveryData(raw) {
    const data = {};

    if ('id' in raw) {
      data.id = raw.id;
      data.aircon_id = raw.id;
    }

    if ('address' in raw) data.ip_address = raw.address;
    if ('port' in raw) data.port = raw.port;
    if ('name' in raw) data.name = raw.name;

    return data;
  }

  fromAirconStatData(raw) {
    if (!('airconStat' in raw)) return {};

    if (typeof raw.airconStat === 'string') {
      const coder = new Coder();

      raw = coder.fromBase64(raw.airconStat);
    }

    const data = {
      airconStat: raw,
    };

    if ('entrust' in raw) data['3d_auto'] = raw.entrust;
    if ('airFlow' in raw) data.fan_speed = AirFlow[raw.airFlow];
    if ('windDirectionLR' in raw) data.horizontal_position = HorizontalPosition[raw.windDirectionLR];
    if ('operationMode' in raw) data.operating_mode = OperationMode[raw.operationMode];
    if ('operation' in raw) data.onoff = raw.operation;
    if ('presetTemp' in raw) data.target_temperature = raw.presetTemp;
    if ('indoorTemp' in raw) data.measure_temperature = raw.indoorTemp;
    if ('outdoorTemp' in raw) data['measure_temperature.outdoor'] = raw.outdoorTemp;
    if ('windDirectionUD' in raw) data.vertical_position = VerticalPosition[raw.windDirectionUD];

    return data;
  }

  get device() {
    return {
      name: this.name,
      data: {
        id: this.id,
      },
      store: {
        registered: false,
        operatorId: crypto.randomUUID(),
        airconId: this.id,
      },
    };
  }

  fromApiData(raw) {
    const data = {};

    if ('deviceId' in raw) data.aircon_id = raw.deviceId;
    if ('operatorId' in raw) data.operator_id = raw.operatorId;

    return data;
  }

  fromApiContentsData(raw) {
    if (!('contents' in raw)) return {};

    const data = {};
    const { contents } = raw;

    if ('firmType' in contents) data.firmware_type = contents.firmType;
    if ('numOfAccount' in contents) data.accounts = String(contents.numOfAccount);

    if ('mcu' in contents) {
      const { mcu } = contents;

      if ('firmVer' in mcu) data.mcu_firmware = mcu.firmVer;
    }

    if ('wireless' in contents) {
      const { wireless } = contents;

      if ('firmVer' in wireless) data.wifi_firmware = wireless.firmVer;
    }

    if ('airconStat' in contents) {
      return { ...data, ...this.fromAirconStatData(contents) };
    }

    return data;
  }

}

module.exports = Aircon;
