// -*- mode : js; js-indent-level : 2 -*-
import * as express from 'express';
import { LockAccessory } from './LockAccessory';
import { Logger } from './Logger';

export class Server {
  locks: Map<string, LockAccessory>;
  port: number;
  api: express.Express;

  DEFAULT_PORT = 33892;

  constructor(port: number) {
    this.port = port || this.DEFAULT_PORT;

    this.locks = new Map<string, LockAccessory>();

    this.api = express();
    this.api.use(express.json());

    this.api.post('/', (req, res) => {
      try {
        this.handleRequest(req);
      } catch(e) {
        Logger.error(e);
      }

      res.end();
    });
  }

  listen(): void {
    this.api.listen(this.port, () => Logger.log(`Listening for webhooks on port ${this.port}`));
  }

  async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async handleRequest(request: express.Request): Promise<void> {
    let id = request.body.device_id;
    let locked = request.body.locked;

    if (id == null) {
      Logger.log(`Unexpected webhook request body: ${JSON.stringify(request.body)}`);
      return;
    }

    let lockAccessory = this.locks.get(id);
    if (!lockAccessory) {
      Logger.log(`No lock accessory found from webhook request. Device ID: ${id}`);
      return;
    }

    await lockAccessory.mutex.thunk(async (): Promise<void> => {
    //if (locked == null) {
    //  Logger.log(`Unexpected webhook request body of ${lockAccessory.lock.nickname}: ${JSON.stringify(request.body)}`);
    //  return;
    //}

    Logger.log(`Set ${lockAccessory.lock.nickname} to ${locked ? 'locked' : 'unlocked'}(${request.body.locked}) from webhook`);
  //Logger.log(`request.body.locked: ${JSON.stringify(request.body.locked)}`);
      
    try {
      let sync = await lockAccessory.client.sync(id);
      if (sync.successful) {
	let status = await lockAccessory.mutex.wait(() => lockAccessory.client.getStatus(id));
	Logger.log(`${lockAccessory.lock.nickname} synced to confirm lock status: ${status.locked}.`)
      }
    } catch(e) {
      Logger.error(`${lockAccessory.lock.nickname} failed to sync. API responded with: ${e}`);
      //console.log(JSON.stringify(e));
      let {error} = e.error;
      let busy = parseInt(error.replace(/DEVICE_IS_BUSY ([0-9]+)/, '$1'));
      if (busy > 0) {
	//Logger.log(`${lockAccessory.lock.nickname} waits for ${busy} seconds ...`);
	await this.sleep(busy * 1000);
	//Logger.log(`${lockAccessory.lock.nickname} Done.`);
      }
    }

  //if (lockAccessory.state.targetLockState != locked) {
    if (lockAccessory.state.targetLockState == lockAccessory.state.currentLockState) {
      if (lockAccessory.state.targetLockState !== locked) {
	Logger.debug(`${lockAccessory.lock.nickname}: handleRequest updates targetLockState to ${locked} from ${lockAccessory.state.targetLockState}`);
      }
      lockAccessory.updateTargetLockState(locked ? true : false);
      lockAccessory.state.targetLockState = locked ? true : false;
      
      if (lockAccessory.state.currentLockState !== locked) {
	Logger.debug(`${lockAccessory.lock.nickname}: handleRequest updates currentLockState to ${locked} from ${lockAccessory.state.currentLockState}`);
      }
      lockAccessory.updateCurrentLockState(locked ? true : false);
      await lockAccessory.updateHistory(locked ? true : false);
      lockAccessory.state.currentLockState = locked ? true : false;
    } else if (lockAccessory.state.targetLockState != locked) {
      Logger.error(`${lockAccessory.lock.nickname} received inconsistent webhook '${locked}'`);
    }

    //console.log(lockAccessory.state);
    })
  }
}
