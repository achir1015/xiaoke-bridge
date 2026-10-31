// 雙明手解算器（Double Dummy Solver）
// 全部牌攤開時雙方最佳打法能拿幾墩。零視窗 alpha-beta，配合 DDS 的核心手法：
//   ・同手連張視為同一張
//   ・贏牌點位（winning ranks）分割：證明結果時記下「哪些點位真的有影響」，
//     只差小牌的局面共用同一筆置換表
//   ・快速贏墩的上下界剪枝
//   ・換領出者、換抽樣局面時共用置換表
// 手牌格式：hands[座位][花色] = 13 位元遮罩，bit 12=A … bit 0=2
import { scoreContract, isVul, STRAINS } from './rules.js';

const POP = new Uint8Array(8192);
const HIGH = new Int8Array(8192); // 最高位元索引
const SPREAD = new Int32Array(8192); // 每位元間隔一格，用來組「每張牌的主人」
for (let i = 1; i < 8192; i++) { POP[i] = POP[i >> 1] + (i & 1); HIGH[i] = i === 1 ? 0 : HIGH[i >> 1] + 1; }
for (let i = 0; i < 8192; i++) { let v = 0; for (let b = 0; b < 13; b++) if (i >> b & 1) v |= 1 << (2 * b); SPREAD[i] = v; }

// pext：把 x 中落在 m 的位元壓縮到低位。分兩段查表
const PEXT_LOW = new Uint8Array(128 * 128);
const PEXT_HIGH = new Uint8Array(64 * 64);
for (let m = 0; m < 128; m++) for (let x = 0; x < 128; x++) {
  let out = 0, k = 0;
  for (let b = 0; b < 7; b++) if (m >> b & 1) { if (x >> b & 1) out |= 1 << k; k++; }
  PEXT_LOW[m * 128 + x] = out;
}
for (let m = 0; m < 64; m++) for (let x = 0; x < 64; x++) {
  let out = 0, k = 0;
  for (let b = 0; b < 6; b++) if (m >> b & 1) { if (x >> b & 1) out |= 1 << k; k++; }
  PEXT_HIGH[m * 64 + x] = out;
}
function pext13(x, m) {
  const lm = m & 127, hm = m >> 7;
  return PEXT_LOW[lm * 128 + (x & 127)] | (PEXT_HIGH[hm * 64 + (x >> 7)] << POP[lm]);
}
function popcnt32(x) {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}
function sortMoves(a, b, n) {
  for (let i = 1; i < n; i++) {
    const v = a[b + i];
    let j = i - 1;
    while (j >= 0 && a[b + j] < v) { a[b + j + 1] = a[b + j]; j--; }
    a[b + j + 1] = v;
  }
}

const NONE = 13; // 這個花色沒有任何點位有影響
const PLIES = 60;

export class Solver {
  constructor(poolBits = 20, bucketBits = 18) {
    const pool = 1 << poolBits;
    this.poolSize = pool;
    this.bMask = (1 << bucketBits) - 1;
    this.head = new Int32Array(1 << bucketBits);
    this.next = new Int32Array(pool);
    this.kA = new Int32Array(pool);
    this.kB = new Int32Array(pool);
    this.own = new Int32Array(pool * 4);
    this.oMask = new Int32Array(pool * 4);
    this.val = new Int8Array(pool); // 正：南北 ≥ val-1；負：南北 ≤ -val-1
    this.top = 1;
    this.ttTrump = -2;
    this.nodes = 0;
    this.h = new Int32Array(16);   // [座位*4+花色]
    this.cur = new Int32Array(4);  // 每花色剩餘遮罩
    this.R = new Int8Array(PLIES * 4); // 每層每花色「最低的有效點位」
    this.lowT = new Int8Array(PLIES * 4); // 每層每花色已試過的最低牌
    this.mv = new Int32Array(PLIES * 14);
    this.pOwn = new Int32Array(14 * 4);
    this.tm = new Int32Array(14 * 4); // 本墩已出的牌：連張判斷時它們還佔位置（夾在中間就不算連張）
    this.bestLead = new Int16Array(1 << 20).fill(-1);
    this.maxSide = 0;
    this.trump = -1;
  }

