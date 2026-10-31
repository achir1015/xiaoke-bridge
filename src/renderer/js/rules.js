// 合約橋牌規則引擎（純邏輯，畫面、AI、網路共用）
// 牌：0-51 = 花色×13＋點位；花色 0♠ 1♥ 2♦ 3♣，點位 0=A 1=K … 12=2（與 BEN 的順序相同）
// 座位：0=北 1=東 2=南 3=西；N-S 一隊、E-W 一隊
// 叫品：'P' 'X' 'XX'，或 '1C'…'7N'（花色 C D H S N）
export const SEATS = ['北', '東', '南', '西'];
export const SEAT_EN = ['N', 'E', 'S', 'W'];
export const SUITS = ['♠', '♥', '♦', '♣'];
export const SUIT_LETTER = ['S', 'H', 'D', 'C'];
export const SUIT_NAME = ['黑桃', '紅心', '方塊', '梅花'];
export const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
export const STRAINS = ['C', 'D', 'H', 'S', 'N'];
export const STRAIN_SYM = { C: '♣', D: '♦', H: '♥', S: '♠', N: 'NT' };
export const STRAIN_NAME = { C: '梅花', D: '方塊', H: '紅心', S: '黑桃', N: '無王' };
export const STRAIN_TO_SUIT = { S: 0, H: 1, D: 2, C: 3, N: -1 };
export const VULS = ['無', '南北', '東西', '雙方'];
export const LEVEL_NAME = ['', '一', '二', '三', '四', '五', '六', '七'];

export const suitOf = (c) => (c / 13) | 0;
export const rankOf = (c) => c % 13;
export const cardOf = (suit, rank) => suit * 13 + rank;
export const cardName = (c) => SUITS[suitOf(c)] + (RANKS[rankOf(c)] === 'T' ? '10' : RANKS[rankOf(c)]);
export const cardCode = (c) => SUIT_LETTER[suitOf(c)] + RANKS[rankOf(c)];
export const cardFromCode = (s) => cardOf(SUIT_LETTER.indexOf(s[0].toUpperCase()), RANKS.indexOf(s[1].toUpperCase()));
export const partner = (s) => (s + 2) % 4;
export const nextSeat = (s) => (s + 1) % 4;
export const sameSide = (a, b) => (a & 1) === (b & 1);
export const sideOf = (s) => s & 1; // 0=南北 1=東西

const HCP = [4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
export const hcpOf = (cards) => cards.reduce((n, c) => n + HCP[rankOf(c)], 0);
export function shapeOf(cards) { const s = [0, 0, 0, 0]; for (const c of cards) s[suitOf(c)]++; return s; }
export const sortHand = (cards) => [...cards].sort((a, b) => a - b);

// 可重現的亂數（mulberry32）
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// 依牌號決定發牌者與身價（複式橋牌標準 16 副循環）
export function boardInfo(no) {
  const n = ((no - 1) % 16 + 16) % 16;
  const dealer = n % 4;
  const VUL_TABLE = [0, 1, 2, 3, 1, 2, 3, 0, 2, 3, 0, 1, 3, 0, 1, 2];
  return { dealer, vul: VUL_TABLE[n] };
}
export const isVul = (vul, seat) => vul === 3 || (vul === 1 && seat % 2 === 0) || (vul === 2 && seat % 2 === 1);

export function dealCards(seed) {
  const r = rng(seed);
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return [0, 1, 2, 3].map((s) => sortHand(d.slice(s * 13, s * 13 + 13)));
}

// ---------------- 叫牌 ----------------
export const isBid = (c) => /^[1-7][CDHSN]$/.test(c);
export const bidValue = (c) => (Number(c[0]) - 1) * 5 + STRAINS.indexOf(c[1]);
export function callName(c) {
  if (c === 'P') return 'Pass';
  if (c === 'X') return 'X';
  if (c === 'XX') return 'XX';
  return c[0] + STRAIN_SYM[c[1]];
}
export function callSpeech(c) {
  if (c === 'P') return '派司';
  if (c === 'X') return '賭倍';
  if (c === 'XX') return '再賭倍';
  return LEVEL_NAME[Number(c[0])] + STRAIN_NAME[c[1]];
}

export function legalCalls(calls) {
  const out = ['P'];
  let last = -1, lastI = -1, dbl = 0;
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    if (isBid(c)) { last = bidValue(c); lastI = i; break; }
    if (c === 'XX' && !dbl) dbl = 2;
    if (c === 'X' && !dbl) dbl = 1;
  }
  if (lastI >= 0) {
    const enemy = (calls.length - lastI) % 2 === 1; // 最後叫品是對手的
    let actor = calls.length - 1;
    while (actor >= 0 && calls[actor] === 'P') actor--;
    const xEnemy = (calls.length - actor) % 2 === 1; // X／叫品是對手叫的
    if (dbl === 0 && enemy) out.push('X');
    if (dbl === 1 && xEnemy) out.push('XX');
  }
  for (let v = last + 1; v < 35; v++) out.push(((v / 5 | 0) + 1) + STRAINS[v % 5]);
  return out;
}

