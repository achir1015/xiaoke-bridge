// 撲克牌牌面（Canvas 即時繪製，3D 貼圖與畫面小牌共用）
import { suitOf, rankOf, RANKS, SUITS } from './rules.js';

export const CW = 300, CH = 420;
const RED = '#c8102e', BLACK = '#14161f', GOLD = '#d9a93c';
const rankText = (r) => (RANKS[r] === 'T' ? '10' : RANKS[r]);
const SUIT_FONT = '"Segoe UI Symbol","Apple Symbols","Noto Sans Symbols",sans-serif';
const FACE_FONT = 'Georgia,"Times New Roman",serif';

// 向量花色：字型不同時也一致
function suitPath(c, s, x, y, size) {
  c.save();
  c.translate(x, y);
  c.scale(size / 100, size / 100);
  c.beginPath();
  if (s === 1) { // ♥
    c.moveTo(0, 42);
    c.bezierCurveTo(-58, 2, -50, -44, -20, -44);
    c.bezierCurveTo(-8, -44, 0, -34, 0, -24);
    c.bezierCurveTo(0, -34, 8, -44, 20, -44);
    c.bezierCurveTo(50, -44, 58, 2, 0, 42);
  } else if (s === 2) { // ♦
    c.moveTo(0, -48);
    c.quadraticCurveTo(18, -22, 38, 0);
    c.quadraticCurveTo(18, 22, 0, 48);
    c.quadraticCurveTo(-18, 22, -38, 0);
    c.quadraticCurveTo(-18, -22, 0, -48);
  } else if (s === 0) { // ♠
    c.moveTo(0, -46);
    c.bezierCurveTo(14, -24, 48, -4, 42, 18);
    c.bezierCurveTo(38, 34, 16, 36, 6, 20);
    c.quadraticCurveTo(8, 36, 16, 46);
    c.lineTo(-16, 46);
    c.quadraticCurveTo(-8, 36, -6, 20);
    c.bezierCurveTo(-16, 36, -38, 34, -42, 18);
    c.bezierCurveTo(-48, -4, -14, -24, 0, -46);
  } else { // ♣
    c.arc(0, -22, 22, 0, Math.PI * 2);
    c.moveTo(-1, 2);
    c.arc(-23, 8, 22, 0, Math.PI * 2);
    c.moveTo(45, 8);
    c.arc(23, 8, 22, 0, Math.PI * 2);
    c.moveTo(-7, 8);
    c.quadraticCurveTo(-5, 34, -16, 46);
    c.lineTo(16, 46);
    c.quadraticCurveTo(5, 34, 7, 8);
  }
  c.closePath();
  c.fill();
  c.restore();
}

const PIPS = {
  1: [[.5, .5]],
  2: [[.5, .2], [.5, .8]],
  3: [[.5, .2], [.5, .5], [.5, .8]],
  4: [[.3, .2], [.7, .2], [.3, .8], [.7, .8]],
  5: [[.3, .2], [.7, .2], [.5, .5], [.3, .8], [.7, .8]],
  6: [[.3, .2], [.7, .2], [.3, .5], [.7, .5], [.3, .8], [.7, .8]],
  7: [[.3, .2], [.7, .2], [.5, .35], [.3, .5], [.7, .5], [.3, .8], [.7, .8]],
  8: [[.3, .2], [.7, .2], [.5, .35], [.3, .5], [.7, .5], [.5, .65], [.3, .8], [.7, .8]],
  9: [[.3, .18], [.7, .18], [.3, .39], [.7, .39], [.5, .5], [.3, .61], [.7, .61], [.3, .82], [.7, .82]],
  10: [[.3, .18], [.7, .18], [.5, .28], [.3, .39], [.7, .39], [.3, .61], [.7, .61], [.5, .72], [.3, .82], [.7, .82]],
};

