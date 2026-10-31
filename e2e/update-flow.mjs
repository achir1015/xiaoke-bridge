// 版本更新實測：用舊版免安裝檔開啟 → 自動找到新版 → 下載 → 安裝（換成新版並重新開啟）
// 用法：node e2e/update-flow.mjs <舊版 win-unpacked\XiaokeBridge.exe>
// （免安裝版 exe 是自解壓外殼，測試工具連不上，所以用解壓版並設定 PORTABLE_EXECUTABLE_FILE 模擬）
import { _electron as electron } from 'playwright-core';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFileSync } from 'child_process';

// 用法加 MISSING=1：模擬免安裝版原本的資料夾已被刪除
const MISSING = !!process.env.MISSING;
const started = new Date();
// 免安裝版會再開一個解壓後的內層程序，整組都要關掉，不然視窗會留在使用者螢幕上
function closeSpawned() {
  const ps = `$t=[datetime]'${started.toISOString()}'; Get-CimInstance Win32_Process -Filter "Name like 'XiaokeBridge%'" | Where-Object { $_.CreationDate -gt $t -and $_.ExecutablePath -notmatch 'dist-test' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
}

const src = process.argv[2];
const dir = path.join(os.tmpdir(), 'xkm-update-test');
fs.rmSync(dir, { recursive: true, force: true });
if (!MISSING) fs.mkdirSync(dir, { recursive: true });
const exe = src;
const fakePortable = path.join(dir, 'XiaokeBridge-old-win-x64-portable.exe');

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };
const app = await electron.launch({ executablePath: exe, args: ['--profile=e2eUpd'], env: { ...process.env, PORTABLE_EXECUTABLE_FILE: fakePortable } });
const win = await app.firstWindow();
let info = null;
try {
  await win.waitForSelector('#startAI', { timeout: 60000 });
  await win.evaluate(() => document.querySelectorAll('.modal-back').forEach((b) => b.remove()));
  info = await win.evaluate(() => window.xk.update.check());
  console.log(`目前 v${info.current}，最新 v${info.latest}，版本類型 ${info.flavor}，檔案 ${info.asset && info.asset.name}`);
  check('舊版會發現新版本', info.newer);
  check('找到免安裝版的新檔案', info.asset && /portable\.exe$/.test(info.asset.name), JSON.stringify(info.asset));
  check('打包版可以直接安裝', info.canInstall);
  // 畫面上的「關於與更新」
  await win.click('#btnAbout');
  await win.waitForSelector('#btnDoUpdate', { timeout: 20000 });
  check('「關於與更新」顯示「立即更新」按鈕', true);
  await win.screenshot({ path: 'e2e/out/upd-1-found.png' });
  // 下載
  const t0 = Date.now();
  const file = await win.evaluate(() => window.xk.update.download());
  const size = fs.statSync(file).size;
  check('新版下載完成', size > 100 * 1048576 && (!info.asset.size || size === info.asset.size), `${size} / ${info.asset.size}`);
  console.log(`下載 ${(size / 1048576).toFixed(1)} MB，用了 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
  // 安裝：免安裝版會把新檔放到同一資料夾並開啟、舊版結束
  const r = await win.evaluate((f) => window.xk.update.install(f), file).catch((e) => ({ err: String(e) }));
  check('安裝後舊版自動結束', !!(r && r.quitting) || /closed/i.test(r.err || ''), JSON.stringify(r));
  await new Promise((res) => setTimeout(res, 3000));
  const dl = path.join(os.homedir(), 'Downloads', info.asset.name);
  const newFile = MISSING ? dl : path.join(dir, info.asset.name);
  check(MISSING ? '原資料夾不見時改放到「下載」' : '新版檔案已放到原本的資料夾', fs.existsSync(newFile), newFile);
} catch (e) {
  fail++; console.log('✘ 例外：', e.message);
} finally {
  await app.close().catch(() => {});
  await new Promise((res) => setTimeout(res, 2500));
  closeSpawned();
  await new Promise((res) => setTimeout(res, 800));
  if (MISSING && info) fs.rmSync(path.join(os.homedir(), 'Downloads', info.asset.name), { force: true });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n通過 ${pass}，失敗 ${fail}`);
  process.exit(fail ? 1 : 0);
}
