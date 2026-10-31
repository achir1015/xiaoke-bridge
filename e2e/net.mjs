// 遠端對賽測試：本機配對伺服器＋三個實例（房主、夥伴、東家），空位 AI，打完一副
// 用法：node e2e/net.mjs
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
import { PeerServer } from 'peer';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const PORT = 9151;
const server = PeerServer({ port: PORT, path: '/', key: 'peerjs' });
await new Promise((r) => setTimeout(r, 500));
const appData = process.env.APPDATA || path.join(os.homedir(), 'Library', 'Application Support');

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(name) {
  fs.rmSync(path.join(appData, 'xiaoke-bridge-' + name), { recursive: true, force: true });
  const app = await electron.launch({ executablePath: require('electron'), args: ['.', `--profile=${name}`, '--hidden', '--autoplay-policy=no-user-gesture-required'] });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  const waitFor = async (fn, arg, ms = 30000) => {
    const t = Date.now();
    for (;;) {
      const v = await win.evaluate(fn, arg).catch(() => false);
      if (v) return v;
      if (Date.now() - t > ms) throw new Error(`${name} 等待逾時：` + fn);
      await sleep(120);
    }
  };
  await waitFor(() => !!document.querySelector('#homeBody .mode-grid'));
  await win.evaluate(async ({ PORT, name }) => {
    document.querySelectorAll('.pf-pane')[0].querySelectorAll('.pf-item')[name.length % 7].click();
    document.querySelectorAll('.pf-pane')[2].querySelector('.pf-item').click();
    document.querySelector('.pf-ok').click();
    await xk.settings.set({ playerName: name, server: { mode: 'custom', host: '127.0.0.1', port: PORT, path: '/', secure: false } });
    window.__xkb.settings = await xk.settings.get();
  }, { PORT, name });
  return { app, win, waitFor, errors, name };
}

const A = await open('netHost'), B = await open('netPartner'), C = await open('netEast');
await A.win.evaluate(() => { document.querySelector('#lenNet').value = '4'; document.querySelector('#lvNet').value = '0'; document.querySelector('#btnHost').click(); });
await A.waitFor(() => !!document.querySelector('.room-code'));
const code = await A.win.evaluate(() => window.__xkb.net.code);
check('建立房間得到 6 位數房號', /^\d{6}$/.test(code), code);

for (const p of [B, C]) {
  await p.win.evaluate((code) => { document.querySelector('#joinCode').value = code; document.querySelector('#btnJoin').click(); }, code);
  await p.waitFor(() => window.__xkb.net && window.__xkb.net.members.length >= 2);
}
await A.waitFor(() => window.__xkb.net.members.length === 3);
check('第一位朋友坐北（房主夥伴）、第二位坐東', await A.win.evaluate(() => window.__xkb.net.members.map((m) => m.seat).join() === '2,0,1'));
await A.win.evaluate(() => document.querySelector('#btnStartNet').click());
await B.waitFor(() => window.__xkb.mode === 'net' && window.__xkb.view, null, 15000);
await C.waitFor(() => window.__xkb.mode === 'net' && window.__xkb.view, null, 15000);
check('來賓進入牌局', true);
check('空位西家由 AI 補上', await A.win.evaluate(() => window.__xkb.seats[3].kind === 'ai'));
check('來賓看到自己的牌、看不到別人的', await B.win.evaluate(() => { const h = window.__xkb.view.hands; return h[0].length === 13 && h[1] === null && h[2] === null && h[3] === null; }));

// 聊天
await B.win.evaluate(() => { document.querySelector('#chatInput').value = '大家好'; document.querySelector('#chatSend').click(); });
await A.waitFor(() => document.querySelector('#chatLog').textContent.includes('大家好'));
await C.waitFor(() => document.querySelector('#chatLog').textContent.includes('大家好'));
check('聊天訊息轉送到其他人', true);