function roundRectPath(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// 人頭牌：幾何化的皇冠半身，上下對稱
function courtFigure(c, r, s, color) {
  const x0 = 62, y0 = 58, w = CW - 124, h = CH - 116;
  c.save();
  c.strokeStyle = color; c.lineWidth = 3;
  c.fillStyle = s === 1 || s === 2 ? '#fff4e4' : '#f2f3fa';
  roundRectPath(c, x0, y0, w, h, 10); c.fill(); c.stroke();
  roundRectPath(c, x0, y0, w, h, 10); c.clip();
  const half = () => {
    const cx = x0 + w / 2;
    const robe = s === 1 || s === 2 ? '#c8102e' : '#1b2a6b', robe2 = s === 1 || s === 2 ? '#1b2a6b' : '#c8102e';
    // 長袍
    c.fillStyle = robe;
    c.beginPath(); c.moveTo(x0, y0 + h / 2); c.lineTo(x0 + 6, y0 + 120); c.quadraticCurveTo(cx, y0 + 96, x0 + w - 6, y0 + 120); c.lineTo(x0 + w, y0 + h / 2); c.closePath(); c.fill();
    c.fillStyle = GOLD;
    c.beginPath(); c.moveTo(cx - 16, y0 + 106); c.lineTo(cx + 16, y0 + 106); c.lineTo(cx + 26, y0 + h / 2); c.lineTo(cx - 26, y0 + h / 2); c.closePath(); c.fill();
    c.fillStyle = robe2;
    for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(cx, y0 + 118 + i * 12, 3.6, 0, 7); c.fill(); }
    // 臉
    c.fillStyle = '#f5d3ae';
    c.beginPath(); c.ellipse(cx, y0 + 74, 26, 31, 0, 0, 7); c.fill();
    c.strokeStyle = '#3a2412'; c.lineWidth = 2.4;
    c.beginPath(); c.moveTo(cx - 14, y0 + 68); c.lineTo(cx - 6, y0 + 68); c.moveTo(cx + 6, y0 + 68); c.lineTo(cx + 14, y0 + 68); c.stroke();
    c.beginPath(); c.moveTo(cx, y0 + 72); c.lineTo(cx - 3, y0 + 84); c.lineTo(cx + 2, y0 + 84); c.stroke();
    c.strokeStyle = '#b23a3a'; c.beginPath(); c.moveTo(cx - 6, y0 + 92); c.quadraticCurveTo(cx, y0 + 96, cx + 6, y0 + 92); c.stroke();
    // 頭髮與冠
    c.fillStyle = r === 2 ? '#6a4316' : r === 1 ? '#8a8a8a' : '#2a1a0c';
    c.beginPath(); c.moveTo(cx - 30, y0 + 58); c.quadraticCurveTo(cx - 40, y0 + 92, cx - 28, y0 + 110); c.lineTo(cx - 20, y0 + 74); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(cx + 30, y0 + 58); c.quadraticCurveTo(cx + 40, y0 + 92, cx + 28, y0 + 110); c.lineTo(cx + 20, y0 + 74); c.closePath(); c.fill();
    if (r === 1) { c.fillStyle = '#9a9a9a'; c.beginPath(); c.moveTo(cx - 18, y0 + 90); c.quadraticCurveTo(cx, y0 + 124, cx + 18, y0 + 90); c.quadraticCurveTo(cx, y0 + 102, cx - 18, y0 + 90); c.fill(); }
    c.fillStyle = GOLD;
    if (r === 3) { // J：羽帽
      c.beginPath(); c.moveTo(cx - 30, y0 + 52); c.quadraticCurveTo(cx, y0 + 18, cx + 30, y0 + 52); c.closePath(); c.fill();
      c.strokeStyle = robe; c.lineWidth = 5; c.beginPath(); c.moveTo(cx + 12, y0 + 34); c.quadraticCurveTo(cx + 40, y0 + 14, cx + 46, y0 + 34); c.stroke();
    } else {
      c.beginPath(); c.moveTo(cx - 30, y0 + 50); c.lineTo(cx - 34, y0 + 18); c.lineTo(cx - 16, y0 + 36); c.lineTo(cx, y0 + 12); c.lineTo(cx + 16, y0 + 36); c.lineTo(cx + 34, y0 + 18); c.lineTo(cx + 30, y0 + 50); c.closePath(); c.fill();
      c.fillStyle = robe; for (const k of [-34, 0, 34]) { c.beginPath(); c.arc(cx + k, y0 + (k ? 18 : 12), 4.4, 0, 7); c.fill(); }
    }
  };
  half();
  c.translate(CW, CH); c.rotate(Math.PI);
  half();
  c.restore();
  c.strokeStyle = color; c.lineWidth = 2;
  c.beginPath(); c.moveTo(x0, CH / 2); c.lineTo(x0 + w, CH / 2); c.stroke();
}