  clear() { this.head.fill(0); this.top = 1; }
  _setTrump(t) { if (t !== this.ttTrump) { this.clear(); this.ttTrump = t; } }

  load(handMasks) {
    for (let s = 0; s < 4; s++) for (let k = 0; k < 4; k++) this.h[s * 4 + k] = handMasks[s][k];
    for (let k = 0; k < 4; k++) this.cur[k] = this.h[k] | this.h[4 + k] | this.h[8 + k] | this.h[12 + k];
  }

  // 從「leader 領出」開始（一墩開始時），傳回 leader 這一隊還能贏幾墩
  solve(handMasks, trump, leader, guess = -1) {
    this._setTrump(trump);
    this.load(handMasks);
    this.trump = trump;
    this.nodes = 0;
    let n = 0;
    for (let k = 0; k < 4; k++) n += POP[this.h[leader * 4 + k]];
    this.maxSide = leader & 1;
    let lo = 0, hi = n;
    let g = guess >= 0 ? Math.min(n, guess) : this._estimate(leader, n);
    while (lo < hi) {
      const t = Math.max(lo + 1, Math.min(hi, g));
      if (this._trickStart(0, leader, t, n)) { lo = t; g = t + 1; } else { hi = t - 1; g = t - 1; }
    }
    return lo;
  }

  _estimate(leader, n) {
    let a = 0, b = 0;
    for (let k = 0; k < 4; k++) {
      const w = this.cur[k];
      if (!w) continue;
      const m1 = 1 << HIGH[w];
      for (let s = 0; s < 4; s++) if (this.h[s * 4 + k] & m1) { if ((s & 1) === (leader & 1)) a++; else b++; }
    }
    return Math.max(1, Math.round(n * (a + 1) / (a + b + 2)));
  }

