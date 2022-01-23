// -*- mode : js; js-indent-level : 2 -*-
import { PlatformAccessory as Accessory, Characteristic, Service, uuid, User } from 'homebridge';

export class HAP {
  static Accessory: typeof Accessory;
  static Service: typeof Service;
  static Characteristic: typeof Characteristic;
  static UUID: typeof uuid;
  static User: typeof User;
}
