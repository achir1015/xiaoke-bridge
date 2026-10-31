// 單機端對端測試：首頁、半身照、真人對 AI 打完一場、軍師、接手與換回、換軍師、牌譜庫、重播分析、教學、AI 對 AI
// 用法：node e2e/smoke.mjs [截圖資料夾]；W=寬 H=高 可模擬小螢幕
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const outDir = process.argv[2] || 'e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const appData = process.env.APPDATA || path.join(os.homedir(), 'Library', 'Application Support');
fs.rmSync(path.join(appData, 'xiaoke-bridge-e2eSmoke'), { recursive: true, force: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };

const app = await electron.launch({ executablePath: require('electron'), args: ['.', '--profile=e2eSmoke', '--autoplay-policy=no-user-gesture-required'] });
const win = await app.firstWindow();
if (process.env.W) await win.setViewportSize({ width: Number(process.env.W), height: Number(process.env.H || 900) }).catch(() => {});
const errors = [];
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
win.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
const waitFor = async (fn, arg, ms = 30000) => {
  const t = Date.now();
  for (;;) {
    const v = await win.evaluate(fn, arg).catch(() => false);
    if (v) return v;
    if (Date.now() - t > ms) throw new Error('等待逾時：' + fn);
    await new Promise((r) => setTimeout(r, 150));
  }
};
const shot = async (name) => { const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')); fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(b64, 'base64')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await waitFor(() => !!document.querySelector('#homeBody .mode-grid'));
check('首頁顯示三種模式', await win.evaluate(() => document.querySelectorAll('.mode-card').length === 3));
// 必選半身照
check('第一次要選半身照與軍師', await win.evaluate(() => !!document.querySelector('.modal .pf')));
check('半身照 男 20 女 20', await win.evaluate(() => document.querySelectorAll('.pf-pane')[0].querySelectorAll('.pf-item').length === 20 && document.querySelectorAll('.pf-pane')[1].querySelectorAll('.pf-item').length === 20));
check('軍師 30 位', await win.evaluate(() => document.querySelectorAll('.pf-pane')[2].querySelectorAll('.pf-item').length === 30));
check('沒選好不能確定', await win.evaluate(() => document.querySelector('.pf-ok').disabled));
await win.evaluate(() => {
  document.querySelectorAll('.pf-pane')[0].querySelector('.pf-item').click();
  document.querySelectorAll('.pf-pane')[2].querySelector('.pf-item').click();
  document.querySelector('.pf-ok').click();
});
await waitFor(() => !document.querySelector('.modal'));
await shot('01-home');

check('AI 引擎自動載入', await waitFor(() => window.__xkb.nn.ready.then(() => true), null, 40000));

// A：真人對 AI，4 副
await win.evaluate(() => { document.querySelector('#lenAI').value = '4'; document.querySelector('#lvAI').value = '1'; document.querySelector('#startAI').click(); });
await waitFor(() => window.__xkb.mode === 'ai' && window.__xkb.view);
await sleep(1200);
await shot('02-deal');
check('牌局中有 52 張牌的資料（我看得到自己 13 張）', await win.evaluate(() => window.__xkb.view.hands[2].length === 13 && window.__xkb.view.hands[0] === null));

async function playBoard(no, { bidMode = 'hint', shots = false } = {}) {
  let n = 0, shotBid = false, shotPlay = false;
  const t0 = Date.now();
  for (;;) {
    const st = await win.evaluate(() => {
      const S = window.__xkb, v = S.view;
      if (!v) return { none: true };
      const legal = [...window.__xkbTable.playable];
      return { phase: v.phase, turn: v.turn, ctrl: v.ctrl, my: S.mySeat, no: v.no, legal, proxy: S.proxy[S.mySeat], box: !document.querySelector('#bidBox').classList.contains('hidden'), hold: !!S.hold, modal: !!document.querySelector('.modal'), banner: document.querySelector('#turnBanner').textContent };
    });
    if (st.none || st.modal) { if (st.modal) return st; await sleep(100); continue; }
    if (st.phase === 'done') { await sleep(200); continue; }
    if (st.phase === 'bidding' && st.box) {
      if (shots && !shotBid) { shotBid = true; await sleep(500); await shot('03-bidding'); }
      const call = await win.evaluate(async (mode) => {
        const S = window.__xkb, v = S.view;
        const box = document.querySelector('#bidBox');
        if (mode === 'pass') { box.querySelector('[data-call="P"]').click(); return 'P'; }
        const r = await S.brain.chooseCall(v.hands[2], 2, v.calls, v.dealer, v.vul, 1);
        const b = box.querySelector(`[data-call="${r.call}"]`);
        if (b) b.click();
        return r.call;
      }, bidMode);
      n++;
      void call;
    } else if (st.phase === 'play' && st.legal.length && !st.hold) {
      if (shots && !shotPlay && n > 6) { shotPlay = true; await sleep(800); await shot('04-playing'); }
      await win.evaluate((c) => window.__xkbApi.myAct({ t: 'play', card: c }), st.legal[st.legal.length - 1]);
      n++;
      await sleep(60);
    } else await sleep(120);
    if (Date.now() - t0 > 240000) throw new Error('打牌逾時');
  }
}

let st = await playBoard(1, { shots: true });
await sleep(500);
await shot('05-result');
check('第 1 副打完顯示結果與雙明手表', await win.evaluate(() => !!document.querySelector('.result .dd-table')), JSON.stringify(st));
check('記錄累積到牌譜庫', await win.evaluate(() => window.__xkb.lib.boards.length === 1));
check('Par 與 IMP 已算好', await win.evaluate(() => window.__xkb.history[0].par != null && window.__xkb.history[0].dd.length === 5));
await win.evaluate(() => [...document.querySelectorAll('.modal-btns button')].find((b) => b.classList.contains('primary')).click());
await waitFor(() => !document.querySelector('.modal'));
await waitFor(() => window.__xkb.view && window.__xkb.view.no === 2);

// 提示、軍師
await waitFor(() => window.__xkb.view.turn === 2 || window.__xkb.view.phase !== 'bidding', null, 20000);
const hintOk = await win.evaluate(async () => {
  const S = window.__xkb;
  if (S.view.turn !== 2) return 'skip';
  document.querySelector('#btnHint').click();
  for (let i = 0; i < 60; i++) { if (document.querySelector('.bb.hint')) return true; await new Promise((r) => setTimeout(r, 100)); }
  return false;
});
check('提示會標出建議叫品', hintOk === true || hintOk === 'skip', hintOk);
await win.evaluate(() => { document.querySelector('.adv-input').value = '夥伴有什麼牌？'; [...document.querySelectorAll('.adv-send button')][0].click(); });
await waitFor(() => document.querySelectorAll('.adv-msg.me').length >= 1 && !document.querySelector('.adv-msg.thinking'), null, 15000);
check('離線軍師有回答', await win.evaluate(() => [...document.querySelectorAll('.adv-msg.ai')].pop().textContent.length > 6));

// 軍師接手：不用動手，這副會自己打完
await win.evaluate(() => document.querySelector('#btnProxy').click());
check('軍師接手：按鈕變成換回主位', await win.evaluate(() => document.querySelector('#btnProxy').textContent.includes('換回主位')));
check('上方顯示軍師接手中', await win.evaluate(() => document.querySelector('#turnBanner').textContent.includes('軍師')));
await waitFor(() => window.__xkb.view.phase === 'play' && window.__xkb.view.tricks.length >= 2, null, 90000);
await win.evaluate(() => document.querySelector('#btnProxy').click());
check('可以換回主位', await win.evaluate(() => !window.__xkb.proxy[2] && document.querySelector('#btnProxy').textContent.includes('軍師接手')));

// 換軍師
await win.evaluate(() => document.querySelector('#btnChangeAdv').click());
await waitFor(() => !!document.querySelector('.modal .pf-grid'));
const before = await win.evaluate(() => window.__xkb.seats[2].profile.advisor);
await win.evaluate(() => { document.querySelectorAll('.modal .pf-item')[5].click(); document.querySelector('.modal .modal-btns button.primary').click(); });
await waitFor(() => !document.querySelector('.modal'));
check('中途換軍師', await win.evaluate((b) => window.__xkb.seats[2].profile.advisor !== b, before));

// 其餘牌打完（第 3、4 副 Pass 讓 AI 叫）
for (let b = 2; b <= 4; b++) {
  st = await playBoard(b, { bidMode: 'pass' });
  await waitFor(() => !!document.querySelector('.modal'));
  const final = await win.evaluate(() => !!document.querySelector('.final'));
  if (final) break;
  await win.evaluate(() => [...document.querySelectorAll('.modal-btns button')].find((x) => x.classList.contains('primary')).click());
  await sleep(300);
  if (await win.evaluate(() => !!document.querySelector('.final'))) break;
}
await waitFor(() => !!document.querySelector('.final'), null, 10000);
await shot('06-final');
check('四副打完顯示總成績', true);
check('牌譜庫累積 4 副', await win.evaluate(() => window.__xkb.lib.boards.length === 4));
await win.evaluate(() => [...document.querySelectorAll('.modal-btns button')].find((b) => !b.classList.contains('primary')).click());
await waitFor(() => window.__xkb.screen === 'home');

// 牌譜庫
await win.evaluate(() => document.querySelector('#btnKB').click());
await waitFor(() => !!document.querySelector('.rec-table'));
await sleep(600);
await shot('07-kb');
check('牌譜庫列出 4 副', await win.evaluate(() => document.querySelectorAll('.rec-table tr').length === 5));
check('統計卡片', await win.evaluate(() => document.querySelectorAll('.kb-card').length === 6));
await win.evaluate(() => { const q = document.querySelector('.kb-q'); q.value = 'zzz'; [...document.querySelectorAll('.kb-filter button')][0].click(); });
await waitFor(() => !document.querySelector('.rec-table'));
check('查詢：沒有符合就顯示提示', await win.evaluate(() => !!document.querySelector('.empty')));
await win.evaluate(() => { const q = document.querySelector('.kb-q'); q.value = ''; [...document.querySelectorAll('.kb-filter button')][0].click(); });
await waitFor(() => !!document.querySelector('.rec-table'));

// 重播與逐張分析（找有打牌的一副）
await win.evaluate(() => { const S = window.__xkb; const b = S.lib.boards.find((x) => x.level > 0); window.__xkbApi.openReplayByKey(b.k); });
await waitFor(() => window.__xkb.mode === 'replay' && window.__xkb.view);
await win.evaluate(() => { for (let i = 0; i < 30; i++) document.querySelector('#rpNext').click(); });
await sleep(900);
await shot('08-replay');
check('重播可以前進', await win.evaluate(() => window.__xkb.replay.step === 30));
await win.evaluate(() => document.querySelector('#rpAna').click());
await waitFor(() => !document.querySelector('#rpAna').disabled && document.querySelector('#eventLog').textContent.includes('逐張分析完成'), null, 120000);
check('逐張雙明手分析完成', true);
console.log('   ', await win.evaluate(() => [...document.querySelectorAll('#eventLog .ev')].pop().textContent));
await win.evaluate(() => document.querySelector('#btnHome').click());
await waitFor(() => window.__xkb.screen === 'kb');
await win.evaluate(() => [...document.querySelectorAll('.rec-actions button')].pop().click());
await waitFor(() => window.__xkb.screen === 'home');

// 教學
await win.evaluate(() => { window.__sp = []; const o = speechSynthesis.speak.bind(speechSynthesis); speechSynthesis.speak = (u) => { window.__sp.push(u.text); o(u); }; document.querySelector('#btnGuide').click(); });
await waitFor(() => window.__xkb.screen === 'guide');
await sleep(1500);
await shot('09-guide');
check('教學 12 課＋練習', await win.evaluate(() => document.querySelectorAll('.gd-item').length === 13));
check('語音自動開始', await win.evaluate(() => window.__sp.length >= 1 || !speechSynthesis.getVoices().length));
await win.evaluate(() => [...document.querySelectorAll('.gd-item')][9].click());
await sleep(600);
await win.evaluate(() => [...document.querySelectorAll('.gd-ctrl button')][2].click());
await sleep(3800);
await shot('10-finesse');
check('飛牌動畫有出牌', await win.evaluate(() => document.querySelectorAll('.gs-card').length === 4));
await win.evaluate(() => [...document.querySelectorAll('.gd-item')].pop().click());
await sleep(500);
await win.evaluate(() => { const a = [...document.querySelectorAll('.gd-choices button')]; a[2].click(); });
check('練習題：答對有回饋', await win.evaluate(() => document.querySelector('.gd-result').classList.contains('ok')));
await win.evaluate(() => document.querySelector('.gd-section [data-s=system]').click());
check('系統說明 8 課', await win.evaluate(() => document.querySelectorAll('.gd-item').length === 8));
await win.evaluate(() => document.querySelector('.gd-back').click());
await waitFor(() => window.__xkb.screen === 'home');

// AI 對 AI
await win.evaluate(() => { document.querySelector('#lenAivai').value = '4'; document.querySelector('#aivaiNS').value = '0'; document.querySelector('#aivaiEW').value = '0'; [...document.querySelectorAll('#startAivai')][0].closest('.mode-card').querySelector('.segbtn[data-v=fast]').click(); document.querySelector('#startAivai').click(); });
await waitFor(() => window.__xkb.mode === 'aivai' && window.__xkb.view && window.__xkb.view.phase === 'play' && window.__xkb.view.tricks.length >= 1, null, 90000);
await sleep(600);
await shot('11-aivai');
check('AI 對 AI 四家攤牌', await win.evaluate(() => window.__xkb.view.hands.every((h) => h)));
await win.evaluate(() => document.querySelector('#btnPause').click());
check('AI 對 AI 可以暫停', await win.evaluate(() => window.__xkb.paused));
await win.evaluate(() => document.querySelector('#btnPause').click());
await waitFor(() => window.__xkb.history.length >= 1, null, 150000);
check('AI 對 AI 打完一副', true);

check('畫面沒有錯誤', errors.filter((e) => !/favicon|Failed to load resource/.test(e)).length === 0, errors.slice(0, 6).join('\n'));
await app.close();
console.log(`\n通過 ${pass} 項，失敗 ${fail} 項`);
process.exit(fail ? 1 : 0);