export function auctionDone(calls) {
  if (calls.length < 4) return false;
  const last3 = calls.slice(-3);
  if (!last3.every((c) => c === 'P')) return false;
  return calls.length > 4 ? true : calls.length === 4 && calls[0] === 'P' ? true : calls.slice(0, calls.length - 3).some((c) => c !== 'P');
}

// 回傳 null（四家 Pass）或 { level, strain, doubled(0,1,2), declarer }
export function contractOf(calls, dealer) {
  let i = calls.length - 1;
  while (i >= 0 && !isBid(calls[i])) i--;
  if (i < 0) return null;
  const bid = calls[i];
  let doubled = 0;
  for (let j = i + 1; j < calls.length; j++) { if (calls[j] === 'X') doubled = 1; if (calls[j] === 'XX') doubled = 2; }
  const seat = (dealer + i) % 4;
  let declarer = seat;
  for (let j = 0; j <= i; j++) {
    const s = (dealer + j) % 4;
    if (isBid(calls[j]) && calls[j][1] === bid[1] && sameSide(s, seat)) { declarer = s; break; }
  }
  return { level: Number(bid[0]), strain: bid[1], doubled, declarer };
}
export function contractName(c) {
  if (!c) return '四家 Pass';
  return c.level + STRAIN_SYM[c.strain] + (c.doubled === 2 ? 'XX' : c.doubled === 1 ? 'X' : '') + ' ' + SEATS[c.declarer] + '家主打';
}
export const contractCode = (c) => (c ? c.level + c.strain + (c.doubled === 2 ? 'XX' : c.doubled === 1 ? 'X' : '') + SEAT_EN[c.declarer] : 'PASS');

// ---------------- 計分（複式橋牌） ----------------
// 回傳主打方得分（負數＝倒約）
export function scoreContract(level, strain, doubled, vul, tricks) {
  const need = level + 6, over = tricks - need;
  if (over < 0) {
    const down = -over;
    if (doubled === 0) return -(vul ? 100 : 50) * down;
    let s = 0;
    for (let d = 1; d <= down; d++) {
      if (vul) s += d === 1 ? 200 : 300;
      else s += d === 1 ? 100 : d <= 3 ? 200 : 300;
    }
    return -s * (doubled === 2 ? 2 : 1);
  }
  const mul = doubled === 2 ? 4 : doubled === 1 ? 2 : 1;
  let trick = strain === 'N' ? 40 + 30 * (level - 1) : (strain === 'S' || strain === 'H' ? 30 : 20) * level;
  trick *= mul;
  let s = trick;
  s += trick >= 100 ? (vul ? 500 : 300) : 50;
  if (level === 6) s += vul ? 750 : 500;
  if (level === 7) s += vul ? 1500 : 1000;
  if (doubled === 1) s += 50;
  if (doubled === 2) s += 100;
  if (doubled === 0) s += over * (strain === 'N' || strain === 'S' || strain === 'H' ? 30 : 20);
  else s += over * (vul ? 200 : 100) * (doubled === 2 ? 2 : 1);
  return s;
}

