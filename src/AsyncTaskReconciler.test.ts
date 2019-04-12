import { AsyncTaskReconciler } from './AsyncTaskReconciler';

const sleep = (n: number) =>
  new Promise(r => {
    setTimeout(r, n);
  });

test('default options test', done => {
  const reconciler = new AsyncTaskReconciler({
    concurrent: 5
  });
  const resolvers = [];
  const tasks = Array(10)
    .fill(null)
    .map((_, index) => {
      resolvers.push(jest.fn(r => r));
      return jest.fn(async () => {
        await sleep(100);
        return index;
      });
    });

  const start = process.hrtime();
  Promise.all(
    tasks.map((t, i) => {
      return reconciler.addTask(t).then(resolvers[i]);
    })
  ).then(() => {
    const time = process.hrtime(start);
    let i = 0;
    for (const r of resolvers) {
      const index = i++;
      expect(r).toHaveBeenCalledTimes(1);
      expect(r).toHaveBeenCalledWith(index);
      expect(tasks[index]).toHaveBeenCalledTimes(1);
    }
    expect(time[1] * 1e-6).toBeLessThan(250);
    expect(reconciler).toHaveProperty('waitingTasks.length', 0);
    expect(reconciler).toHaveProperty('workingTaskCount', 0);
    expect(reconciler).toHaveProperty('workingTaskWrap.size', 0);
    expect(reconciler).toHaveProperty('finishedTasks.size', 0);
    expect(reconciler).toHaveProperty('visitedKeyStack.length', 0);
    done();
  });
});

test('with key but no cache, should combine the task of the same key', done => {
  const concurrent = 8;
  const reconciler = new AsyncTaskReconciler({
    concurrent,
    cache: false
  });
  const resolvers = [];
  const tasks = Array(10)
    .fill(null)
    .map((_, index) => {
      resolvers.push(jest.fn(r => r));
      return jest.fn(async () => {
        await sleep(100);
        return index;
      });
    });

  const start = process.hrtime();

  Promise.all(
    tasks.map((d, i) => reconciler.addTask(d, String(i % 5)).then(resolvers[i]))
  ).then(results => {
    const time = process.hrtime(start);
    let i = 0;
    for (const r of resolvers) {
      const index = i++;
      if (index < 5) {
        // 0~4 肯定调用一次，5~7 肯定不调用
        expect(r).toHaveBeenCalledTimes(1);
        expect(r).toHaveBeenCalledWith(results[index]);
        expect(tasks[index]).toHaveBeenCalled();
      } else if (index >= 5 && index <= 7) {
        expect(tasks[index]).not.toHaveBeenCalled();
        expect(r).toHaveBeenCalledWith(index % 5);
        expect(r).toHaveBeenCalledTimes(1);
      }
    }
    expect(time[1] * 1e-6).toBeLessThan(250);
    expect(reconciler).toHaveProperty('waitingTasks.length', 0);
    expect(reconciler).toHaveProperty('workingTaskCount', 0);
    expect(reconciler).toHaveProperty('workingTaskWrap.size', 0);
    expect(reconciler).toHaveProperty('finishedTasks.size', 0);
    expect(reconciler).toHaveProperty('visitedKeyStack.length', 0);
    done();
  });
});

test('with default cache LRU 1', done => {
  const reconciler = new AsyncTaskReconciler({
    cache: {
      strategy: 'LRU',
      size: 5
    },
    concurrent: 6
  });

  const resolvers = [];
  const tasks = Array(5)
    .fill(null)
    .map((_, index) => {
      resolvers.push(jest.fn(r => r));
      return jest.fn(async () => {
        await sleep(20);
        return index % 3;
      });
    });
  Promise.all(
    tasks.map((d, i) => {
      return reconciler.addTask(d, String(i % 3)).then(resolvers[i]);
    })
  ).then(() => {
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const r = resolvers[i];
      expect(t).toHaveBeenCalledTimes(i <= 2 ? 1 : 0);
      expect(r).toHaveBeenCalledTimes(1);
    }
    expect(reconciler).toHaveProperty('finishedTasks.size', 3);
    expect(reconciler).toHaveProperty('visitedKeyStack.length', 3);
    reconciler.clearCache();
    expect(reconciler).toHaveProperty('waitingTasks.length', 0);
    expect(reconciler).toHaveProperty('workingTaskCount', 0);
    expect(reconciler).toHaveProperty('workingTaskWrap.size', 0);
    expect(reconciler).toHaveProperty('finishedTasks.size', 0);
    done();
  });
});

