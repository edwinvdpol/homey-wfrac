'use strict';

class AirconStat {

  constructor() {
    this.airFlow = -1;
    this.coolHotJudge = false;
    this.electric = 0;
    this.entrust = false;
    this.errorCode = '';
    this.indoorTemp = -1.0;
    this.isAutoHeating = false;
    this.isSelfCleanOperation = false;
    this.isSelfCleanReset = false;
    this.isVacantProperty = false;
    this.modelNo = '00000';
    this.operation = false;
    this.operationMode = -1;
    this.outdoorTemp = -1.0;
    this.presetTemp = -1.0;
    this.windDirectionLR = -1;
    this.windDirectionUD = -1;
  }

}

module.exports = AirconStat;
