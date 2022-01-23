// -*- mode : js; js-indent-level : 2 -*-
// import { Accessory, Characteristic, Service, UUID } from './interfaces/HAP';
import { PlatformAccessory as Accessory, Characteristic, Service, uuid, User } from 'homebridge';

export class HAP {
  static Accessory: typeof Accessory;
  static Service: typeof Service;
  static Characteristic: typeof Characteristic;
  static UUID: typeof uuid;
  static User: typeof User;
//   private static _accessory: typeof Accessory;
//   private static _service: typeof Service;
//   private static _characteristic: typeof Characteristic;
//   private static _uuid: typeof UUID;
//   private static _user: typeof User;
// //private static _fakegatoService: any;

//   // public static get Accessory() {
//   //   return this._accessory;
//   // }

//   // public static set Accessory(accessory) {
//   //   this._accessory = accessory;
//   // }

//   public static get Service() {
//     return this._service;
//   }

//   public static set Service(hap) {
//     this._service = hap;
//   }

//   public static get Characteristic() {
//     return this._characteristic;
//   }

//   public static set Characteristic(characteristic) {
//     this._characteristic = characteristic;
//   }

//   public static get UUID() {
//     return this._uuid;
//   }

//   public static set UUID(uuid) {
//     this._uuid = uuid;
//   }

//   public static get User() {
//     return this._user;
//   }

//   public static set User(user) {
//     this._user = user;
//   }

//   // public static set fakegatoService(service) {
//   //   this._fakegatoService = service;
//   // }

//   // public static get fakegatoService() {
//   //   return this._fakegatoService;
//   // }
}