test('with default cache LRU 2', done => {
  const reconciler = new AsyncTaskReconciler({
    cache: {
      strategy: 'LRU',
      size: 3
    },
    concurrent: 2
  });

  const resolvers = [];
  const tasks = [0, 1, 2, 3, 1].map(i => {
    resolvers.push(jest.fn(r => r));
    return {
      fn: jest.fn(async () => {
        await sleep(20);
        return i;
      }),
      key: i
    };
  });
  Promise.all(
    tasks.map(({ fn, key }, idx) => {
      return reconciler.addTask(fn, String(key)).then(resolvers[idx]);
    })
  ).then(() => {
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const r = resolvers[i];
      expect(t.fn).toHaveBeenCalledTimes(i < 4 ? 1 : 0);
      expect(r).toHaveBeenCalledTimes(1);
    }
    // 等待 clearCache 完成
    setTimeout(() => {
      expect(reconciler).toHaveProperty('finishedTasks.size', 3);
      reconciler.clearCache();
      expect(reconciler).toHaveProperty('waitingTasks.length', 0);
      expect(reconciler).toHaveProperty('workingTaskCount', 0);
      expect(reconciler).toHaveProperty('workingTaskWrap.size', 0);
      expect(reconciler).toHaveProperty('finishedTasks.size', 0);
      expect(reconciler['visitedKeyStack'].length).toEqual(3);
      expect(reconciler['visitedKeyStack'].indexOf('0')).toEqual(-1);
      done();
    }, 20);
  });
});

test('with cache FIFO', done => {
  const concurrent = 2;
  const reconciler = new AsyncTaskReconciler({
    cache: {
      size: 3,
      strategy: 'FIFO'
    },
    concurrent
  });

  const resolvers = [];
  const tasks = [0, 0, 2, 1, 2, 0, 3].map(i => {
    resolvers.push(jest.fn(r => r));
    return {
      fn: jest.fn(async () => {
        await sleep(20);
        expect(reconciler.getWorkingCount()).toBeLessThanOrEqual(concurrent);
        return i;
      }),
      key: i
    };
  });
  Promise.all(
    tasks.map(({ fn, key }, idx) => {
      return reconciler.addTask(fn, String(key)).then(resolvers[idx]);
    })
  ).then(() => {
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const r = resolvers[i];
      expect(t.fn).toHaveBeenCalledTimes([1, 4, 5].indexOf(i) === -1 ? 1 : 0);
      expect(r).toHaveBeenCalledTimes(1);
    }
    // 等待 clearCache 完成
    setTimeout(() => {
      expect(reconciler).toHaveProperty('finishedTasks.size', 3);
      expect(reconciler).toHaveProperty('waitingTasks.length', 0);
      expect(reconciler).toHaveProperty('workingTaskCount', 0);
      expect(reconciler).toHaveProperty('workingTaskWrap.size', 0);
      expect(reconciler['visitedKeyStack'].length).toEqual(3);
      expect(reconciler['visitedKeyStack'].indexOf('0')).toEqual(-1);
      done();
    }, 20);
  });
});

test('error handler with cache', done => {
  const reconciler = new AsyncTaskReconciler({
    cache: true,
    concurrent: 6
  });
  const errorHandlers = [];
  const tasks = Array(10)
    .fill(null)
    .map((_, i) => {
      errorHandlers.push(
        jest.fn(e => {
          expect(e.message).toEqual(String(i));
        })
      );
      return jest.fn(async () => {
        await sleep(20);
        throw new Error(String(i));
      });
    });
  Promise.all(
    tasks.map((t, i) => {
      reconciler.addTask(t).catch(e => {
        errorHandlers[i](e);
      });
    })
  ).then(() => {
    setTimeout(() => {
      expect(
        errorHandlers.some((eh, i) => {
          try {
            expect(eh).toHaveBeenCalledTimes(1);
            return true;
          } catch (e) {
            return false;
          }
        })
      ).toEqual(true);
      done();
    }, 50);
  });
});
test('error handler without cache', done => {
  const reconciler = new AsyncTaskReconciler();
  const errorHandlers = [];
  const tasks = Array(10)
    .fill(null)
    .map((_, i) => {
      errorHandlers.push(
        jest.fn(e => {
          expect(e.message).toEqual(String(i));
        })
      );
      return jest.fn(async () => {
        await sleep(20);
        throw new Error(String(i));
      });
    });
  Promise.all(
    tasks.map((t, i) => {
      reconciler.addTask(t).catch(e => {
        errorHandlers[i](e);
      });
    })
  ).then(() => {
    setTimeout(() => {
      expect(
        errorHandlers.some((eh, i) => {
          try {
            expect(eh).toHaveBeenCalledTimes(1);
            return true;
          } catch (e) {
            return false;
          }
        })
      ).toEqual(true);
      done();
    }, 50);
  });
});
