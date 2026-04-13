'use strict';

class AirconStat {

  constructor() {
    this.airFlow = -1;
    this.coolHotJudge = false;
    this.electric = 0;
    this.entrust = false;
    this.errorCode = '';
    this.indoorTemp = -1.0;
    this.modelNo = '00000';
    this.operation = false;
    this.operationMode = 0;
    this.outdoorTemp = -1.0;
    this.presetTemp = -1.0;
    this.windDirectionLR = -1;
    this.windDirectionUD = -1;

    // Not always available, depends on model.
    this.isSelfCleanOperation = null;
    this.isSelfCleanReset = null;
    this.isVacantProperty = null;
  }

}

module.exports = AirconStat;
