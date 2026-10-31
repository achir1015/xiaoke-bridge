// AI 大腦：叫牌＝BEN 神經網路（高手以上再用模擬比較候選叫品）；打牌＝抽樣＋雙明手（PIMC）；首攻＝神經網路＋抽樣驗證
// nn 介面：bid/bidBatch/bidMany/likelihood/info/lead（BenNet 或 Worker 代理）
// pool 介面：moves(tasks,{deadline}) → 陣列（每項 [{card,tricks}] 或 null）；final(tasks,{deadline}) → 墩數陣列
import { legalCalls, contractOf, auctionDone, scoreContract, isVul, imps, suitOf, rankOf, cardOf, sideOf, hcpOf, shapeOf, STRAIN_TO_SUIT, partner, sortHand } from './rules.js';
import { idCall, callId } from './nn.js';

export const LEVELS = [
  { name: '入門', samples: 8, ms: 500, temp: 2.0, bidSim: 0, cardNoise: 0.9 },
  { name: '中級', samples: 16, ms: 900, temp: 0, bidSim: 0, cardNoise: 0.3 },
  { name: '高手', samples: 32, ms: 1600, temp: 0, bidSim: 10, cardNoise: 0 },
  { name: '大師', samples: 64, ms: 3000, temp: 0, bidSim: 18, cardNoise: 0 },
];

function shuffle(a, r) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// 從已打出的牌推出每家確定缺門的花色
export function voidsOf(tricks, trick) {
  const v = [new Set(), new Set(), new Set(), new Set()];
  for (const t of [...tricks.map((x) => x.cards), trick]) {
    if (!t.length) continue;
    const lead = suitOf(t[0].card);
    for (const p of t) if (suitOf(p.card) !== lead) v[p.seat].add(lead);
  }
  return v;
}

// 隨機把 pool 的牌發給 hidden 座位（滿足張數與缺門）；失敗回傳 null
function dealHidden(pool, hidden, need, voids, r) {
  const out = hidden.map(() => []);
  const left = hidden.map((s) => need[s]);
  const cards = shuffle([...pool], r);
  // 先放受限制的花色：有人缺門的花色先發
  cards.sort((a, b) => {
    const ra = hidden.filter((s) => voids[s].has(suitOf(a))).length, rb = hidden.filter((s) => voids[s].has(suitOf(b))).length;
    return rb - ra;
  });
  for (const c of cards) {
    const s = suitOf(c);
    const can = [];
    for (let i = 0; i < hidden.length; i++) if (left[i] > 0 && !voids[hidden[i]].has(s)) can.push(i);
    if (!can.length) return null;
    // 依剩餘張數加權，分佈才均勻
    let tot = 0;
    for (const i of can) tot += left[i];
    let x = r() * tot, pick = can[can.length - 1];
    for (const i of can) { x -= left[i]; if (x < 0) { pick = i; break; } }
    out[pick].push(c);
    left[pick]--;
  }
  return out;
}

export class Brain {
  constructor({ nn, pool, random = Math.random }) { this.nn = nn; this.pool = pool; this.r = random; }

  // ---------------- 叫牌 ----------------
  // 回傳 { call, cands:[{call,p}] }
  async chooseCall(cards, seat, calls, dealer, vul, levelIdx = 2, { bias = null } = {}) {
    const lv = LEVELS[levelIdx];
    const probs = await this.nn.bid(cards, seat, calls, dealer, vul);
    const legal = legalCalls(calls);
    const cands = legal.map((c) => ({ call: c, p: probs[callId(c)] })).sort((a, b) => b.p - a.p);
    const tot = cands.reduce((n, c) => n + c.p, 0) || 1;
    for (const c of cands) c.p /= tot;
    let call = cands[0].call;
    // 牌譜庫累積的經驗：兩個候選機率接近時，選過去結果較好的
    if (bias && cands.length > 1 && cands[0].p - cands[1].p < 0.15 && (bias[cands[1].call] ?? 0) - (bias[cands[0].call] ?? 0) >= 1) call = cands[1].call;
    if (lv.temp > 0) {
      // 入門：依機率抽（溫度放大），偶爾會叫偏
      const w = cands.map((c) => Math.pow(c.p, 1 / lv.temp));
      const s = w.reduce((a, b) => a + b, 0);
      let x = this.r() * s;
      for (let i = 0; i < cands.length; i++) { x -= w[i]; if (x < 0) { call = cands[i].call; break; } }
    } else if (lv.bidSim && this.pool) {
      const top = cands.filter((c) => c.p >= 0.08).slice(0, 3);
      if (top.length >= 2) {
        const best = await this._simulateBids(cards, seat, calls, dealer, vul, top, lv).catch(() => null);
        if (best) call = best;
      }
    }
    return { call, cands: cands.slice(0, 5) };
  }

