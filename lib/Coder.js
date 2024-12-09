'use strict';

const AirconStat = require('./AirconStat');

class Coder {

  constructor() {
    this.outdoorTempList = [-50.0, -50.0, -50.0, -50.0, -50.0, -48.9, -46.0, -44.0, -42.0, -41.0, -39.0, -38.0, -37.0, -36.0, -35.0, -34.0, -33.0, -32.0, -31.0, -30.0, -29.0, -28.5, -28.0, -27.0, -26.0, -25.5, -25.0, -24.0, -23.5, -23.0, -22.5, -22.0, -21.5, -21.0, -20.5, -20.0, -19.5, -19.0, -18.5, -18.0, -17.5, -17.0, -16.5, -16.0, -15.5, -15.0, -14.6, -14.3, -14.0, -13.5, -13.0, -12.6, -12.3, -12.0, -11.5, -11.0, -10.6, -10.3, -10.0, -9.6, -9.3, -9.0, -8.6, -8.3, -8.0, -7.6, -7.3, -7.0, -6.6, -6.3, -6.0, -5.6, -5.3, -5.0, -4.6, -4.3, -4.0, -3.7, -3.5, -3.2, -3.0, -2.6, -2.3, -2.0, -1.7, -1.5, -1.2, -1.0, -0.6, -0.3, 0.0, 0.2, 0.5, 0.7, 1.0, 1.3, 1.6, 2.0, 2.2, 2.5, 2.7, 3.0, 3.2, 3.5, 3.7, 4.0, 4.2, 4.5, 4.7, 5.0, 5.2, 5.5, 5.7, 6.0, 6.2, 6.5, 6.7, 7.0, 7.2, 7.5, 7.7, 8.0, 8.2, 8.5, 8.7, 9.0, 9.2, 9.5, 9.7, 10.0, 10.2, 10.5, 10.7, 11.0, 11.2, 11.5, 11.7, 12.0, 12.2, 12.5, 12.7, 13.0, 13.2, 13.5, 13.7, 14.0, 14.2, 14.4, 14.6, 14.8, 15.0, 15.2, 15.5, 15.7, 16.0, 16.2, 16.5, 16.7, 17.0, 17.2, 17.5, 17.7, 18.0, 18.2, 18.5, 18.7, 19.0, 19.2, 19.4, 19.6, 19.8, 20.0, 20.2, 20.5, 20.7, 21.0, 21.2, 21.5, 21.7, 22.0, 22.2, 22.5, 22.7, 23.0, 23.2, 23.5, 23.7, 24.0, 24.2, 24.5, 24.7, 25.0, 25.2, 25.5, 25.7, 26.0, 26.2, 26.5, 26.7, 27.0, 27.2, 27.5, 27.7, 28.0, 28.2, 28.5, 28.7, 29.0, 29.2, 29.5, 29.7, 30.0, 30.2, 30.5, 30.7, 31.0, 31.3, 31.6, 32.0, 32.2, 32.5, 32.7, 33.0, 33.2, 33.5, 33.7, 34.0, 34.3, 34.6, 35.0, 35.2, 35.5, 35.7, 36.0, 36.3, 36.6, 37.0, 37.2, 37.5, 37.7, 38.0, 38.3, 38.6, 39.0, 39.3, 39.6, 40.0, 40.3, 40.6, 41.0, 41.3, 41.6, 42.0, 42.3, 42.6, 43.0];
    this.indoorTempList = [-30.0, -30.0, -30.0, -30.0, -30.0, -30.0, -30.0, -30.0, -30.0, -30.0, -30.0, -30.0, -30.0, -30.0, -30.0, -30.0, -29.0, -28.0, -27.0, -26.0, -25.0, -24.0, -23.0, -22.5, -22.0, -21.0, -20.0, -19.5, -19.0, -18.0, -17.5, -17.0, -16.5, -16.0, -15.0, -14.5, -14.0, -13.5, -13.0, -12.5, -12.0, -11.5, -11.0, -10.5, -10.0, -9.5, -9.0, -8.6, -8.3, -8.0, -7.5, -7.0, -6.5, -6.0, -5.6, -5.3, -5.0, -4.5, -4.0, -3.6, -3.3, -3.0, -2.6, -2.3, -2.0, -1.6, -1.3, -1.0, -0.5, 0.0, 0.3, 0.6, 1.0, 1.3, 1.6, 2.0, 2.3, 2.6, 3.0, 3.2, 3.5, 3.7, 4.0, 4.3, 4.6, 5.0, 5.3, 5.6, 6.0, 6.3, 6.6, 7.0, 7.2, 7.5, 7.7, 8.0, 8.3, 8.6, 9.0, 9.2, 9.5, 9.7, 10.0, 10.3, 10.6, 11.0, 11.2, 11.5, 11.7, 12.0, 12.3, 12.6, 13.0, 13.2, 13.5, 13.7, 14.0, 14.2, 14.5, 14.7, 15.0, 15.3, 15.6, 16.0, 16.2, 16.5, 16.7, 17.0, 17.2, 17.5, 17.7, 18.0, 18.2, 18.5, 18.7, 19.0, 19.2, 19.5, 19.7, 20.0, 20.2, 20.5, 20.7, 21.0, 21.2, 21.5, 21.7, 22.0, 22.2, 22.5, 22.7, 23.0, 23.2, 23.5, 23.7, 24.0, 24.2, 24.5, 24.7, 25.0, 25.2, 25.5, 25.7, 26.0, 26.2, 26.5, 26.7, 27.0, 27.2, 27.5, 27.7, 28.0, 28.2, 28.5, 28.7, 29.0, 29.2, 29.5, 29.7, 30.0, 30.2, 30.5, 30.7, 31.0, 31.3, 31.6, 32.0, 32.2, 32.5, 32.7, 33.0, 33.2, 33.5, 33.7, 34.0, 34.2, 34.5, 34.7, 35.0, 35.3, 35.6, 36.0, 36.2, 36.5, 36.7, 37.0, 37.2, 37.5, 37.7, 38.0, 38.3, 38.6, 39.0, 39.2, 39.5, 39.7, 40.0, 40.3, 40.6, 41.0, 41.2, 41.5, 41.7, 42.0, 42.3, 42.6, 43.0, 43.2, 43.5, 43.7, 44.0, 44.3, 44.6, 45.0, 45.3, 45.6, 46.0, 46.2, 46.5, 46.7, 47.0, 47.3, 47.6, 48.0, 48.3, 48.6, 49.0, 49.3, 49.6, 50.0, 50.3, 50.6, 51.0, 51.3, 51.6, 52.0];
  }

