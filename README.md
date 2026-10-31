# 小柯機器人橋牌競賽

3D 合約橋牌。遊戲開發：吳玉柱 先生 與 Claude AI Opus 5.5

## 功能

- **參賽方式**：真人對 AI、AI 對 AI、真人對真人（遠端房間，空位 AI 補上，可語音與文字聊天）
- **AI**：叫牌與首攻用 BEN 神經網路（ONNX，WebAssembly 執行，不用安裝 Python）；打牌用抽樣＋雙明手解算（PIMC）；入門、中級、高手、大師四級
- **AI 軍師**：提示、推估夥伴牌力、接手主位後可換回、中途換軍師；有 Anthropic API 金鑰時用 Claude 白話解說
- **牌譜庫**：每副自動累積，雙明手 20 組結果與 Par、對 Par 的 IMP、條件查詢、重播、逐張分析、PBN 匯入匯出
- **教學**：橋牌教學 12 課、系統說明 8 課，動畫搭配語音講解，含練習題
- **其他**：20 位男性、20 位女性半身照，30 位 AI 軍師；20 首背景音樂；直立音量滑桿；3D 牌室；自動更新

## 下載與線上版

- 首頁：<https://achir1015.github.io/xiaoke-bridge/>（線上版、Windows、Mac、Android）
- iPad／iPhone：<https://achir1015.github.io/xiaoke-bridge/ios/>（用 Safari 開，按一下安裝；限登記過的裝置）

## 開發

```bash
npm install
npm start
npm test
node e2e/smoke.mjs
node e2e/net.mjs
node e2e/real-window.mjs
npm run dist:win
```

素材腳本：`npm run icon`、`npm run portraits`、`npm run music`。

## 架構

- `src/renderer/js/rules.js`：規則、計分、IMP、PBN（畫面、AI、網路共用）
- `src/renderer/js/dds.js`：雙明手解算器（贏牌點位分割的置換表）
- `src/renderer/js/nn.js`、`brain.js`：BEN 模型編碼與 AI 決策
- `src/renderer/js/engine.js`：神經網路 Worker 與解算 Worker 池
- `src/renderer/js/table3d.js`、`cards.js`：3D 牌桌與牌面
- `src/renderer/js/app.js`：比賽流程、遠端房間、牌譜庫、重播

## 授權

GPL-3.0-or-later，第三方元件見 [NOTICE.md](NOTICE.md)。
