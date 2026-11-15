interface ActiveAiRequest {
  done: Promise<void>;
  cancelled: boolean;
}

/** Serializes complete operations, including their local tools and resource cleanup. */
export class AiRequestLifecycle {
  private readonly active = new Map<string, ActiveAiRequest>();

  async run<T>(id: string, action: () => T | PromiseLike<T>): Promise<T> {
    if (this.active.size) throw new Error('已有 AI 请求正在进行，请等待完成或停止请求。');
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    const job: ActiveAiRequest = { done, cancelled: false };
    // Register before calling action so cancellation also covers synchronous setup.
    this.active.set(id, job);
    try {
      return await action();
    } finally {
      if (this.active.get(id) === job) this.active.delete(id);
      // Completion only notifies waiters; the run promise retains the actual error.
      finish();
    }
  }

  async cancel(id: string, abort: () => void): Promise<void> {
    const job = this.active.get(id);
    if (!job) return;
    try {
      if (!job.cancelled) {
        job.cancelled = true;
        abort();
      }
    } finally {
      // Capture this job once. A late cancellation must not touch a later request.
      await job.done;
    }
  }
}
