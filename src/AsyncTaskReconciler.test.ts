import { AsyncTaskReconciler } from "./AsyncTaskReconciler";

const sleep = (n: number) =>
  new Promise(r => {
    setTimeout(r, n);
  });

test("default options test", done => {
  const reconciler = new AsyncTaskReconciler();
  const t1 = async () => {
    await sleep(500);
    return 1;
  };
  const t2 = async () => {
    await sleep(100);
    return 2;
  }
  reconciler.addTask(t1).then((r) => done());
  reconciler.addTask(t2).then(console.log);
});
