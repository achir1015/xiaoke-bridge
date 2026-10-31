// 雙明手解算工作執行緒：一個 Worker 一份置換表
import { Solver, toMasks, ddRow } from './dds.js';

// 手機記憶體比較小：置換表約 11MB（電腦約 45MB）
const solver = /Android|iPhone|iPad/.test(navigator.userAgent) ? new Solver(18, 16) : new Solver();

self.onmessage = (e) => {
  const { id, op, a } = e.data;
  try {
    let r;
    if (op === 'moves') r = solver.solveMoves(toMasks(a.deal), a.trump, a.turn, a.played, a.only);
    else if (op === 'final') r = solver.solve(toMasks(a.deal), a.trump, a.leader);
    else if (op === 'row') r = ddRow(a.deal, a.st, solver);
    else throw new Error('未知工作');
    self.postMessage({ id, r });
  } catch (err) { self.postMessage({ id, err: String(err && err.message || err) }); }
};