// 打一副：每個人輪到就動作（來賓走 act 訊息）
async function step(p) {
  return p.win.evaluate(async () => {
    const S = window.__xkb, v = S.view;
    if (!v || document.querySelector('.modal')) return false;
    const box = document.querySelector('#bidBox');
    if (v.phase === 'bidding' && !box.classList.contains('hidden')) {
      const r = await S.brain.chooseCall(v.hands[S.mySeat], S.mySeat, v.calls, v.dealer, v.vul, 1);
      box.querySelector(`[data-call="${r.call}"]`).click();
      return true;
    }
    const legal = [...window.__xkbTable.playable];
    if (v.phase === 'play' && legal.length) { window.__xkbApi.myAct({ t: 'play', card: legal[0] }); return true; }
    return false;
  }).catch(() => false);
}

// 打到這一副快結束時，測試軍師接手與換回（來賓）
let toggled = false;
const t0 = Date.now();
for (;;) {
  const hist = await A.win.evaluate(() => window.__xkb.history.length);
  if (hist >= 1) break;
  await step(A); await step(B); await step(C);
  const tricks = await A.win.evaluate(() => window.__xkb.view?.tricks.length ?? 0);
  if (!toggled && tricks >= 3) {
    toggled = true;
    await B.win.evaluate(() => document.querySelector('#btnProxy').click());
    await A.waitFor(() => window.__xkb.proxy[0], null, 5000);
    check('來賓請軍師接手，房主收到', true);
    await sleep(600);
    await B.win.evaluate(() => document.querySelector('#btnProxy').click());
    await A.waitFor(() => !window.__xkb.proxy[0], null, 5000);
    check('來賓換回主位', true);
  }
  await sleep(150);
  if (Date.now() - t0 > 100000) {
    for (const p of [A, B, C]) console.log(p.name, await p.win.evaluate(() => { const S = window.__xkb, v = S.view; return JSON.stringify({ phase: v?.phase, turn: v?.turn, ctrl: v?.ctrl, my: S.mySeat, tricks: v?.tricks.length, trick: v?.trick.length, calls: v?.calls.join(' '), legal: window.__xkbTable.playable.size, hold: !!S.hold, modal: document.querySelector('.modal h3')?.textContent, proxy: S.proxy, kinds: S.seats.map((x) => x.kind), banner: document.querySelector('#turnBanner').textContent }); }));
    throw new Error('打牌逾時');
  }
}
check('一副打完（房主有紀錄）', true);
await B.waitFor(() => window.__xkb.history.length === 1, null, 10000);
check('來賓也存到牌譜', await C.waitFor(() => window.__xkb.history.length === 1, null, 10000));
check('結果一致', await (async () => {
  const a = await A.win.evaluate(() => window.__xkb.history[0].result.nsScore);
  const b = await B.win.evaluate(() => window.__xkb.history[0].result.nsScore);
  return a === b;
})());
await B.waitFor(() => !!document.querySelector('.result'), null, 5000);
check('來賓看到結果畫面', true);

// 下一副
await A.waitFor(() => !!document.querySelector('.modal .result'), null, 5000);
await A.win.evaluate(() => [...document.querySelectorAll('.modal-btns button')].find((b) => b.classList.contains('primary')).click());
await B.win.evaluate(() => document.querySelector('.modal-btns button')?.click());
await B.waitFor(() => window.__xkb.view && window.__xkb.view.no === 2, null, 10000);
check('房主開下一副，來賓同步', true);

// 斷線：東家離開由 AI 接手
await C.app.close();
await A.waitFor(() => window.__xkb.seats[1].kind === 'ai', null, 25000);
check('有人斷線由 AI 代打', true);

check('沒有頁面錯誤', A.errors.length + B.errors.length === 0, [...A.errors, ...B.errors].slice(0, 4).join('\n'));
await A.app.close();
await B.app.close();
server.close?.();
console.log(`\n通過 ${pass} 項，失敗 ${fail} 項`);
process.exit(fail ? 1 : 0);
