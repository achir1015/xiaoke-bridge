// 牌譜庫：每副牌一筆索引（搜尋與統計用，完整牌譜在 games/），加上從結果累積的叫牌經驗
import { sideOf, hcpOf, shapeOf, isVul, SEAT_EN } from './rules.js';

const CAP = 20000;
const MAX_KEYS = 6000;

export function boardEntry(rec, meta) {
  const c = rec.contract;
  return {
    k: `${meta.matchId}#${rec.no}`, m: meta.matchId, no: rec.no, date: meta.date, mode: meta.mode,
    names: meta.names || [], me: meta.mySeat ?? -1,
    c: c ? c.level + c.strain + (c.doubled === 2 ? 'XX' : c.doubled === 1 ? 'X' : '') : 'PASS',
    level: c ? c.level : 0, st: c ? c.strain : '', dbl: c ? c.doubled : 0, decl: c ? c.declarer : -1,
    tricks: c ? rec.won[sideOf(c.declarer)] : 0,
    made: c && rec.result ? rec.result.made : 0,
    ns: rec.result ? rec.result.nsScore : 0, par: rec.par ?? null, parC: rec.parC || '', imp: rec.imp ?? null,
    dealer: rec.dealer, vul: rec.vul, hcp: rec.deal.map(hcpOf), dd: rec.dd || null,
  };
}

export const handKey = (cards) => {
  const hcp = hcpOf(cards), s = shapeOf(cards);
  const longest = s.indexOf(Math.max(...s));
  return `${(hcp / 3) | 0}${'SHDC'[longest]}${Math.max(...s) >= 6 ? 'L' : Math.max(...s) >= 5 ? 'M' : 'B'}`;
};
export const prefixKey = (calls, dealer) => `${calls.slice(-6).join(',')}|${calls.length > 6 ? 1 : 0}|${dealer % 2}`;

export class Library {
  constructor(data) {
    const d = data || {};
    this.boards = Array.isArray(d.boards) ? d.boards : [];
    this.learn = d.learn && typeof d.learn === 'object' ? d.learn : {};
    this.keys = new Set(this.boards.map((b) => b.k));
  }

  add(entry) {
    if (this.keys.has(entry.k)) return false;
    this.keys.add(entry.k);
    this.boards.push(entry);
    if (this.boards.length > CAP) this.boards.splice(0, this.boards.length - CAP);
    return true;
  }

  // 把這一副的叫牌結果學進去：叫品＋手牌類型 → 平均 IMP（對 Par）
  learnBoard(rec) {
    if (rec.imp == null || !rec.calls.length) return;
    rec.calls.forEach((call, i) => {
      const seat = (rec.dealer + i) % 4;
      const key = prefixKey(rec.calls.slice(0, i), rec.dealer) + '|' + handKey(rec.deal[seat]);
      const e = this.learn[key] || (this.learn[key] = {});
      const v = e[call] || (e[call] = [0, 0]);
      v[0]++;
      v[1] += sideOf(seat) === 0 ? rec.imp : -rec.imp;
    });
    const ks = Object.keys(this.learn);
    if (ks.length > MAX_KEYS) for (const k of ks.slice(0, ks.length - MAX_KEYS)) delete this.learn[k];
  }

  // 叫牌時查詢：回傳 {call: 平均IMP}（次數夠才算）
  bias(calls, dealer, cards) {
    const e = this.learn[prefixKey(calls, dealer) + '|' + handKey(cards)];
    if (!e) return null;
    const out = {};
    for (const [c, v] of Object.entries(e)) if (v[0] >= 3) out[c] = v[1] / v[0];
    return Object.keys(out).length ? out : null;
  }

  // ---------------- 速查 ----------------
  filter({ q = '', result = 'all', kind = 'all', mine = 'all' } = {}) {
    const text = q.trim().toUpperCase().replace('♠', 'S').replace('♥', 'H').replace('♦', 'D').replace('♣', 'C').replace('NT', 'N');
    return this.boards.filter((b) => {
      if (text && !(b.c.includes(text) || b.names.some((n) => String(n).toUpperCase().includes(text)) || (SEAT_EN[b.decl] || '') === text)) return false;
      if (result === 'made' && !(b.level && b.made >= 0)) return false;
      if (result === 'down' && !(b.level && b.made < 0)) return false;
      if (result === 'pass' && b.level) return false;
      if (kind === 'nt' && b.st !== 'N') return false;
      if (kind === 'major' && !'HS'.includes(b.st || '_')) return false;
      if (kind === 'minor' && !'CD'.includes(b.st || '_')) return false;
      if (kind === 'game' && !isGame(b)) return false;
      if (kind === 'slam' && b.level < 6) return false;
      if (mine === 'decl' && !(b.me >= 0 && b.decl >= 0 && sideOf(b.decl) === sideOf(b.me))) return false;
      if (mine === 'def' && !(b.me >= 0 && b.decl >= 0 && sideOf(b.decl) !== sideOf(b.me))) return false;
      return true;
    });
  }

  stats(list = this.boards) {
    const played = list.filter((b) => b.level);
    const made = played.filter((b) => b.made >= 0).length;
    const withImp = list.filter((b) => b.imp != null && b.me >= 0);
    const myImp = withImp.reduce((n, b) => n + (sideOf(b.me) === 0 ? b.imp : -b.imp), 0);
    const by = {};
    for (const b of played) {
      const e = by[b.st] || (by[b.st] = { n: 0, made: 0 });
      e.n++;
      if (b.made >= 0) e.made++;
    }
    return {
      total: list.length, played: played.length, made,
      makeRate: played.length ? made / played.length : 0,
      games: played.filter(isGame).length, slams: played.filter((b) => b.level >= 6).length,
      myImp, impBoards: withImp.length, analyzed: list.filter((b) => b.dd).length,
      by,
    };
  }

  toJSON() { return { boards: this.boards, learn: this.learn }; }
}

export function isGame(b) {
  if (!b.level) return false;
  if (b.level >= 6) return false;
  if (b.st === 'N') return b.level >= 3;
  if (b.st === 'H' || b.st === 'S') return b.level >= 4;
  return b.level >= 5;
}
export { isVul };
