import test from 'node:test';
import assert from 'node:assert/strict';
import { Solver, toMasks, ddTable, parOf } from '../src/renderer/js/dds.js';
import { rng, dealCards, suitOf, rankOf } from '../src/renderer/js/rules.js';

// 參考解：純 alpha-beta，完全不用置換表，用來驗證解算器
function ref(hands, trump, leader, played = []) {
  const trick = [...played.map((p) => ({ s: p.seat, c: p.card }))];
  const rec = (turn, alpha, beta) => { // 傳回南北墩數
    if (!hands[turn].length) return 0;
    let legal = hands[turn];
    if (trick.length) { const s = suitOf(trick[0].c); const f = legal.filter((c) => suitOf(c) === s); if (f.length) legal = f; }
    const ns = (turn & 1) === 0;
    let best = ns ? -1 : 99;
    for (const c of [...legal]) {
      const saved = hands[turn];
      hands[turn] = saved.filter((x) => x !== c);
      trick.push({ s: turn, c });
      let v;
      if (trick.length === 4) {
        let w = trick[0];
        for (const p of trick) {
          const ps = suitOf(p.c), ws = suitOf(w.c);
          if (ps === ws) { if (rankOf(p.c) < rankOf(w.c)) w = p; } else if (ps === trump) w = p;
        }
        const old = trick.splice(0, 4);
        const gain = (w.s & 1) === 0 ? 1 : 0;
        v = gain + rec(w.s, alpha - gain, beta - gain);
        trick.push(...old);
      } else v = rec((turn + 1) % 4, alpha, beta);
      trick.pop();
      hands[turn] = saved;
      if (ns) { if (v > best) best = v; if (best > alpha) alpha = best; } else { if (v < best) best = v; if (best < beta) beta = best; }
      if (alpha >= beta) break;
    }
    return best;
  };
  const n = hands[leader].length;
  const ns = rec(leader, -1, n + 1);
  return (leader & 1) === 0 ? ns : n - ns;
}

function shuffled(r) {
  const d = Array.from({ length: 52 }, (_, x) => x);
  for (let j = 51; j > 0; j--) { const k = Math.floor(r() * (j + 1)); [d[j], d[k]] = [d[k], d[j]]; }
  return d;
}

test('隨機殘局與參考解一致（共用置換表）', () => {
  const r = rng(12345);
  const s = new Solver(16, 12);
  for (let i = 0; i < 500; i++) {
    const n = 1 + Math.floor(r() * 6);
    const d = shuffled(r);
    const hands = [0, 1, 2, 3].map((p) => d.slice(p * n, (p + 1) * n));
    const trump = Math.floor(r() * 5) - 1;
    const leader = Math.floor(r() * 4);
    const want = ref(hands.map((h) => [...h]), trump, leader);
    const got = s.solve(toMasks(hands), trump, leader);
    assert.equal(got, want, `i=${i} trump=${trump} leader=${leader} n=${n} ${JSON.stringify(hands)}`);
  }
});

test('一墩中途 solveMoves 的最佳值與參考解一致', () => {
  const r = rng(777);
  const s = new Solver(16, 12);
  for (let i = 0; i < 200; i++) {
    const n = 4;
    const d = shuffled(r);
    const hands = [0, 1, 2, 3].map((p) => d.slice(p * n, (p + 1) * n));
    const trump = Math.floor(r() * 5) - 1, leader = Math.floor(r() * 4);
    // 先出 0～3 張
    const k = Math.floor(r() * 4);
    const played = [];
    let t = leader;
    for (let q = 0; q < k; q++) {
      let legal = hands[t];
      if (played.length) { const f = legal.filter((c) => suitOf(c) === suitOf(played[0].card)); if (f.length) legal = f; }
      const c = legal[Math.floor(r() * legal.length)];
      hands[t] = hands[t].filter((x) => x !== c);
      played.push({ seat: t, card: c });
      t = (t + 1) % 4;
    }
    const res = s.solveMoves(toMasks(hands), trump, t, played);
    const want = ref(hands.map((h) => [...h]), trump, t, played);
    // ref 以「turn 這隊」表示，n 是 turn 手上張數
    assert.equal(Math.max(...res.map((m) => m.tricks)), want, `i=${i} k=${k}`);
  }
});

test('整桌結果自我一致：兩隊墩數相加 13，北南領出對稱', () => {
  const s = new Solver();
  const t = ddTable(dealCards(4), s);
  const m = toMasks(dealCards(4));
  for (let st = 0; st < 5; st++) for (let d = 0; d < 4; d++) assert.ok(t[st][d] >= 0 && t[st][d] <= 13);
  const trumps = [3, 2, 1, 0, -1];
  for (let st = 0; st < 5; st++) assert.equal(new Solver().solve(m, trumps[st], 1), 13 - t[st][0]);
});

test('Par：一方能做 3NT 時為該方得分', () => {
  const table = Array.from({ length: 5 }, () => [6, 6, 6, 6]);
  table[4] = [9, 4, 9, 4];
  table[0] = [5, 7, 5, 7];
  table[1] = [5, 7, 5, 7];
  table[2] = [5, 7, 5, 7];
  table[3] = [5, 7, 5, 7];
  const p = parOf(table, 0);
  assert.equal(p.score, 400);
  assert.match(p.contract, /3N 南北/);
});
