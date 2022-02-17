// -*- mode : js; js-indent-level : 2 -*-
import { API } from 'homebridge';
import { LockPlatform } from './src/LockPlatform';
import { HAP } from './src/HAP';

export = (homebridge: API) => {
  HAP.Accessory = homebridge.platformAccessory;
  HAP.Service = homebridge.hap.Service;
  HAP.Characteristic = homebridge.hap.Characteristic;
  HAP.UUID = homebridge.hap.uuid;
  HAP.User = homebridge.user;

  homebridge.registerPlatform('homebridge-sesame', 'Sesame', LockPlatform);
}
