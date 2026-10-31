// Android 更新檢查（除錯版 APK 實機）：node e2e/android-upd.mjs
import { chromium } from 'playwright-core';
import { execFileSync } from 'child_process';
const ADB = process.env.ADB || 'E:/小米觸控音箱/tools/android-sdk/platform-tools/adb.exe';
const SERIAL = process.env.ANDROID_SERIAL || 'R5CY236CQ3B';
const adb = (...a) => execFileSync(ADB, ['-s', SERIAL, ...a], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
const sock = /@?(webview_devtools_remote_\d+)/.exec(adb('shell', 'cat', '/proc/net/unix'));
execFileSync(ADB, ['-s', SERIAL, 'forward', 'tcp:9335', 'localabstract:' + sock[1]]);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9335');
const page = browser.contexts()[0].pages().find((p) => p.url().includes('appassets')) || browser.contexts()[0].pages()[0];
const r = await page.evaluate(() => JSON.parse(window.XiaokeAndroid.checkUpdate()));
console.log(JSON.stringify(r).slice(0, 300));
const res = await fetch(r.url, { method: 'HEAD', redirect: 'follow' });
console.log('APK 下載網址', res.status, res.headers.get('content-length'));
await browser.close();
