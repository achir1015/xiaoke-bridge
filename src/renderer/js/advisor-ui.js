// AI 軍師面板：本機 AI 分析＋（有金鑰時）Claude 白話解說
import { h, uid } from './util.js';
import { SEATS, callName, cardName, handToPbn, contractName, suitOf } from './rules.js';
import { portraitUrl, labelOf } from './portraits.js';

const QUICK = [
  ['該叫／出什麼？', '現在輪到我，該怎麼叫牌或出哪張牌比較好？'],
  ['夥伴有什麼牌？', '從叫牌過程推估，我夥伴大概有幾點、什麼牌型？'],
  ['這手怎麼打？', '請告訴我這副牌的打牌計畫。'],
  ['教我技巧', '有什麼實用的橋牌技巧？請配合目前的牌局說明。'],
];

export class AdvisorPanel {
  // ctx(): { view, mySeat, names, analyze():Promise<{kind,cands?,table?,info?,best}>, showHint(best) }
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.history = [];
    this.busy = null;
    this.hasKey = false;
    this.build();
    xk.advisor.onDelta((d) => { if (this.busy && d.id === this.busy.id) { this.busy.text += d.text; this.busy.el.textContent = this.busy.text; this.scroll(); } });
    xk.advisor.onDone((d) => this.onDone(d));
  }

  setHasKey(v) {
    this.hasKey = v;
    this.modeEl.textContent = v ? '🟢 Claude 軍師（線上）' : '⚪ 離線軍師（本機 AI）';
    this.modeEl.title = v ? '使用 Claude 以白話解說 AI 分析' : '尚未設定 Anthropic API 金鑰，只提供 AI 建議。可到「設定」輸入金鑰。';
  }

  setAdvisor(id) {
    this.avatar.innerHTML = '';
    if (id) { this.avatar.append(h('img', { src: portraitUrl(id), alt: '' })); this.nameEl.textContent = `${labelOf(id)}（AI 軍師）`; }
    else { this.avatar.textContent = '🧙'; this.nameEl.textContent = '小柯軍師'; }
  }

  build() {
    this.modeEl = h('div', { class: 'adv-mode' });
    this.avatar = h('span', { class: 'adv-avatar' }, '🧙');
    this.nameEl = h('b', {}, '小柯軍師');
    this.log = h('div', { class: 'adv-log' });
    this.input = h('textarea', { class: 'adv-input', rows: 2, placeholder: '問軍師，例如：這手該怎麼叫？（Enter 送出）', onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } } });
    this.btnSend = h('button', { class: 'primary', onclick: () => this.send() }, '請教');
    this.root.append(
      h('div', { class: 'adv-head' }, this.avatar, h('div', {}, this.nameEl, this.modeEl)),
      this.log,
      h('div', { class: 'adv-quick' }, QUICK.map(([label, q]) => h('button', { class: 'chip', onclick: () => this.send(q) }, label))),
      h('div', { class: 'adv-send' }, this.input, this.btnSend),
    );
    this.say('ai', '您好！我是您的 AI 軍師。牌局中有任何疑問都可以問我，我會先請 AI 引擎算過叫品機率與每張牌的期望墩數，再告訴您建議和理由。需要時也可以按「軍師接手」讓我上場。');
  }

  reset() {
    this.history = [];
    this.log.innerHTML = '';
    this.say('ai', '新的一副開始了，需要建議隨時叫我！');
  }

  say(who, text) {
    const el = h('div', { class: 'adv-msg ' + who }, text);
    this.log.append(el);
    this.scroll();
    return el;
  }
  scroll() { this.log.scrollTop = this.log.scrollHeight; }

  describe(ana) {
    const { view, mySeat, names } = this.ctx();
    const lines = ['【牌局資訊】'];
    lines.push(`第 ${view.no} 副，${SEATS[view.dealer]}家發牌。您（${names[mySeat] || ''}）坐${SEATS[mySeat]}。`);
    lines.push(`您的手牌（♠.♥.♦.♣）：${handToPbn(view.hands[mySeat] || [])}`);
    lines.push(`叫牌過程（由${SEATS[view.dealer]}家開始）：${view.calls.map(callName).join(' ') || '（尚未開始）'}`);
    if (view.contract) {
      lines.push(`合約：${contractName(view.contract)}，要做成 ${view.contract.level + 6} 墩。南北 ${view.won[0]} 墩、東西 ${view.won[1]} 墩。`);
      const d = (view.contract.declarer + 2) % 4;
      if (view.hands[d] && d !== mySeat) lines.push(`明手（${SEATS[d]}）：${handToPbn(view.hands[d])}`);
      for (const t of view.tricks.slice(-3)) lines.push(`第 ${view.tricks.indexOf(t) + 1} 墩：${t.cards.map((c) => `${SEATS[c.seat]}${cardName(c.card)}`).join(' ')}（${SEATS[t.winner]}贏）`);
      if (view.trick.length) lines.push(`本墩已出：${view.trick.map((c) => `${SEATS[c.seat]}${cardName(c.card)}`).join(' ')}`);
    }
    if (ana) {
      if (ana.info) lines.push(`AI 推估：下家約 ${ana.info.hcp[0].toFixed(0)} 點、夥伴約 ${ana.info.hcp[1].toFixed(0)} 點、上家約 ${ana.info.hcp[2].toFixed(0)} 點；夥伴牌型約 ♠${ana.info.shape[1][0].toFixed(1)} ♥${ana.info.shape[1][1].toFixed(1)} ♦${ana.info.shape[1][2].toFixed(1)} ♣${ana.info.shape[1][3].toFixed(1)}。`);
      if (ana.cands) lines.push('AI 候選叫品（機率）：' + ana.cands.map((c) => `${callName(c.call)} ${(c.p * 100).toFixed(0)}%`).join('、'));
      if (ana.table) lines.push('AI 候選出牌（期望總墩數、做成率）：' + ana.table.slice(0, 5).map((t) => `${cardName(t.card)} ${t.tricks.toFixed(1)} 墩／${(t.make * 100).toFixed(0)}%`).join('、'));
      if (ana.best != null) lines.push(`AI 的建議：${ana.kind === 'bid' ? callName(ana.best) : cardName(ana.best)}`);
    }
    return lines.join('\n');
  }

  offline(ana) {
    const { view, names, mySeat } = this.ctx();
    if (view.phase === 'done') return '這一副已經結束了，可以到「牌譜庫」重播並看雙明手分析喔。';
    const parts = [];
    if (ana && ana.info) parts.push(`從叫牌推估：您的夥伴約 ${ana.info.hcp[1].toFixed(0)} 點，牌型約 ♠${ana.info.shape[1][0].toFixed(0)} ♥${ana.info.shape[1][1].toFixed(0)} ♦${ana.info.shape[1][2].toFixed(0)} ♣${ana.info.shape[1][3].toFixed(0)}。`);
    if (!ana || ana.best == null) { parts.unshift(`現在輪到${SEATS[view.turn]}家，還沒輪到您（${names[mySeat] || ''}）。`); return parts.join('\n'); }
    if (ana.kind === 'bid') {
      parts.unshift(`建議叫 ${callName(ana.best)}。`);
      const alt = ana.cands.filter((c) => c.call !== ana.best).slice(0, 2);
      if (alt.length) parts.push('其他選擇：' + alt.map((c) => `${callName(c.call)}（${(c.p * 100).toFixed(0)}%）`).join('、') + '。');
    } else {
      parts.unshift(`建議出 ${cardName(ana.best)}。`);
      if (ana.table) {
        const t = ana.table.find((x) => x.card === ana.best) || ana.table[0];
        parts.push(`抽樣 ${ana.samples || 0} 種可能的牌局：這張牌平均可拿到 ${t.tricks.toFixed(1)} 墩，合約做成率約 ${(t.make * 100).toFixed(0)}%。`);
        const alt = ana.table.filter((x) => x.card !== ana.best && suitOf(x.card) !== suitOf(ana.best)).slice(0, 2);
        if (alt.length) parts.push('另外可考慮：' + alt.map((x) => `${cardName(x.card)}（${x.tricks.toFixed(1)} 墩）`).join('、') + '。');
      }
    }
    parts.push('（亮綠色的就是建議的牌或叫品）');
    return parts.join('\n');
  }

  async send(q) {
    const question = (q || this.input.value).trim();
    if (!question || this.busy) return;
    const c0 = this.ctx();
    if (!c0.view || c0.mySeat < 0) { this.say('ai', '目前沒有進行中的牌局，開一副之後再問我吧！'); return; }
    this.input.value = '';
    this.say('me', question);
    const pending = this.say('ai thinking', '軍師正在看牌…');
    let ana = null;
    try { ana = await c0.analyze(); } catch (e) { console.warn(e); }
    if (ana && ana.best != null) c0.showHint(ana);
    if (!this.hasKey) {
      pending.classList.remove('thinking');
      pending.textContent = this.offline(ana);
      this.scroll();
      return;
    }
    pending.textContent = '';
    pending.classList.add('streaming');
    const id = uid();
    this.busy = { id, el: pending, text: '', question };
    this.btnSend.textContent = '停止';
    this.btnSend.onclick = () => xk.advisor.cancel(id);
    const userMsg = { role: 'user', content: `${this.describe(ana)}\n\n【我的問題】${question}` };
    this.busy.userMsg = userMsg;
    this.busy.offline = this.offline(ana);
    xk.advisor.ask(id, { messages: [...this.history.slice(-12), userMsg] });
  }

  onDone(d) {
    const b = this.busy;
    if (!b || d.id !== b.id) return;
    this.busy = null;
    this.btnSend.textContent = '請教';
    this.btnSend.onclick = () => this.send();
    b.el.classList.remove('thinking', 'streaming');
    if (d.error) {
      if (d.error === 'cancelled') { b.el.textContent = (b.text || '') + '（已停止）'; return; }
      if (d.error === 'nokey') { this.setHasKey(false); b.el.textContent = b.offline; return; }
      b.el.textContent = `${b.offline}\n\n⚠ ${d.error}`;
      return;
    }
    const text = d.text || b.text;
    b.el.textContent = text + (d.truncated ? '…' : '');
    this.history.push(b.userMsg, { role: 'assistant', content: text });
    this.scroll();
  }
}
