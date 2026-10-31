// 小柯機器人橋牌競賽：主控流程（真人對 AI、AI 對 AI、遠端真人、軍師接手、牌譜庫、重播分析）
import { $, $$, h, toast, modal, sleep, errMsg, fmtDate, uid } from './util.js';
import {
  Match, replayBoard, SEATS, SEAT_EN, VULS, STRAINS, STRAIN_SYM, LEVEL_NAME, SUIT_NAME, legalCalls, callName, callSpeech, cardName, contractName,
  sideOf, partner, suitOf, rankOf, isVul, handToPbn, recordToPbn, parsePbn, imps, STRAIN_TO_SUIT,
} from './rules.js';
import { LEVELS, Brain } from './brain.js';
import { NNProxy, DDPool } from './engine.js';
import { Library, boardEntry, isGame } from './kb.js';
import { Table3D, sortForDisplay } from './table3d.js';
import { cardUrl } from './cards.js';
import { Room, PROTOCOL } from './net.js';
import { MusicPlayer } from './music.js';
import { AdvisorPanel } from './advisor-ui.js';
import { sfx, setSfx, setSfxVolume, sfxVolume } from './sfx.js';
import { voice } from './voice.js';
import { loadPortraits, portraitUrl, pickProfile, pickAdvisor, randomProfile, validProfile, labelOf } from './portraits.js';
import { openGuide } from './guide.js';

const APP_NAME = '小柯機器人橋牌競賽';
const CREDIT = '遊戲開發：吳玉柱 先生 與 Claude AI Opus 5.5';
const SPEEDS = [['fast', '快', 350], ['normal', '一般', 900], ['slow', '慢', 1800]];
const LENGTHS = [[4, '4 副'], [8, '8 副'], [12, '12 副'], [16, '16 副'], [24, '24 副']];
const HOLD_MS = 1100;
const DD_LIMIT_MS = 25000;
const TEAM = ['南北', '東西'];
const STRAIN_ORDER = ['C', 'D', 'H', 'S', 'N'];

const S = {
  settings: null, info: null, screen: 'home',
  mode: null,            // ai | net | aivai | replay
  match: null, board: null, matchId: '',
  seats: [],             // [{ name, kind: me|ai|remote, level, profile, left }]
  mySeat: -1,
  proxy: [false, false, false, false],
  view: null, boardNo: 0, boardIdx: 0, boardTotal: 0, total: [0, 0], impTotal: [0, 0], matchOver: false,
  hold: null, aiToken: 0, aiBusy: false, paused: false, aivaiDelay: 900,
  shownResult: '',
  lib: null, brain: null, nn: null, pool: null,
  room: null, net: null,
  history: [],
  voice: { on: false, mic: null, calls: new Map() },
  replay: null,
  hintCall: null,
};

let table, music, advisor;
const newMatchId = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + uid().slice(-6);
const myName = () => S.settings.playerName || '牌手';
const lvName = (i) => LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i))].name;
const isAuthority = () => S.mode === 'ai' || S.mode === 'aivai' || (S.mode === 'net' && S.net && S.net.role === 'host');
const viewSeat = () => (S.mySeat >= 0 ? S.mySeat : 2);
const seatName = (s) => (S.seats[s] ? S.seats[s].name : SEATS[s]);
const seatLabel = (s) => `${SEATS[s]}家${S.seats[s] ? `（${S.seats[s].name}）` : ''}`;

// ---------------- 啟動 ----------------
async function init() {
  S.settings = await xk.settings.get();
  S.info = await xk.sys.info();
  setSfx(S.settings.sfx);
  setSfxVolume(S.settings.sfxVolume ?? 0.8);
  voice.enabled = S.settings.voiceCall !== false;
  await loadPortraits();
  S.lib = new Library(await xk.kb.get());

  // 一進來就啟動 AI 引擎，不需要使用者做任何事
  S.nn = new NNProxy();
  S.pool = new DDPool();
  S.brain = new Brain({ nn: S.nn, pool: S.pool });
  S.nn.ready.catch((e) => { console.error(e); toast('AI 引擎載入失敗：' + errMsg(e), 'err', 8000); });

  table = new Table3D($('#board'), { onCardClick, mobile: !!xk.mobile, touch: !!xk.touch });
  setView(S.settings.view || 'tilt', false);

  music = new MusicPlayer($('#musicPanel'), S.settings, (patch) => saveSettings(patch));
  await music.load();
  if (S.settings.music.autoplay && S.settings.music.enabled !== false) {
    const start = () => { music.play(); document.removeEventListener('pointerdown', start); };
    document.addEventListener('pointerdown', start);
  }
  music.renderState();

  advisor = new AdvisorPanel($('#advisorPanel'), () => ({
    view: S.view, mySeat: S.mySeat, names: S.seats.map((s) => s.name),
    analyze: () => analyzeForMe(), showHint: (a) => showHint(a),
  }));
  advisor.setHasKey(S.settings.advisor.hasKey);
  if (S.settings.profile) advisor.setAdvisor(S.settings.profile.advisor);

  bindUI();
  if (xk.touch) $('.board-tip').textContent = '點一下牌浮起來，再點一次打出．兩指拖曳旋轉．兩指捏合縮放';
  renderHome();
  showScreen('home');
  setInterval(tick, 500);
  tick();
  document.addEventListener('pointerdown', () => sfx.resume(), { once: true });
  window.__xkb = S; // 方便自動化測試
  window.__xkbTable = table;
  window.__xkbApi = { humanAct, myAct, startAIGame, startAIvAI, nextBoard: () => authNextBoard(), openReplayByKey };
  if (!validProfile(S.settings.profile)) await chooseProfile(true);
  if (S.settings.autoUpdate !== false && S.info.packaged && !S.info.profile) setTimeout(() => checkUpdate(false), 5000);
}

async function saveSettings(patch) {
  S.settings = await xk.settings.set(patch);
  return S.settings;
}

async function chooseProfile(required) {
  const pr = await pickProfile(S.settings.profile, { required });
  if (pr) { await saveSettings({ profile: pr }); advisor.setAdvisor(pr.advisor); renderHome(); }
}

// ---------------- 畫面切換 ----------------
function showScreen(name) {
  S.screen = name;
  setDrawer(false);
  $$('.screen').forEach((el) => el.classList.toggle('on', el.id === 'scr-' + name));
  if (name === 'game') setTimeout(() => table.resize(), 30);
  if (name === 'kb') renderKB();
}

function bindUI() {
  $('#btnHome').onclick = () => leaveGame();
  $('#viewTilt').onclick = () => setView('tilt');
  $('#viewTop').onclick = () => setView('top');
  $('#viewLow').onclick = () => setView('low');
  $('#btnHint').onclick = () => hint();
  $('#btnProxy').onclick = () => toggleProxy();
  $('#btnChangeAdv').onclick = () => changeAdvisor();
  $('#btnFast').onclick = () => fastFinish();
  $('#btnPause').onclick = () => togglePause();
  $('#btnNext').onclick = () => onNextClick();
  $('#miniMusic').onclick = () => { selectTab('music'); music.toggle(); if (xk.mobile) setDrawer(true); };
  // 手機：右側面板變成抽屜
  $('#btnDrawer').onclick = () => setDrawer(!document.documentElement.classList.contains('drawer-open'));
  $('#drawerShade').onclick = () => setDrawer(false);
  window.__xkbBack = onBackKey;
  $('#btnSfx').onclick = () => { const on = !S.settings.sfx; setSfx(on); saveSettings({ sfx: on }); renderVolume(); };
  const mv = $('#musicVol');
  mv.oninput = () => { music.cfg.volume = mv.value / 100; music.applyVolume(); music.persist(); };
  const sv = $('#sfxVol');
  sv.oninput = () => { setSfxVolume(sv.value / 100); sfx.select(); clearTimeout(sv._t); sv._t = setTimeout(() => saveSettings({ sfxVolume: sfxVolume() }), 400); };
  renderVolume();
  $$('.tab').forEach((t) => { t.onclick = () => { t.classList.remove('ping'); selectTab(t.dataset.tab); }; });
  $('#chatSend').onclick = () => sendChat();
  $('#chatInput').onkeydown = (e) => { if (e.key === 'Enter') sendChat(); };
  $('#btnVoice').onclick = () => toggleVoice();
  $('#btnMute').onclick = () => toggleMute();
  $('#rpStart').onclick = () => replayGo(0);
  $('#rpPrev').onclick = () => replayGo(S.replay.step - 1);
  $('#rpNext').onclick = () => replayGo(S.replay.step + 1);
  $('#rpPlay').onclick = () => replayAuto();
  $('#rpAna').onclick = () => analyzeReplay();
  document.addEventListener('keydown', (e) => {
    if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (S.mode === 'replay') {
      if (e.key === 'ArrowLeft') replayGo(S.replay.step - 1);
      if (e.key === 'ArrowRight') replayGo(S.replay.step + 1);
    }
  });
}

function renderVolume() {
  $('#musicVol').value = Math.round((music ? music.cfg.volume : 0.45) * 100);
  $('#sfxVol').value = Math.round(sfxVolume() * 100);
  $('#btnSfx').textContent = S.settings.sfx ? '🔔' : '🔕';
}

function setDrawer(on) { document.documentElement.classList.toggle('drawer-open', !!on); }

// Android 返回鍵：先關對話框、抽屜，再離開牌桌；回傳 true 表示已處理
function onBackKey() {
  const back = [...document.querySelectorAll('.modal-back')].pop();
  if (back) { const btns = [...back.querySelectorAll('.modal-btns button')]; (btns.find((b) => !b.classList.contains('primary')) || btns[0])?.click(); return true; }
  if (document.documentElement.classList.contains('drawer-open')) { setDrawer(false); return true; }
  if (S.screen === 'guide') { document.querySelector('.gd-back')?.click(); return true; }
  if (S.screen === 'kb') { showScreen('home'); return true; }
  if (S.screen === 'game') { leaveGame(); return true; }
  return false;
}

function selectTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
  $$('.tabpane').forEach((p) => p.classList.toggle('on', p.id === 'pane-' + name));
}

function setView(v, save = true) {
  table.setView(v);
  $$('.viewbtn').forEach((b) => b.classList.toggle('on', b.id === 'view' + v[0].toUpperCase() + v.slice(1)));
  if (save) saveSettings({ view: v });
}