  fromBase64(StatString) {
    const airconStat = new AirconStat();
    const StatByte = Buffer.from(StatString.replace('\n', ''), 'base64').toString('binary');
    const StatByteArray = [];

    for (let i = 0; i < StatByte.length; i++) {
      let h = StatByte.charCodeAt(i);

      StatByteArray[i] = h;
      h = StatByte.charCodeAt(i);

      if (h > 127) {
        StatByteArray[i] = (256 - h) * (-1);
      } else {
        StatByteArray[i] = h;
      }
    }

    return this.byteToStat(airconStat, StatByteArray);
  }

  byteToStat(airconStat, statByteArray) {
    const dataStart = statByteArray[18] * 4 + 21;
    const dataLength = statByteArray.length - 2;
    const data = statByteArray.slice(dataStart, dataLength);
    const code = data[6] & 127;
    const zeroPad = (num, places) => String(num).padStart(places, '0');

    airconStat.operation = (3 & data[2]) === 1;
    airconStat.presetTemp = data[4] / 2;
    airconStat.operationMode = this.wosoFindMatch(60 & data[2], [8, 16, 12, 4], 1);
    airconStat.airFlow = this.wosoFindMatch(15 & data[3], [7, 0, 1, 2, 6]);
    airconStat.windDirectionUD = (data[2] & 192) === 64 ? 0 : this.wosoFindMatch(240 & data[3], [0, 16, 32, 48], 1);
    airconStat.windDirectionLR = (data[12] & 3) === 1 ? 0 : this.wosoFindMatch(31 & data[11], [0, 1, 2, 3, 4, 5, 6], 1);
    airconStat.entrust = (12 & data[12]) === 4;
    airconStat.coolHotJudge = (data[8] & 8) <= 0;
    airconStat.modelNo = this.wosoFindMatch(data[0] & 127, [0, 1, 2]);
    airconStat.isVacantProperty = (data[10] & 1) !== 0;

    if (code === 0) {
      airconStat.errorCode = '00';
    } else if ((data[6] & -128) <= 0) {
      airconStat.errorCode = `M${zeroPad(code, 2)}`;
    } else {
      airconStat.errorCode = `E${code}`;
    }

    let c = 0;
    const vals = [];

    for (let i = dataStart + 19; i < statByteArray.length - 2; i++) {
      vals[c] = statByteArray[i];
      c++;
    }

    airconStat.electric = 0;

    for (let i = 0; i < vals.length; i += 4) {
      if ((vals[i] === -128) && (vals[i + 1] === 16)) {
        airconStat.outdoorTemp = this.outdoorTempList[vals[i + 2] & 0xFF];
      }

      if ((vals[i] === -128) && (vals[i + 1] === 32)) {
        airconStat.indoorTemp = this.indoorTempList[vals[i + 2] & 0xFF];
      }

      if ((vals[i] === -108) && (vals[i + 1] === 16)) {
        const bytes = new Uint8Array([vals[i + 2], vals[i + 3], 0, 0]);
        const uint = new Uint32Array(bytes.buffer)[0];
        airconStat.electric = uint * 0.25;
      }
    }

    return airconStat;
  }

