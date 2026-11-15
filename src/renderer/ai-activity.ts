interface ActivityJob {
  actionDone: Promise<void>;
  actionSettled: boolean;
  cancel?: () => void | Promise<void>;
  cancelDone?: Promise<void>;
  cancelStarted: boolean;
  cancelSettled: boolean;
  stop?: ActivityStop;
}

interface ActivityStop {
  done: Promise<void>;
  failures: unknown[];
  resolve: () => void;
  reject: (error: unknown) => void;
}

function completion() {
  let finish!: () => void;
  const done = new Promise<void>(resolve => { finish = resolve; });
  return { done, finish };
}

/** Shared by settings and assistant instances in one renderer. A cancellation
 * callback only cancels its own operation; stopAll is never registered as a job. */
export class AiActivity {
  private readonly jobs = new Set<ActivityJob>();
  private readonly listeners = new Set<() => void>();
  private stopping?: ActivityStop;

  busy = () => this.jobs.size > 0 || !!this.stopping;
  getSnapshot = this.busy;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private notify() {
    for (const listener of [...this.listeners]) listener();
  }

  private release(job: ActivityJob) {
    if (job.actionSettled && (!job.cancelStarted || job.cancelSettled) && this.jobs.delete(job)) this.notify();
  }

  run = <T>(action: () => Promise<T>, cancel?: () => void | Promise<void>, options?: { requireSuccessToClose?: boolean }): Promise<T> => {
    const actionExit = completion();
    const requireSuccessToClose = options?.requireSuccessToClose === true;
    const job: ActivityJob = { actionDone: actionExit.done, actionSettled: false, cancel, cancelStarted: false, cancelSettled: false };
    this.jobs.add(job);
    this.notify();

    let result: Promise<T>;
    try { result = Promise.resolve(action()); }
    catch (error) { result = Promise.reject(error); }
    const finish = () => { job.actionSettled = true; actionExit.finish(); this.release(job); };
    // Request errors belong to their caller. A close already waiting on an
    // explicitly flagged write must also learn that the write failed, after
    // every other action and cancellation has finished.
    void result.then(finish, error => {
      if (requireSuccessToClose && job.stop) job.stop.failures.push(error);
      finish();
    });
    if (this.stopping) this.cancel(job, this.stopping);
    return result;
  };

  private cancel(job: ActivityJob, stopping: ActivityStop) {
    if (job.cancelStarted) return;
    job.cancelStarted = true;
    job.stop = stopping;
    const cancelExit = completion();
    job.cancelDone = cancelExit.done;
    let result: Promise<void>;
    try { result = Promise.resolve(job.cancel?.()); }
    catch (error) { result = Promise.reject(error); }
    const finish = () => { job.cancelSettled = true; cancelExit.finish(); this.release(job); };
    void result.then(finish, error => { stopping.failures.push(error); finish(); });
  }

  stopAll = (): Promise<void> => {
    if (this.stopping) return this.stopping.done;
    if (!this.jobs.size) return Promise.resolve();
    let resolve!: () => void, reject!: (error: unknown) => void;
    const done = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const stopping: ActivityStop = { done, failures: [], resolve, reject };
    this.stopping = stopping;
    this.notify();
    // Dispatch all cancellation immediately, including jobs whose setup itself
    // calls stopAll. Repeated callers share this drain and never cancel twice.
    for (const job of [...this.jobs]) this.cancel(job, stopping);
    void this.drain(stopping);
    return done;
  };

  private async drain(stopping: ActivityStop) {
    try {
      while (this.jobs.size) {
        const jobs = [...this.jobs];
        for (const job of jobs) this.cancel(job, stopping);
        await Promise.allSettled(jobs.flatMap(job => [job.actionDone, job.cancelDone!]));
      }
    } catch (error) { stopping.failures.push(error); }
    if (this.stopping === stopping) this.stopping = undefined;
    // Settle before announcing idle. A listener may immediately start a fresh
    // operation; it belongs after this drain, not to the completed stop.
    if (stopping.failures.length === 1) stopping.reject(stopping.failures[0]);
    else if (stopping.failures.length > 1) stopping.reject(new AggregateError(stopping.failures, '部分 AI 请求未能完成停止。'));
    else stopping.resolve();
    this.notify();
  }
}

const activities = new WeakMap<object, AiActivity>();
export function aiActivityFor(bridge: object): AiActivity {
  let activity = activities.get(bridge);
  if (!activity) { activity = new AiActivity(); activities.set(bridge, activity); }
  return activity;
}
