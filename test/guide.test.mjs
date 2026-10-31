// 教學內容用規則引擎驗證：示範局面不能有錯
import test from 'node:test';
import assert from 'node:assert/strict';
import { LESSONS, SYS_LESSONS, PRACTICE, C, trickWinner, practiceAnswer, speechText } from '../src/renderer/js/guide.js';
import { hcpOf, contractOf, cardFromCode, suitOf } from '../src/renderer/js/rules.js';

test('每一課都有語音文字與畫面', () => {
  for (const l of [...LESSONS, ...SYS_LESSONS]) {
    assert.ok(l.steps.length >= 1, l.id);
    for (const s of l.steps) { assert.ok(s.say.length > 10); assert.ok(s.show && s.show.t, l.id); }
  }
  assert.equal(LESSONS.length, 12);
  assert.equal(SYS_LESSONS.length, 8);
});

test('牌桌動畫：同一墩牌合法，標示的贏家正確', () => {
  for (const l of LESSONS) for (const s of l.steps) {
    const sh = s.show;
    if (sh.t !== 'table' || !sh.plays) continue;
    const list = sh.plays.map((p) => cardFromCode(p[1]));
    assert.equal(new Set(list).size, 4, l.id);
    assert.equal(sh.plays.length, 4);
    // 順時針：北→東→南→西
    const order = 'nesw';
    const i = order.indexOf(sh.plays[0][0]);
    sh.plays.forEach((p, k) => assert.equal(p[0], order[(i + k) % 4], `${l.id} 出牌順序`));
    assert.equal(trickWinner(sh.plays, sh.trump), sh.win, `${l.id}: ${sh.note}`);
  }
});

test('牌型示範：每手 13 張的牌沒有重複', () => {
  for (const l of LESSONS) for (const s of l.steps) {
    if (s.show.t !== 'cards') continue;
    for (const r of s.show.rows) {
      const c = C(r.cards);
      assert.equal(new Set(c).size, c.length, `${l.id}: ${r.label}`);
      for (const i of r.hl || []) assert.ok(i < c.length);
    }
  }
});

test('開叫示範手牌的點數與描述一致', () => {
  const pts = LESSONS.find((l) => l.id === 'points').steps[2].show.rows[0];
  assert.equal(hcpOf(C(pts.cards)), 12);
  const open = LESSONS.find((l) => l.id === 'open').steps;
  assert.equal(hcpOf(C(open[0].show.rows[0].cards)), 12);
  const s1 = C(open[1].show.rows[0].cards);
  assert.equal(s1.filter((c) => suitOf(c) === 0).length, 5);
  assert.ok(hcpOf(s1) >= 12);
  const pre = C(open[3].show.rows[0].cards);
  assert.equal(pre.length, 13);
  assert.equal(pre.filter((c) => suitOf(c) === 0).length, 7);
});

test('叫牌示範：合約與主打正確', () => {
  const st = LESSONS.find((l) => l.id === 'contract').steps[1].show;
  assert.deepEqual(contractOf(st.calls, st.dealer), { level: 4, strain: 'H', doubled: 0, declarer: 2 });
});

test('練習題答案由規則引擎算出，且一定在選項內', () => {
  for (const p of PRACTICE) {
    const a = practiceAnswer(p);
    assert.ok(a != null, p.q);
    if (p.kind === 'score') assert.ok(p.opts.includes(a), p.q);
    if (p.kind === 'winner') assert.ok('nesw'.includes(a));
  }
  assert.equal(practiceAnswer(PRACTICE[0]), 4 + 2 + 3 + 1 + 4);
  assert.equal(practiceAnswer(PRACTICE[3]), 'e');
});

test('語音文字會把符號念成中文', () => {
  assert.equal(speechText('開叫 1♠'), '開叫 1黑桃');
  assert.equal(speechText('15 點 1NT'), '15 點 1無王');
});
