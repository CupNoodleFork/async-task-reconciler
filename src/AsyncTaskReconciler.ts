export interface AsyncTaskReconcilerOptions {
  cache?:
    | boolean
    | {
        strategy: "FIFO" | "LRU";
        size: number;
      };
  concurrent?: number;
}

const enum TaskStatusEnum {
  pending = 0,
  resolved = 1,
  rejected = 2
}

export interface TaskWrapper<T = any> {
  key?: string;
  p: Promise<T> | null;
  task: () => Promise<T>;
  status: TaskStatusEnum;
  error?: any;
  resolve: (value?: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
}

const defaultOpts = Object.freeze({
  cache: false,
  concurrent: 2
});

export class AsyncTaskReconciler {
  private waitingTasks: TaskWrapper[] = [];
  private workingTaskCount: number = 0;
  private finishedTasks: Map<string, TaskWrapper> = new Map();
  private visitedKeyStack: string[]; // 用来排序的栈;
  private opts: Required<AsyncTaskReconcilerOptions> & {
    cache:
      | {
          strategy: "FIFO" | "LRU";
          size: number;
        }
      | false;
  };
  constructor(opts: AsyncTaskReconcilerOptions = defaultOpts) {
    this.opts = { ...defaultOpts, ...(opts || {}) } as any;
    if (this.opts.cache === true) {
      this.opts.cache = {
        strategy: "LRU",
        size: 10
      };
    }
    if (!this.opts.cache) {
      // 故意触发 .prop 操作报错
      this.finishedTasks = null as any;
    }
  }

  public addTask<T = any>(task: () => Promise<T>, key?: string): Promise<T> {
    const taskWrapper = wrapTask(task, key);
    this.waitingTasks.push(taskWrapper);
    this._consumeTask();
    return taskWrapper.p;
  }

  private _consumeTask() {
    if (
      this.workingTaskCount < this.opts.concurrent &&
      this.waitingTasks.length
    ) {
      // 获取接下来要执行的 tasks
      const tasksToRun = this.waitingTasks.splice(
        0,
        this.opts.concurrent - this.workingTaskCount
      );

      for (let tWrap of tasksToRun) {
        this.workingTaskCount++;
        if (tWrap.key && this.opts.cache && this.finishedTasks.has(tWrap.key)) {
          // 如果命中缓存
          const cachedWrap = this.finishedTasks.get(tWrap.key);
          tWrap.resolve(cachedWrap.p);
          this._finallyTaskWorkflow(tWrap.key);
        } else if (!tWrap.key) {
          // 没有 key 说明不需要做缓存
          tWrap
            .task()
            .then(
              r => {
                tWrap.resolve(r);
              },
              e => {
                tWrap.reject(e);
              }
            )
            .then(
              () => {
                this._finallyTaskWorkflow(tWrap.key);
              },
              () => {
                this._finallyTaskWorkflow(tWrap.key);
              }
            );
        } else {
          tWrap.task().then(
            r => {
              tWrap.status = TaskStatusEnum.resolved;
              if (tWrap.key && this.opts.cache) {
                this.finishedTasks.set(tWrap.key!, tWrap);
                const idx = this.visitedKeyStack.indexOf(tWrap.key);
                if (idx >= 0) {
                  this.visitedKeyStack.splice(idx, 1);
                }
                this.visitedKeyStack.push(tWrap.key); // 放到尾部
              }
              this._finallyTaskWorkflow(tWrap.key);
              tWrap.resolve(r);
            },
            e => {
              tWrap.error = e;
              tWrap.status = TaskStatusEnum.rejected;
              tWrap.reject(e);
              this._finallyTaskWorkflow(tWrap.key);
              throw e;
            }
          );
        }
      }
    }
  }

  private _finallyTaskWorkflow = (key?: string) => {
    this.workingTaskCount--;
    if (key && this.opts.cache) {
      setTimeout(this._clearCache);
      updateStack(this.visitedKeyStack, this.opts.cache.strategy, key);
    }
    this._consumeTask();
  };

  private _clearCache() {
    if (!this.opts.cache || this.finishedTasks.size <= this.opts.cache.size) {
      return;
    }

    const keysToDel = this.visitedKeyStack.splice(
      0,
      this.finishedTasks.size - this.opts.cache.size
    );
    keysToDel.forEach(key => {
      this.finishedTasks.delete(key);
    });

    if (this.finishedTasks.size !== this.visitedKeyStack.length) {
      throw new Error("AsyncTaskReconciler: something wrong with cache.");
    }
  }
}

function updateStack<T>(stack: T[], strategy: "FIFO" | "LRU", key: T) {
  const idx = stack.indexOf(key);
  if (idx === -1) {
    stack.push(key);
  } else if (strategy === "LRU") {
    const k = stack.splice(idx, 1)[0];
    stack.push(k);
  }
}

function wrapTask<T = any>(
  task: () => Promise<T>,
  key?: string
): TaskWrapper<T> {
  const taskState: any = {
    status: TaskStatusEnum.pending,
    resolve: null as any,
    reject: null as any,
    key,
    task
  };

  taskState.p = new Promise<T>((resolve, reject) => {
    taskState.resolve = resolve;
    taskState.reject = reject;
  })

  return taskState;
}
