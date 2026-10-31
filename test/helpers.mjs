// 測試共用：在 Node 內直接跑 ONNX 與解算器（不開 Worker）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BenNet } from '../src/renderer/js/nn.js';
import { Solver, toMasks } from '../src/renderer/js/dds.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function makeNet() {
  const ort = await import(new URL('../node_modules/onnxruntime-web/dist/ort.wasm.min.mjs', import.meta.url).href);
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = new URL('../node_modules/onnxruntime-web/dist/', import.meta.url).href;
  const net = new BenNet(ort, async (n) => fs.readFileSync(path.join(ROOT, 'assets', 'models', n + '.onnx')));
  await net.init();
  return net;
}

export class InlinePool {
  constructor() { this.s = new Solver(); }
  async moves(tasks, { deadline } = {}) {
    return tasks.map((t) => {
      if (deadline && Date.now() > deadline) return null;
      const r = this.s.solveMoves(toMasks(t.deal), t.trump, t.turn, t.played, t.only);
      return r;
    });
  }
  async final(tasks, { deadline } = {}) {
    return tasks.map((t) => {
      if (deadline && Date.now() > deadline) return null;
      return this.s.solve(toMasks(t.deal), t.trump, t.leader);
    });
  }
}
