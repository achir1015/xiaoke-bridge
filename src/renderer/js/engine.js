// 主執行緒上的 AI 引擎代理：一個神經網路 Worker＋多個雙明手 Worker
import { parOf } from './dds.js';

export class NNProxy {
  constructor() {
    this.w = new Worker(new URL('./nn.worker.js', import.meta.url), { type: 'module' });
    this.seq = 0;
    this.wait = new Map();
    this.w.onmessage = (e) => {
      const p = this.wait.get(e.data.id);
      if (!p) return;
      this.wait.delete(e.data.id);
      if (e.data.err) p.reject(new Error(e.data.err)); else p.resolve(e.data.r);
    };
    this.ready = this._call('init', []);
  }
  _call(op, args) {
    return new Promise((resolve, reject) => { const id = ++this.seq; this.wait.set(id, { resolve, reject }); this.w.postMessage({ id, op, args }); });
  }
  bid(...a) { return this._call('bid', a); }
  bidBatch(...a) { return this._call('bidBatch', a); }
  bidMany(...a) { return this._call('bidMany', a); }
  likelihood(...a) { return this._call('likelihood', a); }
  info(...a) { return this._call('info', a); }
  lead(...a) { return this._call('lead', a); }
  close() { this.w.terminate(); }
}

export class DDPool {
  constructor(n = Math.max(1, Math.min(/Android|iPhone|iPad/.test(navigator.userAgent) ? 4 : 8, (navigator.hardwareConcurrency || 4) - 1))) {
    this.workers = Array.from({ length: n }, () => {
      const w = new Worker(new URL('./dd.worker.js', import.meta.url), { type: 'module' });
      return { w, job: null };
    });
    this.queue = [];
    this.seq = 0;
    for (const x of this.workers) {
      x.w.onmessage = (e) => {
        const j = x.job;
        x.job = null;
        if (j) { if (e.data.err) j.reject(new Error(e.data.err)); else j.resolve(e.data.r); }
        this.pump();
      };
      x.w.onerror = (e) => { const j = x.job; x.job = null; if (j) j.reject(new Error(e.message)); this.pump(); };
    }
  }
  get size() { return this.workers.length; }

  pump() {
    for (const x of this.workers) {
      if (x.job) continue;
      let j = this.queue.shift();
      while (j && j.deadline && Date.now() > j.deadline) { j.resolve(null); j = this.queue.shift(); }
      if (!j) return;
      x.job = j;
      x.w.postMessage({ id: ++this.seq, op: j.op, a: j.a });
    }
  }

  run(op, a, deadline = 0, front = false) {
    return new Promise((resolve, reject) => {
      const job = { op, a, deadline, resolve, reject };
      if (front) this.queue.unshift(job); else this.queue.push(job);
      this.pump();
    });
  }

  // 到期還沒開始的工作回傳 null（已經開始的算完才回來）
  moves(tasks, { deadline = 0 } = {}) { return Promise.all(tasks.map((t) => this.run('moves', t, deadline, true).catch(() => null))); }
  final(tasks, { deadline = 0 } = {}) { return Promise.all(tasks.map((t) => this.run('final', t, deadline, true).catch(() => null))); }
  // 整桌雙明手：五門分給不同核心同時算
  async table(deal, vul, dealer) {
    const table = await Promise.all([0, 1, 2, 3, 4].map((st) => this.run('row', { deal, st })));
    return { table, par: parOf(table, vul, dealer) };
  }
  close() { for (const x of this.workers) x.w.terminate(); this.queue = []; }
}
