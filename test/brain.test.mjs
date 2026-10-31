import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { makeNet, InlinePool } from './helpers.mjs';
import { Brain, voidsOf } from '../src/renderer/js/brain.js';
import { callId, idCall, encodeHand, paddedIds, stepsFor, writeSeq } from '../src/renderer/js/nn.js';
import { Board, pbnToHand, legalCalls, suitOf, hcpOf } from '../src/renderer/js/rules.js';

let net, brain;
before(async () => { net = await makeNet(); brain = new Brain({ nn: net, pool: new InlinePool() }); });

test('叫品編號與 BEN 一致', () => {
  assert.equal(callId('P'), 2);
  assert.equal(callId('X'), 3);
  assert.equal(callId('XX'), 4);
  assert.equal(callId('1C'), 5);
  assert.equal(callId('1N'), 9);
  assert.equal(callId('7N'), 39);
  for (const c of ['P', 'X', 'XX', '1C', '3H', '7N']) assert.equal(idCall(callId(c)), c);
});

test('手牌編碼：24 維小牌併成 x', () => {
  const h = pbnToHand('AK2.Q3.J42.T9876');
  const x = encodeHand(h, 24);
  assert.equal(x.reduce((a, b) => a + b, 0), 13);
  assert.equal(x[0], 1); assert.equal(x[1], 1); assert.equal(x[5], 1);
  assert.equal(x[6 + 2], 1); assert.equal(x[11], 1);
  assert.equal(x[12 + 3], 1); assert.equal(x[17], 2);
  assert.equal(x[18 + 4], 1); assert.equal(x[23], 4); // ♣ T 一張，其餘四張歸 x
});

test('輸入 193 維序列：第一步與 PAD 位置正確', () => {
  const h = pbnToHand('AK2.Q3.J42.T9876');
  const ids = paddedIds(['1C', 'P'], 2); // 南發牌，輪到西
  assert.deepEqual(ids, [0, 0, 5, 2]);
  assert.equal(stepsFor(ids), 1);
  const x = new Float32Array(193);
  writeSeq(x, 0, h, 0, ids, 3, 1); // 北第一次叫：南 1C、西 P 之後
  assert.equal(x[0], 1); assert.equal(x[1], 1);
  assert.equal(x[2], 1); assert.equal(x[3], 1); // 雙方有身價
  assert.equal(x[4], (hcpOf(h) - 10) / 4);
});

test('叫牌合理：15 點平均牌開叫 1NT', async () => {
  const strong = pbnToHand('AK4.QJ5.K83.A972'); // 17 點
  const r = await brain.chooseCall(strong, 0, [], 0, 0, 1);
  assert.equal(r.call, '1N');
});

test('叫牌合理：五張黑桃開叫 1S、弱牌 Pass', async () => {
  const a = await brain.chooseCall(pbnToHand('AQ975.K52.84.Q73'), 2, [], 2, 0, 1);
  assert.equal(a.call, '1S');
  const b = await brain.chooseCall(pbnToHand('J975.852.843.973'), 2, [], 2, 0, 1);
  assert.equal(b.call, 'P');
});

test('叫牌永遠合法：隨機局面 30 手', async () => {
  for (let i = 1; i <= 30; i++) {
    const b = new Board({ no: i, seed: i * 13 });
    let n = 0;
    while (b.phase === 'bidding' && n++ < 50) {
      const s = b.turn;
      const r = await brain.chooseCall(b.hands[s], s, b.calls, b.dealer, b.vul, 1);
      assert.ok(legalCalls(b.calls).includes(r.call));
      b.act(s, { t: 'call', call: r.call });
    }
    assert.notEqual(b.phase, 'bidding');
  }
});

test('bidinfo 推估：北家開叫 1NT 後，南家看夥伴約 15～17 點', async () => {
  const info = await net.info(pbnToHand('Q752.K84.963.J52'), 2, ['1N', 'P'], 0, 0);
  assert.equal(info.hcp.length, 3);
  assert.ok(info.hcp[1] > 14 && info.hcp[1] < 18.5, `夥伴 ${info.hcp[1]}`);
  for (const k of info.shape[1]) assert.ok(k > 1.5 && k < 5, `牌型 ${info.shape[1]}`);
});

test('首攻：機率有效，且只出手上的牌', async () => {
  const b = new Board({ no: 1, seed: 21 });
  for (const call of ['1N', 'P', '3N', 'P', 'P', 'P']) b.act(b.controller(), { t: 'call', call });
  const st = Brain.stateFrom(b, b.turn);
  const r = await brain.chooseCard(st, 1);
  assert.ok(b.hands[b.turn].includes(r.card));
});

test('打牌：抽樣滿足缺門，AI 一定出合法的牌', async () => {
  const b = new Board({ no: 3, seed: 55 });
  for (const call of ['P', '1S', 'P', '4S', 'P', 'P', 'P']) b.act(b.controller(), { t: 'call', call });
  let steps = 0;
  while (b.phase === 'play' && steps++ < 12) {
    const c = b.controller();
    const st = Brain.stateFrom(b, c);
    const deals = await brain._samplePlay(st, 6);
    const v = voidsOf(st.tricks, st.trick);
    for (const d of deals) {
      for (let s = 0; s < 4; s++) {
        assert.equal(d[s].length, 13, '原始手牌 13 張');
        // 已知缺門的花色在目前手牌裡不能出現
        const cur = brain._current(d[s], s, st);
        for (const x of v[s]) assert.ok(!cur.some((k) => suitOf(k) === x));
      }
      assert.equal(new Set(d.flat()).size, 52);
    }
    const r = await brain.chooseCard(st, 0);
    assert.ok(b.legalPlays().includes(r.card));
    b.act(c, { t: 'play', card: r.card });
  }
});