  // 一墩開始：maxSide 能否從此再拿 ≥ target 墩
  _trickStart(ply, leader, target, n) {
    const R = this.R, rb = ply * 4;
    R[rb] = R[rb + 1] = R[rb + 2] = R[rb + 3] = NONE;
    if (target <= 0) return true;
    if (target > n) return false;
    const maxMoves = (leader & 1) === this.maxSide;

    // 快速贏墩
    const qt = this._quick(ply, leader, n);
    if (maxMoves ? qt >= target : n - qt < target) return maxMoves;
    R[rb] = R[rb + 1] = R[rb + 2] = R[rb + 3] = NONE;

    // 置換表：以長度分桶，桶內比對「有效點位以上」的牌歸誰
    const nsMax = this.maxSide === 0;
    const nsTarget = nsMax ? target : n - target + 1;
    const h = this.h, cur = this.cur;
    let kA = 0, kB = leader << 28;
    const pOwn = this.pOwn, ob = n * 4;
    for (let k = 0; k < 4; k++) {
      const l = POP[h[k]] | POP[h[4 + k]] << 4 | POP[h[8 + k]] << 8 | POP[h[12 + k]] << 12;
      if (k < 2) kA |= l << (k * 16); else if (k === 2) kB |= l; else kB |= (l & 0xfff) << 16;
      const m = cur[k];
      const c1 = pext13(h[4 + k], m), c2 = pext13(h[8 + k], m), c3 = pext13(h[12 + k], m);
      pOwn[ob + k] = SPREAD[c1 | c3] | (SPREAD[c2 | c3] << 1);
    }
    const bucket = (Math.imul(kA, 0x9e3779b1) ^ Math.imul(kB, 0x85ebca77) ^ (kA >>> 13)) & this.bMask;
    const own0 = pOwn[ob], own1 = pOwn[ob + 1], own2 = pOwn[ob + 2], own3 = pOwn[ob + 3];
    const eOwn = this.own, eMask = this.oMask, val = this.val, next = this.next, eA = this.kA, eB = this.kB;
    let e = this.head[bucket], scan = 0;
    while (e && scan < 64) {
      scan++;
      if (eA[e] === kA && eB[e] === kB) {
        const i = e * 4;
        if ((own0 & eMask[i]) === eOwn[i] && (own1 & eMask[i + 1]) === eOwn[i + 1] && (own2 & eMask[i + 2]) === eOwn[i + 2] && (own3 & eMask[i + 3]) === eOwn[i + 3]) {
          const v = val[e];
          const lower = v > 0, b = lower ? v - 1 : -v - 1;
          // 下界：南北 ≥ b；上界：南北 ≤ b
          if (lower ? b >= nsTarget : b < nsTarget) {
            for (let k = 0; k < 4; k++) R[rb + k] = this._rankAtMask(k, eMask[i + k]);
            return lower === nsMax;
          }
        }
      }
      e = next[e];
    }

    const res = this._lead(ply, leader, target, n, (Math.imul(own0 ^ Math.imul(own1, 31) ^ Math.imul(own2, 131) ^ Math.imul(own3, 1031) ^ kA ^ kB, 0x9e3779b1) >>> 12));

    // 寫入置換表
    if (this.top >= this.poolSize) this.clear();
    const idx = this.top++;
    const j = idx * 4;
    for (let k = 0; k < 4; k++) {
      const m = cur[k], L = R[rb + k];
      if (L >= NONE || !m) { eMask[j + k] = 0; eOwn[j + k] = 0; continue; }
      const len = POP[m], top = POP[m >> L];
      const mask = (top >= 16 ? -1 : (1 << (2 * top)) - 1) << (2 * (len - top));
      eMask[j + k] = mask;
      eOwn[j + k] = pOwn[ob + k] & mask;
    }
    const nsReached = nsMax ? res : !res;
    val[idx] = nsReached ? nsTarget + 1 : -(nsTarget - 1) - 1;
    eA[idx] = kA; eB[idx] = kB;
    next[idx] = this.head[bucket];
    this.head[bucket] = idx;
    return res;
  }

  // 由表中遮罩還原成目前局面的最低有效點位
  _rankAtMask(k, mask) {
    if (!mask) return NONE;
    const top = popcnt32(mask) >> 1;
    let x = this.cur[k];
    for (let i = 1; i < top; i++) x ^= 1 << HIGH[x];
    return HIGH[x];
  }

  // 領出者自己穩拿的墩數（保守下界），同時把依賴到的點位記進 R[ply]
  _quick(ply, leader, n) {
    const h = this.h, base = leader * 4, tr = this.trump, R = this.R, rb = ply * 4, cur = this.cur;
    const lho = ((leader + 1) & 3) * 4, pd = ((leader + 2) & 3) * 4, rho = ((leader + 3) & 3) * 4;
    let total = 0, oppTr = 0;
    if (tr >= 0) {
      const mine = h[base + tr];
      let m = cur[tr], c = 0, low = NONE;
      while (m) { const hb = HIGH[m]; low = hb; if (mine >> hb & 1) { c++; m ^= 1 << hb; } else break; }
      total = c;
      R[rb + tr] = low;
      const a = POP[h[lho + tr]], d = POP[h[rho + tr]];
      oppTr = Math.max(0, a - c) + Math.max(0, d - c);
    }
    let pdSide = -1;
    for (let k = 0; k < 4; k++) {
      if (k === tr) continue;
      const mine = h[base + k];
      if (!mine) continue;
      let m = cur[k], c = 0, low = NONE;
      while (m) { const hb = HIGH[m]; if (mine >> hb & 1) { c++; low = hb; m ^= 1 << hb; } else break; }
      if (!c) continue;
      if (tr >= 0 && oppTr > 0) {
        // 對手還有王：只算他們都跟得上的張數
        const a = h[lho + tr] ? POP[h[lho + k]] : 99, d = h[rho + tr] ? POP[h[rho + k]] : 99;
        if (a < c) c = a;
        if (d < c) c = d;
      }
      // 夥伴若只剩王牌可能被迫王吃而搶走出牌權
      if (tr >= 0 && !h[pd + k] && h[pd + tr]) {
        if (pdSide < 0) { pdSide = 0; for (let q = 0; q < 4; q++) if (q !== tr) pdSide += POP[h[pd + q]]; }
        if (pdSide < c) c = pdSide;
      }
      if (c > 0) { total += c; R[rb + k] = low; }
    }
    return total > n ? n : total;
  }