const IMP_TABLE = [20, 50, 90, 130, 170, 220, 270, 320, 370, 430, 500, 600, 750, 900, 1100, 1300, 1500, 1750, 2000, 2250, 2500, 3000, 3500, 4000];
export function imps(diff) {
  const a = Math.abs(diff);
  let i = 0;
  while (i < IMP_TABLE.length && a >= IMP_TABLE[i]) i++;
  return diff < 0 ? -i : i;
}

// ---------------- 一副牌 ----------------
export class Board {
  // opts: { no, seed, hands?(已知發牌，用於重播或匯入), dealer?, vul? }
  constructor(opts = {}) {
    this.no = opts.no || 1;
    this.seed = opts.seed ?? 1;
    const info = boardInfo(this.no);
    this.dealer = opts.dealer ?? info.dealer;
    this.vul = opts.vul ?? info.vul;
    this.deal = opts.hands ? opts.hands.map((h) => sortHand(h)) : dealCards(this.seed);
    this.hands = this.deal.map((h) => [...h]);
    this.calls = [];
    this.phase = 'bidding'; // bidding → play → done
    this.turn = this.dealer;
    this.contract = null;
    this.trick = [];      // 目前一墩：[{seat, card}]
    this.tricks = [];     // 已完成：[{leader, cards:[{seat,card}], winner}]
    this.won = [0, 0];    // 各隊贏墩（0=南北 1=東西）
    this.claim = null;
    this.result = null;
  }

  get dummy() { return this.contract ? partner(this.contract.declarer) : -1; }
  get declarer() { return this.contract ? this.contract.declarer : -1; }
  get trumpSuit() { return this.contract ? STRAIN_TO_SUIT[this.contract.strain] : -1; }
  get dummyShown() { return this.phase !== 'bidding' && (this.tricks.length > 0 || this.trick.length > 0); }

  // 誰有權動作：明手由主打方代出
  controller() {
    if (this.phase === 'done') return -1;
    if (this.phase === 'play' && this.turn === this.dummy) return this.declarer;
    return this.turn;
  }

  legalPlays(seat = this.turn) {
    const h = this.hands[seat];
    if (this.trick.length) {
      const s = suitOf(this.trick[0].card);
      const f = h.filter((c) => suitOf(c) === s);
      if (f.length) return f;
    }
    return [...h];
  }

  legal() {
    if (this.phase === 'bidding') return legalCalls(this.calls);
    if (this.phase === 'play') return this.legalPlays();
    return [];
  }

  // action: { t:'call', call } 或 { t:'play', card }；seat = 動作者（出明手時為主打）
  act(seat, action) {
    if (this.phase === 'done') throw new Error('本副已結束');
    if (seat !== this.controller()) throw new Error('還沒輪到您');
    if (action.t === 'call') return this._call(action.call);
    if (action.t === 'play') return this._play(action.card);
    throw new Error('不明動作');
  }

  _call(call) {
    if (this.phase !== 'bidding') throw new Error('已過叫牌階段');
    if (!legalCalls(this.calls).includes(call)) throw new Error('這個叫品不合法');
    const seat = this.turn;
    this.calls.push(call);
    const ev = [{ e: 'call', seat, call }];
    if (auctionDone(this.calls)) {
      this.contract = contractOf(this.calls, this.dealer);
      if (!this.contract) {
        this.phase = 'done';
        this._finish();
        ev.push({ e: 'passout' });
      } else {
        this.phase = 'play';
        this.turn = nextSeat(this.contract.declarer);
        ev.push({ e: 'contract', contract: this.contract, leader: this.turn });
      }
    } else this.turn = nextSeat(seat);
    return ev;
  }

