// BEN 神經網路（ONNX）的輸入編碼與推論。編碼方式移植自 lorserker/ben（GPL-3.0）的 src/binary.py、src/bidding/binary.py
// 使用 model_version 3：輸入 193 維＝[系統×2, 我方身價, 他方身價, hcp, 四門長度, 手牌 24 維, 我/下家/夥伴/上家 叫品各 40 維]
import { STRAINS, suitOf, rankOf, isBid } from './rules.js';

const PAD_START = 0, PAD_END = 1;
export const SYSTEM_ID = 1; // onnx.conf：NS = 1、EW = 1
const STEP_DIM = 193;

export function callId(c) {
  if (c === 'P') return 2;
  if (c === 'X') return 3;
  if (c === 'XX') return 4;
  return 5 + (Number(c[0]) - 1) * 5 + STRAINS.indexOf(c[1]);
}
export function idCall(i) {
  if (i === 2) return 'P';
  if (i === 3) return 'X';
  if (i === 4) return 'XX';
  if (i < 5) return null;
  const v = i - 5;
  return ((v / 5 | 0) + 1) + STRAINS[v % 5];
}

// 手牌 → n 維（24：AKQJTx；32：AKQJT98x）
export function encodeHand(cards, n) {
  const per = n / 4, out = new Float32Array(n);
  for (const c of cards) out[suitOf(c) * per + Math.min(rankOf(c), per - 1)]++;
  return out;
}
function handStats(cards) {
  const shp = [0, 0, 0, 0];
  let hcp = 0;
  for (const c of cards) { shp[suitOf(c)]++; const r = rankOf(c); if (r < 4) hcp += 4 - r; }
  return { hcp: (hcp - 10) / 4, shp: shp.map((x) => (x - 3.25) / 1.75) };
}

// 編成 BEN 的 auction 陣列：前面補 dealer 個 PAD_START
export function paddedIds(calls, dealer) {
  const a = [];
  for (let i = 0; i < dealer; i++) a.push(PAD_START);
  for (const c of calls) a.push(callId(c));
  return a;
}

// 把 seat 在 steps 步的序列寫進 buf（offset 起算，每步 193）
export function writeSeq(buf, offset, cards, seat, ids, vul, steps) {
  const hand = encodeHand(cards, 24);
  const { hcp, shp } = handStats(cards);
  const vulNS = vul === 1 || vul === 3 ? 1 : 0, vulEW = vul === 2 || vul === 3 ? 1 : 0;
  const us = seat % 2 === 0 ? vulNS : vulEW, them = seat % 2 === 0 ? vulEW : vulNS;
  let bid = seat;
  while (bid < ids.length && ids[bid] === PAD_START) bid += 4;
  const at = (i) => (i < 0 ? PAD_START : i < ids.length ? ids[i] : PAD_END);
  const H = 9, BID = H + 24;
  for (let t = 0; t < steps; t++, bid += 4) {
    const o = offset + t * STEP_DIM;
    buf[o] = SYSTEM_ID; buf[o + 1] = SYSTEM_ID;
    buf[o + 2] = us; buf[o + 3] = them; buf[o + 4] = hcp;
    for (let k = 0; k < 4; k++) buf[o + 5 + k] = shp[k];
    buf.set(hand, o + H);
    buf[o + BID + at(bid - 4)] = 1;
    buf[o + BID + 40 + at(bid - 3)] = 1;
    buf[o + BID + 80 + at(bid - 2)] = 1;
    buf[o + BID + 120 + at(bid - 1)] = 1;
  }
}

// 輪到 seat 叫牌時這家走到第幾步
export function stepsFor(ids) {
  let i = ids.length % 4;
  while (i < ids.length && ids[i] === PAD_START) i += 4;
  return 1 + ((ids.length - i) / 4 | 0);
}

export const fromHcp = (x) => x * 4 + 10;
export const fromShape = (x) => x * 1.75 + 3.25;

export class BenNet {
  // ort：onnxruntime-web；load(name) → Uint8Array
  constructor(ort, load) { this.ort = ort; this.load = load; this.s = {}; }

  async init(names = ['bidder', 'bidinfo', 'lead_nt', 'lead_suit']) {
    const o = { executionProviders: ['wasm'], graphOptimizationLevel: 'extended' };
    for (const n of names) this.s[n] = await this.ort.InferenceSession.create(await this.load(n), o);
    return true;
  }

  async _seq(name, data, batch, steps) {
    const s = this.s[name];
    const r = await s.run({ [s.inputNames[0]]: new this.ort.Tensor('float32', data, [batch, steps, STEP_DIM]) });
    return s.outputNames.map((n) => r[n].data);
  }

  // 輪到 seat 叫牌：回傳 40 維機率
  async bid(cards, seat, calls, dealer, vul) {
    const ids = paddedIds(calls, dealer);
    const steps = stepsFor(ids);
    const x = new Float32Array(steps * STEP_DIM);
    writeSeq(x, 0, cards, seat, ids, vul, steps);
    const [out] = await this._seq('bidder', x, 1, steps);
    return Array.from(out.slice((steps - 1) * 40, steps * 40));
  }