  // 用抽樣＋神經網路把叫牌叫完，再用雙明手評分，比較候選叫品
  async _simulateBids(cards, seat, calls, dealer, vul, top, lv) {
    const deals = await this._sampleFromAuction(cards, seat, calls, dealer, vul, lv.bidSim);
    if (deals.length < 4) return null;
    const lines = [];
    for (const c of top) for (let d = 0; d < deals.length; d++) lines.push({ cand: c.call, d, calls: [...calls, c.call] });
    // 全部同步往下叫到結束（批次）
    for (let round = 0; round < 24; round++) {
      const open = lines.filter((l) => !auctionDone(l.calls));
      if (!open.length) break;
      const items = open.map((l) => { const s = (dealer + l.calls.length) % 4; return { cards: deals[l.d][s], seat: s, calls: l.calls }; });
      const res = await this.nn.bidMany(items, dealer, vul);
      open.forEach((l, i) => {
        const legal = legalCalls(l.calls);
        let bi = -1, bv = -1;
        for (const c of legal) { const v = res[i][callId(c)]; if (v > bv) { bv = v; bi = c; } }
        l.calls.push(bi);
      });
    }
    const tasks = [];
    for (const l of lines) {
      l.contract = contractOf(l.calls, dealer);
      if (l.contract) { l.task = tasks.length; tasks.push({ deal: deals[l.d], trump: STRAIN_TO_SUIT[l.contract.strain], leader: (l.contract.declarer + 1) % 4 }); }
    }
    const res = await this.pool.final(tasks, { deadline: Date.now() + lv.ms });
    const sum = new Map(top.map((c) => [c.call, { s: 0, n: 0 }]));
    // 用 IMP 比較：每個牌局對同一副的平均分
    for (let d = 0; d < deals.length; d++) {
      const row = lines.filter((l) => l.d === d);
      const vals = row.map((l) => {
        if (!l.contract) return 0;
        const t = res[l.task];
        if (t == null) return null;
        const c = l.contract, tricks = 13 - t;
        const sc = scoreContract(c.level, c.strain, c.doubled, isVul(vul, c.declarer), tricks);
        return sideOf(c.declarer) === sideOf(seat) ? sc : -sc;
      });
      if (vals.some((v) => v == null)) continue;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      row.forEach((l, i) => { const e = sum.get(l.cand); e.s += imps(vals[i] - mean); e.n++; });
    }
    let best = top[0].call, bs = -1e9;
    for (const c of top) {
      const e = sum.get(c.call);
      if (!e.n) return null;
      // 神經網路本身的信心也算一部分（BEN 的 adjust 概念），差距不大時尊重神經網路
      const v = e.s / e.n + c.p * 3;
      if (v > bs) { bs = v; best = c.call; }
    }
    return best;
  }

  // 叫牌階段：抽出符合目前叫牌的整副牌（包含自己的 cards）
  async _sampleFromAuction(cards, seat, calls, dealer, vul, want) {
    const seen = new Set(cards);
    const pool = []; for (let c = 0; c < 52; c++) if (!seen.has(c)) pool.push(c);
    const hidden = [1, 2, 3].map((i) => (seat + i) % 4);
    const need = [13, 13, 13, 13];
    const voids = [new Set(), new Set(), new Set(), new Set()];
    return this._weightedDeals({ known: { [seat]: cards }, hidden, need, voids, pool, calls, dealer, vul, want, full: (s, h) => h, focus: seat });
  }

