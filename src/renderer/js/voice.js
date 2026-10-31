// 中文語音：報牌、喊吃碰槓胡，以及遊戲說明朗讀
// 桌面版用系統 speechSynthesis；Android App 的 WebView 沒有網頁語音，改用手機原生的文字轉語音（window.xk.tts）
class Voice {
  constructor() {
    this.voice = null;
    this.enabled = true;
    this.rate = 1.05;
    if ('speechSynthesis' in window) {
      speechSynthesis.addEventListener('voiceschanged', () => this.pick());
      let n = 0;
      const poll = () => { if (this.voice || ++n > 30) return; this.pick(); setTimeout(poll, 200); };
      poll();
    }
  }

  pick() {
    if (!('speechSynthesis' in window)) return;
    const vs = speechSynthesis.getVoices();
    const pref = [/Yating/i, /Hanhan/i, /Mei-?Jia/i, /Zhiwei/i];
    this.voice = pref.map((re) => vs.find((v) => re.test(v.name))).find(Boolean)
      || vs.find((v) => /zh[-_]TW/i.test(v.lang)) || vs.find((v) => /zh[-_]HK/i.test(v.lang)) || vs.find((v) => /^zh/i.test(v.lang)) || null;
  }

  get native() { return (window.xk && window.xk.tts) || null; }
  get available() { if (this.native) return this.native.available(); if (!this.voice) this.pick(); return 'speechSynthesis' in window && !!this.voice; }
  get voiceName() { if (this.native) return this.native.voiceName(); return this.voice ? this.voice.name : ''; }

  stop() { if (this.native) this.native.stop(); else if ('speechSynthesis' in window) speechSynthesis.cancel(); }

  // 牌桌上的短語：不排隊，太多就跳過舊的
  call(text, { pitch = 1, rate = 1.15, urgent = false } = {}) {
    if (!this.enabled || !this.available) return;
    if (this.native) { this.native.speak(text, rate); return; }
    if (urgent || speechSynthesis.pending) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = this.voice; u.lang = this.voice.lang; u.pitch = pitch; u.rate = rate; u.volume = 1;
    speechSynthesis.speak(u);
  }

  // 說明朗讀：說完才 resolve；沒有語音時依字數等待
  speak(text) {
    const plain = String(text).replace(/[「」（）()【】]/g, ' ');
    if (!this.available) return new Promise((r) => setTimeout(r, Math.min(9000, 600 + plain.length * 160)));
    if (this.native) return this.native.speak(plain, this.rate);
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(plain);
      u.voice = this.voice; u.lang = this.voice.lang; u.rate = this.rate; u.pitch = 1;
      let done = false;
      const end = () => { if (!done) { done = true; clearTimeout(t); resolve(); } };
      const t = setTimeout(end, 4000 + plain.length * 300);
      u.onend = end; u.onerror = end;
      speechSynthesis.speak(u);
    });
  }
}

export const voice = new Voice();