  wosoFindMatch(value, posVals, p = 0) {
    const ret = -1;

    for (let i = 0; i < posVals.length; i++) {
      if (posVals[i] === value) {
        return i + p;
      }
    }

    return ret;
  }

  toBase64(airconStat) {
    let hb = this.commandToByte(airconStat);
    let hhb = this.addCommandVariable(hb);

    const arTo1 = this.addCrc16(hhb);

    hb = this.receiveToBytes(airconStat);
    hhb = this.addVariable(hb);

    const arTo2 = (this.addCrc16(hhb));

    const newAR = arTo1.concat(arTo2);
    let ret = this.arrayBufferToBase64(newAR);
    ret = ret.replace('\n', '');

    return ret;
  }

  commandToByte(airconStat) {
    const statByte = [0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    // On/off
    statByte[2] |= airconStat.operation ? 3 : 2;

    // Operating mode
    if (airconStat.operationMode === 0) {
      statByte[2] |= 32;
    } else if (airconStat.operationMode === 1) {
      statByte[2] |= 40;
    } else if (airconStat.operationMode === 2) {
      statByte[2] |= 48;
    } else if (airconStat.operationMode === 3) {
      statByte[2] |= 44;
    } else if (airconStat.operationMode === 4) {
      statByte[2] |= 36;
    }

    // Air flow
    if (airconStat.airFlow === 0) {
      statByte[3] |= 15;
    } else if (airconStat.airFlow === 1) {
      statByte[3] |= 8;
    } else if (airconStat.airFlow === 2) {
      statByte[3] |= 9;
    } else if (airconStat.airFlow === 3) {
      statByte[3] |= 10;
    } else if (airconStat.airFlow === 4) {
      statByte[3] |= 14;
    }

    // Vertical wind direction
    if (airconStat.windDirectionUD === 0) {
      statByte[2] |= 192;
      statByte[3] |= 128;
    } else if (airconStat.windDirectionUD === 1) {
      statByte[2] |= 128;
      statByte[3] |= 128;
    } else if (airconStat.windDirectionUD === 2) {
      statByte[2] |= 128;
      statByte[3] |= 144;
    } else if (airconStat.windDirectionUD === 3) {
      statByte[2] |= 128;
      statByte[3] |= 160;
    } else if (airconStat.windDirectionUD === 4) {
      statByte[2] |= 128;
      statByte[3] |= 176;
    }

    // Horizontal wind direction
    if (airconStat.windDirectionLR === 0) {
      statByte[12] |= 3;
      statByte[11] |= 16;
    } else if (airconStat.windDirectionLR === 1) {
      statByte[12] |= 2;
      statByte[11] |= 16;
    } else if (airconStat.windDirectionLR === 2) {
      statByte[12] |= 2;
      statByte[11] |= 17;
    } else if (airconStat.windDirectionLR === 3) {
      statByte[12] |= 2;
      statByte[11] |= 18;
    } else if (airconStat.windDirectionLR === 4) {
      statByte[12] |= 2;
      statByte[11] |= 19;
    } else if (airconStat.windDirectionLR === 5) {
      statByte[12] |= 2;
      statByte[11] |= 20;
    } else if (airconStat.windDirectionLR === 6) {
      statByte[12] |= 2;
      statByte[11] |= 21;
    } else if (airconStat.windDirectionLR === 7) {
      statByte[12] |= 2;
      statByte[11] |= 22;
    }

    // Preset temperature
    const { presetTemp } = airconStat;
    statByte[4] |= Math.floor(presetTemp / 0.5) + 128;

    // Entrust
    statByte[12] |= airconStat.entrust ? 12 : 8;

    // Cool hot judge
    if (!airconStat.coolHotJudge) {
      statByte[8] |= 8;
    }

    // Vacant property
    if (airconStat.modelNo === 1) {
      statByte[10] |= airconStat.isVacantProperty ? 1 : 0;
    }

    if (airconStat.modelNo !== 1 && airconStat.modelNo !== 2) {
      return statByte;
    }

    statByte[10] |= airconStat.isSelfCleanReset ? 4 : 0;
    statByte[10] |= airconStat.isSelfCleanOperation ? 144 : 128;

    return statByte;
  }

  receiveToBytes(airconStat) {
    const statByte = [0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    if (airconStat.operation) {
      statByte[2] |= 1;
    }

    // Operating mode
    if (airconStat.operationMode === 1) {
      statByte[2] |= 8;
    } else if (airconStat.operationMode === 2) {
      statByte[2] |= 16;
    } else if (airconStat.operationMode === 3) {
      statByte[2] |= 12;
    } else if (airconStat.operationMode === 4) {
      statByte[2] |= 4;
    }

    // Air flow
    if (airconStat.airFlow === 0) {
      statByte[3] |= 7;
    } else if (airconStat.airFlow === 2) {
      statByte[3] |= 1;
    } else if (airconStat.airFlow === 3) {
      statByte[3] |= 2;
    } else if (airconStat.airFlow === 4) {
      statByte[3] |= 6;
    }

    // Vertical wind direction
    if (airconStat.windDirectionUD === 0) {
      statByte[2] |= 64;
    } else if (airconStat.windDirectionUD === 2) {
      statByte[3] |= 16;
    } else if (airconStat.windDirectionUD === 3) {
      statByte[3] |= 32;
    } else if (airconStat.windDirectionUD === 4) {
      statByte[3] |= 48;
    }

    // Horizontal wind direction
    if (airconStat.windDirectionLR === 0) {
      statByte[12] |= 1;
    } else if (airconStat.windDirectionLR === 1) {
      statByte[11] |= 0;
    } else if (airconStat.windDirectionLR === 2) {
      statByte[11] |= 1;
    } else if (airconStat.windDirectionLR === 3) {
      statByte[11] |= 2;
    } else if (airconStat.windDirectionLR === 4) {
      statByte[11] |= 3;
    } else if (airconStat.windDirectionLR === 5) {
      statByte[11] |= 4;
    } else if (airconStat.windDirectionLR === 6) {
      statByte[11] |= 5;
    } else if (airconStat.windDirectionLR === 7) {
      statByte[11] |= 6;
    }

    // Preset temperature
    const { presetTemp } = airconStat;
    statByte[4] |= Math.floor(presetTemp / 0.5);

    // Entrust
    if (airconStat.entrust) {
      statByte[12] |= 4;
    }

    // Cool hot judge
    if (!airconStat.coolHotJudge) {
      statByte[8] |= 8;
    }

    if (airconStat.modelNo === 1) {
      statByte[0] |= 1;
    } else if (airconStat.modelNo === 2) {
      statByte[0] |= 2;
    }

    // Vacant property
    if (airconStat.modelNo === 1) {
      statByte[10] |= airconStat.isVacantProperty ? 1 : 0;
    }

    if (airconStat.modelNo !== 1 && airconStat.modelNo !== 2) {
      return statByte;
    }

    statByte[15] |= airconStat.isSelfCleanOperation ? 1 : 0;

    return statByte;
  }

  addVariable(byteBuffer) {
    return byteBuffer.concat([1, 255, 255, 255, 255]);
  }

  addCommandVariable(byteBuffer) {
    return byteBuffer.concat([1, 255, 255, 255, 255]);
  }

  crc16ccitt(dataIn) {
    const data = [];

    for (let i = 0; i < dataIn.length; i++) {
      if (dataIn[i] > 127) {
        data[i] = (256 - dataIn[i]) * (-1);
      } else {
        data[i] = dataIn[i];
      }
    }

    let i = 65535;

    for (let i1 = 0; i1 < data.length; i1++) {
      const b = data[i1];

      for (let i2 = 0; i2 < 8; i2++) {
        let z = true;
        const z2 = ((b >> (7 - i2)) & 1) === 1;

        if (((i >> 15) & 1) !== 1) {
          z = false;
        }

        i <<= 1;

        if (z2 ^ z) {
          i ^= 4129;
        }
      }
    }

    return (i & 65535);
  }

  addCrc16(byteBuffer) {
    const crc = this.crc16ccitt(byteBuffer);

    return byteBuffer.concat([(crc & 255), ((crc >> 8) & 255)]);
  }

  byteArrayToBinaryStr(bar) {
    let ret = '';

    for (let i = 0; i < bar.length; i++) {
      ret += String.fromCharCode(bar[i]);
    }

    return ret;
  }

  arrayBufferToBase64(buffer) {
    const binary = this.byteArrayToBinaryStr(buffer);

    return Buffer.from(binary, 'binary').toString('base64');
  }

}

module.exports = Coder;
