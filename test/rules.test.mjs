import test from 'node:test';
import assert from 'node:assert/strict';
import { Board, Match, boardInfo, legalCalls, contractOf, auctionDone, scoreContract, imps, cardFromCode, dealToPbn, pbnToDeal, recordToPbn, parsePbn, replayBoard, rng, sortHand, hcpOf } from '../src/renderer/js/rules.js';

test('發牌：52 張不重複、可重現', () => {
  const a = new Board({ no: 1, seed: 99 }), b = new Board({ no: 1, seed: 99 });
  assert.deepEqual(a.deal, b.deal);
  assert.equal(new Set(a.deal.flat()).size, 52);
  for (const h of a.deal) assert.equal(h.length, 13);
  assert.equal(a.deal.flat().reduce((n, c) => n + hcpOf([c]), 0), 40);
});

test('發牌者與身價循環符合標準', () => {
  assert.deepEqual(boardInfo(1), { dealer: 0, vul: 0 });
  assert.deepEqual(boardInfo(2), { dealer: 1, vul: 1 });
  assert.deepEqual(boardInfo(3), { dealer: 2, vul: 2 });
  assert.deepEqual(boardInfo(4), { dealer: 3, vul: 3 });
  assert.deepEqual(boardInfo(5), { dealer: 0, vul: 1 });
  assert.deepEqual(boardInfo(16), { dealer: 3, vul: 2 });
  assert.deepEqual(boardInfo(17), { dealer: 0, vul: 0 });
});

test('叫牌合法性：賭倍、再賭倍、不能往下叫', () => {
  assert.ok(!legalCalls([]).includes('X'));
  assert.ok(legalCalls(['1C']).includes('X'));
  assert.ok(!legalCalls(['1C', 'P']).includes('X'));       // 自己夥伴的叫品不能賭倍
  assert.ok(legalCalls(['1C', 'P', 'P']).includes('X'));   // 對手叫的，可以
  assert.ok(legalCalls(['1C', 'X']).includes('XX'));
  assert.ok(!legalCalls(['1C', 'X', 'P']).includes('XX')); // 賭倍方的夥伴不能再賭倍
  assert.ok(legalCalls(['1C', 'X', 'P', 'P']).includes('XX'));
  assert.ok(!legalCalls(['1C', 'X', 'XX']).includes('X'));
  assert.ok(!legalCalls(['1H']).includes('1D'));
  assert.ok(legalCalls(['1H']).includes('1S'));
  assert.equal(legalCalls(['7N', 'P', 'P']).filter((c) => /\d/.test(c)).length, 0);
});

test('叫牌結束判定', () => {
  assert.ok(!auctionDone(['P', 'P', 'P']));
  assert.ok(auctionDone(['P', 'P', 'P', 'P']));
  assert.ok(!auctionDone(['1C', 'P', 'P']));
  assert.ok(auctionDone(['1C', 'P', 'P', 'P']));
  assert.ok(auctionDone(['P', '1C', 'P', 'P', 'P']));
  assert.ok(!auctionDone(['1C', 'P', 'P', 'X', 'P', 'P']));
  assert.ok(auctionDone(['1C', 'P', 'P', 'X', 'P', 'P', 'P']));
});

test('主打：同隊最先叫出該花色的人', () => {
  // 南發牌：南 1H、北 2H、南 4H
  const c = contractOf(['1H', 'P', '2H', 'P', '4H', 'P', 'P', 'P'], 2);
  assert.deepEqual(c, { level: 4, strain: 'H', doubled: 0, declarer: 2 });
  // 北發牌：北 1C、南 1H、北 2H：南先叫紅心，南主打
  const d = contractOf(['1C', 'P', '1H', 'P', '2H', 'P', 'P', 'P'], 0);
  assert.equal(d.declarer, 2);
  const e = contractOf(['1S', 'X', 'XX', 'P', 'P', 'P'], 0);
  assert.equal(e.doubled, 2);
  assert.equal(contractOf(['P', 'P', 'P', 'P'], 0), null);
});

test('計分：常見合約', () => {
  assert.equal(scoreContract(3, 'N', 0, false, 9), 400);
  assert.equal(scoreContract(3, 'N', 0, true, 9), 600);
  assert.equal(scoreContract(4, 'S', 0, false, 10), 420);
  assert.equal(scoreContract(4, 'H', 0, true, 11), 650);
  assert.equal(scoreContract(5, 'C', 0, false, 11), 400);
  assert.equal(scoreContract(2, 'S', 0, false, 8), 110);
  assert.equal(scoreContract(1, 'N', 0, false, 8), 120);
  assert.equal(scoreContract(6, 'S', 0, false, 12), 980);
  assert.equal(scoreContract(6, 'N', 0, true, 12), 1440);
  assert.equal(scoreContract(7, 'N', 0, true, 13), 2220);
  // 賭倍
  assert.equal(scoreContract(2, 'S', 1, false, 8), 470);
  assert.equal(scoreContract(1, 'C', 2, false, 7), 230);
  assert.equal(scoreContract(4, 'S', 1, true, 8), -500);
  assert.equal(scoreContract(4, 'S', 1, false, 6), -800);
  assert.equal(scoreContract(4, 'S', 0, false, 9), -50);
  assert.equal(scoreContract(4, 'S', 2, true, 9), -400);
  // 倒 4 賭倍沒身價 = 100+200+200+300
  assert.equal(scoreContract(3, 'N', 1, false, 5), -800);
});