  async _weightedDeals({ known, hidden, need, voids, pool, calls, dealer, vul, want, full, focus }) {
    const cand = [];
    let tries = 0;
    const maxTry = Math.max(120, want * 12);
    // 用 bidinfo 先篩掉點力差太多的牌，省下神經網路時間
    let inf = null;
    try { if (calls.length && focus != null) inf = await this.nn.info(known[focus], focus, calls, dealer, vul); } catch {}
    while (cand.length < want * 4 && tries++ < maxTry * 6) {
      const d = dealHidden(pool, hidden, need, voids, this.r);
      if (!d) continue;
      let ok = true;
      if (inf) {
        for (let i = 0; i < hidden.length && ok; i++) {
          const rel = (hidden[i] - focus + 3 + 4) % 4; // 下家 0、夥伴 1、上家 2
          if (rel > 2) continue;
          const fh = full(hidden[i], d[i]);
          const margin = 4 + 2 * (tries > maxTry ? 2 : 0);
          if (Math.abs(hcpOf(fh) - inf.hcp[rel]) > margin + 1) ok = false;
          const shp = shapeOf(fh);
          for (let k = 0; k < 4 && ok; k++) if (Math.abs(shp[k] - inf.shape[rel][k]) > 3 + (tries > maxTry ? 1 : 0)) ok = false;
        }
      }
      if (ok) cand.push(d);
    }
    if (!cand.length) { for (let i = 0; i < want; i++) { const d = dealHidden(pool, hidden, need, voids, this.r); if (d) cand.push(d); } }
    // 依「這家真的會這樣叫」的機率加權
    const ll = cand.map(() => 0);
    if (calls.length) {
      for (let i = 0; i < hidden.length; i++) {
        const seat = hidden[i];
        const hands = cand.map((d) => full(seat, d[i]));
        const v = await this.nn.likelihood(hands, seat, calls, dealer, vul);
        v.forEach((x, j) => { ll[j] += x; });
      }
    }
    const order = cand.map((_, i) => i).sort((a, b) => ll[b] - ll[a]).slice(0, want);
    const deals = order.map((i) => {
      const out = [null, null, null, null];
      for (const k of Object.keys(known)) out[k] = known[k];
      hidden.forEach((s, j) => { out[s] = full(s, cand[i][j]); });
      return out;
    });
    deals.weights = order.map((i) => Math.exp((ll[i] - ll[order[0]]) * 0.25));
    return deals;
  }

  // ---------------- 打牌 ----------------
  // st：{ seat:操作者（看得到哪些牌）, turn, hands:[座位手牌或 null], counts, contract, vul, calls, dealer, trick, tricks, won }
  async chooseCard(st, levelIdx = 2, { analyze = false } = {}) {
    const lv = LEVELS[levelIdx];
    const legal = this._legal(st);
    if (legal.length === 1 && !analyze) return { card: legal[0], table: null };
    const isLead = st.tricks.length === 0 && st.trick.length === 0;
    let prior = null;
    if (isLead) {
      prior = await this._leadPrior(st, legal);
      if (lv.bidSim === 0 && !analyze) return { card: this._pickPrior(prior, lv), table: null };
    }
    const deals = await this._samplePlay(st, lv.samples);
    if (!deals.length) return { card: legal[legal.length - 1], table: null };

    const trump = STRAIN_TO_SUIT[st.contract.strain];
    // 首攻時只比較神經網路給的前幾張
    const cards = prior ? prior.slice(0, levelIdx >= 3 ? 5 : 4).map((p) => p.card) : legal;
    const played = st.trick.map((t) => ({ seat: t.seat, card: t.card }));
    const tasks = deals.map((d) => ({ deal: d.map((h, s) => this._current(h, s, st)), trump, turn: st.turn, played, only: isLead ? cards : null }));
    const res = await this.pool.moves(tasks, { deadline: Date.now() + (isLead ? lv.ms * 1.5 : lv.ms) });

    const c = st.contract, decSide = sideOf(c.declarer), turnSide = sideOf(st.turn);
    const remainAll = 13 - st.tricks.length;
    const stat = new Map(cards.map((x) => [x, { u: 0, t: 0, make: 0, w: 0 }]));
    res.forEach((r, i) => {
      if (!r) return;
      const w = deals.weights ? deals.weights[i] : 1;
      const vals = [];
      for (const m of r) {
        if (!stat.has(m.card)) continue;
        const decTricks = st.won[decSide] + (turnSide === decSide ? m.tricks : remainAll - m.tricks);
        const sc = scoreContract(c.level, c.strain, c.doubled, isVul(st.vul, c.declarer), decTricks);
        vals.push({ card: m.card, sc: turnSide === decSide ? sc : -sc, t: m.tricks, made: decTricks >= c.level + 6 });
      }
      const mean = vals.reduce((a, b) => a + b.sc, 0) / (vals.length || 1);
      for (const v of vals) {
        const e = stat.get(v.card);
        e.u += w * (imps(v.sc - mean) + v.t * 0.05); e.t += w * v.t; e.make += w * (v.made ? 1 : 0); e.w += w;
      }
    });
    const table = cards.map((x) => {
      const e = stat.get(x);
      const wt = e.w || 1;
      return { card: x, util: e.u / wt, tricks: st.won[turnSide] + e.t / wt, make: e.make / wt, prior: prior ? (prior.find((p) => p.card === x) || {}).p || 0 : 0 };
    });
    if (!table.some((t) => stat.get(t.card).w > 0)) return { card: prior ? prior[0].card : this._fallback(legal, st), table: null };
    // 同分時：跟牌出小；領牌優先長門與大牌連張
    const pick = (t) => t.util + (prior ? t.prior * 2 : 0) - this._tieBreak(t.card, st) * 0.001 + (lv.cardNoise ? (this.r() - 0.5) * lv.cardNoise : 0);
    const sorted = [...table].sort((a, b) => pick(b) - pick(a));
    return { card: sorted[0].card, table: [...table].sort((a, b) => b.util - a.util), samples: res.filter(Boolean).length };
  }

