// -*- mode : js; js-indent-level : 2 -*-
import { API, Logger as Log, Access } from 'homebridge';
import { HAP } from "./HAP";
import { LockStatus, Lock } from "./interfaces/API";
import { PlatformAccessory as Accessory} from 'homebridge';
import { Service, WithUUID } from 'homebridge';
import { Logger } from "./Logger";
import { Client } from "./Client";
import { Mutex } from "./util/Mutex";
import { LockPlatform } from "./LockPlatform";

import * as path from 'path';
import nodePersist = require("node-persist");

interface currentState {
  currentLockState?: boolean;
  targetLockState?: boolean;
  currentBatteryLevel?: number;
  statusLowBattery?: number;
  lastActivation?: number;
  openDuration?: number;
  closedDuration?: number;
  timesOpened?: number;
  lastTime?: number;
  lastReset?: number;
};

export class LockAccessory {
  lock: Lock;
  accessory: Accessory;
  log: Log;
  api: API;
  historyService: any;

  client: Client;
  mutex: Mutex<LockStatus>;

  state;
  eveHistoryType: string;

  
  constructor(log: Log, lock: Lock, accessory: Accessory, platform: LockPlatform) {
    this.log = log;
    this.lock = lock;
    this.accessory = accessory;
    this.api = platform.platform;
    this.eveHistoryType = 'door';
    //this.eveHistoryType = 'motion';

    this.client = new Client();
    this.mutex = new Mutex<LockStatus>();

    this.state = {};
    this.setupLockStatePersist(HAP.User.storagePath(), platform);

    this.accessory.getService(HAP.Service.AccessoryInformation)
      .setCharacteristic(HAP.Characteristic.Manufacturer, 'CANDY HOUSE')
      .setCharacteristic(HAP.Characteristic.Model, 'Sesame')
      .setCharacteristic(HAP.Characteristic.SerialNumber, this.lock.serial);

    this.setupLockServiceCharacteristics();
    this.setupBatteryServiceCharacteristics();

    //this.setupHistoryService(platform);
  }

  // getServices(): Service[] {
  //   Logger.log('getServices() is requested.');

  //   return [
  //     this.accessory.getService(HAP.Service.LockMechanism),
  //     this.accessory.getService(HAP.Service.BatteryService),
  //     this.accessory.getService(HAP.Service.AccessoryInformation)
  //   ]
  // }
  
  getOrCreateHAPService(service: WithUUID<typeof Service>): Service {
    let hapService: Service = this.accessory.getService(service);

    if (!hapService) {
      hapService = this.accessory.addService(service, this.lock.nickname);
    }

    return hapService;
  }

  async setupLockStatePersist(user: string, platform: LockPlatform): Promise<void> {
    const persist = nodePersist.create();
    const nickname = this.lock.nickname;
    await persist.init({
      dir: path.join(user, 'plugin-persist', 'homebridge-sesame'),
      forgiveParseErrors: true,
      // logging: (message) => {
      //   console.log(message);
      // }
    });
    let state:currentState = await persist.getItem(nickname) || {};
    try {
      let status:LockStatus = await this.mutex.wait(() => this.client.getStatus(this.lock.device_id));
      state.currentLockState = status.locked ? true : false;
      state.targetLockState = status.locked ? true : false;
    } catch (e) {
      state.currentLockState = undefined;
      state.targetLockState = undefined;
    }
    //Logger.log(`${this.lock.nickname}: currentLockState(${this.state.currentLockState}) targetLockState(${this.state.targetLockState})`);
    state.lastActivation = state.lastActivation || undefined;
    state.openDuration = state.openDuration  || 0;
    state.closedDuration = state.closedDuration || 0;
    state.timesOpened = state.timesOpened || 0;
    //Logger.log(`${this.lock.nickname}:`, JSON.stringify(state));
    this.state = new Proxy(state, {
      set: function(target:any, key:PropertyKey, value:any, receiver:any):boolean {
	try {
	  persist.setItem(nickname, target)
	} catch(e) {
	  Logger.error(`${this.lock.nickname} is unable to set lock state persist`, e);
	}
	return Reflect.set(target, key, value, receiver);
      }.bind(this)
    })
    this.state.lastTime = Math.round(new Date().valueOf()/1000);
    // if (!this.state.lastReset) {
    //   this.state.lastReset = Math.round((new Date().valueOf() - Date.parse('01 Jan 2001 00:00:00 GMT'))/1000);
    // }

    //console.log(`${this.lock.nickname}:`, JSON.stringify(this.state));
    await this.setupHistoryService(platform);
}
  