  _lead(ply, leader, target, n, bKey) {
    const h = this.h, cur = this.cur, base = leader * 4, tr = this.trump, R = this.R, rb = ply * 4, mv = this.mv, mb = ply * 14, lowT = this.lowT, tm = this.tm, tb = n * 4;
    const maxMoves = (leader & 1) === this.maxSide;
    const pd = ((leader + 2) & 3) * 4, lho = ((leader + 1) & 3) * 4, rho = ((leader + 3) & 3) * 4;
    const pv = this.bestLead[bKey];
    let cnt = 0;
    for (let k = 0; k < 4; k++) {
      const mine = h[base + k];
      if (!mine) continue;
      const all = cur[k], allHi = HIGH[all];
      const pdV = h[pd + k], lhoV = h[lho + k], rhoV = h[rho + k];
      const oppTop = (lhoV | rhoV) ? HIGH[lhoV | rhoV] : -1;
      let m = mine;
      while (m) {
        const hb = HIGH[m];
        let rest = m ^ (1 << hb), below = all & ((1 << hb) - 1), lowG = hb;
        while (below) {
          const nb = HIGH[below];
          if (mine >> nb & 1) { rest &= ~(1 << nb); below ^= 1 << nb; lowG = nb; } else break;
        }
        let score = POP[mine];
        if (k === tr) score += maxMoves ? 18 : 2;
        if (hb === allHi) score += 40;
        else if (pdV && HIGH[pdV] > oppTop) score += 30;   // 夥伴有贏張
        else if (hb > oppTop) score += 25;
        else if (rhoV && HIGH[rhoV] > hb && lhoV && HIGH[lhoV] < hb) score += 6;
        if (tr >= 0 && k !== tr) {
          if ((!lhoV && h[lho + tr]) || (!rhoV && h[rho + tr])) score -= 30;
          if (!pdV && h[pd + tr]) score += 22;
        }
        if (pv === ((k << 4) | hb)) score += 200;
        else if (pv >= 0 && (pv >> 4) === k) score += 12;
        mv[mb + cnt++] = (score + 128) << 10 | k << 8 | hb << 4 | lowG;
        m = rest;
      }
    }
    sortMoves(mv, mb, cnt);
    lowT[rb] = lowT[rb + 1] = lowT[rb + 2] = lowT[rb + 3] = NONE;
    const c = (ply + 1) * 4;
    for (let i = 0; i < cnt; i++) {
      const code = mv[mb + i], k = (code >> 8) & 3, hb = (code >> 4) & 15, lowG = code & 15;
      const L = R[rb + k];
      if (lowT[rb + k] < L && hb < L) continue; // 與已試過的小牌等值
      const bit = 1 << hb;
      h[base + k] ^= bit; cur[k] ^= bit; tm[tb + k] |= bit;
      this.nodes++;
      const r = this._follow(ply + 1, (leader + 1) & 3, 1, leader, k, hb, k === tr, false, target, n);
      h[base + k] ^= bit; cur[k] |= bit; tm[tb + k] ^= bit;
      if (r === maxMoves) {
        for (let q = 0; q < 4; q++) R[rb + q] = R[c + q];
        this.bestLead[bKey] = (k << 4) | hb;
        return maxMoves;
      }
      for (let q = 0; q < 4; q++) if (R[c + q] < R[rb + q]) R[rb + q] = R[c + q];
      if (R[rb + k] <= hb && lowG < R[rb + k]) R[rb + k] = lowG;
      if (hb < lowT[rb + k]) lowT[rb + k] = hb;
    }
    return !maxMoves;
  }