  _play(card) {
    if (this.phase !== 'play') throw new Error('還不能出牌');
    const seat = this.turn;
    if (!this.legalPlays(seat).includes(card)) throw new Error(this.trick.length && this.hands[seat].includes(card) ? '有同花色的牌一定要跟' : '這張牌不能出');
    this.hands[seat] = this.hands[seat].filter((c) => c !== card);
    const first = this.trick.length === 0 && this.tricks.length === 0;
    this.trick.push({ seat, card });
    const ev = [{ e: 'play', seat, card }];
    if (first) ev.push({ e: 'dummy', seat: this.dummy, cards: [...this.hands[this.dummy]] });
    if (this.trick.length === 4) {
      const winner = this.trickWinner(this.trick);
      this.tricks.push({ leader: this.trick[0].seat, cards: this.trick, winner });
      this.won[sideOf(winner)]++;
      this.trick = [];
      this.turn = winner;
      ev.push({ e: 'trick', winner, won: [...this.won], count: this.tricks.length });
      if (this.tricks.length === 13) { this.phase = 'done'; this._finish(); }
    } else this.turn = nextSeat(seat);
    return ev;
  }

  trickWinner(t) {
    const trump = this.trumpSuit, lead = suitOf(t[0].card);
    let best = t[0];
    for (const p of t) {
      const s = suitOf(p.card), bs = suitOf(best.card);
      if (s === bs) { if (rankOf(p.card) < rankOf(best.card)) best = p; } else if (s === trump) best = p;
      else if (bs !== trump && s === lead) best = p;
    }
    return best.seat;
  }

  // 攤牌：宣稱全部剩下幾墩（由 AI 解算驗證後才呼叫），seat=宣稱者、tricks=宣稱者一方再拿幾墩
  claimRest(seat, tricks) {
    if (this.phase !== 'play') throw new Error('現在不能攤牌');
    if (this.trick.length) throw new Error('要在一墩開始時才能攤牌');
    const left = 13 - this.tricks.length;
    const t = Math.max(0, Math.min(left, tricks));
    this.claim = { seat, tricks: t };
    this.won[sideOf(seat)] += t;
    this.won[1 - sideOf(seat)] += left - t;
    this.phase = 'done';
    this._finish();
    return [{ e: 'claim', seat, tricks: t, won: [...this.won] }];
  }

  _finish() {
    if (!this.contract) { this.result = { nsScore: 0, tricks: 0, made: 0, text: '四家 Pass，本副不計分' }; return; }
    const c = this.contract, side = sideOf(c.declarer);
    const tricks = this.won[side];
    const score = scoreContract(c.level, c.strain, c.doubled, isVul(this.vul, c.declarer), tricks);
    const made = tricks - (c.level + 6);
    this.result = {
      tricks, made, score, nsScore: side === 0 ? score : -score,
      text: contractName(c) + '，' + (made >= 0 ? (made === 0 ? '剛好做成' : `超 ${made} 墩做成`) : `倒 ${-made} 墩`),
    };
  }

  // 對某座位可見的資料（網路傳輸與 AI 共用，看不到別人的手牌）
  view(seat) {
    const showAll = this.phase === 'done';
    const showDummy = this.dummyShown;
    return {
      no: this.no, dealer: this.dealer, vul: this.vul, phase: this.phase, turn: this.turn, ctrl: this.controller(),
      calls: [...this.calls], contract: this.contract, trick: this.trick.map((t) => ({ ...t })),
      tricks: this.tricks.map((t) => ({ leader: t.leader, winner: t.winner, cards: t.cards.map((x) => ({ ...x })) })),
      won: [...this.won], result: this.result, claim: this.claim,
      hands: this.hands.map((h, s) => (showAll || seat === 'all' || s === seat || (showDummy && s === this.dummy) ? [...h] : null)),
      counts: this.hands.map((h) => h.length),
      deal: showAll ? this.deal.map((h) => [...h]) : null,
    };
  }

  // 重播用的完整紀錄
  record() {
    return {
      no: this.no, seed: this.seed, dealer: this.dealer, vul: this.vul,
      deal: this.deal.map((h) => [...h]), calls: [...this.calls],
      plays: [...this.tricks.flatMap((t) => t.cards.map((c) => c.card)), ...this.trick.map((t) => t.card)],
      contract: this.contract, result: this.result, won: [...this.won], claim: this.claim,
    };
  }
}

