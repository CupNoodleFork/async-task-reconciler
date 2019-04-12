export interface AsyncTaskReconcilerOptions {
  cache?:
    | boolean
    | {
        strategy: 'FIFO' | 'LRU';
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
  public waitingTasks: TaskWrapper[] = [];
  public workingTaskCount: number = 0; // 如果 addTask 没有传 key，不会记录在 workingTaskWrap 中，所以额外开一个字段记录 working 数
  public workingTaskWrap: Map<string, TaskWrapper> = new Map();
  public finishedTasks: Map<string, TaskWrapper> = new Map();
  public visitedKeyStack: string[] = []; // 用来排序的栈;
  private opts: Required<AsyncTaskReconcilerOptions> & {
    cache:
      | {
          strategy: 'FIFO' | 'LRU';
          size: number;
        }
      | false;
  };
  constructor(opts: AsyncTaskReconcilerOptions = defaultOpts) {
    this.opts = { ...defaultOpts, ...opts } as any;
    if (this.opts.cache === true) {
      this.opts.cache = {
        strategy: 'LRU',
        size: 10
      };
    }
  }

  public addTask<T = any>(task: () => Promise<T>, key?: string): Promise<T> {
    const taskWrapper = wrapTask(task, key);
    this.waitingTasks.push(taskWrapper);
    this._consumeTask();
    return taskWrapper.p;
  }

  public clearCache() {
    this.finishedTasks.clear();
  }

  public getWorkingCount() {
    return this.workingTaskCount;
  }

  private _consumeTask() {
    if (
      this.workingTaskCount < this.opts.concurrent && // 正在工作的数量小于并发数
      this.waitingTasks.length // 且等待队列不为空
    ) {
      // 获取接下来要执行的 tasks
      const tasksToRun = this.waitingTasks.splice(
        0,
        this.opts.concurrent - this.workingTaskWrap.size
      );

      for (let tWrap of tasksToRun) {
        this.workingTaskCount++;
        const key = tWrap.key;
        const finalize = () => this._finallyTaskWorkflow(key);
        const tWrapResolveCallback = r => {
          tWrap.status = TaskStatusEnum.resolved;
          tWrap.resolve(r);
        };
        const tWrapRejectCallback = e => {
          tWrap.status = TaskStatusEnum.rejected;
          tWrap.error = e;
          tWrap.reject(e);
        };
        if (key && this.opts.cache && this.finishedTasks.has(key)) {
          // 如果命中缓存
          const cachedWrap = this.finishedTasks.get(key);
          tWrap.resolve(cachedWrap.p);
          this._finallyTaskWorkflow(key);
        } else if (key && this.workingTaskWrap.has(key)) {
          // 如果命中有正在执行的相同 key 的 task，合并回调
          const wk = this.workingTaskWrap.get(key);
          wk.p.then(tWrapResolveCallback, tWrapRejectCallback).then(finalize);
        } else {
          // 全新的 task
          if (key) {
            // 如果有 key，加入 workingTaskWrap 来去重合并 task
            this.workingTaskWrap.set(key, tWrap);
          }
          tWrap
            .task()
            .then(r => {
              // 如果指定了 task 的 key，则进行缓存
              if (key && this.opts.cache) {
                this.finishedTasks.set(key, tWrap);
              }
              if (key) {
                this.workingTaskWrap.delete(key);
              }
              tWrapResolveCallback(r);
            }, tWrapRejectCallback)
            .then(finalize);
        }
      }
    }
  }

  private _finallyTaskWorkflow = (key?: string) => {
    this.workingTaskCount--;
    if (key && this.opts.cache) {
      updateStack(this.visitedKeyStack, this.opts.cache.strategy, key);
      setTimeout(this._clearCache.bind(this));
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

    /* istanbul ignore if */
    if (this.finishedTasks.size !== this.visitedKeyStack.length) {
      throw new Error('AsyncTaskReconciler: something wrong with cache.');
    }
  }
}

function updateStack<T>(stack: T[], strategy: 'FIFO' | 'LRU', key: T) {
  const idx = stack.indexOf(key);
  if (idx === -1) {
    stack.push(key);
  } else if (strategy === 'LRU') {
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
  });

  return taskState;
}