  // 跟牌（pos=1～3）；bestS 目前贏家、bestH 贏牌點位、bestTr 贏牌是否王牌、contest 贏牌花色有沒有被比過大小
  _follow(ply, seat, pos, bestS, suit, bestH, bestTr, contest, target, n) {
    const h = this.h, cur = this.cur, tr = this.trump, base = seat * 4, R = this.R, rb = ply * 4, mv = this.mv, mb = ply * 14, lowT = this.lowT, tm = this.tm, tb = n * 4;
    const maxMoves = (seat & 1) === this.maxSide;
    const mine = h[base + suit];
    const partnerWins = (bestS & 1) === (seat & 1);
    let cnt = 0;
    const ks = mine ? suit : 0, ke = mine ? suit : 3;
    for (let k = ks; k <= ke; k++) {
      const hand = h[base + k], all = cur[k] | tm[tb + k];
      let m = hand;
      while (m) {
        const hb = HIGH[m];
        let rest = m ^ (1 << hb), below = all & ((1 << hb) - 1), lowG = hb;
        while (below) {
          const nb = HIGH[below];
          if (hand >> nb & 1) { rest &= ~(1 << nb); below ^= 1 << nb; lowG = nb; } else break;
        }
        const wins = k === suit ? (bestTr === (suit === tr)) && hb > bestH : k === tr && (!bestTr || hb > bestH);
        let score;
        if (partnerWins) score = wins ? 10 - lowG : 40 - lowG;
        else if (wins) score = pos === 3 ? 70 - lowG : 50 + (pos === 2 ? hb : -lowG);
        else score = 30 - lowG;
        
        if (k !== suit && k !== tr && !wins) { const l = POP[hand]; score += l > 3 ? 4 : l === 1 ? 2 : 0; if (hb === HIGH[all]) score -= 15; }
        mv[mb + cnt++] = (score + 128) << 10 | k << 8 | hb << 4 | lowG;
        m = rest;
      }
    }
    sortMoves(mv, mb, cnt);
    R[rb] = R[rb + 1] = R[rb + 2] = R[rb + 3] = NONE;
    lowT[rb] = lowT[rb + 1] = lowT[rb + 2] = lowT[rb + 3] = NONE;
    const c = (ply + 1) * 4;
    for (let i = 0; i < cnt; i++) {
      const code = mv[mb + i], k = (code >> 8) & 3, hb = (code >> 4) & 15, lowG = code & 15;
      const L0 = R[rb + k];
      if (lowT[rb + k] < L0 && hb < L0) continue;
      let nS = bestS, nH = bestH, nT = bestTr, nC = contest;
      if (k === suit) {
        if (bestTr === (suit === tr)) { nC = true; if (hb > bestH) { nS = seat; nH = hb; } }
      } else if (k === tr) {
        if (!bestTr) { nS = seat; nH = hb; nT = true; nC = false; } else { nC = true; if (hb > bestH) { nS = seat; nH = hb; } }
      }
      const bit = 1 << hb;
      h[base + k] ^= bit; cur[k] ^= bit; tm[tb + k] |= bit;
      this.nodes++;
      let r;
      if (pos === 3) {
        r = this._trickStart(ply + 1, nS, (nS & 1) === this.maxSide ? target - 1 : target, n - 1);
        if (nC) { const ws = nT ? tr : suit; if (nH < R[c + ws]) R[c + ws] = nH; }
      } else r = this._follow(ply + 1, (seat + 1) & 3, pos + 1, nS, suit, nH, nT, nC, target, n);
      h[base + k] ^= bit; cur[k] |= bit; tm[tb + k] ^= bit;
      if (r === maxMoves) {
        for (let q = 0; q < 4; q++) R[rb + q] = R[c + q];
        return maxMoves;
      }
      for (let q = 0; q < 4; q++) if (R[c + q] < R[rb + q]) R[rb + q] = R[c + q];
      if (R[rb + k] <= hb && lowG < R[rb + k]) R[rb + k] = lowG;
      if (hb < lowT[rb + k]) lowT[rb + k] = hb;
    }
    return !maxMoves;
  }