export function replayBoard(rec, nActions = Infinity) {
  const b = new Board({ no: rec.no, seed: rec.seed, hands: rec.deal, dealer: rec.dealer, vul: rec.vul });
  let n = 0;
  for (const call of rec.calls) { if (n++ >= nActions) return b; b.act(b.controller(), { t: 'call', call }); }
  for (const card of rec.plays) { if (n++ >= nActions) return b; b.act(b.controller(), { t: 'play', card }); }
  if (rec.claim && n <= nActions && b.phase === 'play') b.claimRest(rec.claim.seat, rec.claim.tricks);
  return b;
}

// ---------------- 比賽（連續多副） ----------------
// 南北、東西各自累積：實得分與對 Par 的 IMP
export class Match {
  constructor(cfg = {}) {
    this.boards = cfg.boards || 8;
    this.seed = cfg.seed ?? (Date.now() & 0x7fffffff);
    this.startNo = cfg.startNo || 1;
    this.index = 0;
    this.history = [];
    this.total = [0, 0];
    this.impTotal = [0, 0];
    this.finished = false;
  }
  get boardNo() { return this.startNo + this.index; }
  newBoard() { return new Board({ no: this.boardNo, seed: (this.seed + Math.imul(this.index + 1, 2654435761)) >>> 0 }); }
  // par：南北角度的 Par 分（沒有就當 0）
  record(board, par = null) {
    const r = board.result, ns = r ? r.nsScore : 0;
    const imp = par == null ? null : imps(ns - par);
    if (ns > 0) this.total[0] += ns; else this.total[1] += -ns;
    if (imp != null) { if (imp > 0) this.impTotal[0] += imp; else this.impTotal[1] += -imp; }
    const rec = { ...board.record(), par, imp };
    this.history.push(rec);
    this.index++;
    if (this.index >= this.boards) this.finished = true;
    return rec;
  }
}

