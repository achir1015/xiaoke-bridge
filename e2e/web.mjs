// 線上版測試（Edge 無頭模式）：SITE=網址 node e2e/web.mjs
import { chromium } from 'playwright-core';

const SITE = process.env.SITE || 'https://achir1015.github.io/xiaoke-bridge/';
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const waitFor = async (fn, arg, ms = 60000) => { const t = Date.now(); for (;;) { const v = await page.evaluate(fn, arg).catch(() => false); if (v) return v; if (Date.now() - t > ms) throw new Error('等待逾時：' + fn); await new Promise((r) => setTimeout(r, 200)); } };

await page.goto(SITE, { waitUntil: 'domcontentloaded' });
check('首頁可開', (await page.title()).includes('橋牌'));
await page.waitForTimeout(1500);
const links = await page.evaluate(() => ({ win: document.querySelector('#dl-win').href, apk: document.querySelector('#dl-apk').href, ver: document.querySelector('#ver').textContent }));
console.log('  ', JSON.stringify(links));
check('Windows 下載連到安裝檔', /win-x64\.exe$/.test(links.win) || /releases\/latest$/.test(links.win));

const r = await page.evaluate(async (base) => {
  const t = await (await fetch(base + 'ios/manifest.plist', { cache: 'no-store' })).text();
  const v = await (await fetch(base + 'online/version.json', { cache: 'no-store' })).json();
  return { bundle: /<key>bundle-version<\/key>\s*<string>([^<]+)/.exec(t)?.[1], id: /com\.achir\.xiaokebridge/.test(t), ipa: /releases\/latest\/download\/xiaoke-bridge-ios\.ipa/.test(t), web: v.version };
}, SITE);
console.log('  ', JSON.stringify(r));
check('iPad／iPhone 安裝頁 manifest 正確', r.bundle === r.web && r.id && r.ipa);

await page.goto(SITE + 'ios/', { waitUntil: 'domcontentloaded' });
check('iPad／iPhone 安裝按鈕是 itms-services', await page.evaluate(() => /^itms-services:/.test(document.querySelector('a.btn').href)));

await page.goto(SITE + 'online/', { waitUntil: 'domcontentloaded' });
await waitFor(() => window.__xkb && window.__xkbTable);
check('線上版載入', true);
check('線上版 AI 模型載入', await waitFor(() => window.__xkb.nn.ready.then(() => true)));
await page.evaluate(() => { document.querySelectorAll('.pf-pane')[0].querySelector('.pf-item').click(); document.querySelectorAll('.pf-pane')[2].querySelector('.pf-item').click(); document.querySelector('.pf-ok').click(); });
check('線上版有 20 首音樂', (await page.evaluate(() => window.xk.music.list().then((l) => l.length))) === 20);
const up = await page.evaluate(async () => { const a = await window.xk.update.check(); window.XKB_VERSION = '0.9.0'; const b = await window.xk.update.check(); return { a, b }; });
check('線上版是最新時不提示', up.a.newer === false && up.a.flavor === 'web', JSON.stringify(up.a));
check('線上版舊版會發現新版本', up.b.newer === true, JSON.stringify(up.b));
await page.evaluate(() => { document.querySelector('#lenAI').value = '4'; document.querySelector('#lvAI').value = '0'; document.querySelector('#startAI').click(); });
await waitFor(() => window.__xkb.mode === 'ai' && window.__xkb.view);
const played = await waitFor(() => { const v = window.__xkb.view; return v.phase === 'bidding' && !document.querySelector('#bidBox').classList.contains('hidden'); });
check('線上版可以開局叫牌', !!played);
await page.evaluate(() => document.querySelector('#bidBox [data-call="P"]').click());
await waitFor(() => window.__xkb.view.calls.length >= 3 || window.__xkb.view.phase !== 'bidding');
check('線上版 AI 會叫牌', true);
check('沒有錯誤', errors.filter((e) => !/favicon|manifest|404|403/.test(e)).length === 0, errors.slice(0, 5).join('\n'));

// iPad／iPhone 的更新：模擬 iOS 橋接，舊版要導向 GitHub 安裝頁；API 被限流時改讀 manifest.plist
const ios = await ctx.newPage();
await ios.addInitScript(() => {
  window.XiaokeIOS = true;
  window.__opened = [];
  window.webkit = { messageHandlers: { xkb: { postMessage: async (m) => { if (m.cmd === 'open_url') window.__opened.push(m.args[0]); return { status: 'ok', version: '0.9.0' }; } } } };
});
await ios.goto(SITE + 'online/', { waitUntil: 'domcontentloaded' });
await ios.waitForFunction(() => window.xk && window.XKB_VERSION);
const iu = await ios.evaluate(async () => {
  window.XKB_VERSION = '0.9.0';
  const i = await window.xk.update.check();
  await window.xk.update.openPage();
  return { newer: i.newer, latest: i.latest, flavor: i.flavor, page: i.page, canInstall: i.canInstall, opened: window.__opened };
});
console.log('  ', JSON.stringify(iu));
check('iPad／iPhone 舊版會發現新版本', iu.newer && iu.flavor === 'ios');
check('iPad／iPhone 更新開 GitHub 安裝頁', iu.opened[0] === SITE + 'ios/', iu.opened[0]);
await browser.close();
console.log(`\n通過 ${pass} 項，失敗 ${fail} 項`);
process.exit(fail ? 1 : 0);