test('IMP 換算表', () => {
  assert.equal(imps(10), 0);
  assert.equal(imps(20), 1);
  assert.equal(imps(50), 2);
  assert.equal(imps(-420), -9);
  assert.equal(imps(1000), 14);
  assert.equal(imps(5000), 24);
});

// 走完一副：隨機合法出牌
function playRandom(b, r) {
  while (b.phase !== 'done') {
    const l = b.legal();
    const seat = b.controller();
    if (b.phase === 'bidding') {
      const call = b.calls.length < 3 ? '1N' && l[Math.floor(r() * Math.min(l.length, 6))] : 'P';
      b.act(seat, { t: 'call', call });
    } else b.act(seat, { t: 'play', card: l[Math.floor(r() * l.length)] });
  }
}

test('隨機打完 200 副：墩數加總 13、規則不出錯、重播一致', () => {
  const r = rng(5);
  for (let i = 1; i <= 200; i++) {
    const b = new Board({ no: i, seed: i * 7 });
    playRandom(b, r);
    if (b.contract) assert.equal(b.won[0] + b.won[1], 13);
    const rec = b.record();
    const c = replayBoard(rec);
    assert.deepEqual(c.result, b.result);
    assert.deepEqual(c.won, b.won);
  }
});

test('必須跟牌與明手由主打代出', () => {
  const b = new Board({ no: 1, seed: 3 }); // 北發牌
  b.act(0, { t: 'call', call: '1N' });
  b.act(1, { t: 'call', call: 'P' });
  b.act(2, { t: 'call', call: '3N' });
  b.act(3, { t: 'call', call: 'P' });
  b.act(0, { t: 'call', call: 'P' });
  b.act(1, { t: 'call', call: 'P' });
  assert.equal(b.declarer, 0);
  assert.equal(b.turn, 1);
  assert.equal(b.dummy, 2);
  const lead = b.hands[1][0];
  b.act(1, { t: 'play', card: lead });
  assert.equal(b.turn, 2);
  assert.equal(b.controller(), 0, '明手由主打代出');
  assert.throws(() => b.act(2, { t: 'play', card: b.hands[2][0] }));
  const suit = Math.floor(lead / 13);
  const legal = b.legalPlays();
  const has = b.hands[2].some((c) => Math.floor(c / 13) === suit);
  if (has) { assert.ok(legal.every((c) => Math.floor(c / 13) === suit)); }
  // 攤牌後別家看得到明手，看不到別人
  const v = b.view(3);
  assert.ok(v.hands[2]);
  assert.equal(v.hands[0], null);
  assert.equal(v.hands[1], null);
});

test('看不到別人的牌：打牌前對手全部是 null', () => {
  const b = new Board({ no: 2, seed: 9 });
  const v = b.view(0);
  assert.ok(v.hands[0]);
  for (const s of [1, 2, 3]) assert.equal(v.hands[s], null);
  assert.equal(v.deal, null);
});

test('Match 累積分數與 IMP', () => {
  const m = new Match({ boards: 2, seed: 1 });
  const b = m.newBoard();
  for (let i = 0; i < 4; i++) b.act(b.controller(), { t: 'call', call: 'P' });
  assert.equal(b.phase, 'done');
  const rec = m.record(b, 400);
  assert.equal(rec.imp, -9);
  assert.equal(m.impTotal[1], 9);
  assert.equal(m.finished, false);
  m.record(m.newBoard(), null);
  assert.equal(m.finished, true);
});

test('PBN 匯出再匯入：牌局、叫牌、打牌一致', () => {
  const r = rng(77);
  const b = new Board({ no: 6, seed: 123 });
  playRandom(b, r);
  const text = recordToPbn(b.record(), { names: ['甲', '乙', '丙', '丁'], date: '2026-10-31' });
  const [rec] = parsePbn(text);
  assert.deepEqual(rec.deal, b.deal);
  assert.deepEqual(rec.calls, b.calls);
  assert.deepEqual(rec.plays, b.record().plays);
  assert.equal(rec.dealer, b.dealer);
  assert.equal(rec.vul, b.vul);
  assert.deepEqual(rec.result, b.result);
});

test('PBN 牌局字串互轉', () => {
  const d = new Board({ seed: 4 }).deal;
  assert.deepEqual(pbnToDeal(dealToPbn(d, 2)), d.map(sortHand));
  assert.equal(cardFromCode('SA'), 0);
  assert.equal(cardFromCode('C2'), 51);
  assert.throws(() => pbnToDeal('N:AKQ.. .. .. ..'));
});