// ---------------- PBN 牌譜 ----------------
export function handToPbn(cards) {
  const s = [[], [], [], []];
  for (const c of sortHand(cards)) s[suitOf(c)].push(RANKS[rankOf(c)]);
  return s.map((x) => x.join('')).join('.');
}
export function pbnToHand(str) {
  const out = [];
  str.split('.').forEach((part, si) => { for (const ch of part) out.push(cardOf(si, RANKS.indexOf(ch.toUpperCase()))); });
  return out;
}
export function dealToPbn(deal, first = 0) {
  return SEAT_EN[first] + ':' + [0, 1, 2, 3].map((i) => handToPbn(deal[(first + i) % 4])).join(' ');
}
export function pbnToDeal(str) {
  const m = /^\s*([NESW])\s*:\s*(.+)$/i.exec(str);
  const first = m ? SEAT_EN.indexOf(m[1].toUpperCase()) : 0;
  const parts = (m ? m[2] : str).trim().split(/\s+/);
  if (parts.length !== 4) throw new Error('PBN 牌局格式錯誤');
  const deal = [null, null, null, null];
  parts.forEach((p, i) => { deal[(first + i) % 4] = sortHand(pbnToHand(p)); });
  if (deal.some((h) => h.length !== 13) || new Set(deal.flat()).size !== 52) throw new Error('PBN 牌局不是完整 52 張');
  return deal;
}
const PBN_VUL = ['None', 'NS', 'EW', 'All'];
export function recordToPbn(rec, meta = {}) {
  const tag = (k, v) => `[${k} "${v}"]`;
  const c = rec.contract;
  const lines = [
    tag('Event', meta.event || '小柯機器人橋牌競賽'), tag('Date', (meta.date || '').slice(0, 10).replace(/-/g, '.')),
    tag('Board', rec.no),
    tag('West', (meta.names || [])[3] || ''), tag('North', (meta.names || [])[0] || ''), tag('East', (meta.names || [])[1] || ''), tag('South', (meta.names || [])[2] || ''),
    tag('Dealer', SEAT_EN[rec.dealer]), tag('Vulnerable', PBN_VUL[rec.vul]), tag('Deal', dealToPbn(rec.deal)),
    tag('Declarer', c ? SEAT_EN[c.declarer] : ''), tag('Contract', c ? c.level + c.strain.replace('N', 'NT') + (c.doubled === 2 ? 'XX' : c.doubled === 1 ? 'X' : '') : 'Pass'),
    tag('Result', c ? rec.won[sideOf(c.declarer)] : ''),
    tag('Auction', SEAT_EN[rec.dealer]),
  ];
  for (let i = 0; i < rec.calls.length; i += 4) lines.push(rec.calls.slice(i, i + 4).map((x) => (x === 'P' ? 'Pass' : x.replace('N', 'NT'))).join(' '));
  if (c && rec.plays.length) {
    lines.push(tag('Play', SEAT_EN[(c.declarer + 1) % 4]));
    // PBN 的打牌區以「座位欄」排列，每列是一墩
    const b = new Board({ no: rec.no, seed: rec.seed, hands: rec.deal, dealer: rec.dealer, vul: rec.vul });
    for (const call of rec.calls) b.act(b.controller(), { t: 'call', call });
    const first = (c.declarer + 1) % 4;
    for (let i = 0; i < rec.plays.length;) {
      const row = ['-', '-', '-', '-'];
      for (let k = 0; k < 4 && i < rec.plays.length; k++, i++) {
        const seat = b.turn;
        const card = rec.plays[i];
        row[(seat - first + 4) % 4] = cardCode(card);
        b.act(b.controller(), { t: 'play', card });
      }
      lines.push(row.join(' '));
    }
    lines.push('*');
  }
  return lines.join('\n') + '\n';
}
// 匯入 PBN：回傳 [{no, dealer, vul, deal, calls, plays, contract, won}]（只取本程式需要的欄位）
export function parsePbn(text) {
  const out = [];
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n(?=\s*\[)/)) {
    const tags = {};
    for (const m of block.matchAll(/^\[(\w+)\s+"([^"]*)"\]/gm)) tags[m[1]] = m[2];
    if (!tags.Deal) continue;
    try {
      const deal = pbnToDeal(tags.Deal);
      const no = parseInt(tags.Board, 10) || out.length + 1;
      const info = boardInfo(no);
      const dealer = tags.Dealer ? SEAT_EN.indexOf(tags.Dealer.trim().toUpperCase()[0]) : info.dealer;
      const vulIdx = PBN_VUL.indexOf(tags.Vulnerable === 'Both' ? 'All' : tags.Vulnerable === '-' ? 'None' : tags.Vulnerable);
      const b = new Board({ no, hands: deal, dealer, vul: vulIdx >= 0 ? vulIdx : info.vul });
      const auc = /\[Auction\s+"[^"]*"\]\s*\n([\s\S]*?)(?=\n\[|$)/.exec(block);
      if (auc) {
        for (const tok of auc[1].split(/\s+/).filter(Boolean)) {
          if (/^[;=%*+]|^\$/.test(tok)) continue;
          const u = tok.toUpperCase().replace(/[!?]/g, '');
          const call = u === 'PASS' || u === 'AP' ? 'P' : u.replace('NT', 'N');
          if (u === 'AP') { while (b.phase === 'bidding') b.act(b.controller(), { t: 'call', call: 'P' }); break; }
          if (b.phase === 'bidding') b.act(b.controller(), { t: 'call', call });
        }
      }
      const play = /\[Play\s+"([NESW])"\]\s*\n([\s\S]*?)(?=\n\[|\*|$)/.exec(block);
      if (play && b.phase === 'play') {
        const first = SEAT_EN.indexOf(play[1]);
        const rows = play[2].trim().split('\n').map((l) => l.trim().split(/\s+/));
        for (const row of rows) {
          for (let k = 0; k < 4 && b.phase === 'play'; k++) {
            const col = (b.turn - first + 4) % 4;
            const tok = row[col];
            if (!tok || tok === '-') break;
            b.act(b.controller(), { t: 'play', card: cardFromCode(tok.replace(/[!?]/g, '')) });
          }
        }
      }
      out.push(b);
    } catch (e) { /* 壞掉的一副略過 */ }
  }
  return out.map((b) => ({ ...b.record(), event: '匯入' }));
}