  setupLockServiceCharacteristics(): void {
    let lockService = this.getOrCreateHAPService(HAP.Service.LockMechanism);

    lockService.getCharacteristic(HAP.Characteristic.LockCurrentState)
      .on('get', this.getCurrentLockState.bind(this));

    lockService.getCharacteristic(HAP.Characteristic.LockTargetState)
      .on('get', this.getTargetLockState.bind(this))
      .on('set', this.setLockState.bind(this));
  }

  setupBatteryServiceCharacteristics(): void {
    let batteryService = this.getOrCreateHAPService(HAP.Service.BatteryService);

    batteryService.getCharacteristic(HAP.Characteristic.BatteryLevel)
      .on('get', this.getBatteryLevel.bind(this));

    batteryService.getCharacteristic(HAP.Characteristic.ChargingState)
      .on('get', this.getBatteryChargingState.bind(this));

    batteryService.getCharacteristic(HAP.Characteristic.StatusLowBattery)
      .on('get', this.getLowBatteryStatus.bind(this));
  }

  async getCurrentLockState(callback: Function): Promise<void> {
    //Logger.log(`Get current of ${this.lock.nickname}`);

    let status: LockStatus;
    let callbacked: boolean = false;

    if (this.state.currentLockState != undefined) {
      callback(null, this.state.currentLockState);
      callbacked = true;
    }

    await this.mutex.thunk(async (): Promise<void> => {
    try {
      status = await this.mutex.wait(() => this.client.getStatus(this.lock.device_id));
    } catch(e) {
      Logger.error(`${this.lock.nickname} is unable to get current lock state`, e);
      //callback(e);
    }

    if (!status || !status.responsive || status.locked === undefined) {
//  if (!status.responsive) {
      Logger.log(`${this.lock.nickname} is unresponsive, forcing a status sync...`);

      console.log(status);
      //console.trace();

      try {
        let result = await this.client.sync(this.lock.device_id);

        if (result.successful) {
          Logger.log(`${this.lock.nickname} sync successful.`)
	  status = await this.mutex.wait(() => this.client.getStatus(this.lock.device_id));
        } else {
          Logger.error(`${this.lock.nickname} failed to sync, please check WiFi connectivity. API responded with: ${result.error}`);
        }
      } catch(e) {
        Logger.error(`${this.lock.nickname} is unable to sync`, e);
      }
    }

    try {
      let locked = status.locked ?
	  HAP.Characteristic.LockCurrentState.SECURED :
	  HAP.Characteristic.LockCurrentState.UNSECURED;
      if (!callbacked) {
	callback(null, locked);
      }
      if (this.state.currentLockState !== status.locked) {
	Logger.log(`${this.lock.nickname}: getCurrentLockState updates currentLockState to ${status.locked} from ${this.state.currentLockState}`);
      }
      this.updateCurrentLockState(locked ? true : false);
      await this.updateHistory(locked);
      this.state.currentLockState = status.locked ? true : false;
    } catch(e) {
      Logger.error(`${this.lock.nickname} is unable to determine current lock state`, e);
      if (!callbacked) callback();
      //throw(e);
    }})
  }