  // 目前（可能在一墩中間）每個合法出牌的結果
  // played = [{seat, card}] 本墩已出的牌；傳回 [{card, tricks}]，tricks 是「turn 這一隊」從現在起的墩數
  solveMoves(handMasks, trump, turn, played, only = null) {
    this._setTrump(trump);
    this.load(handMasks);
    this.trump = trump;
    const h = this.h, cur = this.cur, base = turn * 4;
    const pos = played.length;
    let n = 0;
    for (let k = 0; k < 4; k++) n += POP[h[base + k]];
    this.maxSide = turn & 1;
    let suit = -1, bestS = 0, bestH = -1, bestTr = false, contest = false;
    if (pos) {
      suit = (played[0].card / 13) | 0;
      bestS = played[0].seat; bestH = 12 - played[0].card % 13; bestTr = suit === trump;
      for (let i = 1; i < pos; i++) {
        const p = played[i], k = (p.card / 13) | 0, hb = 12 - p.card % 13;
        if (k === suit) { if (bestTr === (suit === trump)) { contest = true; if (hb > bestH) { bestS = p.seat; bestH = hb; } } } else if (k === trump) {
          if (!bestTr) { bestS = p.seat; bestH = hb; bestTr = true; contest = false; } else { contest = true; if (hb > bestH) { bestS = p.seat; bestH = hb; } }
        }
      }
    }
    const tm = this.tm, tb = n * 4;
    for (const p of played) tm[tb + ((p.card / 13) | 0)] |= 1 << (12 - p.card % 13);
    const ks = pos && h[base + suit] ? [suit] : [0, 1, 2, 3];
    const out = [];
    let g = Math.ceil(n / 2);
    for (const k of ks) {
      const hand = h[base + k], all = cur[k] | tm[tb + k];
      let m = hand;
      while (m) {
        const hb = HIGH[m];
        const eq = [hb];
        let rest = m ^ (1 << hb), below = all & ((1 << hb) - 1);
        while (below) {
          const nb = HIGH[below];
          if (hand >> nb & 1) { rest &= ~(1 << nb); below ^= 1 << nb; eq.push(nb); } else break;
        }
        if (only && !eq.some((e) => only.includes(k * 13 + (12 - e)))) { m = rest; continue; }
        // 這張牌的確切墩數
        let lo = 0, hi = n, gg = g;
        while (lo < hi) {
          const t = Math.max(lo + 1, Math.min(hi, gg));
          if (this._testMove(k, hb, turn, pos, suit, bestS, bestH, bestTr, contest, t, n)) { lo = t; gg = t + 1; } else { hi = t - 1; gg = t - 1; }
        }
        g = lo;
        for (const e of eq) out.push({ card: k * 13 + (12 - e), tricks: lo });
        m = rest;
      }
    }
    tm[tb] = tm[tb + 1] = tm[tb + 2] = tm[tb + 3] = 0;
    return out;
  }