const WEEK = '日一二三四五六';
function tick() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const el = $('#clock');
  if (el) el.textContent = `西元 ${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日（${WEEK[d.getDay()]}）${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const hc = $('#homeClock');
  if (hc) hc.textContent = el ? el.textContent : '';
}

// ---------------- 首頁 ----------------
function seg(options, value, onPick) {
  const el = h('div', { class: 'seg' }, ...options.map(([v, l]) => h('button', { class: 'segbtn' + (String(v) === String(value) ? ' on' : ''), 'data-v': v, onclick: () => { $$('.segbtn', el).forEach((b) => b.classList.toggle('on', b.dataset.v === String(v))); el.dataset.v = v; onPick && onPick(v); } }, l)));
  el.dataset.v = value;
  return el;
}
const lvSelect = (id, val) => h('select', { class: 'lv', id }, LEVELS.map((l, i) => h('option', { value: i, selected: i === val }, l.name)));
const lenSelect = (id, val) => h('select', { class: 'lv', id }, LENGTHS.map(([v, l]) => h('option', { value: v, selected: v === Number(val) }, l)));

function renderHome() {
  const home = $('#homeBody');
  home.innerHTML = '';
  const pr = S.settings.profile || {};
  const mc = S.settings.match || {};
  const nameInput = h('input', { class: 'name-in', value: myName(), maxLength: 16, onchange: (e) => saveSettings({ playerName: e.target.value.trim() || '牌手' }) });

  const lvA = lvSelect('lvAI', mc.level ?? 2);
  const lenA = lenSelect('lenAI', mc.boards || 8);
  const cardAI = h('div', { class: 'card mode-card' },
    h('div', { class: 'card-icon' }, '🤖'),
    h('h2', {}, 'A　真人對 AI'),
    h('p', { class: 'muted' }, '不需要網路。您坐南家，對面的夥伴與東西兩家都是 AI；AI 軍師隨時在旁指點，也可以接手您的主位。'),
    h('div', { class: 'two-col' }, h('div', {}, h('label', {}, 'AI 難度：'), lvA), h('div', {}, h('label', {}, '副數：'), lenA)),
    h('button', { class: 'primary big', id: 'startAI', onclick: () => {
      const cfg = { level: Number(lvA.value), boards: Number(lenA.value) };
      saveSettings({ match: cfg });
      startAIGame(cfg);
    } }, '開始比賽'));

  const nc = S.settings.netCfg || {};
  const lvB = lvSelect('lvNet', nc.aiLevel ?? 2);
  const lenB = lenSelect('lenNet', nc.boards || 8);
  const codeIn = h('input', { class: 'code-in', id: 'joinCode', placeholder: '輸入 6 位數房號', maxLength: 7, inputMode: 'numeric' });
  const cardNet = h('div', { class: 'card mode-card' },
    h('div', { class: 'card-icon' }, '🌐'),
    h('h2', {}, 'B　真人對真人（遠端）'),
    h('p', { class: 'muted' }, '建立房間、把房號告訴朋友。最多四位真人，空位由 AI 補上；之後加入的人當觀眾。可以語音通話、文字聊天。'),
    h('div', { class: 'two-col' }, h('div', {}, h('label', {}, '空位 AI 難度：'), lvB), h('div', {}, h('label', {}, '副數：'), lenB)),
    h('button', { class: 'primary', id: 'btnHost', onclick: () => { const cfg = { aiLevel: Number(lvB.value), boards: Number(lenB.value) }; saveSettings({ netCfg: cfg }); hostRoom(cfg); } }, '建立房間（我當房主）'),
    h('div', { class: 'net-or' }, '或'),
    h('div', { class: 'net-row' }, codeIn, h('button', { class: 'primary', id: 'btnJoin', onclick: () => joinRoom(codeIn.value) }, '加入房間')),
    h('div', { id: 'netWait', class: 'net-wait hidden' }));

  const av = S.settings.aivai || {};
  const lvNS = lvSelect('aivaiNS', av.ns ?? 2), lvEW = lvSelect('aivaiEW', av.ew ?? 2);
  const speedSel = seg(SPEEDS.map(([v, l]) => [v, l]), av.speed || 'normal');
  const lenC = lenSelect('lenAivai', av.boards || 8);
  const cardAivai = h('div', { class: 'card mode-card' },
    h('div', { class: 'card-icon' }, '🎬'),
    h('h2', {}, 'C　AI 對 AI'),
    h('p', { class: 'muted' }, '坐下來觀戰，四家手牌全部攤開，看 BEN 神經網路怎麼叫、抽樣解算怎麼打。牌譜也會累積到牌譜庫。'),
    h('div', { class: 'two-col' }, h('div', {}, h('label', {}, '南北難度：'), lvNS), h('div', {}, h('label', {}, '東西難度：'), lvEW)),
    h('div', { class: 'two-col' }, h('div', {}, h('label', {}, '每步速度：'), speedSel), h('div', {}, h('label', {}, '副數：'), lenC)),
    h('button', { class: 'primary big', id: 'startAivai', onclick: () => {
      const cfg = { ns: Number(lvNS.value), ew: Number(lvEW.value), speed: speedSel.dataset.v, boards: Number(lenC.value) };
      saveSettings({ aivai: cfg });
      startAIvAI(cfg);
    } }, '開始觀戰'));

  const profileCard = h('div', { class: 'profile-card' },
    h('img', { class: 'pc-avatar', src: portraitUrl(pr.avatar), title: '我的半身照' }),
    h('div', { class: 'pc-mid' },
      h('label', {}, '我的暱稱'), nameInput,
      h('div', { class: 'pc-adv' }, h('img', { src: portraitUrl(pr.advisor) }), h('span', {}, `AI 軍師：${labelOf(pr.advisor) || '未選擇'}`)),
      h('button', { class: 'small', onclick: () => chooseProfile(false) }, '更換半身照與軍師')));

  home.append(
    h('div', { class: 'home-hero' },
      h('img', { class: 'hero-icon', src: '../../build/icon.png', alt: '' }),
      h('div', {}, h('h1', {}, APP_NAME), h('p', { class: 'muted' }, '3D 合約橋牌．BEN 神經網路叫牌．雙明手速算．AI 軍師．遠端連線＋語音'), h('div', { id: 'homeClock', class: 'clock home-clock' })),
      profileCard),
    h('div', { class: 'mode-grid' }, cardAI, cardNet, cardAivai),
    h('div', { class: 'home-links' },
      h('button', { class: 'guide-btn', id: 'btnGuide', onclick: () => openGuide(guideCtx('teach')) }, '🎓 橋牌教學'),
      h('button', { class: 'guide-btn', id: 'btnSysGuide', onclick: () => openGuide(guideCtx('system')) }, '📖 系統說明'),
      h('button', { id: 'btnKB', onclick: () => showScreen('kb') }, '📚 牌譜庫'),
      h('button', { onclick: () => openSettings() }, '⚙ 設定'),
      h('button', { onclick: () => { selectTab('music'); enterIdle(); setDrawer(true); } }, '♫ 背景音樂'),
      h('button', { id: 'btnAbout', onclick: () => openAbout() }, 'ℹ 關於與更新')),
    h('div', { class: 'credit muted small' }, `v${S.info.version}　${CREDIT}`),
  );
  tick();
}

function guideCtx(section) {
  return { section, voice, back: () => { renderHome(); showScreen('home'); }, show: () => showScreen('guide') };
}

function enterIdle() {
  if (!S.mode) {
    document.body.className = 'mode-idle';
    S.view = null;
    $('#turnBanner').textContent = '請回首頁選擇模式';
    $('#seats').innerHTML = '';
    $('#infoBox').innerHTML = '';
    $('#auction').innerHTML = '';
    $('#bidBox').classList.add('hidden');
    table.layout(null);
  }
  showScreen('game');
}

// ---------------- 開局 ----------------
function aiSeat(level, used, n) {
  const p = randomProfile(used);
  used.push(p.avatar, p.advisor);
  return { name: labelOf(p.avatar), kind: 'ai', level, profile: p, robot: true, idx: n };
}
function myProfile() { return S.settings.profile || randomProfile(); }

function setupMatch(mode, seats, mySeat, matchId) {
  S.mode = mode;
  S.seats = seats;
  S.mySeat = mySeat;
  S.proxy = [false, false, false, false];
  S.matchId = matchId || newMatchId();
  S.matchOver = false;
  S.total = [0, 0]; S.impTotal = [0, 0];
  S.history = [];
  S.view = null; S.board = null;
  S.shownResult = '';
  S.paused = false;
  S.aiToken++;
  S.hold = null;
  document.body.className = 'mode-' + mode;
  $('#eventLog').innerHTML = '';
  $('#btnNext').classList.add('hidden');
  $('#btnPause').textContent = '⏸ 暫停';
  $('#btnProxy').textContent = '🧙 軍師接手';
  $('#btnProxy').classList.remove('on');
  advisor.reset();
  if (mySeat >= 0) advisor.setAdvisor(seats[mySeat].profile.advisor);
  showScreen('game');
}

function startAIGame(cfg) {
  const used = [S.settings.profile.avatar, S.settings.profile.advisor];
  const seats = [0, 1, 2, 3].map((s) => (s === 2 ? { name: myName(), kind: 'me', profile: myProfile() } : aiSeat(cfg.level, used, s)));
  setupMatch('ai', seats, 2);
  S.match = new Match({ boards: cfg.boards });
  versus().then(() => authNextBoard());
}

function startAIvAI(cfg) {
  const used = [];
  const seats = [0, 1, 2, 3].map((s) => aiSeat(s % 2 === 0 ? cfg.ns : cfg.ew, used, s));
  setupMatch('aivai', seats, -1);
  S.aivaiDelay = (SPEEDS.find(([v]) => v === cfg.speed) || SPEEDS[1])[2];
  S.match = new Match({ boards: cfg.boards });
  selectTab('log');
  versus().then(() => authNextBoard());
}

async function versus() {
  const wrap = h('div', { class: 'versus' },
    h('h2', {}, '南北 對 東西'),
    h('div', { class: 'vs-row' }, [2, 0, 1, 3].map((s) => {
      const st = S.seats[s];
      return h('div', { class: 'vs-seat' + (s === S.mySeat ? ' me' : '') },
        h('img', { src: portraitUrl(st.profile.avatar) }),
        h('b', {}, `${SEATS[s]}家．${st.name}`),
        h('div', { class: 'vs-adv' }, h('img', { src: portraitUrl(st.profile.advisor) }), `軍師 ${labelOf(st.profile.advisor)}`));
    })));
  $('#boardWrap').append(wrap);
  sfx.shuffle();
  await sleep(S.info.profile ? 200 : 2000);
  wrap.remove();
}

// ---------------- 牌局（持有完整狀態的一方） ----------------
function authNextBoard() {
  if (!S.match || S.match.finished) return;
  S.board = S.match.newBoard();
  S.shownResult = '';
  S.hold = null;
  $('#btnNext').classList.add('hidden');
  table.hint = -1;
  S.hintCall = null;
  advisor.reset();
  S.boardIdx = S.match.index + 1; S.boardTotal = S.match.boards;
  logLine(`── 第 ${S.board.no} 副（${S.boardIdx}/${S.boardTotal}）${SEATS[S.board.dealer]}家發牌，身價：${VULS[S.board.vul]} ──`, 'sys');
  sfx.shuffle();
  applyEvents([], { deal: true });
  schedule();
}

function metaInfo() {
  return {
    boardNo: S.board ? S.board.no : 0, boardIdx: S.boardIdx, boardTotal: S.boardTotal,
    total: S.total, impTotal: S.impTotal, matchOver: S.matchOver, matchId: S.matchId, proxy: S.proxy,
    seats: S.seats.map(({ name, kind, level, profile, left }) => ({ name, kind, level, profile, left })),
  };
}

function viewForAuth() {
  return S.board.view(S.mode === 'aivai' ? 'all' : S.mySeat);
}

function pushStates(ev = [], only) {
  if (S.mode !== 'net' || !S.room || !S.net || S.net.role !== 'host') return;
  const meta = metaInfo();
  for (const m of S.net.members) {
    if (m.id === S.room.myId) continue;
    if (only && m.id !== only) continue;
    S.room.sendTo(m.id, { t: 'state', view: S.board.view(m.seat >= 0 ? m.seat : 'all'), ev, meta });
  }
}

function applyEvents(ev, opts = {}) {
  S.view = viewForAuth();
  S.boardNo = S.board.no;
  handleEvents(ev);
  pushStates(ev);
  renderAll(opts);
}

function isAITurn() {
  const b = S.board;
  if (!b || b.phase === 'done') return false;
  const c = b.controller();
  return S.seats[c].kind === 'ai' || S.proxy[c];
}

// 排程：輪到 AI 就思考，輪到真人就等
function schedule() {
  if (!S.board || !isAuthority()) return;
  if (S.board.phase === 'done') { onBoardOver(); return; }
  if (!isAITurn() || S.paused) return;
  const token = ++S.aiToken;
  runAI(token).catch((e) => { console.error('AI', e); toast('AI 發生錯誤：' + errMsg(e), 'err'); });
}

async function runAI(token) {
  const b = S.board;
  const c = b.controller();
  const lv = S.proxy[c] ? 3 : (S.seats[c].level ?? 2);
  const t0 = Date.now();
  const wait = S.mode === 'aivai' ? S.aivaiDelay : 650;
  const holdLeft = S.hold ? Math.max(0, S.hold.until - t0) : 0;
  let act;
  try {
    await S.nn.ready;
    if (b.phase === 'bidding') {
      const seat = b.turn;
      const r = await S.brain.chooseCall(b.hands[seat], seat, b.calls, b.dealer, b.vul, lv, { bias: S.lib.bias(b.calls, b.dealer, b.hands[seat]) });
      act = { t: 'call', call: r.call };
    } else {
      const r = await S.brain.chooseCard(Brain.stateFrom(b, c), lv);
      act = { t: 'play', card: r.card };
    }
  } catch (e) {
    // 引擎出問題也不能讓牌局停住：出保底的合法動作
    console.error('AI', e);
    if (token !== S.aiToken || S.board !== b) return;
    const l = b.legal();
    act = b.phase === 'bidding' ? { t: 'call', call: 'P' } : { t: 'play', card: l[l.length - 1] };
  }
  const left = Math.max(wait, holdLeft) - (Date.now() - t0);
  if (left > 0) await sleep(left);
  while (S.paused && token === S.aiToken) await sleep(150);
  if (token !== S.aiToken || S.board !== b || b.phase === 'done' || b.controller() !== c) return;
  doAct(c, act);
}

function doAct(seat, a) {
  const ev = S.board.act(seat, a);
  S.aiToken++; // 局面變了，還在思考中的 AI 結果作廢
  applyEvents(ev);
  schedule();
}

function humanAct(seat, a) {
  if (!S.board || S.board.phase === 'done') return false;
  try { doAct(seat, a); return true; } catch (e) { return false; }
}

// 我方出手（不論房主或來賓）
function myAct(a) {
  table.hint = -1; S.hintCall = null;
  if (S.mode === 'net' && S.net.role === 'guest') {
    S.room.send({ t: 'act', a });
    // 先鎖定操作，等房主回傳
    table.setPlayable(new Set());
    $('#bidBox').classList.add('hidden');
    return;
  }
  humanAct(S.mySeat, a);
}

// ---------------- 一副結束 ----------------
async function onBoardOver() {
  const b = S.board;
  if (!b || S.shownResult === b) return;
  S.shownResult = b;
  // 速算：整桌雙明手與 Par
  let dd = null;
  // 極難算的牌不能拖住比賽：超過時限先顯示結果，之後可在牌譜庫補算
  try { dd = await S.pool.table(b.deal, b.vul, b.dealer, DD_LIMIT_MS); } catch (e) { console.warn(e); }
  const par = dd ? dd.par.score : null;
  const rec = S.match.record(b, par);
  if (dd) { rec.dd = dd.table; rec.parC = dd.par.contract; }
  S.total = [...S.match.total]; S.impTotal = [...S.match.impTotal];
  S.matchOver = S.match.finished;
  S.history.push(rec);
  learn(rec);
  const meta = metaInfo();
  if (S.mode === 'net' && S.room) S.room.send({ t: 'board', rec, meta });
  await saveRecord(S.history);
  renderAll();
  if (S.mode !== 'net' || S.net.role === 'host') showBoardResult(rec, meta);
}

function learn(rec) {
  const names = S.seats.map((x) => x.name);
  S.lib.add(boardEntry(rec, { matchId: S.matchId, date: new Date().toISOString(), mode: S.mode, names, mySeat: S.mySeat }));
  S.lib.learnBoard(rec);
  saveLib();
}
function saveLib() { clearTimeout(S._libT); S._libT = setTimeout(() => xk.kb.set(S.lib.toJSON()), 300); }

async function saveRecord(history) {
  if (!history.length) return;
  await xk.games.save({ id: S.matchId, date: new Date().toISOString(), mode: S.mode, names: S.seats.map((x) => x.name), profiles: S.seats.map((x) => x.profile), mySeat: S.mySeat, history, finished: S.matchOver });
}

function handLine(cards) {
  const by = [[], [], [], []];
  for (const c of sortForDisplay(cards, null)) by[suitOf(c)].push(c);
  return h('div', { class: 'res-hand-lines' }, by.map((list, s) => h('div', { class: 'res-suit' + (s === 1 || s === 2 ? ' red' : '') }, h('span', { class: 's' }, '♠♥♦♣'[s]), h('span', {}, list.map((c) => cardName(c).slice(1)).join(' ') || '—'))));
}

function ddTableEl(dd) {
  if (!dd) return null;
  return h('table', { class: 'dd-table' },
    h('tr', {}, h('th', {}, '主打'), STRAIN_ORDER.slice().reverse().map((s) => h('th', {}, STRAIN_SYM[s]))),
    [0, 2, 1, 3].map((d) => h('tr', {}, h('td', {}, SEATS[d]), [4, 3, 2, 1, 0].map((st) => h('td', { class: dd[st][d] >= 7 ? 'ok' : '' }, dd[st][d] >= 7 ? `${dd[st][d] - 6}` : '—')))));
}

function resultBody(rec) {
  const mySide = S.mySeat >= 0 ? sideOf(S.mySeat) : 0;
  const r = rec.result;
  const myScore = mySide === 0 ? r.nsScore : -r.nsScore;
  const compass = h('div', { class: 'res-compass' },
    h('div', { class: 'rc n' }, h('b', {}, seatLabel(0)), handLine(rec.deal[0])),
    h('div', { class: 'rc w' }, h('b', {}, seatLabel(3)), handLine(rec.deal[3])),
    h('div', { class: 'rc c' }, ddTableEl(rec.dd)),
    h('div', { class: 'rc e' }, h('b', {}, seatLabel(1)), handLine(rec.deal[1])),
    h('div', { class: 'rc s' }, h('b', {}, seatLabel(2)), handLine(rec.deal[2])));
  return h('div', { class: 'result' },
    h('div', { class: 'res-final' }, r.text),
    h('div', { class: 'res-score ' + (myScore >= 0 ? 'up' : 'down') }, `南北 ${r.nsScore >= 0 ? '+' : ''}${r.nsScore} 分`),
    rec.par != null ? h('div', { class: 'muted' }, `雙明手最佳（Par）：${rec.parC || ''}，南北 ${rec.par >= 0 ? '+' : ''}${rec.par} 分；對 Par 南北 ${rec.imp >= 0 ? '+' : ''}${rec.imp} IMP`) : null,
    compass);
}

async function showBoardResult(rec) {
  const over = S.matchOver;
  const r = rec.result;
  const mySide = S.mySeat >= 0 ? sideOf(S.mySeat) : -1;
  if (mySide >= 0) { const v = mySide === 0 ? r.nsScore : -r.nsScore; if (v > 0) sfx.win(); else if (v < 0) sfx.lose(); }
  if (S.mode === 'aivai') {
    logLine(`${r.text}，南北 ${r.nsScore} 分${rec.imp != null ? `（對 Par ${rec.imp} IMP）` : ''}`, 'res');
    await sleep(S.aivaiDelay * 3);
    if (S.mode === 'aivai') { if (over) showFinal(); else authNextBoard(); }
    return;
  }
  const canNext = isAuthority();
  const go = await modal(`第 ${rec.no} 副結果`, resultBody(rec), canNext ? [{ label: '先看牌桌', value: false }, { label: over ? '看總成績' : '下一副 ▶', value: true, primary: true }] : [{ label: '關閉', value: false, primary: true }]);
  if (!canNext) return;
  if (go) { if (over) showFinal(); else authNextBoard(); } else { $('#btnNext').classList.remove('hidden'); $('#btnNext').textContent = over ? '看總成績' : '下一副 ▶'; }
}

function onNextClick() {
  $('#btnNext').classList.add('hidden');
  if (S.matchOver) showFinal(); else authNextBoard();
}

async function showFinal() {
  const [ns, ew] = S.total, [ni, ei] = S.impTotal;
  const body = h('div', { class: 'final' },
    h('div', { class: 'res-final' }, ni === ei ? '雙方平手！' : `${ni > ei ? '南北' : '東西'} 獲勝！`),
    h('table', { class: 'dd-table wide' },
      h('tr', {}, h('th', {}, ''), h('th', {}, '南北'), h('th', {}, '東西')),
      h('tr', {}, h('td', {}, '累積得分'), h('td', {}, ns), h('td', {}, ew)),
      h('tr', {}, h('td', {}, 'IMP（對 Par）'), h('td', {}, ni), h('td', {}, ei))),
    h('div', { class: 'muted small' }, `本場 ${S.history.length} 副已存進牌譜庫。`));
  const again = await modal('比賽結束', body, [{ label: '回首頁', value: false }, { label: '再來一場', value: true, primary: true }]);
  if (again && S.mode === 'ai') startAIGame(S.settings.match);
  else if (again && S.mode === 'aivai') startAIvAI(S.settings.aivai);
  else leaveGame(true);
}

// ---------------- 事件：音效、語音、紀錄 ----------------
function handleEvents(evs) {
  for (const e of evs) {
    if (e.e === 'call') {
      sfx.select();
      callout(e.seat, callName(e.call));
      logLine(`${SEATS[e.seat]}：${callName(e.call)}`);
      voice.call(callSpeech(e.call));
    } else if (e.e === 'passout') {
      logLine('四家 Pass，本副不計分', 'res');
    } else if (e.e === 'contract') {
      const c = e.contract;
      logLine(`合約：${contractName(c)}，${SEATS[e.leader]}家首攻`, 'res');
      voice.call(`合約${LEVEL_NAME[c.level]}${{ C: '梅花', D: '方塊', H: '紅心', S: '黑桃', N: '無王' }[c.strain]}，${SEATS[c.declarer]}家主打`, { urgent: false });
    } else if (e.e === 'play') {
      sfx.card();
      S.hold = null;
      logLine(`${SEATS[e.seat]} ${cardName(e.card)}`, 'play');
    } else if (e.e === 'dummy') {
      logLine(`明手（${SEATS[e.seat]}家）攤牌`);
    } else if (e.e === 'trick') {
      logLine(`第 ${e.count} 墩由${SEATS[e.winner]}家贏得（南北 ${e.won[0]}：東西 ${e.won[1]}）`, 'ev-t');
      S.hold = { until: Date.now() + HOLD_MS };
      clearTimeout(S._holdT);
      S._holdT = setTimeout(() => { S.hold = null; renderAll(); }, HOLD_MS);
      setTimeout(() => sfx.gather(), HOLD_MS - 120);
    } else if (e.e === 'claim') {
      logLine(`快轉打完：${SEATS[e.seat]}家這一方再拿 ${e.tricks} 墩`, 'res');
    }
  }
}

function callout(seat, text) {
  const pos = (seat - viewSeat() + 4) % 4;
  const el = h('div', { class: `callout pos${pos}` }, text);
  $('#boardWrap').append(el);
  setTimeout(() => el.remove(), 1500);
}

function logLine(text, cls = '') {
  const log = $('#eventLog');
  if (!log) return;
  log.append(h('div', { class: 'ev ' + cls }, text));
  log.scrollTop = log.scrollHeight;
}

// ---------------- 畫面 ----------------
// 一墩打完先停留一下，看得清楚最後一張
function displayView() {
  const v = S.view;
  if (!v || !S.hold || !v.tricks.length) return v;
  const last = v.tricks[v.tricks.length - 1];
  return { ...v, trick: last.cards, tricks: v.tricks.slice(0, -1), turn: -1 };
}

function renderAll(opts = {}) {
  const dv = displayView();
  const open = S.mode === 'aivai' || S.mode === 'replay' || S.mySeat < 0;
  table.setPlayable(computePlayable(dv));
  table.layout(dv, { viewSeat: viewSeat(), open, deal: opts.deal });
  renderSeats();
  renderInfo();
  renderAuction();
  renderBidBox();
  renderBanner();
  renderScores();
  renderButtons();
}

function myTurnToPlay(v) {
  return v && v.phase === 'play' && S.mySeat >= 0 && v.ctrl === S.mySeat && !S.proxy[S.mySeat] && S.mode !== 'replay' && !S.hold;
}

function computePlayable(v) {
  if (!myTurnToPlay(v)) return new Set();
  const hand = v.hands[v.turn];
  if (!hand) return new Set();
  if (v.trick.length) {
    const s = suitOf(v.trick[0].card);
    const f = hand.filter((c) => suitOf(c) === s);
    if (f.length) return new Set(f);
  }
  return new Set(hand);
}

function onCardClick(card) {
  const v = S.view;
  if (!myTurnToPlay(v)) return;
  if (!computePlayable(v).has(card)) { sfx.illegal(); return; }
  myAct({ t: 'play', card });
}

function renderSeats() {
  const box = $('#seats');
  box.innerHTML = '';
  if (!S.view || !S.seats.length) return;
  const v = S.view;
  for (let s = 0; s < 4; s++) {
    const st = S.seats[s];
    if (!st) continue;
    const pos = (s - viewSeat() + 4) % 4;
    const tags = [];
    tags.push(h('span', { class: 'tag wind' }, SEATS[s]));
    if (v.dealer === s) tags.push(h('span', { class: 'tag dealer' }, '發牌'));
    if (isVul(v.vul, s)) tags.push(h('span', { class: 'tag vul' }, '有身價'));
    if (v.contract && v.contract.declarer === s) tags.push(h('span', { class: 'tag decl' }, '主打'));
    if (v.contract && partner(v.contract.declarer) === s) tags.push(h('span', { class: 'tag' }, '明手'));
    if (st.kind === 'remote') tags.push(h('span', { class: 'tag remote' }, '遠端'));
    if (S.proxy[s]) tags.push(h('span', { class: 'tag proxy' }, '軍師接手'));
    if (st.kind === 'ai' && !S.proxy[s]) tags.push(h('span', { class: 'tag' }, `AI ${lvName(st.level ?? 2)}`));
    box.append(h('div', { class: `seat-card pos${pos}` + (v.turn === s && v.phase !== 'done' ? ' active' : '') + (s === S.mySeat ? ' me' : '') },
      h('div', { class: 'sc-av' }, h('img', { src: portraitUrl(st.profile.avatar) }), h('img', { class: 'sc-sub', src: portraitUrl(st.profile.advisor), title: `軍師：${labelOf(st.profile.advisor)}` })),
      h('div', { class: 'sc-info' }, h('div', { class: 'sc-name' }, st.name), h('div', { class: 'sc-tags' }, tags))));
  }
}

function renderInfo() {
  const box = $('#infoBox');
  const v = S.view;
  box.innerHTML = '';
  if (!v) return;
  const need = v.contract ? v.contract.level + 6 : 0;
  const mySide = S.mySeat >= 0 ? sideOf(S.mySeat) : 0;
  const side = v.contract ? sideOf(v.contract.declarer) : 0;
  box.append(...[
    h('div', { class: 'ib-row' }, h('b', {}, `第 ${v.no} 副`), S.boardTotal ? h('span', { class: 'muted' }, `${S.boardIdx}/${S.boardTotal}`) : null),
    h('div', { class: 'ib-row' }, h('span', { class: 'muted' }, '發牌'), SEATS[v.dealer], h('span', { class: 'muted' }, '身價'), VULS[v.vul]),
    v.contract ? h('div', { class: 'ib-contract' }, contractText(v.contract)) : h('div', { class: 'ib-row muted' }, v.phase === 'bidding' ? '叫牌中' : '四家 Pass'),
    v.contract ? h('div', { class: 'ib-row' }, h('span', { class: 'muted' }, '需要'), `${need} 墩`, h('span', { class: 'muted' }, TEAM[side]), `${v.won[side]} 墩`) : null,
    h('div', { class: 'ib-tricks' }, h('span', { class: mySide === 0 ? 'mine' : '' }, `南北 ${v.won[0]}`), h('span', { class: mySide === 1 ? 'mine' : '' }, `東西 ${v.won[1]}`)),
  ].filter(Boolean));
}

function contractText(c) {
  const red = c.strain === 'H' || c.strain === 'D';
  return h('span', {}, `${c.level}`, h('span', { class: red ? 'red-s' : '' }, STRAIN_SYM[c.strain]), c.doubled === 2 ? 'XX' : c.doubled === 1 ? 'X' : '', h('small', {}, ` ${SEATS[c.declarer]}家`));
}

function callEl(c) {
  if (c === 'P') return h('span', { class: 'cl pass' }, 'Pass');
  if (c === 'X' || c === 'XX') return h('span', { class: 'cl dbl' }, c);
  const red = c[1] === 'H' || c[1] === 'D';
  return h('span', { class: 'cl' }, c[0], h('span', { class: red ? 'red-s' : '' }, STRAIN_SYM[c[1]]));
}

function renderAuction() {
  const box = $('#auction');
  const v = S.view;
  box.innerHTML = '';
  if (!v) return;
  box.classList.toggle('center', v.phase === 'bidding');
  const info = $('#infoBox');
  box.style.top = v.phase === 'bidding' ? '' : `${info.offsetTop + info.offsetHeight + 6}px`;
  const cols = [3, 0, 1, 2]; // 西 北 東 南
  const rows = [];
  const cells = [];
  for (let i = 0; i < cols.indexOf(v.dealer); i++) cells.push(null);
  for (const c of v.calls) cells.push(c);
  if (v.phase === 'bidding') cells.push('?');
  for (let i = 0; i < cells.length; i += 4) rows.push(cells.slice(i, i + 4));
  box.append(h('table', {},
    h('tr', {}, cols.map((s) => h('th', { class: (isVul(v.vul, s) ? 'vul ' : '') + (s === S.mySeat ? 'me' : '') }, SEATS[s]))),
    rows.map((r) => h('tr', {}, [0, 1, 2, 3].map((i) => h('td', {}, r[i] == null ? '' : r[i] === '?' ? h('span', { class: 'cl wait' }, '…') : callEl(r[i])))))));
}

function renderBidBox() {
  const box = $('#bidBox');
  const v = S.view;
  const on = v && v.phase === 'bidding' && v.turn === S.mySeat && !S.proxy[S.mySeat] && S.mode !== 'replay' && S.mySeat >= 0;
  box.classList.toggle('hidden', !on);
  if (!on) { box.innerHTML = ''; return; }
  const legal = new Set(legalCalls(v.calls));
  const hintC = S.hintCall;
  const btn = (c, cls = '') => h('button', { class: `bb ${cls}` + (c === hintC ? ' hint' : ''), 'data-call': c, disabled: !legal.has(c), onclick: () => myAct({ t: 'call', call: c }) }, callEl(c));
  box.innerHTML = '';
  const grid = h('div', { class: 'bb-grid' });
  for (let lv = 1; lv <= 7; lv++) for (const st of STRAIN_ORDER) grid.append(btn(lv + st));
  box.append(grid, h('div', { class: 'bb-row' }, btn('P', 'pass'), btn('X', 'dbl'), btn('XX', 'dbl')));
}

function renderBanner() {
  const b = $('#turnBanner');
  const v = S.view;
  let cls = '', text = '—';
  if (S.mode === 'replay') { cls = 'replay'; text = S.replay ? S.replay.label : '牌譜重播'; }
  else if (S.net && S.mode === 'net' && S.net.status) { cls = 'over'; text = S.net.status; }
  else if (!v) text = '發牌中…';
  else if (v.phase === 'done') { cls = 'over'; text = v.result ? v.result.text : '本副結束'; }
  else if (S.mode === 'aivai') { cls = 'watch'; text = S.paused ? '已暫停' : `${SEATS[v.turn]}家${v.phase === 'bidding' ? '叫牌中' : '出牌中'}`; }
  else if (S.mySeat < 0) { cls = 'watch'; text = '觀戰中'; }
  else if (S.proxy[S.mySeat]) { cls = 'watch'; text = '軍師接手中，隨時可以換回主位'; }
  else if (v.phase === 'bidding') {
    if (v.turn === S.mySeat) { cls = 'mine'; text = '輪到您叫牌'; } else { cls = 'watch'; text = `等待${SEATS[v.turn]}家叫牌`; }
  } else if (v.ctrl === S.mySeat) {
    cls = 'mine';
    text = v.turn === S.mySeat ? '輪到您出牌' : '輪到您替明手出牌';
  } else if (v.contract && partner(v.contract.declarer) === S.mySeat) { cls = 'watch'; text = '您是明手，換您觀牌'; }
  else { cls = 'watch'; text = `換您觀牌，等待${SEATS[v.turn]}家出牌`; }
  const was = b.classList.contains('mine');
  b.className = 'turn-banner ' + cls;
  b.textContent = text;
  if (cls === 'mine' && !was) sfx.turn();
}

function renderScores() {
  const box = $('#scoreBox');
  box.innerHTML = '';
  box.append(
    h('div', { class: 'score-row' }, h('span', {}, ''), h('span', {}, '南北'), h('b', {}, `${S.total[0]} 分／${S.impTotal[0]} IMP`)),
    h('div', { class: 'score-row' }, h('span', {}, ''), h('span', {}, '東西'), h('b', {}, `${S.total[1]} 分／${S.impTotal[1]} IMP`)));
}

function renderButtons() {
  const v = S.view;
  const playing = v && v.phase !== 'done' && S.mode !== 'replay' && S.mySeat >= 0;
  $('#btnHint').disabled = !(playing && (v.turn === S.mySeat || v.ctrl === S.mySeat) && !S.proxy[S.mySeat]);
  $('#btnProxy').disabled = !playing;
  const canFast = v && v.phase === 'play' && isAuthority() && S.mode !== 'net' && !v.trick.length;
  $('#btnFast').disabled = !canFast;
}

// ---------------- 分析、提示 ----------------
function stateFromView(v, seat) {
  return { seat, turn: v.turn, hands: v.hands, counts: v.counts, contract: v.contract, vul: v.vul, calls: v.calls, dealer: v.dealer, trick: v.trick, tricks: v.tricks, won: v.won };
}

async function analyzeForMe() {
  const v = S.view;
  if (!v || S.mySeat < 0 || v.phase === 'done') return null;
  await S.nn.ready;
  const me = S.mySeat;
  const hand = v.hands[me];
  const info = hand ? await S.nn.info(fullHand(v, me), me, v.calls, v.dealer, v.vul).catch(() => null) : null;
  if (v.phase === 'bidding') {
    if (v.turn !== me) return { kind: 'bid', info, best: null };
    const r = await S.brain.chooseCall(hand, me, v.calls, v.dealer, v.vul, 2);
    return { kind: 'bid', cands: r.cands, best: r.call, info };
  }
  if (v.ctrl !== me) return { kind: 'play', info, best: null };
  const r = await S.brain.chooseCard(stateFromView(v, me), 3, { analyze: true });
  return { kind: 'play', table: r.table, best: r.card, samples: r.samples, info };
}

// 叫牌資訊要原始 13 張
function fullHand(v, seat) {
  const played = [];
  for (const t of v.tricks) for (const p of t.cards) if (p.seat === seat) played.push(p.card);
  for (const p of v.trick) if (p.seat === seat) played.push(p.card);
  return [...(v.hands[seat] || []), ...played];
}

async function hint() {
  $('#btnHint').disabled = true;
  try {
    const a = await analyzeForMe();
    if (a && a.best != null) showHint(a);
  } finally { renderButtons(); }
}

function showHint(a) {
  if (a.kind === 'bid') { S.hintCall = a.best; renderBidBox(); } else table.setHint(a.best);
}

// ---------------- 軍師接手 ----------------
function toggleProxy() {
  if (S.mySeat < 0) return;
  const on = !S.proxy[S.mySeat];
  S.proxy[S.mySeat] = on;
  const btn = $('#btnProxy');
  btn.textContent = on ? '🙋 換回主位' : '🧙 軍師接手';
  btn.classList.toggle('on', on);
  logLine(on ? `軍師 ${labelOf(S.seats[S.mySeat].profile.advisor)} 接手主位` : '已換回主位', 'sys');
  if (S.mode === 'net' && S.net.role === 'guest') { S.room.send({ t: 'proxy', on }); renderAll(); return; }
  S.aiToken++;
  pushStates();
  renderAll();
  schedule();
}

async function changeAdvisor() {
  if (S.mySeat < 0) return;
  const st = S.seats[S.mySeat];
  const id = await pickAdvisor(st.profile.advisor);
  if (!id || id === st.profile.advisor) return;
  st.profile = { ...st.profile, advisor: id };
  advisor.setAdvisor(id);
  await saveSettings({ profile: { ...S.settings.profile, advisor: id } });
  logLine(`更換軍師：${labelOf(id)}`, 'sys');
  if (S.mode === 'net') {
    if (S.net.role === 'guest') S.room.send({ t: 'advisor', id });
    else pushStates();
  }
  renderSeats();
}

// 雙方都以最佳打法打完這一副
async function fastFinish() {
  const b = S.board;
  if (!b || b.phase !== 'play' || b.trick.length) return;
  if (!(await modal('快轉打完', '雙方都用雙明手最佳打法打完這一副，直接看結果？', [{ label: '取消', value: false }, { label: '快轉', value: true, primary: true }]))) return;
  if (b.phase !== 'play' || b.trick.length) return;
  S.aiToken++;
  const t = await S.pool.final([{ deal: b.hands, trump: STRAIN_TO_SUIT[b.contract.strain], leader: b.turn }], { deadline: Date.now() + 20000 });
  if (t[0] == null) { toast('這副牌太複雜，算不出來，請繼續打完', 'err'); schedule(); return; }
  const ev = b.claimRest(b.turn, t[0]);
  applyEvents(ev);
  schedule();
}

function togglePause() {
  S.paused = !S.paused;
  $('#btnPause').textContent = S.paused ? '▶ 繼續' : '⏸ 暫停';
  renderBanner();
  if (!S.paused) schedule();
}

// ---------------- 離開 ----------------
async function leaveGame(force = false) {
  if (S.mode === 'replay') { stopReplayAuto(); S.mode = null; document.body.className = ''; showScreen('kb'); return; }
  if (S.mode && !force && S.view && S.view.phase !== 'done' && !S.matchOver) {
    if (!(await modal('離開比賽', '確定要離開這場比賽嗎？已完成的牌都存在牌譜庫了。', [{ label: '繼續比賽', value: false }, { label: '離開', value: true, primary: true }]))) return;
  }
  S.aiToken++;
  S.mode = null; S.board = null; S.view = null; S.match = null;
  closeNet();
  voice.stop();
  document.body.className = '';
  table.layout(null);
  renderHome();
  showScreen('home');
}

// ---------------- 遠端對戰 ----------------
function netWait(content) {
  const w = $('#netWait');
  if (!w) return;
  w.classList.toggle('hidden', !content);
  w.innerHTML = '';
  if (content) w.append(content);
}
function memberOfSeat(s) { return S.net.members.find((m) => m.seat === s); }

function renderLobby() {
  if (!S.net || S.net.started || S.screen !== 'home') return;
  const host = S.net.role === 'host';
  const rows = [];
  for (const s of [2, 0, 1, 3]) {
    const m = memberOfSeat(s);
    rows.push(h('div', { class: 'seat-row' + (m ? '' : ' wait') },
      m && m.profile ? h('img', { class: 'mini-av', src: portraitUrl(m.profile.avatar) }) : h('span', { class: 'mini-av empty' }),
      h('span', { class: 'who' }, `${SEATS[s]}：${m ? m.name : '等待加入…'}`),
      h('span', { class: 'kind' }, m ? (m.id === S.room.myId ? '我' : '遠端') : `開始時由 AI（${lvName(S.net.cfg.aiLevel)}）補位`,
        host && m && m.id !== S.room.myId ? h('button', { class: 'small', title: '換到下一個座位', onclick: () => rotateSeat(m) }, '換位') : null)));
  }
  const watchers = S.net.members.filter((m) => m.seat < 0);
  const content = h('div', {},
    h('div', { class: 'lobby-head' }, h('b', {}, '房號'), h('span', { class: 'muted small' }, `${S.net.cfg.boards || 8} 副`)),
    h('div', { class: 'room-code' }, S.net.code.replace(/(\d{3})(\d{3})/, '$1 $2')),
    h('div', { class: 'seat-list' }, rows),
    watchers.length ? h('div', { class: 'muted small' }, `觀眾：${watchers.map((w) => w.name).join('、')}`) : null,
    host
      ? h('div', { class: 'net-row' },
        h('button', { onclick: () => { navigator.clipboard.writeText(S.net.code); toast('已複製房號', 'ok'); } }, '複製房號'),
        h('button', { onclick: () => { closeNet(); netWait(null); } }, '取消'),
        h('button', { class: 'primary', id: 'btnStartNet', onclick: () => hostStartGame() }, '開始比賽'))
      : h('div', { class: 'net-row' }, h('span', { class: 'muted small spin' }, '等待房主開始…'), h('button', { onclick: () => { closeNet(); netWait(null); } }, '離開')),
    host ? h('div', { class: 'muted small' }, '請把房號告訴朋友，對方在「加入房間」輸入即可。您對面（北）是您的夥伴。') : null);
  netWait(content);
}

function rotateSeat(m) {
  const order = [0, 1, 3];
  const i = order.indexOf(m.seat);
  const next = order[(i + 1) % order.length];
  const other = memberOfSeat(next);
  if (other) other.seat = m.seat;
  m.seat = next;
  for (const x of S.net.members) if (x.id !== S.room.myId) S.room.sendTo(x.id, { t: 'welcome', seat: x.seat });
  broadcastRoster();
}

function renderMembers() {
  const box = $('#memberList');
  if (!box || !S.net || !S.room) return;
  box.innerHTML = '';
  for (const m of S.net.members) {
    box.append(h('span', { class: 'member' + (m.voice ? ' voice' : '') },
      m.profile ? h('img', { src: portraitUrl(m.profile.avatar) }) : null, `${m.name}${m.seat < 0 ? '（觀眾）' : ''}${m.id === S.room.myId ? '（我）' : ''}`));
  }
  const n = S.net.members.filter((m) => m.voice).length;
  $('#voiceState').textContent = S.voice.on ? `🟢 語音中（${n} 人）` : n ? `語音：${n} 人通話中` : '語音：未通話';
}

async function hostRoom(cfg) {
  closeNet();
  netWait(h('span', {}, '正在建立房間…'));
  const room = new Room(S.settings);
  S.room = room;
  try {
    const code = await room.host();
    S.net = { role: 'host', code, cfg, started: false, members: [{ id: room.myId, name: myName(), seat: 2, voice: false, profile: myProfile() }], mySeat: 2 };
    room.on('member-msg', (id, m) => queueNet(() => onHostMsg(id, m)));
    room.on('member-lost', (id, reason) => queueNet(() => onMemberLost(id, reason)));
    room.on('call', (call) => onVoiceCall(call));
    renderLobby();
  } catch (e) {
    netWait(h('span', { class: 'err' }, '建立房間失敗：' + errMsg(e)));
    S.room = null;
  }
}

function broadcastRoster() {
  if (!S.net || S.net.role !== 'host') return;
  S.room.send({ t: 'roster', members: S.net.members.map(({ id, name, seat, voice: vo, profile }) => ({ id, name, seat, voice: vo, profile })), cfg: S.net.cfg, started: S.net.started });
  renderLobby();
  renderMembers();
}

function hostStartGame() {
  if (!S.net || S.net.role !== 'host') return;
  const cfg = S.net.cfg;
  const used = S.net.members.flatMap((m) => (m.profile ? [m.profile.avatar, m.profile.advisor] : []));
  const seats = [0, 1, 2, 3].map((s) => {
    const m = memberOfSeat(s);
    if (!m) return aiSeat(cfg.aiLevel ?? 2, used, s);
    return { name: m.name, kind: s === 2 ? 'me' : 'remote', profile: m.profile || randomProfile(used) };
  });
  S.net.started = true;
  setupMatch('net', seats, 2);
  S.match = new Match({ boards: cfg.boards });
  S.room.send({ t: 'start', meta: metaInfo() });
  broadcastRoster();
  chatSys('比賽開始！');
  versus().then(() => authNextBoard());
}

let netChain = Promise.resolve();
function queueNet(fn) { netChain = netChain.then(fn).catch((e) => console.error('net msg', e)); }

async function onHostMsg(id, m) {
  const mem = S.net.members.find((x) => x.id === id);
  switch (m.t) {
    case 'hello': {
      if (m.ver !== PROTOCOL) { S.room.sendTo(id, { t: 'old', text: '雙方程式版本不同，請先更新到最新版。' }); setTimeout(() => S.room.kick(id), 400); return; }
      const name = String(m.name || '牌手').slice(0, 16);
      const profile = validProfile(m.profile) ? m.profile : null;
      let seat = -1;
      if (!S.net.started) {
        for (const s of [0, 1, 3]) if (!memberOfSeat(s)) { seat = s; break; }
      } else if (S.board && !S.matchOver) {
        // 斷線重連：拿回原本的座位
        const s = S.seats.findIndex((st) => st.kind === 'ai' && st.left && st.leftName === name);
        if (s >= 0 && !memberOfSeat(s)) { seat = s; Object.assign(S.seats[s], { kind: 'remote', left: false, name }); }
      }
      S.net.members.push({ id, name, seat, voice: false, profile });
      S.room.sendTo(id, { t: 'welcome', seat });
      if (S.net.started && S.board) {
        S.room.sendTo(id, { t: 'start', meta: metaInfo() });
        if (seat >= 0) chatSys(`${name} 回來了，接回座位`); else chatSys(`${name} 加入觀戰`);
        pushStates([], id);
        renderAll();
      }
      broadcastRoster();
      break;
    }
    case 'act': {
      if (!mem || mem.seat < 0 || !S.board || S.board.phase === 'done') return;
      if (!humanAct(mem.seat, m.a)) pushStates([], id);
      break;
    }
    case 'proxy':
      if (mem && mem.seat >= 0) {
        S.proxy[mem.seat] = !!m.on;
        chatSys(`${mem.name} ${m.on ? '請軍師接手' : '換回主位'}`);
        S.aiToken++;
        pushStates();
        renderAll();
        schedule();
      }
      break;
    case 'advisor':
      if (mem && mem.seat >= 0) { S.seats[mem.seat].profile = { ...S.seats[mem.seat].profile, advisor: String(m.id) }; pushStates(); renderAll(); }
      break;
    case 'chat': {
      if (!mem) return;
      const text = String(m.text || '').slice(0, 500);
      S.room.send({ t: 'chat', name: mem.name, seat: mem.seat, text }, id);
      chatLine(mem.name, mem.seat, text, false);
      break;
    }
    case 'voice':
      if (mem) { mem.voice = !!m.on; broadcastRoster(); }
      break;
    case 'sync-req':
      pushStates([], id);
      break;
  }
}

function onMemberLost(id, reason) {
  const i = S.net.members.findIndex((x) => x.id === id);
  if (i < 0) return;
  const mem = S.net.members[i];
  S.net.members.splice(i, 1);
  closeCall(id);
  if (S.net.started && mem.seat >= 0 && S.mode === 'net' && !S.matchOver) {
    const st = S.seats[mem.seat];
    Object.assign(st, { kind: 'ai', left: true, leftName: mem.name, level: S.net.cfg.aiLevel ?? 2 });
    chatSys(`${mem.name}${reason}，暫時由 AI 代打`);
    pushStates();
    renderAll();
    schedule();
  } else if (S.screen === 'game') chatSys(`${mem.name} 離開了`);
  broadcastRoster();
}

async function joinRoom(code) {
  closeNet();
  netWait(h('span', {}, '正在連線…'));
  const room = new Room(S.settings);
  S.room = room;
  S.net = { role: 'guest', code: String(code).replace(/\D/g, ''), members: [], started: false, mySeat: -1, cfg: {} };
  room.on('connected', () => room.send({ t: 'hello', name: myName(), ver: PROTOCOL, profile: myProfile() }));
  room.on('msg', (m) => queueNet(() => onGuestMsg(m)));
  room.on('lost', (reason) => {
    if (S.room !== room) return;
    endVoice();
    if (S.screen === 'game' && S.mode === 'net') {
      S.net.status = '⚠ ' + reason + '，比賽中斷';
      chatSys(reason);
      renderAll();
      toast(reason, 'err', 6000);
    } else netWait(h('span', { class: 'err' }, reason));
  });
  room.on('call', (call) => onVoiceCall(call));
  try {
    await room.join(code);
  } catch (e) {
    netWait(h('span', { class: 'err' }, errMsg(e)));
    S.room = null;
    room.close();
  }
}

function applyMeta(meta) {
  S.total = meta.total; S.impTotal = meta.impTotal; S.boardNo = meta.boardNo; S.boardIdx = meta.boardIdx; S.boardTotal = meta.boardTotal; S.matchOver = meta.matchOver;
  if (meta.matchId) S.matchId = meta.matchId;
  S.proxy = meta.proxy.slice();
  S.seats = meta.seats.map((st, s) => ({ ...st, kind: s === S.mySeat ? 'me' : st.kind === 'ai' ? 'ai' : 'remote' }));
}

async function onGuestMsg(m) {
  switch (m.t) {
    case 'full': netWait(h('span', { class: 'err' }, '這個房間人數已滿')); closeNet(); break;
    case 'old': netWait(h('span', { class: 'err' }, m.text || '版本不相容')); toast(m.text || '版本不相容', 'err', 8000); break;
    case 'end':
      if (S.mode === 'net') { S.net.status = '⚠ 房主已關閉房間'; chatSys('房主已關閉房間'); renderAll(); }
      else netWait(h('span', { class: 'err' }, '房主已關閉房間'));
      break;
    case 'welcome': S.net.mySeat = m.seat; renderLobby(); break;
    case 'roster':
      S.net.members = m.members || [];
      S.net.cfg = m.cfg || {};
      renderLobby();
      renderMembers();
      break;
    case 'start': {
      S.net.started = true;
      S.net.status = '';
      const mySeat = S.net.mySeat ?? -1;
      S.mySeat = mySeat;
      applyMeta(m.meta);
      setupMatch('net', S.seats, mySeat, m.meta.matchId);
      netWait(null);
      renderMembers();
      chatSys(mySeat >= 0 ? `比賽開始！您坐${SEATS[mySeat]}家。` : '比賽開始！您是觀眾。');
      xk.win.attention('比賽開始', '');
      if (mySeat >= 0) await versus();
      break;
    }
    case 'state': {
      if (S.mode !== 'net') return;
      const prevNo = S.boardNo;
      applyMeta(m.meta);
      if (S.view && m.view.no !== prevNo) { advisor.reset(); $('#btnNext').classList.add('hidden'); }
      const isNew = !S.view || m.view.no !== S.view.no;
      S.view = m.view;
      if (isNew) sfx.shuffle();
      handleEvents(m.ev || []);
      renderAll({ deal: isNew });
      break;
    }
    case 'board': {
      // 來賓也把每一副存起來、學進牌譜庫
      S.history.push(m.rec);
      applyMeta(m.meta);
      learn(m.rec);
      saveRecord(S.history);
      renderAll();
      showBoardResult(m.rec, m.meta);
      break;
    }
    case 'chat': chatLine(m.name, m.seat, String(m.text || '').slice(0, 500), false); break;
  }
}

function closeNet() {
  endVoice();
  if (S.room) {
    if (S.net && S.net.role === 'host') S.room.send({ t: 'end' });
    S.room.close();
    S.room = null;
  }
  if (S.net) S.net.started = false;
}

// ---------------- 文字聊天 ----------------
function chatLine(name, seat, text, me) {
  const log = $('#chatLog');
  log.append(h('div', { class: 'chat-msg' + (me ? ' me' : '') }, h('b', {}, me ? '我' : `${name}${seat < 0 ? '（觀眾）' : ''}`), h('span', {}, text)));
  log.scrollTop = log.scrollHeight;
  if (!me && !$('#pane-chat').classList.contains('on')) $('.tab[data-tab="chat"]').classList.add('ping');
}
function chatSys(text) {
  const log = $('#chatLog');
  log.append(h('div', { class: 'chat-msg sys' }, text));
  log.scrollTop = log.scrollHeight;
}
function sendChat() {
  const inp = $('#chatInput');
  const text = inp.value.trim();
  if (!text || !S.room || !S.room.connected) return;
  if (S.net.role === 'host') S.room.send({ t: 'chat', name: myName(), seat: S.net.mySeat, text });
  else S.room.send({ t: 'chat', text });
  chatLine(myName(), S.net.mySeat, text, true);
  inp.value = '';
}

// ---------------- 語音通話（多人，兩兩直連） ----------------
async function getMic() {
  await xk.sys.askMicrophone();
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
}
function announceVoice(on) {
  if (!S.net || !S.room) return;
  if (S.net.role === 'host') {
    const me = S.net.members.find((x) => x.id === S.room.myId);
    if (me) me.voice = on;
    broadcastRoster();
  } else S.room.send({ t: 'voice', on });
}
function setVoiceUI() {
  $('#btnVoice').textContent = S.voice.on ? '⏹ 離開語音' : '🎤 加入語音';
  $('#btnMute').classList.toggle('hidden', !S.voice.on);
  $('#voiceBar').classList.toggle('on', S.voice.on);
  if (music) music.setDuck(S.voice.on && S.voice.calls.size > 0);
  renderMembers();
}
async function toggleVoice() {
  if (S.voice.on) { endVoice(); return; }
  if (!S.room || !S.room.connected) { toast('尚未連線', 'err'); return; }
  try { S.voice.mic = await getMic(); } catch (e) { toast('無法開啟麥克風：' + errMsg(e), 'err'); return; }
  S.voice.on = true;
  announceVoice(true);
  for (const m of S.net.members) if (m.voice && m.id !== S.room.myId && !S.voice.calls.has(m.id)) setupCall(m.id, S.room.call(m.id, S.voice.mic));
  setVoiceUI();
  chatSys('您已加入語音通話');
}
function onVoiceCall(call) {
  if (!S.voice.on || !S.voice.mic) { try { call.close(); } catch {} return; }
  if (S.voice.calls.has(call.peer)) closeCall(call.peer);
  call.answer(S.voice.mic);
  setupCall(call.peer, call);
}
function setupCall(id, call) {
  S.voice.calls.set(id, call);
  call.on('stream', (stream) => {
    let a = document.getElementById('aud-' + id);
    if (!a) { a = h('audio', { id: 'aud-' + id, autoplay: true }); $('#remoteAudios').append(a); }
    a.srcObject = stream;
    a.play().catch(() => {});
    setVoiceUI();
  });
  call.on('close', () => { if (S.voice.calls.get(id) === call) closeCall(id); });
  call.on('error', () => { if (S.voice.calls.get(id) === call) closeCall(id); });
}
function closeCall(id) {
  const c = S.voice.calls.get(id);
  S.voice.calls.delete(id);
  if (c) { try { c.close(); } catch {} }
  const a = document.getElementById('aud-' + id);
  if (a) { a.srcObject = null; a.remove(); }
  if (music) setVoiceUI();
}
function toggleMute() {
  if (!S.voice.mic) return;
  const t = S.voice.mic.getAudioTracks()[0];
  t.enabled = !t.enabled;
  $('#btnMute').textContent = t.enabled ? '🔇 靜音' : '🔈 取消靜音';
}
function endVoice() {
  const was = S.voice.on;
  for (const id of [...S.voice.calls.keys()]) closeCall(id);
  if (S.voice.mic) { S.voice.mic.getTracks().forEach((t) => t.stop()); S.voice.mic = null; }
  S.voice.on = false;
  if (was) { announceVoice(false); if (S.screen === 'game') chatSys('已離開語音通話'); }
  if (music) setVoiceUI();
}

// ---------------- 牌譜庫 ----------------
const MODE_NAME = { ai: '真人對 AI', net: '遠端真人', aivai: 'AI 對 AI', import: '匯入' };
const KB = { q: '', result: 'all', kind: 'all', mine: 'all', running: false };

function renderKB() {
  const box = $('#kbBody');
  box.innerHTML = '';
  const t0 = performance.now();
  const list = S.lib.filter(KB).slice().reverse();
  const st = S.lib.stats(S.lib.filter(KB));
  const ms = performance.now() - t0;
  const select = (key, opts) => h('select', { onchange: (e) => { KB[key] = e.target.value; renderKB(); } }, opts.map(([v, l]) => h('option', { value: v, selected: KB[key] === v }, l)));
  const q = h('input', { class: 'kb-q', placeholder: '搜尋合約或牌手，例如 3NT、4S、志豪', value: KB.q, onkeydown: (e) => { if (e.key === 'Enter') { KB.q = e.target.value; renderKB(); } } });
  const stats = [
    [st.total, '累積副數'], [`${(st.makeRate * 100).toFixed(0)}%`, '合約做成率'], [st.games, '成局合約'], [st.slams, '滿貫合約'],
    [st.impBoards ? (st.myImp / st.impBoards).toFixed(1) : '—', '我方每副 IMP（對 Par）'], [`${st.analyzed}/${st.total}`, '已完成雙明手'],
  ];
  const bars = ['N', 'S', 'H', 'D', 'C'].map((k) => {
    const e = st.by[k] || { n: 0, made: 0 };
    const rate = e.n ? e.made / e.n : 0;
    return h('div', { class: 'kb-bar' }, h('span', {}, `${STRAIN_SYM[k]}（${e.n}）`), h('i', { style: { width: `${Math.max(2, rate * 100)}%` } }), h('em', {}, e.n ? `${(rate * 100).toFixed(0)}%` : '—'));
  });
  const progress = h('span', { class: 'muted small', id: 'kbProgress' });
  box.append(
    h('div', { class: 'rec-head' },
      h('div', {}, h('h2', {}, '📚 牌譜庫'), h('p', { class: 'muted small' }, `每副牌自動累積，全部資料查詢 ${ms.toFixed(1)} 毫秒。可以重播、雙明手逐張分析、匯入匯出 PBN。`)),
      h('div', { class: 'rec-actions' },
        h('button', { onclick: () => importPbn() }, '📥 匯入 PBN'),
        h('button', { onclick: () => exportPbn() }, '📤 匯出 PBN'),
        h('button', { id: 'btnBatch', disabled: KB.running, onclick: () => batchAnalyze() }, '⚡ 速算全部雙明手'),
        h('button', { onclick: () => { renderHome(); showScreen('home'); } }, '回首頁'))),
    h('div', { class: 'kb-stats' }, stats.map(([a, b]) => h('div', { class: 'kb-card' }, h('b', {}, a), h('span', {}, b)))),
    h('div', { class: 'kb-grid2' },
      h('div', { class: 'kb-box' }, h('h4', {}, '各花色做成率'), h('div', { class: 'kb-bars' }, bars)),
      h('div', { class: 'kb-box' }, h('h4', {}, '條件查詢'), h('div', { class: 'kb-filter' }, q,
        select('result', [['all', '全部結果'], ['made', '做成'], ['down', '倒約'], ['pass', '四家 Pass']]),
        select('kind', [['all', '全部合約'], ['nt', '無王'], ['major', '高花'], ['minor', '低花'], ['game', '成局'], ['slam', '滿貫']]),
        select('mine', [['all', '不分'], ['decl', '我方主打'], ['def', '我方防守']]),
        h('button', { class: 'primary', onclick: () => { KB.q = q.value; renderKB(); } }, '查詢')), progress)),
    list.length ? h('div', { class: 'rec-wrap' }, h('table', { class: 'rec-table' },
      h('tr', {}, ['日期', '模式', '副', '合約', '主打', '結果', '南北分', 'Par', 'IMP', ''].map((t) => h('th', {}, t))),
      list.slice(0, 400).map((b) => h('tr', {},
        h('td', {}, fmtDate(b.date)), h('td', {}, MODE_NAME[b.mode] || ''), h('td', {}, b.no),
        h('td', { class: b.level ? '' : 'muted' }, b.level ? `${b.level}${STRAIN_SYM[b.st]}${b.dbl === 2 ? 'XX' : b.dbl ? 'X' : ''}` : 'Pass'),
        h('td', {}, b.decl >= 0 ? `${SEATS[b.decl]}${b.names[b.decl] ? `．${b.names[b.decl]}` : ''}` : ''),
        h('td', { class: b.level ? (b.made >= 0 ? 'up' : 'down') : '' }, b.level ? (b.made >= 0 ? (b.made ? `+${b.made}` : '＝') : `${b.made}`) : ''),
        h('td', {}, b.ns), h('td', {}, b.par ?? '—'), h('td', {}, b.imp ?? '—'),
        h('td', { class: 'ops' }, h('button', { onclick: () => openReplayByKey(b.k) }, '重播'), b.m ? h('button', { class: 'danger', title: '刪除這場比賽', onclick: () => deleteMatch(b.m) }, '✕') : null))))) : h('div', { class: 'empty' }, S.lib.boards.length ? '沒有符合條件的牌。' : '還沒有牌譜。打完一副牌就會自動存進來，也可以匯入 PBN。'),
  );
}

async function deleteMatch(id) {
  const n = S.lib.boards.filter((b) => b.m === id).length;
  if (!(await modal('刪除比賽', `要刪除這場比賽的 ${n} 副牌譜嗎？刪除後無法復原。`, [{ label: '取消', value: false }, { label: '刪除', value: true, primary: true }]))) return;
  await xk.games.delete(id);
  S.lib.boards = S.lib.boards.filter((b) => b.m !== id);
  S.lib.keys = new Set(S.lib.boards.map((b) => b.k));
  await xk.kb.set(S.lib.toJSON());
  renderKB();
}

async function loadRecord(key) {
  const [m, no] = key.split('#');
  const g = await xk.games.get(m);
  if (!g) return null;
  const rec = g.history.find((r) => String(r.no) === no);
  return rec ? { g, rec } : null;
}

async function importPbn() {
  const files = await xk.games.pickImport();
  let n = 0;
  for (const f of files) {
    if (f.error || !f.text) continue;
    try {
      const recs = parsePbn(f.text);
      if (!recs.length) continue;
      const matchId = newMatchId();
      for (const r of recs) { r.seed = r.seed ?? 0; r.result = r.result || { nsScore: 0, made: 0, text: '' }; }
      await xk.games.save({ id: matchId, date: new Date().toISOString(), mode: 'import', names: ['', '', '', ''], mySeat: -1, history: recs, finished: true });
      for (const r of recs) if (S.lib.add(boardEntry(r, { matchId, date: new Date().toISOString(), mode: 'import', names: ['', '', '', ''], mySeat: -1 }))) n++;
    } catch (e) { console.warn(e); }
  }
  await xk.kb.set(S.lib.toJSON());
  toast(n ? `已匯入 ${n} 副牌` : '沒有可匯入的牌（要是 PBN 格式）', n ? 'ok' : 'err');
  renderKB();
}

async function exportPbn() {
  const all = await xk.games.all();
  const parts = [];
  for (const g of all) for (const r of g.history || []) { try { parts.push(recordToPbn(r, { date: g.date, names: g.names })); } catch (e) { console.warn(e); } }
  if (!parts.length) { toast('還沒有牌譜可以匯出', 'err'); return; }
  const p = await xk.games.export(`小柯橋牌牌譜-${new Date().toISOString().slice(0, 10)}.pbn`, parts.join('\n'));
  if (p) toast('已匯出到 ' + p, 'ok');
}

// 把所有還沒算過的牌用全部核心做雙明手
async function batchAnalyze() {
  const todo = S.lib.boards.filter((b) => !b.dd);
  if (!todo.length) { toast('全部都算過了', 'ok'); return; }
  KB.running = true;
  renderKB();
  const t0 = performance.now();
  let done = 0;
  const games = new Map();
  await Promise.all(todo.map(async (b) => {
    if (!games.has(b.m)) games.set(b.m, await xk.games.get(b.m));
    const g = games.get(b.m);
    const rec = g && g.history.find((r) => r.no === b.no);
    if (!rec) return;
    const dd = await S.pool.table(rec.deal, rec.vul, rec.dealer, 90000);
    if (!dd) return;
    rec.dd = dd.table; rec.par = dd.par.score; rec.parC = dd.par.contract;
    rec.imp = rec.result ? imps(rec.result.nsScore - rec.par) : null;
    Object.assign(b, { dd: rec.dd, par: rec.par, parC: rec.parC, imp: rec.imp });
    done++;
    const el = $('#kbProgress');
    if (el) el.textContent = `速算中 ${done}/${todo.length}…`;
  }));
  for (const g of games.values()) if (g) await xk.games.save(g);
  await xk.kb.set(S.lib.toJSON());
  KB.running = false;
  const sec = (performance.now() - t0) / 1000;
  renderKB();
  toast(`完成 ${done} 副：共 ${(done * 20)} 組雙明手結果，用了 ${sec.toFixed(1)} 秒（${S.pool.size} 核心）`, 'ok', 6000);
}

// ---------------- 牌譜重播 ----------------
async function openReplayByKey(key) {
  const r = await loadRecord(key);
  if (!r) { toast('找不到這副牌的完整牌譜', 'err'); return; }
  S.mode = 'replay';
  document.body.className = 'mode-replay';
  S.mySeat = r.g.mySeat ?? -1;
  S.seats = [0, 1, 2, 3].map((s) => ({ name: (r.g.names || [])[s] || SEATS[s], kind: 'ai', level: 2, profile: (r.g.profiles || [])[s] || randomProfile() }));
  S.proxy = [false, false, false, false];
  const rec = r.rec;
  S.replay = { rec, step: 0, total: rec.calls.length + rec.plays.length, label: `牌譜重播：第 ${rec.no} 副`, timer: 0, ana: null };
  S.boardTotal = 0;
  S.total = [0, 0]; S.impTotal = [0, 0];
  $('#eventLog').innerHTML = '';
  selectTab('log');
  showScreen('game');
  replayGo(0);
}

function replayGo(step) {
  const R = S.replay;
  if (!R) return;
  R.step = Math.max(0, Math.min(R.total, step));
  const b = replayBoard(R.rec, R.step);
  S.view = b.view('all');
  S.view.deal = null;
  S.hold = null;
  $('#rpInfo').textContent = `第 ${R.step} / ${R.total} 步` + (R.step >= R.total && R.rec.result ? `．${R.rec.result.text}` : '');
  renderAll();
}

function replayAuto() {
  const R = S.replay;
  if (R.timer) { stopReplayAuto(); return; }
  $('#rpPlay').textContent = '⏸ 暫停';
  R.timer = setInterval(() => {
    if (!S.replay || R.step >= R.total) { stopReplayAuto(); return; }
    replayGo(R.step + 1);
  }, 900);
}
function stopReplayAuto() {
  const R = S.replay;
  if (R && R.timer) { clearInterval(R.timer); R.timer = 0; }
  $('#rpPlay').textContent = '▶ 播放';
}

// 逐張雙明手：每一張牌比較「應得」與「實得」
async function analyzeReplay() {
  const R = S.replay;
  const rec = R.rec;
  if (!rec.contract || !rec.plays.length) { toast('這副沒有打牌紀錄', 'err'); return; }
  const btn = $('#rpAna');
  btn.disabled = true;
  const log = $('#eventLog');
  log.innerHTML = '';
  logLine('正在逐張計算雙明手…', 'sys');
  selectTab('log');
  const t0 = performance.now();
  const b = replayBoard(rec, rec.calls.length);
  const tasks = [];
  const meta = [];
  for (const card of rec.plays) {
    tasks.push({ deal: b.hands.map((x) => [...x]), trump: STRAIN_TO_SUIT[b.contract.strain], turn: b.turn, played: b.trick.map((t) => ({ seat: t.seat, card: t.card })) });
    meta.push({ seat: b.turn, card, no: b.tricks.length + 1 });
    b.act(b.controller(), { t: 'play', card });
  }
  const res = await S.pool.moves(tasks, { deadline: Date.now() + 60000 });
  log.innerHTML = '';
  let lostNS = 0, lostEW = 0;
  res.forEach((r, i) => {
    if (!r) return;
    const m = meta[i];
    const best = Math.max(...r.map((x) => x.tricks));
    const got = (r.find((x) => x.card === m.card) || {}).tricks ?? best;
    if (got < best) {
      if (sideOf(m.seat) === 0) lostNS += best - got; else lostEW += best - got;
      logLine(`第 ${m.no} 墩 ${SEATS[m.seat]}家 ${cardName(m.card)}：少 ${best - got} 墩（可出 ${r.filter((x) => x.tricks === best).map((x) => cardName(x.card)).join(' ')}）`, 'ev-loss');
    }
  });
  logLine(`逐張分析完成（${((performance.now() - t0) / 1000).toFixed(1)} 秒）：南北失墩 ${lostNS}、東西失墩 ${lostEW}`, 'res');
  btn.disabled = false;
}

// ---------------- 關於與版本更新 ----------------
async function openAbout() {
  const status = h('div', { class: 'upd-status muted' }, '正在檢查是否有新版本…');
  const body = h('div', { class: 'about' },
    h('div', { class: 'about-head' }, h('img', { class: 'hero-icon small', src: '../../build/icon.png' }),
      h('div', {}, h('h2', {}, APP_NAME), h('div', { class: 'muted' }, `版本 v${S.info.version}　（${{ darwin: 'macOS', win32: 'Windows', android: 'Android', web: '網頁版' }[S.info.platform] || S.info.platform}）`))),
    h('p', { class: 'credit-line' }, CREDIT),
    h('p', { class: 'muted small' }, '3D 合約橋牌：真人對 AI、AI 對 AI、遠端真人（空位 AI 補位、觀戰、語音與文字聊天）；AI 軍師指點與接手主位；牌譜庫（累積、查詢、重播、雙明手速算）；20 首原創背景音樂；橋牌教學與系統說明（動畫與語音）。'),
    h('p', { class: 'muted small' }, '叫牌與首攻使用 BEN 神經網路模型（github.com/lorserker/ben，GPL-3.0）；本程式同樣以 GPL-3.0 授權。'),
    h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: S.settings.autoUpdate !== false, onchange: (e) => saveSettings({ autoUpdate: e.target.checked }) }), ' 開啟程式時自動檢查新版本'),
    status);
  const p = modal('關於與更新', body, [{ label: '關閉', value: false, primary: true }]);
  checkUpdate(true, status);
  await p;
}

async function checkUpdate(manual, statusEl) {
  let info;
  try { info = await xk.update.check(); }
  catch (e) { if (statusEl) statusEl.textContent = '無法檢查更新：' + errMsg(e); return; }
  if (!info.newer) { if (statusEl) statusEl.textContent = `✅ 已經是最新版本（v${info.current}）`; return; }
  const go = () => startUpdate(info);
  if (statusEl) {
    statusEl.innerHTML = '';
    statusEl.append(h('span', {}, `🔔 有新版本 v${info.latest}（目前 v${info.current}）　`),
      h('button', { class: 'primary', id: 'btnDoUpdate', onclick: () => { $$('.modal-back').forEach((b) => b.remove()); go(); } }, '立即更新'));
    return;
  }
  const v = await modal(`發現新版本 v${info.latest}`, h('div', {},
    h('p', {}, `目前版本 v${info.current}，要更新到 v${info.latest} 嗎？`),
    info.notes ? h('pre', { class: 'upd-notes' }, info.notes) : null), [{ label: '稍後再說', value: false }, { label: '立即更新', value: true, primary: true }]);
  if (v) go();
}

async function startUpdate(info) {
  if (info.flavor === 'web') {
    if (await modal('線上版有新版本', h('p', {}, `要重新載入網頁更新到 v${info.latest} 嗎？牌譜和設定都會保留。`), [{ label: '稍後', value: false }, { label: '重新載入', value: true, primary: true }])) location.reload();
    return;
  }
  if (!info.canInstall) {
    const text = info.flavor === 'dev' ? '目前是開發版，請到 GitHub 下載安裝檔。' : info.flavor === 'ios' ? '會用 Safari 開啟 GitHub 安裝頁，按「安裝到這台 iPad／iPhone」就會更新（限開發者登記過的裝置）。' : '找不到這個平台的安裝檔，請到 GitHub 下載。';
    const v = await modal('下載新版本', h('p', {}, text), [{ label: '取消', value: false }, { label: info.flavor === 'ios' ? '開啟安裝頁' : '開啟下載頁', value: true, primary: true }]);
    if (v) xk.update.openPage();
    return;
  }
  const bar = h('div', { class: 'upd-bar' }, h('div', { class: 'upd-fill' }));
  const txt = h('div', { class: 'muted small' }, '準備下載…');
  const box = h('div', { class: 'upd-box' }, h('b', {}, `正在下載 v${info.latest}`), bar, txt);
  document.body.append(box);
  const off = xk.update.onProgress(({ got, total }) => {
    const pct = total ? Math.floor((got / total) * 100) : 0;
    bar.firstChild.style.width = pct + '%';
    txt.textContent = `${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB（${pct}%）`;
  });
  try {
    const file = await xk.update.download();
    off();
    txt.textContent = info.flavor === 'mac' ? '下載完成，正在開啟安裝檔…' : info.flavor === 'android' ? '下載完成，正在開啟安裝畫面…' : '下載完成，正在安裝，程式會自動重新開啟…';
    const r = await xk.update.install(file);
    if (r.manual) {
      box.remove();
      await modal('請完成安裝', h('div', {},
        info.flavor === 'android' ? h('p', {}, '請在 Android 的安裝畫面按「更新」或「安裝」，完成後重新開啟小柯橋牌。') : h('p', {}, '新版安裝檔已開啟（也放在「下載」資料夾）。'),
        info.flavor === 'android' ? null : h('p', {}, info.flavor === 'mac' ? `請先結束本程式，再把「${APP_NAME}」拖到「應用程式」資料夾覆蓋舊版。` : '請依照畫面指示完成安裝。')));
    }
  } catch (e) {
    off();
    box.remove();
    toast('更新失敗：' + errMsg(e), 'err', 8000);
  }
}

// ---------------- 設定 ----------------
async function openSettings() {
  const s = S.settings;
  const f = {};
  const row = (label, el, tip) => h('div', { class: 'set-row' }, h('label', {}, label), el, tip ? h('div', { class: 'muted small' }, tip) : null);
  f.name = h('input', { value: s.playerName });
  f.sfx = h('input', { type: 'checkbox', checked: s.sfx });
  f.voiceCall = h('input', { type: 'checkbox', checked: s.voiceCall !== false });
  f.autoplay = h('input', { type: 'checkbox', checked: s.music.autoplay });
  f.autoUpdate = h('input', { type: 'checkbox', checked: s.autoUpdate !== false });
  f.key = h('input', { type: 'password', placeholder: s.advisor.hasKey ? '（已設定，留空表示不變更）' : 'sk-ant-…' });
  f.model = h('select', {}, ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].map((m) => h('option', { value: m, selected: s.advisor.model === m }, m)));
  f.effort = h('select', {}, [['low', '快速（low）'], ['medium', '一般（medium）'], ['high', '深入（high）']].map(([v, l]) => h('option', { value: v, selected: s.advisor.effort === v }, l)));
  f.srvMode = h('select', {}, h('option', { value: 'public', selected: s.server.mode !== 'custom' }, '公用配對伺服器（PeerJS Cloud）'), h('option', { value: 'custom', selected: s.server.mode === 'custom' }, '自架伺服器'));
  f.host = h('input', { value: s.server.host, placeholder: '例如 peer.example.com' });
  f.port = h('input', { value: s.server.port, type: 'number', style: { width: '90px' } });
  f.path = h('input', { value: s.server.path, style: { width: '90px' } });
  f.secure = h('input', { type: 'checkbox', checked: s.server.secure });
  f.stun = h('textarea', { rows: 2, value: s.stun });
  f.turnUrls = h('input', { value: s.turn.urls, placeholder: 'turn:turn.example.com:3478' });
  f.turnUser = h('input', { value: s.turn.username, placeholder: '帳號' });
  f.turnPass = h('input', { type: 'password', value: s.turn.credential, placeholder: '密碼' });
  const testOut = h('div', { class: 'muted small' });
  const body = h('div', { class: 'settings' },
    h('h4', {}, '一般'),
    row('我的暱稱', f.name),
    row('半身照與軍師', h('button', { onclick: () => chooseProfile(false) }, '更換半身照與 AI 軍師')),
    row('音效', h('label', { class: 'chk' }, f.sfx, ' 出牌、洗牌音效')),
    row('語音報叫', h('label', { class: 'chk' }, f.voiceCall, ' 唸出叫品與合約'), voice.available ? `語音：${voice.voiceName}` : '這台電腦沒有中文語音，無法報叫'),
    row('背景音樂', h('label', { class: 'chk' }, f.autoplay, ' 開啟程式後自動播放')),
    row('版本更新', h('label', { class: 'chk' }, f.autoUpdate, ' 開啟程式時自動檢查新版本')),
    h('h4', {}, 'AI 軍師（Claude）'),
    row('Anthropic API 金鑰', f.key, s.advisor.envKey && !s.advisor.hasKey ? '已偵測到環境變數 ANTHROPIC_API_KEY。' : '金鑰會加密存在本機，只用來呼叫 Claude。沒有金鑰時軍師仍會提供本機 AI 的建議。'),
    row('模型', f.model),
    row('思考深度', f.effort),
    h('div', { class: 'set-row' }, h('label', {}, ''), h('button', { onclick: async () => { testOut.textContent = '測試中…'; await applySettings(f); const r = await xk.advisor.test(); testOut.textContent = r.ok ? `✅ ${r.text}` : `❌ ${r.error}`; } }, '測試金鑰'), testOut),
    h('h4', {}, '遠端連線'),
    row('配對伺服器', f.srvMode),
    row('自架伺服器', h('div', { class: 'inline' }, f.host, f.port, f.path, h('label', { class: 'chk' }, f.secure, ' HTTPS'))),
    row('STUN', f.stun),
    row('TURN（跨網路連不上時）', h('div', { class: 'inline' }, f.turnUrls, f.turnUser, f.turnPass)),
    h('h4', {}, '版本'),
    h('div', { class: 'set-row' }, h('label', {}, `目前 v${S.info.version}`), h('button', { onclick: () => { $$('.modal-back').forEach((b) => b.remove()); openAbout(); } }, '檢查更新')),
    h('p', { class: 'credit-line small' }, `${APP_NAME} v${S.info.version}．${CREDIT}`),
  );
  const ok = await modal('設定', body, [{ label: '取消', value: false }, { label: '儲存', value: true, primary: true }]);
  if (ok) { await applySettings(f); toast('設定已儲存', 'ok'); renderHome(); }
}

async function applySettings(f) {
  const patch = {
    playerName: f.name.value.trim() || '牌手',
    sfx: f.sfx.checked,
    voiceCall: f.voiceCall.checked,
    autoUpdate: f.autoUpdate.checked,
    music: { autoplay: f.autoplay.checked },
    advisor: { model: f.model.value, effort: f.effort.value },
    server: { mode: f.srvMode.value, host: f.host.value.trim(), port: Number(f.port.value) || 9000, path: f.path.value.trim() || '/', secure: f.secure.checked },
    stun: f.stun.value,
    turn: { urls: f.turnUrls.value.trim(), username: f.turnUser.value.trim(), credential: f.turnPass.value },
  };
  if (f.key.value.trim()) patch.advisor.apiKey = f.key.value.trim();
  await saveSettings(patch);
  f.key.value = '';
  setSfx(S.settings.sfx);
  voice.enabled = S.settings.voiceCall !== false;
  advisor.setHasKey(S.settings.advisor.hasKey);
  renderVolume();
}

window.addEventListener('beforeunload', () => { closeNet(); });
init().catch((e) => { console.error(e); document.body.append(h('pre', { class: 'fatal' }, '啟動失敗：' + (e.stack || e))); });

export { SUIT_NAME, rankOf, handToPbn, cardUrl, SEAT_EN, isGame, isVul };