  // 時限內一個抽樣都沒算完：領牌出最大、跟牌能贏就用最小的贏、不然出最小
  _fallback(legal, st) {
    const byRank = [...legal].sort((a, b) => rankOf(a) - rankOf(b));
    if (!st.trick.length) return byRank[0];
    const lead = suitOf(st.trick[0].card);
    const best = Math.min(...st.trick.filter((t) => suitOf(t.card) === lead).map((t) => rankOf(t.card)));
    const win = byRank.filter((c) => suitOf(c) === lead && rankOf(c) < best);
    return win.length ? win[win.length - 1] : byRank[byRank.length - 1];
  }

  _tieBreak(card, st) {
    return st.trick.length ? 12 - rankOf(card) : rankOf(card) === 0 ? -5 : 0;
  }

  _legal(st) {
    const h = st.hands[st.turn];
    if (st.trick.length) {
      const s = suitOf(st.trick[0].card);
      const f = h.filter((c) => suitOf(c) === s);
      if (f.length) return f;
    }
    return [...h];
  }

  // 抽樣得到的是原始 13 張，要扣掉已打出的
  _current(hand, seat, st) {
    const gone = new Set();
    for (const t of st.tricks) for (const p of t.cards) gone.add(p.card);
    for (const p of st.trick) gone.add(p.card);
    return hand.filter((c) => !gone.has(c));
  }

  async _leadPrior(st, legal) {
    const seat = st.turn;
    const probs = await this.nn.lead(st.hands[seat], st.contract, seat, st.calls, st.dealer, st.vul);
    const out = [];
    const bySuit = new Map();
    for (const c of legal) {
      const s = suitOf(c), r = Math.min(rankOf(c), 7);
      const key = s * 8 + r;
      if (!bySuit.has(key)) bySuit.set(key, []);
      bySuit.get(key).push(c);
    }
    for (const [key, list] of bySuit) {
      // x 那一格可能有好幾張：出最小的
      out.push({ card: list.sort((a, b) => rankOf(b) - rankOf(a))[0], p: probs[key] });
    }
    return out.sort((a, b) => b.p - a.p);
  }

  _pickPrior(prior, lv) {
    if (!lv.temp) return prior[0].card;
    const w = prior.map((p) => Math.pow(p.p, 1 / lv.temp));
    const s = w.reduce((a, b) => a + b, 0);
    let x = this.r() * s;
    for (let i = 0; i < prior.length; i++) { x -= w[i]; if (x < 0) return prior[i].card; }
    return prior[0].card;
  }

  // 由看得到的資訊抽樣：回傳原始 13 張的整副牌（deals.weights 為權重）
  async _samplePlay(st, want) {
    const c = st.contract;
    const me = st.seat; // 操作者（主打代出明手時是主打）
    const playedBy = [[], [], [], []];
    for (const t of st.tricks) for (const p of t.cards) playedBy[p.seat].push(p.card);
    for (const p of st.trick) playedBy[p.seat].push(p.card);
    const seenHands = [0, 1, 2, 3].filter((s) => st.hands[s] != null);
    const hidden = [0, 1, 2, 3].filter((s) => st.hands[s] == null);
    if (!hidden.length) {
      const d = [0, 1, 2, 3].map((s) => [...st.hands[s], ...playedBy[s]]);
      const a = [d]; a.weights = [1];
      return a;
    }
    const seen = new Set();
    for (const s of seenHands) for (const x of st.hands[s]) seen.add(x);
    for (const p of playedBy.flat()) seen.add(p);
    const pool = []; for (let x = 0; x < 52; x++) if (!seen.has(x)) pool.push(x);
    const need = st.counts.slice();
    const voids = voidsOf(st.tricks, st.trick);
    const known = {};
    for (const s of seenHands) known[s] = [...st.hands[s], ...playedBy[s]];
    const full = (s, h) => [...h, ...playedBy[s]];
    return this._weightedDeals({ known, hidden, need, voids, pool, calls: st.calls, dealer: st.dealer, vul: st.vul, want, full, focus: me });
  }

  // 由牌桌 view 組出 AI 用的狀態
  static stateFrom(board, seat) {
    const v = board.view(seat);
    return {
      seat, turn: board.turn, hands: v.hands, counts: board.hands.map((h) => h.length), contract: board.contract,
      vul: board.vul, calls: board.calls, dealer: board.dealer, trick: board.trick, tricks: board.tricks, won: board.won,
    };
  }
}
export { sortHand, partner, cardOf };