  // 批次：多個手牌、同一叫牌序列（全部輪到同一家）
  async bidBatch(hands, seat, calls, dealer, vul) {
    const ids = paddedIds(calls, dealer);
    const steps = stepsFor(ids);
    const x = new Float32Array(hands.length * steps * STEP_DIM);
    hands.forEach((h, i) => writeSeq(x, i * steps * STEP_DIM, h, seat, ids, vul, steps));
    const [out] = await this._seq('bidder', x, hands.length, steps);
    return hands.map((_, i) => Array.from(out.slice(((i + 1) * steps - 1) * 40, (i + 1) * steps * 40)));
  }

  // 多條不同的叫牌序列（模擬叫牌用）：items = [{cards, seat, calls}]，長度可不同，同步數的併批
  async bidMany(items, dealer, vul) {
    const groups = new Map();
    items.forEach((it, i) => {
      const ids = paddedIds(it.calls, dealer);
      const steps = stepsFor(ids);
      if (!groups.has(steps)) groups.set(steps, []);
      groups.get(steps).push({ i, ids, it });
    });
    const res = new Array(items.length);
    for (const [steps, g] of groups) {
      const x = new Float32Array(g.length * steps * STEP_DIM);
      g.forEach((e, j) => writeSeq(x, j * steps * STEP_DIM, e.it.cards, e.it.seat, e.ids, vul, steps));
      const [out] = await this._seq('bidder', x, g.length, steps);
      g.forEach((e, j) => { res[e.i] = Array.from(out.slice(((j + 1) * steps - 1) * 40, (j + 1) * steps * 40)); });
    }
    return res;
  }

  // 對 hands（皆為 seat 的候選手牌）算「這家實際叫出 calls 的機率」對數和
  async likelihood(hands, seat, calls, dealer, vul) {
    const ids = paddedIds(calls, dealer);
    let first = seat;
    while (first < ids.length && ids[first] === PAD_START) first += 4;
    const made = [];
    for (let i = first; i < ids.length; i += 4) made.push(ids[i]);
    if (!made.length) return hands.map(() => 0);
    const steps = made.length;
    const x = new Float32Array(hands.length * steps * STEP_DIM);
    hands.forEach((h, i) => writeSeq(x, i * steps * STEP_DIM, h, seat, ids, vul, steps));
    const [out] = await this._seq('bidder', x, hands.length, steps);
    return hands.map((_, i) => {
      let s = 0;
      for (let t = 0; t < steps; t++) s += Math.log(Math.max(1e-4, out[(i * steps + t) * 40 + made[t]]));
      return s;
    });
  }

  // 從 seat 看另外三家（下家、夥伴、上家）：回傳 { hcp:[3], shape:[3][4] }
  async info(cards, seat, calls, dealer, vul) {
    const ids = paddedIds(calls, dealer);
    const bids = calls.length;
    const steps = bids === 0 ? 1 : 1 + ((bids / 4) | 0);
    const x = new Float32Array(steps * STEP_DIM);
    writeSeq(x, 0, cards, seat, ids, vul, steps);
    const [h3, s12] = await this._seq('bidinfo', x, 1, steps);
    const hOff = (steps - 1) * 3, sOff = (steps - 1) * 12;
    const raw = { h: Array.from(h3.slice(hOff, hOff + 3)), s: Array.from(s12.slice(sOff, sOff + 12)) };
    return {
      raw,
      hcp: raw.h.map(fromHcp),
      shape: [0, 1, 2].map((p) => raw.s.slice(p * 4, p * 4 + 4).map(fromShape)),
    };
  }

  // 首攻機率（32 維：每門 AKQJT98x）
  async lead(cards, contract, seat, calls, dealer, vul) {
    const x = new Float32Array(42);
    const st = 'NSHDC'.indexOf(contract.strain);
    x[0] = contract.level; x[1 + st] = 1;
    x[6] = contract.doubled >= 1 ? 1 : 0;
    x[7] = contract.doubled === 2 ? 1 : 0;
    const vulNS = vul === 1 || vul === 3 ? 1 : 0, vulEW = vul === 2 || vul === 3 ? 1 : 0;
    x[8] = seat % 2 === 0 ? vulNS : vulEW;
    x[9] = seat % 2 === 0 ? vulEW : vulNS;
    x.set(encodeHand(cards, 32), 10);
    const inf = await this.info(cards, seat, calls, dealer, vul);
    const b = new Float32Array(15);
    b.set(inf.raw.h, 0); b.set(inf.raw.s, 3);
    const s = this.s[contract.strain === 'N' ? 'lead_nt' : 'lead_suit'];
    const r = await s.run({ X_input: new this.ort.Tensor('float32', x, [1, 42]), B_input: new this.ort.Tensor('float32', b, [1, 15]) });
    return Array.from(r[s.outputNames[0]].data);
  }
}
export { isBid };