  async updateHistory(locked) {
    let currentTime = Math.round(new Date().valueOf()/1000);
    //Logger.log(`${this.lock.nickname}: updateHistory:locked(${locked}) currentLockState(${this.state.currentLockState}) openDuration(${this.state.openDuration}) closedDuration(${this.state.closedDuration}) currentTime(${currentTime}) lastTime(${this.state.lastTime}) lastActivation(${this.state.lastActivation})`);
    if (locked != this.state.currentLockState) {
      if (locked == HAP.Characteristic.LockCurrentState.SECURED) {
	this.state.openDuration += (currentTime - this.state.lastTime);
	//Logger.log(`${this.lock.nickname}: lastActivation(${this.state.lastActivation}) openDuration(${this.state.openDuration})`);
	this.accessory.getService(HAP.Service.ContactSensor)
	  .getCharacteristic(HAP.Characteristic.ContactSensorState)
	  .updateValue(HAP.Characteristic.ContactSensorState.CONTACT_DETECTED);
      } else {
	this.state.lastActivation = currentTime;
	this.accessory.getService(HAP.Service.ContactSensor)
	  .getCharacteristic('LastActivation')
	  .updateValue(this.state.lastActivation - this.historyService.getInitialTime());
	this.state.timesOpened++;
	this.accessory.getService(HAP.Service.ContactSensor)
	  .getCharacteristic('TimesOpened')
	  .updateValue(this.state.timesOpened);
	this.state.closedDuration += (currentTime - this.state.lastTime);
	//Logger.log(`${this.lock.nickname}: timesOpened(${this.state.timesOpened}) closedDuration(${this.state.closedDuration})`);
	this.accessory.getService(HAP.Service.ContactSensor)
	  .getCharacteristic(HAP.Characteristic.ContactSensorState)
	  .updateValue(HAP.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
	Logger.debug(`${this.lock.nickname}: updateHistory updates timesOpened(${this.state.timesOpened}) due to ${locked} from ${this.state.currentLockState}`);
      }
      this.accessory.getService(HAP.Service.ContactSensor)
	.getCharacteristic('OpenDuration')
	.updateValue(this.state.openDuration);
      this.accessory.getService(HAP.Service.ContactSensor)
	.getCharacteristic('ClosedDuration')
	.updateValue(this.state.closedDuration);
    } else {
      if (locked == HAP.Characteristic.LockCurrentState.SECURED) {
	this.state.closedDuration += (currentTime - this.state.lastTime);
	if (!this.state.lastActivation) this.state.lastActivation = currentTime;
	//Logger.log(`${this.lock.nickname}: closedDuration(${this.state.closedDuration})`);
      } else {
	this.state.openDuration += (currentTime - this.state.lastTime);
	//Logger.log(`${this.lock.nickname}: openDuration(${this.state.openDuration})`);
      }
    }
    //Logger.log(`${this.lock.nickname}: locked(${locked}) open(${this.state.openDuration}) close(${this.state.closedDuration}) times(${this.state.timesOpened}) last(${this.state.lastTime}) Activation(${this.state.lastActivation})`);
    if (this.eveHistoryType == 'motion') {
      this.historyService.addEntry(
	{time: currentTime,
	 status: locked ? true : false});
    } else if (this.eveHistoryType == 'door') {
      this.historyService.addEntry(
	{time: currentTime,
	 status: locked ?
	 HAP.Characteristic.ContactSensorState.CONTACT_DETECTED :
	 HAP.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED});
    }
    this.state.lastTime = currentTime;
  }

  async getTargetLockState(callback: Function): Promise<void> {
    if (this.state.targetLockState != undefined) {
      callback(null, this.state.targetLockState);
      //return;
    }

    await this.mutex.thunk(async (): Promise<void> => {
    try {
      let status = await this.mutex.wait(() => this.client.getStatus(this.lock.device_id));
      let locked = status.locked ?
	  HAP.Characteristic.LockCurrentState.SECURED :
	  HAP.Characteristic.LockCurrentState.UNSECURED;
      if (this.state.targetLockState == undefined) {
        callback(null, locked);
      }
      if (this.state.targetLockState !== status.locked) {
	Logger.log(`${this.lock.nickname}: getTargetLockState updates targetLockState to ${status.locked} from ${this.state.targetLockState}`);
      }
      this.updateTargetLockState(locked ? true : false);
      this.state.targetLockState = status.locked ? true : false;
    } catch(e) {
      Logger.error(`${this.lock.nickname} is unable to get target lock state`, e);
      if (this.state.targetLockState == undefined) callback(e);
    }
    })
  }

  async setLockState(targetState: boolean, callback: Function): Promise<void> {
    Logger.debug(`${this.lock.nickname}: setLockState sets targetLockState to ${targetState} from ${this.state.targetLockState}`);

    callback();
    await this.mutex.thunk(async (): Promise<void> => {
    try {
      if (this.state.targetLockState == targetState && this.state.currentLockState != targetState) {
	Logger.log(`${this.lock.nickname} is ${targetState ? 'locking' : 'unlocking'} now...`);
      } else if (this.state.targetLockState == targetState && this.state.currentLockState == targetState) {
	Logger.log(`${this.lock.nickname} is being ${targetState ? 'locked' : 'unlocked'}...`);
      } else if (this.state.targetLockState != targetState && this.state.currentLockState == targetState) {
	Logger.error(`${this.lock.nickname} is unexpected ${targetState ? 'locking' : 'unlocking'} state.`);
    //} else if (this.state.targetLockState != targetState && this.state.currentLockState != targetState) {
      } else {
	Logger.log(`${this.lock.nickname} is ${targetState ? 'locking' : 'unlocking'}...`);
	this.state.targetLockState = targetState;
	this.updateTargetLockState(targetState);
	let {status, successful, error} =  await this.client.control(this.lock.device_id, targetState);
	if (successful !== true) {
	  Logger.error(`${this.lock.nickname} possible failed to ${targetState ? 'lock' : 'unlock'}. status:${status} successful:${successful} error:${error}`);
          let sync = await this.client.sync(this.lock.device_id);
          if (sync.successful) {
            Logger.log(`${this.lock.nickname} sync successful.`)
	    let status = await this.mutex.wait(() => this.client.getStatus(this.lock.device_id));
            Logger.log(`${this.lock.nickname} synced to ${status.locked}.`)
	  } else {
            Logger.error(`${this.lock.nickname} failed to sync, please check WiFi connectivity. API responded with: ${sync.error}`);
	  }
	}
      }

      Logger.debug(`${this.lock.nickname}: setLockState sets currentLockState to ${targetState} from ${this.state.currentLockState}`);
      this.updateCurrentLockState(targetState);
      await this.updateHistory(targetState);
      this.state.currentLockState = targetState;
      Logger.log(`${this.lock.nickname} is ${targetState ? 'locked' : 'unlocked'}`);
    } catch(e) {
      Logger.error(`${this.lock.nickname} is unable to set current lock state`, e);
      //callback(e);
    }
      
    // Logger.log(`${this.lock.nickname} is ${targetState ? 'locked' : 'unlocked'}`);
    
    // this.updateCurrentLockState(targetState);
    
    // callback();
    })
  }

  updateCurrentLockState(locked: boolean) {
    //Logger.log(`Update current of ${this.lock.nickname} to ${locked ? 'locked' : 'unlocked'}`);
    // if (this.state.currentLockState == locked) {
    //   return;
    // }
    let lockService = this.getOrCreateHAPService(HAP.Service.LockMechanism);

    lockService.getCharacteristic(HAP.Characteristic.LockCurrentState)
      .updateValue(locked);
  }

  updateTargetLockState(locked: boolean) {
    //Logger.log(`Update target of ${this.lock.nickname} to ${locked ? 'locked' : 'unlocked'}`);
    // if (this.state.targetLockState == locked) {
    //   return;
    // }
    let lockService = this.getOrCreateHAPService(HAP.Service.LockMechanism);

    lockService.getCharacteristic(HAP.Characteristic.LockTargetState)
      .updateValue(locked);
  }

  async getBatteryLevel(callback: Function): Promise<void> {
    if (this.state.currentBatteryLevel != undefined) {
      callback(null, this.state.currentBatteryLevel);
    }

    try {
      let status = await this.mutex.wait(() => this.client.getStatus(this.lock.device_id));
      if (this.state.currentBatteryLevel == undefined) {
	callback(null, status.battery);
      } else {
	let lockService = this.getOrCreateHAPService(HAP.Service.BatteryService);
	lockService.getCharacteristic(HAP.Characteristic.BatteryLevel)
          .updateValue(status.battery);
      }
      this.state.currentBatteryLevel = status.battery;
    } catch(e) {
      if (this.state.currentBatteryLevel == undefined) callback(e);
    }
  }

  async getLowBatteryStatus(callback: Function): Promise<void> {
    if (this.state.statusLowBattery != undefined) {
      callback(null, this.state.statusLowBattery);
    }

    try {
      let status = await this.mutex.wait(() => this.client.getStatus(this.lock.device_id));
      let lowBattery = status.battery <= 20 ?
	  HAP.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW :
	  HAP.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
      
      if (this.state.statusLowBattery == undefined) {
	callback(null, lowBattery);
      } else {
	let lockService = this.getOrCreateHAPService(HAP.Service.BatteryService);
	lockService.getCharacteristic(HAP.Characteristic.StatusLowBattery)
          .updateValue(lowBattery);
      }
      this.state.statusLowBattery = lowBattery;
    } catch(e) {
      if (this.state.statusLowBattery == undefined) callback(e);
    }
  }

  getBatteryChargingState(callback: Function): void {
    callback(null, HAP.Characteristic.ChargingState.NOT_CHARGING);
  }

  SensitivityCharacteristic = new HAP.Characteristic (
    'Sensitivity',
    'E863F120-079E-48FF-8F27-9C2605A29F52', {
      format: HAP.Characteristic.Formats.UINT8,
      minValue: 0,
      maxValue: 7,
      validValues: [0, 4, 7],
      perms: [
        HAP.Characteristic.Perms.READ,
        HAP.Characteristic.Perms.NOTIFY,
        HAP.Characteristic.Perms.WRITE
      ]
    });

  LastActivationCharacteristic = new HAP.Characteristic (
    'LastActivation',
    'E863F11A-079E-48FF-8F27-9C2605A29F52', {
      format: HAP.Characteristic.Formats.UINT32,
      unit: HAP.Characteristic.Units.SECONDS,
      perms: [
        HAP.Characteristic.Perms.READ,
        HAP.Characteristic.Perms.NOTIFY
      ]
    });

  DurationCharacteristic = new HAP.Characteristic (
    'Duration',
    'E863F12D-079E-48FF-8F27-9C2605A29F52', {
      format: HAP.Characteristic.Formats.UINT16,
      unit: HAP.Characteristic.Units.SECONDS,
      minValue: 5,
      maxValue: 15 * 3600,
      validValues: [
        5, 10, 20, 30,
        1 * 60, 2 * 60, 3 * 60, 5 * 60, 10 * 60, 20 * 60, 30 * 60,
        1 * 3600, 2 * 3600, 3 * 3600, 5 * 3600, 10 * 3600, 12 * 3600, 15 * 3600
      ],
      perms: [
        HAP.Characteristic.Perms.READ,
        HAP.Characteristic.Perms.NOTIFY,
        HAP.Characteristic.Perms.WRITE
      ]
    });

  OpenDurationCharacteristic = new HAP.Characteristic (
    'OpenDuration',
    'E863F118-079E-48FF-8F27-9C2605A29F52', {
      format: HAP.Characteristic.Formats.UINT32,
      unit: HAP.Characteristic.Units.SECONDS, // since last reset
      perms: [HAP.Characteristic.Perms.READ,
	      HAP.Characteristic.Perms.NOTIFY,
	      HAP.Characteristic.Perms.WRITE]
    });

  ClosedDurationCharacteristic = new HAP.Characteristic (
    'ClosedDuration',
    'E863F119-079E-48FF-8F27-9C2605A29F52', {
      format: HAP.Characteristic.Formats.UINT32,
      unit: HAP.Characteristic.Units.SECONDS, // since last reset
      perms: [HAP.Characteristic.Perms.READ,
	      HAP.Characteristic.Perms.NOTIFY,
	      HAP.Characteristic.Perms.WRITE]
    });

  TimesOpenedCharacteristic = new HAP.Characteristic (
    'TimesOpened',
    'E863F129-079E-48FF-8F27-9C2605A29F52', {
      format: HAP.Characteristic.Formats.UINT32,
      perms: [HAP.Characteristic.Perms.READ,
	      HAP.Characteristic.Perms.NOTIFY]
    });

  ResetTotalCharacteristic = new HAP.Characteristic (
    'ResetTotal',
    'E863F112-079E-48FF-8F27-9C2605A29F52', {
      format: HAP.Characteristic.Formats.UINT32,
      unit: HAP.Characteristic.Units.SECONDS, // since 2001/01/01
      perms: [HAP.Characteristic.Perms.READ,
	      HAP.Characteristic.Perms.NOTIFY,
	      HAP.Characteristic.Perms.WRITE],
      adminOnlyAccess: [Access.WRITE]
    });

  async setupHistoryService(platform: LockPlatform) {
    if (this.eveHistoryType == 'motion') {
      this.historyService = new platform.FakeGatoHistoryService(this.eveHistoryType, this.accessory, {log: this.log, storage: 'fs'});
      let motionService = this.accessory.getService(HAP.Service.MotionSensor);
      if (!motionService) {
	motionService = this.accessory.addService(HAP.Service.MotionSensor, this.lock.nickname + ' Motion');
      }
      
      motionService.getCharacteristic(HAP.Characteristic.MotionDetected)
	.on('get', function(callback) {
	  callback(null,
	   this.state.currentLockState ?
	   HAP.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED :
	   HAP.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
	}.bind(this));
      
      if (!motionService.getCharacteristic('Sensitivity')) {
	motionService.addCharacteristic(this.SensitivityCharacteristic);
      }
      motionService.getCharacteristic('Sensitivity')
	.on('get', function(callback){
          callback(null, 4);
	}.bind(this));
      
      if (!motionService.getCharacteristic('LastActivation')) {
	motionService.addCharacteristic(this.LastActivationCharacteristic);
      }
      motionService.getCharacteristic('LastActivation')
	.on('get', function(callback){
	  //console.log(this.state.lastActivation, this.historyService.getInitialTime());
          callback(null,
	   this.state.lastActivation ?
	   Math.max(this.state.lastActivation - this.historyService.getInitialTime(), 0) :
	   0);
	}.bind(this));
      
      if (!motionService.getCharacteristic('Duration')) {
	motionService.addCharacteristic(this.DurationCharacteristic);
      }
      motionService.getCharacteristic('Duration')
	.on('get', function(callback){
          callback(null, 5);
	}.bind(this));
    
      this.historyService.addEntry(
	{time: Math.round(new Date().valueOf()/1000),
	 status: this.state.currentLockState ? 1 : 0});
    } else if (this.eveHistoryType == 'door') {
      this.historyService = new platform.FakeGatoHistoryService(this.eveHistoryType, this.accessory, {log: this.log, storage: 'fs'});
      let contactService = this.accessory.getService(HAP.Service.ContactSensor);
      if (!contactService) {
	contactService = this.accessory.addService(HAP.Service.ContactSensor, this.lock.nickname + ' Contact');
      }
      
      contactService.getCharacteristic(HAP.Characteristic.ContactSensorState)
	.on('get', function(callback) {
	  callback(null,
	   this.state.currentLockState ?
	   HAP.Characteristic.ContactSensorState.CONTACT_DETECTED :
	   HAP.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
	}.bind(this));
      
      if (!contactService.getCharacteristic('LastActivation')) {
	contactService.addCharacteristic(this.LastActivationCharacteristic);
      }
      contactService.getCharacteristic('LastActivation')
	.on('get', function(callback){
	  let lastActivation = this.state.lastActivation ?
	      Math.max(this.state.lastActivation - this.historyService.getInitialTime(), 0) : 0;
	  //Logger.log(`Get LastActivation ${this.lock.nickname}: ${lastActivation}`);
          callback(null, lastActivation);
	}.bind(this));
      
      if (!contactService.getCharacteristic('OpenDuration')) {
	contactService.addCharacteristic(this.OpenDurationCharacteristic);
      }
      contactService.getCharacteristic('OpenDuration')
	.on('get', function(callback){
	  //Logger.log(`Get OpenDuration ${this.lock.nickname}: ${this.state.openDuration}`);
          callback(null, this.state.openDuration);
	}.bind(this));
      
      if (!contactService.getCharacteristic('ClosedDuration')) {
	contactService.addCharacteristic(this.ClosedDurationCharacteristic);
      }
      contactService.getCharacteristic('ClosedDuration')
	.on('get', function(callback){
	  //Logger.log(`Get ClosedDuration ${this.lock.nickname}: ${this.state.closedDuration}`);
          callback(null, this.state.closedDuration);
	}.bind(this));
      
      if (!contactService.getCharacteristic('TimesOpened')) {
	contactService.addCharacteristic(this.TimesOpenedCharacteristic);
      }
      contactService.getCharacteristic('TimesOpened')
	.on('get', function(callback){
	  //Logger.log(`Get TimesOpened ${this.lock.nickname}: ${this.state.timesOpened}`);
          callback(null, this.state.timesOpened);
	}.bind(this));

      if (!contactService.getCharacteristic('ResetTotal')) {
	contactService.addCharacteristic(this.ResetTotalCharacteristic);
      }
      contactService.getCharacteristic('ResetTotal')
	.on('set', function(value, callback){
	  Logger.log(`Set ResetTotal ${this.lock.nickname}: ${value}`);
	  if (this.state.lastReset != value) {
	    this.state.timesOpened = 0;
	    this.accessory.getService(HAP.Service.ContactSensor)
	      .getCharacteristic('TimesOpened').updateValue(this.state.timesOpened);
	    this.state.lastReset = value;
	  }
          callback();
	}.bind(this))
	.on('get', function(callback){
	  //Logger.log(`Get ResetTotal ${this.lock.nickname}: ${this.state.lastReset}`);
          callback(null,
	   this.state.lastReset ||
	   this.historyService.getInitialTime() - Math.round(Date.parse('01 Jan 2001 00:00:00 GMT')/1000));
	}.bind(this));

      this.historyService.addEntry(
	{time: Math.round(new Date().valueOf()/1000),
	 status: this.state.currentLockState ?
	 HAP.Characteristic.ContactSensorState.CONTACT_DETECTED :
	 HAP.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED});
    }
  }
}
