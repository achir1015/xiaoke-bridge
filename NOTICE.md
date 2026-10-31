# 第三方元件與授權

本程式以 **GPL-3.0-or-later** 授權（見 LICENSE），因為內含 BEN 的模型並移植了它的輸入編碼。

| 元件 | 用途 | 授權 |
| --- | --- | --- |
| [BEN](https://github.com/lorserker/ben)（Lorand Dali 等） | `assets/models/*.onnx` 叫牌、推估、首攻模型；`nn.js` 的編碼移植自 `src/binary.py`、`src/bidding/binary.py` | GPL-3.0 |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) | 在 WebAssembly 上執行模型 | MIT |
| [three.js](https://threejs.org) | 3D 牌桌 | MIT |
| [PeerJS](https://peerjs.com) | 遠端連線 | MIT |
| [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript) | AI 軍師 | MIT |
| [Electron](https://www.electronjs.org) | 桌面程式框架 | MIT |

雙明手解算器 `dds.js` 參考 [DDS](https://github.com/dds-bridge/dds)（Bo Haglund、Soren Hein，Apache-2.0）公開的演算法思路，程式碼為本專案自行撰寫。

背景音樂、半身照、牌面與程式圖示皆由本專案的腳本原創產生（`scripts/`）。