  _testMove(k, hb, turn, pos, suit, bestS, bestH, bestTr, contest, target, n) {
    const bit = 1 << hb, h = this.h, cur = this.cur, tr = this.trump, base = turn * 4;
    let nS = bestS, nH = bestH, nT = bestTr, nC = contest, r;
    h[base + k] ^= bit; cur[k] ^= bit; this.tm[n * 4 + k] |= bit;
    if (pos === 0) {
      r = this._follow(1, (turn + 1) & 3, 1, turn, k, hb, k === tr, false, target, n);
    } else {
      if (k === suit) { if (bestTr === (suit === tr)) { nC = true; if (hb > bestH) { nS = turn; nH = hb; } } } else if (k === tr) {
        if (!bestTr) { nS = turn; nH = hb; nT = true; nC = false; } else { nC = true; if (hb > bestH) { nS = turn; nH = hb; } }
      }
      if (pos === 3) r = this._trickStart(1, nS, (nS & 1) === this.maxSide ? target - 1 : target, n - 1);
      else r = this._follow(1, (turn + 1) & 3, pos + 1, nS, suit, nH, nT, nC, target, n);
    }
    h[base + k] ^= bit; cur[k] |= bit; this.tm[n * 4 + k] ^= bit;
    return r;
  }
}

// 牌號陣列 → 每手 4 個 13 位元遮罩
export function toMasks(hands) {
  return hands.map((cards) => {
    const m = [0, 0, 0, 0];
    for (const c of cards) m[(c / 13) | 0] |= 1 << (12 - c % 13);
    return m;
  });
}

// 一門（0♣1♦2♥3♠4NT）四個主打座位的墩數
export function ddRow(deal, st, solver = new Solver()) {
  const masks = toMasks(deal);
  const row = [0, 0, 0, 0];
  let g = -1;
  for (let d = 0; d < 4; d++) {
    const defT = solver.solve(masks, [3, 2, 1, 0, -1][st], (d + 1) & 3, g);
    row[d] = 13 - defT;
    g = 13 - defT; // 下一輪領出者的隊伍正好是這一輪的主打方
  }
  return row;
}

// 整桌結果：table[花色序 0♣1♦2♥3♠4NT][主打座位] = 墩數
export function ddTable(deal, solver = new Solver()) {
  const table = [];
  for (let st = 4; st >= 0; st--) table[st] = ddRow(deal, st, solver);
  return table;
}

// Par：雙方都打到底的最佳合約，回傳南北角度分數與合約文字
export function parOf(table, vul, dealer = 0) {
  const tricksOf = (st, side) => Math.max(table[st][side === 0 ? 0 : 1], table[st][side === 0 ? 2 : 3]);
  const scoreFor = (level, st, side, doubled) => scoreContract(level, STRAINS[st], doubled, isVul(vul, side === 0 ? 0 : 1), tricksOf(st, side));
  const makeable = [];
  for (let v = 0; v < 35; v++) {
    const level = (v / 5 | 0) + 1, st = v % 5;
    for (const side of [0, 1]) if (tricksOf(st, side) >= level + 6) makeable.push({ v, level, st, side, score: scoreFor(level, st, side, 0) });
  }
  if (!makeable.length) return { score: 0, contract: '全 Pass' };
  const bestOf = (side) => makeable.filter((m) => m.side === side).sort((a, b) => b.score - a.score || a.v - b.v)[0];
  const n = bestOf(0), e = bestOf(1);
  let cur = !n ? e : !e ? n : n.score > e.score ? n : e.score > n.score ? e : ((dealer & 1) === 0 ? n : e);
  for (let guard = 0; guard < 40; guard++) {
    const other = 1 - cur.side;
    // 對方能否用更高叫品反超（可做，或犧牲被賭倍）
    let best = null;
    for (let v = cur.v + 1; v < 35; v++) {
      const level = (v / 5 | 0) + 1, st = v % 5;
      const makes = tricksOf(st, other) >= level + 6;
      const s = scoreFor(level, st, other, makes ? 0 : 1);
      if (s > -cur.score && (!best || s > best.score)) best = { v, level, st, side: other, score: s, sac: !makes };
    }
    if (!best) break;
    cur = best;
  }
  return { score: cur.side === 0 ? cur.score : -cur.score, contract: cur.level + STRAINS[cur.st] + (cur.sac ? 'X' : '') + (cur.side === 0 ? ' 南北' : ' 東西') };
}
