// 實機測試：透過 adb 連到手機上小柯橋牌（除錯版 APK）的 WebView，用 DevTools 協定檢查功能
// 用法：python android/build.py debug install，手機解鎖後執行 node e2e/phone.mjs [手機序號]
import { chromium } from 'playwright-core';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ADB = process.env.ADB || 'E:/小米觸控音箱/tools/android-sdk/platform-tools/adb.exe';
const SERIAL = process.argv[2] || process.env.ANDROID_SERIAL || 'R5CY236CQ3B';
const outDir = 'e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const adb = (...a) => execFileSync(ADB, ['-s', SERIAL, ...a], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
const shotPhone = (name) => fs.writeFileSync(path.join(outDir, 'p-' + name + '.png'), execFileSync(ADB, ['-s', SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 }));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };

const focus = adb('shell', 'dumpsys', 'window');
if (/isKeyguardShowing=true/.test(focus)) { console.log('手機鎖著，請先解鎖'); process.exit(2); }
const fm = focus.match(/mCurrentFocus=[^\r\n]*/g) || [];
if (!fm.some((f) => f.includes('com.achir.xiaokebridge'))) { console.log('前景不是小柯橋牌：', fm.join(' ')); process.exit(2); }
const sock = /@?(webview_devtools_remote_\d+)/.exec(adb('shell', 'cat', '/proc/net/unix'));
if (!sock) { console.log('找不到 WebView 偵錯通道（要用 python android/build.py debug 建置）'); process.exit(2); }
execFileSync(ADB, ['-s', SERIAL, 'forward', 'tcp:9335', 'localabstract:' + sock[1]]);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9335');
const page = browser.contexts()[0].pages().find((p) => p.url().includes('appassets')) || browser.contexts()[0].pages()[0];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const waitFor = async (fn, arg, ms = 30000) => { const t = Date.now(); for (;;) { const v = await page.evaluate(fn, arg).catch(() => false); if (v) return v; if (Date.now() - t > ms) throw new Error('等待逾時：' + fn); await new Promise((r) => setTimeout(r, 200)); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const info = await page.evaluate(() => ({ android: !!window.XiaokeAndroid, mobile: document.documentElement.classList.contains('mobile'), w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ver: JSON.parse(window.XiaokeAndroid.appInfo()).version, webgl: !!document.createElement('canvas').getContext('webgl2'), cores: navigator.hardwareConcurrency }));
  console.log('  ', JSON.stringify(info));
  check('在 Android App 裡執行（原生橋接）', info.android && info.mobile);
  check('WebGL2（3D 牌桌）可用', info.webgl);
  check('橫向畫面', info.w > info.h);
  await page.reload();
  await waitFor(() => window.__xkb && window.__xkbTable);
  if (await page.evaluate(() => !!document.querySelector('.pf'))) {
    check('第一次開啟要選半身照', true);
    await page.evaluate(() => { document.querySelector('.pf-item[data-id="m02"]').click(); document.querySelector('.pf-tab[data-k="advisor"]').click(); document.querySelector('.pf-item[data-id="af03"]').click(); document.querySelector('.modal .pf-ok').click(); });
  }
  await page.evaluate(async () => { await window.xk.settings.set({ music: { autoplay: false } }); });
  await sleep(800);
  shotPhone('1-home');
  const t0 = Date.now();
  check('手機上神經網路（WASM）載入成功', await waitFor(() => window.__xkb.nn.ready.then(() => true), null, 60000));
  console.log('   模型載入', Date.now() - t0, 'ms');
  const tts = await waitFor(() => window.xk.tts && window.xk.tts.available() && window.xk.tts.voiceName(), null, 15000).catch(() => '');
  check('手機語音可用', !!tts, tts);
  check('內建音樂 20 首', (await page.evaluate(() => window.xk.music.list().then((l) => l.length))) === 20);
  const speed = await page.evaluate(async () => {
    const S = window.__xkb;
    const hand = [0, 1, 2, 3, 13, 14, 15, 26, 27, 28, 39, 40, 41];
    const t0 = performance.now();
    const r = await S.brain.chooseCall(hand, 0, [], 0, 0, 1);
    const t1 = performance.now();
    const d = Array.from({ length: 52 }, (_, i) => (i * 29 + 7) % 52);
    const dd = await S.pool.table([0, 1, 2, 3].map((s) => d.slice(s * 13, (s + 1) * 13)), 0, 0);
    return { call: r.call, bidMs: Math.round(t1 - t0), ddMs: Math.round(performance.now() - t1), workers: S.pool.size, par: dd.par.contract };
  });
  console.log('  ', JSON.stringify(speed));
  check('手機叫牌與雙明手速算可用', !!speed.call && !!speed.par);

  // 真人對 AI 打一副（4 副裡的第 1 副）
  await page.evaluate(() => { document.querySelector('#lenAI').value = '4'; document.querySelector('#lvAI').value = '1'; document.querySelector('#startAI').click(); });
  await waitFor(() => window.__xkb.mode === 'ai' && window.__xkb.view);
  let shotB = false, shotP = false;
  const t1 = Date.now();
  for (;;) {
    const st = await page.evaluate(() => { const S = window.__xkb, v = S.view; return { phase: v?.phase, legal: [...window.__xkbTable.playable], box: !document.querySelector('#bidBox').classList.contains('hidden'), hold: !!S.hold, modal: !!document.querySelector('.modal'), tricks: v?.tricks.length }; });
    if (st.modal) break;
    if (st.phase === 'bidding' && st.box) {
      if (!shotB) { shotB = true; await sleep(700); shotPhone('2-bid'); }
      await page.evaluate(async () => { const S = window.__xkb, v = S.view; const r = await S.brain.chooseCall(v.hands[2], 2, v.calls, v.dealer, v.vul, 1); document.querySelector(`#bidBox [data-call="${r.call}"]`).click(); });
    } else if (st.phase === 'play' && st.legal.length && !st.hold) {
      if (!shotP && st.tricks >= 2) { shotP = true; await sleep(700); shotPhone('3-play'); }
      await page.evaluate((c) => window.__xkbApi.myAct({ t: 'play', card: c }), st.legal[st.legal.length - 1]);
    }
    await sleep(120);
    if (Date.now() - t1 > 220000) throw new Error('打牌逾時');
  }
  await sleep(600);
  shotPhone('4-result');
  check('手機上打完一副，結果與雙明手表', await page.evaluate(() => !!document.querySelector('.result .dd-table')));
  check('牌譜存進手機', await page.evaluate(async () => (await window.xk.kb.get())?.boards?.length >= 0 && window.__xkb.lib.boards.length >= 1));
  await page.evaluate(() => [...document.querySelectorAll('.modal-btns button')].find((b) => b.classList.contains('primary')).click());
  await sleep(400);
  // 抽屜
  await page.evaluate(() => document.querySelector('#btnDrawer').click());
  await sleep(400);
  shotPhone('5-drawer');
  check('抽屜可以打開', await page.evaluate(() => document.documentElement.classList.contains('drawer-open')));
  await page.evaluate(() => document.querySelector('#drawerShade').click());
  // 教學
  await page.evaluate(() => window.__xkbBack());
  await sleep(300);
  await page.evaluate(() => { const b = [...document.querySelectorAll('.modal-btns button')].find((x) => x.classList.contains('primary')); if (b) b.click(); });
  await waitFor(() => window.__xkb.screen === 'home');
  await page.evaluate(() => document.querySelector('#btnGuide').click());
  await sleep(1500);
  await page.evaluate(() => [...document.querySelectorAll('.gd-item')][2].click());
  await sleep(3800);
  shotPhone('6-guide');
  check('教學動畫有出牌', await page.evaluate(() => document.querySelectorAll('.gs-card').length === 4));
  await page.evaluate(() => document.querySelector('.gd-back').click());
  check('畫面沒有錯誤', errors.filter((e) => !/favicon/.test(e)).length === 0, errors.slice(0, 5).join('\n'));
} catch (e) {
  console.log('✘ 例外', e.message);
  fail++;
  shotPhone('err');
  console.log(errors.slice(0, 6).join('\n'));
}
await browser.close().catch(() => {});
console.log(`\n通過 ${pass} 項，失敗 ${fail} 項`);
process.exit(fail ? 1 : 0);
