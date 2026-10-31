// 用真實視窗（最大化、不模擬尺寸）檢查版面：node e2e/real-window.mjs
// 使用者螢幕縮放 210%，視窗內容只有約 915×473，版面問題只有這樣才看得到
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
fs.mkdirSync('e2e/out', { recursive: true });
const app = await electron.launch({ executablePath: require('electron'), args: ['.', '--profile=e2eReal'] });
const win = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.maximize(); });
await win.waitForSelector('#homeBody .mode-grid');
const capture = async (name) => { const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')); fs.writeFileSync(`e2e/out/${name}.png`, Buffer.from(b64, 'base64')); };
await win.waitForTimeout(900);
const info = await win.evaluate(() => ({ dpr: devicePixelRatio, inner: [innerWidth, innerHeight], doc: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] }));
const wb = await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows()[0]; return { content: w.getContentSize(), zoom: w.webContents.getZoomFactor(), wa: screen.getPrimaryDisplay().workAreaSize, scale: screen.getPrimaryDisplay().scaleFactor }; });
console.log(JSON.stringify({ ...info, ...wb }));
await win.evaluate(() => {
  const m = document.querySelector('.modal .pf');
  if (m) { document.querySelectorAll('.pf-pane')[0].querySelector('.pf-item').click(); document.querySelectorAll('.pf-pane')[2].querySelector('.pf-item').click(); document.querySelector('.pf-ok').click(); }
});
await win.waitForTimeout(500);
await capture('real-home');
await win.click('#btnGuide');
await win.waitForTimeout(1500);
await capture('real-guide');
await win.click('.gd-back');
await win.evaluate(() => document.querySelector('#lvAI').value = '0');
await win.click('#startAI');
// 等到輪到我叫牌（或打牌）
for (let i = 0; i < 80; i++) { if (await win.evaluate(() => !document.querySelector('#bidBox').classList.contains('hidden') || window.__xkb.view?.phase === 'play')) break; await win.waitForTimeout(200); }
await win.waitForTimeout(900);
const bad = await win.evaluate(() => {
  const vw = innerWidth, vh = innerHeight, out = [];
  for (const sel of ['.topbar', '.right', '.board-wrap', '#bidBox', '#auction', '#infoBox', '.table-btns']) {
    const e = document.querySelector(sel); if (!e) continue;
    const r = e.getBoundingClientRect();
    if (r.width && (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1)) out.push(`${sel} ${[r.left, r.top, r.right, r.bottom].map(Math.round)}`);
  }
  return { vw, vh, out };
});
console.log('版面超出畫面：', JSON.stringify(bad));
await capture('real-bid');
// 請 AI 代叫到打牌階段
await win.evaluate(() => document.querySelector('#btnProxy').click());
for (let i = 0; i < 300; i++) { if (await win.evaluate(() => window.__xkb.view?.tricks.length >= 2)) break; await win.waitForTimeout(200); }
await win.evaluate(() => document.querySelector('#btnProxy').click());
await win.waitForTimeout(1500);
await capture('real-play');
await app.close();
