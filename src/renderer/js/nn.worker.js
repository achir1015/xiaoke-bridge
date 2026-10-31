// 神經網路工作執行緒：在這裡跑 ONNX，不卡畫面
import * as ort from '../../../node_modules/onnxruntime-web/dist/ort.wasm.min.mjs';
import { BenNet } from './nn.js';

ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;
ort.env.wasm.wasmPaths = new URL('../../../node_modules/onnxruntime-web/dist/', import.meta.url).href;

let net = null;

self.onmessage = async (e) => {
  const { id, op, args } = e.data;
  try {
    if (op === 'init') {
      net = new BenNet(ort, async (n) => new Uint8Array(await (await fetch(new URL(`../../../assets/models/${n}.onnx`, import.meta.url))).arrayBuffer()));
      await net.init();
      self.postMessage({ id, r: true });
      return;
    }
    self.postMessage({ id, r: await net[op](...args) });
  } catch (err) { self.postMessage({ id, err: String(err && err.message || err) }); }
};
