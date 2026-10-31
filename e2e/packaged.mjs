// 打包後的程式實測：node e2e/packaged.mjs <exe 路徑>
// 重點：WebAssembly、ONNX 模型、Worker、音樂都要能從 app.asar 載入，AI 能叫牌打牌
import { _electron as electron } from 'playwright-core';
import path from 'path';
import fs from 'fs';
import os from 'os';

const exe = process.argv[2];
fs.rmSync(path.join(process.env.APPDATA || os.homedir(), 'xiaoke-bridge-e2ePkg'), { recursive: true, force: true });
const app = await electron.launch({ executablePath: exe, args: ['--profile=e2ePkg'] });
const win = await app.firstWindow();
const errors = [];
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
win.on('pageerror', (e) => errors.push(e.message));
await win.waitForSelector('.pf-grid', { timeout: 30000 });
await win.evaluate(async () => {
  window.__xkb.settings = await window.xk.settings.set({ profile: { avatar: 'm01', advisor: 'am01' }, music: { autoplay: false }, voiceCall: false });
  document.querySelectorAll('.modal-back').forEach((b) => b.remove());
});
const tracks = await win.evaluate(() => window.xk.music.list().then((l) => l.length));
const ai = await win.evaluate(async () => {
  const S = window.__xkb;
  await S.nn.ready;
  const t0 = performance.now();
  const hand = [0, 1, 2, 3, 13, 14, 15, 26, 27, 28, 39, 40, 41];
  const call = await S.brain.chooseCall(hand, 0, [], 0, 0, 1);
  const bidMs = performance.now() - t0;
  const t1 = performance.now();
  const d = Array.from({ length: 52 }, (_, i) => (i * 29 + 7) % 52);
  const deal = [0, 1, 2, 3].map((s) => d.slice(s * 13, (s + 1) * 13));
  const dd = await S.pool.table(deal, 0, 0);
  return { call: call.call, bidMs: Math.round(bidMs), ddMs: Math.round(performance.now() - t1), workers: S.pool.size, dd: dd.table[4] };
});
await win.evaluate(() => { document.querySelector('#lenAI').value = '4'; document.querySelector('#lvAI').value = '0'; });
await win.click('#startAI');
const r = await win.evaluate(async () => {
  const S = window.__xkb;
  for (let i = 0; i < 300 && !(S.view && S.view.phase === 'bidding' && S.view.turn === 2); i++) await new Promise((res) => setTimeout(res, 100));
  const a = new Audio('app://local/assets/music/track05.mp3');
  await a.play().catch(() => null);
  await new Promise((res) => setTimeout(res, 1200));
  return { calls: S.view.calls.length, audio: a.currentTime > 0.3, cards: window.__xkbTable.cards.size, version: S.info.version, packaged: S.info.packaged };
});
console.log(JSON.stringify({ tracks, ai, ...r, errors }, null, 1));
await app.close();
process.exit(errors.filter((e) => !/favicon/.test(e)).length || !r.packaged || tracks !== 20 ? 1 : 0);
