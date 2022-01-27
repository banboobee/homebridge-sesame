// -*- mode : js; js-indent-level : 2 -*-
import { Deferred } from 'ts-deferred';
import { Semaphore } from './await-semaphore/index';

export class Mutex<T> {
  private deferred: Deferred<T>;
  private locked: boolean;
  private semaphore: Semaphore;

  constructor() {
    this.deferred = new Deferred<T>();
    this.locked = false;
    this.semaphore = new Semaphore(1);
  }

  async thunk(task) {
    await this.semaphore.use(task);
  }
  
  async wait(task: () => Promise<T>): Promise<T> {
    if (this.locked) {
      let result = await this.deferred;
      return result.promise;
    }

    this.locked = true;

    try {
      let result = await task();
      this.deferred.resolve(result);

      return result;
    } catch(e) {
      this.deferred.reject(e);
      throw new Error(e);
    } finally {
      this.releaseLock();
    }
  }

  private releaseLock(): void {
    setTimeout(() => {
      this.deferred = new Deferred<T>();
      this.locked = false;
    }, 1000);
  }
}