export function drawCard(c, card) {
  const s = suitOf(card), r = rankOf(card);
  const color = s === 1 || s === 2 ? RED : BLACK;
  c.clearRect(0, 0, CW, CH);
  roundRectPath(c, 2, 2, CW - 4, CH - 4, 22);
  const g = c.createLinearGradient(0, 0, CW, CH);
  g.addColorStop(0, '#fffefb'); g.addColorStop(1, '#f4efe4');
  c.fillStyle = g; c.fill();
  c.strokeStyle = 'rgba(70,60,40,.35)'; c.lineWidth = 2; c.stroke();
  c.fillStyle = color;
  const area = { x: 58, y: 42, w: CW - 116, h: CH - 84 };
  if (r <= 3 && r >= 1) {
    courtFigure(c, r, s, color);
    c.fillStyle = color;
    suitPath(c, s, 96, 100, 54);
    c.save(); c.translate(CW, CH); c.rotate(Math.PI); suitPath(c, s, 96, 100, 54); c.restore();
  } else if (r === 0) {
    suitPath(c, s, CW / 2, CH / 2, s === 0 ? 170 : 130);
  } else {
    const n = 14 - r - 1; // 點位 4→10 … 12→2
    const count = 13 - r + 1;
    void n;
    const big = count >= 9 ? 52 : count >= 6 ? 60 : 68;
    for (const [px, py] of PIPS[count]) {
      const x = area.x + px * area.w, y = area.y + py * area.h;
      c.save();
      c.translate(x, y);
      if (py > 0.55) c.rotate(Math.PI);
      suitPath(c, s, 0, 0, big);
      c.restore();
    }
  }
  // 四角索引（上下對稱）
  for (const rot of [0, 1]) {
    c.save();
    if (rot) { c.translate(CW, CH); c.rotate(Math.PI); }
    c.fillStyle = color;
    c.font = `800 ${r === 4 ? 50 : 58}px ${FACE_FONT}`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    if (r === 4) { c.save(); c.translate(36, 44); c.scale(0.84, 1); c.fillText('10', 0, 0); c.restore(); } else c.fillText(rankText(r), 36, 44);
    suitPath(c, s, 36, 92, 42);
    c.restore();
  }
}

// 牌背：深藍菱格＋小柯機器人徽章
export function drawBack(c) {
  c.clearRect(0, 0, CW, CH);
  roundRectPath(c, 2, 2, CW - 4, CH - 4, 22);
  c.fillStyle = '#fbf8f0'; c.fill();
  roundRectPath(c, 16, 16, CW - 32, CH - 32, 14);
  c.fillStyle = '#17366e'; c.fill();
  c.save(); c.clip();
  c.strokeStyle = 'rgba(255,255,255,.2)'; c.lineWidth = 2;
  for (let i = -CH; i < CW + CH; i += 26) {
    c.beginPath(); c.moveTo(i, 0); c.lineTo(i + CH, CH); c.stroke();
    c.beginPath(); c.moveTo(i, CH); c.lineTo(i + CH, 0); c.stroke();
  }
  c.restore();
  const cx = CW / 2, cy = CH / 2;
  c.fillStyle = '#e8c060'; c.beginPath(); c.arc(cx, cy, 78, 0, 7); c.fill();
  c.fillStyle = '#eef3ff'; c.beginPath(); c.arc(cx, cy, 68, 0, 7); c.fill();
  c.fillStyle = '#18243f'; roundRectPath(c, cx - 50, cy - 32, 100, 62, 28); c.fill();
  c.strokeStyle = '#5ae6ff'; c.lineWidth = 7; c.lineCap = 'round';
  for (const ex of [cx - 22, cx + 22]) { c.beginPath(); c.arc(ex, cy - 2, 12, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); }
  c.beginPath(); c.arc(cx, cy + 6, 12, Math.PI * 0.15, Math.PI * 0.85); c.stroke();
  c.fillStyle = '#ffc428'; c.beginPath(); c.arc(cx, cy - 84, 8, 0, 7); c.fill();
}

const cache = new Map();
export function cardCanvas(card) {
  const key = card == null ? 'back' : card;
  if (cache.has(key)) return cache.get(key);
  const cv = document.createElement('canvas');
  cv.width = CW; cv.height = CH;
  const c = cv.getContext('2d');
  if (card == null) drawBack(c); else drawCard(c, card);
  cache.set(key, cv);
  return cv;
}
const urls = new Map();
export function cardUrl(card) {
  const key = card == null ? 'back' : card;
  if (!urls.has(key)) urls.set(key, cardCanvas(card).toDataURL('image/png'));
  return urls.get(key);
}
export { SUITS, SUIT_FONT };
