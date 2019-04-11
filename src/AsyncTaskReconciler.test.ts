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
      resolvers.push(jest.fn());
      return jest.fn(async () => {
        await sleep(100);
        return index;
      });
    });

  const start = process.hrtime();
  Promise.all(
    tasks.map((t, i) => reconciler.addTask(t).then(resolvers[i]))
  ).then(() => {
    const time = process.hrtime(start);
    let i = 0;
    for (const r of resolvers) {
      expect(r).toHaveBeenCalledTimes(1);
      expect(r).toHaveBeenCalledWith(i++);
    }
    expect(time[1]).toBeLessThan(300000000);
    done();
  });
});
