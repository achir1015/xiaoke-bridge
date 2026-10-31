// 產生 70 張半身照（原創向量插畫，SVG）
// 牌手：男 20、女 20；AI 軍師：男 15、女 15
// 用法：node scripts/gen_portraits.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'portraits');
fs.mkdirSync(OUT, { recursive: true });

const W = 240, H = 300;
let uid = 0;
const nid = (p) => `${p}${++uid}`;
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  return '#' + [f(r), f(g), f(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
// 簡單可重現的亂數
function rnd(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const SKINS = ['#f6dcc4', '#f0cfae', '#e8bb93', '#d9a57c', '#c98d62', '#f3d5bb'];
const HAIRS = ['#1b1512', '#2a1c14', '#3b2516', '#5a3a22', '#1b1512', '#6b6b6b', '#8a5a2a', '#2a1c14'];
const BGS = [['#2f6a5a', '#0f2620'], ['#3a4f7a', '#121a2c'], ['#7a3a3a', '#2a1010'], ['#5a4a2a', '#1e180c'], ['#4a3a6a', '#160f22'], ['#2a5a7a', '#0c1a26'], ['#6a5a3a', '#221c10'], ['#355a35', '#0e1a0e']];
const CLOTH = ['#c0392b', '#2c6fb0', '#2f8a5a', '#e0a020', '#7a4ab0', '#e8e4d8', '#2a2a30', '#d85a7a', '#1f4a6e', '#8a5a2a', '#4aa0a0', '#b8262a', '#f0f0f0', '#5a6a7a', '#e87a3a'];

// 名字（暱稱）
const M_NAMES = ['志豪', '建宏', '俊傑', '家豪', '冠宇', '宗翰', '承恩', '柏翰', '文彬', '正雄', '永福', '天佑', '大偉', '育誠', '世明', '振興', '耀東', '子翔', '博文', '立偉'];
const F_NAMES = ['美玲', '淑芬', '雅婷', '怡君', '佳穎', '欣怡', '雅雯', '靜宜', '惠美', '秀英', '麗華', '玉蘭', '心怡', '詩涵', '宜蓁', '佩君', '筱涵', '品妍', '采潔', '曉薇'];
const AM_NAMES = ['林老師', '陳教授', '王大師', '張主任', '李校長', '黃教練', '吳顧問', '劉博士', '蔡會長', '楊教練', '許先生', '謝主任', '洪醫師', '郭總', '曾老師'];
const AF_NAMES = ['方老師', '蘇教授', '姚大師', '范主任', '傅校長', '葉教練', '潘顧問', '唐博士', '高會長', '孫教練', '白小姐', '施主任', '馮醫師', '丁總', '程老師'];

function background(c) {
  const g = nid('bg');
  let s = `<defs><radialGradient id="${g}" cx="50%" cy="36%" r="78%"><stop offset="0" stop-color="${shade(c.bg[0], 0.18)}"/><stop offset="1" stop-color="${c.bg[1]}"/></radialGradient></defs>`;
  s += `<rect width="${W}" height="${H}" rx="18" fill="url(#${g})"/>`;
  // 背景：散落的橋牌花色
  s += `<g opacity="0.14" fill="#fff" font-family="Segoe UI Symbol, sans-serif" font-size="34" text-anchor="middle">`;
  for (const [x, y, r, g] of [[34, 62, -14, '♠'], [206, 74, 12, '♥'], [214, 170, -8, '♦'], [26, 180, 10, '♣']]) s += `<text x="${x}" y="${y}" transform="rotate(${r} ${x} ${y})">${g}</text>`;
  s += `</g>`;
  return s;
}

function body(c, female) {
  const g = nid('cl');
  const m = c.cloth, tr = c.trim;
  let s = `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(m, 0.1)}"/><stop offset="1" stop-color="${shade(m, -0.3)}"/></linearGradient></defs>`;
  const sh = female ? 'M30 300 C36 252 74 228 120 224 C166 228 204 252 210 300 Z' : 'M14 300 C20 246 68 220 120 216 C172 220 220 246 226 300 Z';
  s += `<path d="${sh}" fill="url(#${g})"/>`;
  const o = c.outfit;
  if (o === 'suit') {
    s += `<path d="M98 222 L120 300 L142 222 Z" fill="#f4f4f4"/>`;
    s += `<path d="M114 230 L120 236 L126 230 L124 300 L116 300 Z" fill="${tr}"/>`;
    s += `<path d="M86 224 L120 300 L96 300 L72 240 Z" fill="${shade(m, -0.2)}"/><path d="M154 224 L120 300 L144 300 L168 240 Z" fill="${shade(m, -0.2)}"/>`;
  } else if (o === 'shirt' || o === 'polo') {
    s += `<path d="M96 222 L120 252 L108 262 L88 230 Z" fill="${shade(m, 0.25)}"/><path d="M144 222 L120 252 L132 262 L152 230 Z" fill="${shade(m, 0.25)}"/>`;
    s += `<path d="M120 252 L120 300" stroke="${shade(m, -0.35)}" stroke-width="2"/>`;
    for (const y of [264, 282]) s += `<circle cx="124" cy="${y}" r="2.4" fill="${shade(m, -0.4)}"/>`;
    if (o === 'polo') s += `<path d="M60 250 h20 M160 250 h20" stroke="${tr}" stroke-width="3" opacity="0.6"/>`;
  } else if (o === 'aloha') {
    s += `<path d="M96 222 L120 256 L108 264 L88 230 Z" fill="${shade(m, 0.2)}"/><path d="M144 222 L120 256 L132 264 L152 230 Z" fill="${shade(m, 0.2)}"/>`;
    for (const [x, y] of [[54, 262], [80, 284], [162, 266], [190, 286], [140, 292], [96, 296]]) s += `<g transform="translate(${x} ${y})">${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="${Math.cos(a * Math.PI / 180) * 5}" cy="${Math.sin(a * Math.PI / 180) * 5}" rx="5" ry="3" transform="rotate(${a} ${Math.cos(a * Math.PI / 180) * 5} ${Math.sin(a * Math.PI / 180) * 5})" fill="${tr}"/>`).join('')}<circle r="2" fill="#ffe14a"/></g>`;
  } else if (o === 'hoodie') {
    s += `<path d="M80 226 C90 250 150 250 160 226 C150 238 90 238 80 226 Z" fill="${shade(m, -0.25)}"/>`;
    s += `<path d="M106 240 v34 M134 240 v34" stroke="#f0f0f0" stroke-width="2.4"/><rect x="92" y="276" width="56" height="24" rx="6" fill="${shade(m, -0.15)}"/>`;
  } else if (o === 'tee') {
    s += `<path d="M96 222 Q120 240 144 222" fill="none" stroke="${shade(m, -0.3)}" stroke-width="4"/>`;
    s += `<text x="120" y="282" font-size="22" font-family="Arial Black, sans-serif" fill="${tr}" text-anchor="middle" opacity="0.85">${c.teeText || '胡'}</text>`;
  } else if (o === 'vest') {
    s += `<path d="M96 222 L120 260 L144 222 Z" fill="#f4f4f4"/><path d="M84 226 L120 300 L60 300 Z" fill="${shade(m, -0.15)}"/><path d="M156 226 L120 300 L180 300 Z" fill="${shade(m, -0.15)}"/>`;
    s += `<path d="M112 232 L120 240 L128 232 L120 228 Z" fill="${tr}"/>`;
  } else if (o === 'qipao') {
    s += `<path d="M104 222 L104 236 Q120 242 136 236 L136 222" fill="${shade(m, -0.15)}" stroke="${tr}" stroke-width="2"/>`;
    s += `<path d="M136 236 Q150 250 146 266" fill="none" stroke="${tr}" stroke-width="3"/>`;
    for (const [x, y] of [[70, 270], [176, 270], [120, 290]]) s += `<circle cx="${x}" cy="${y}" r="9" fill="none" stroke="${tr}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="3" fill="${tr}"/>`;
  } else if (o === 'blouse') {
    s += `<path d="M96 222 Q108 246 120 236 Q132 246 144 222" fill="${shade(m, 0.3)}" stroke="${shade(m, -0.2)}" stroke-width="2"/>`;
    s += `<path d="M120 238 L120 300" stroke="${shade(m, -0.2)}" stroke-width="1.5"/>`;
  } else if (o === 'cardigan') {
    s += `<path d="M98 222 Q120 236 142 222 L132 300 L108 300 Z" fill="${tr}"/>`;
    for (const y of [256, 274, 292]) s += `<circle cx="${y % 2 ? 106 : 106}" cy="${y}" r="2.6" fill="${shade(m, -0.4)}"/>`;
  } else if (o === 'sweater') {
    s += `<path d="M98 220 Q120 232 142 220 L142 230 Q120 242 98 230 Z" fill="${shade(m, -0.2)}"/>`;
    s += `<g stroke="${shade(m, 0.3)}" stroke-width="2" fill="none" opacity="0.7"><path d="M40 262 l10 -8 l10 8 l10 -8 l10 8 M160 262 l10 -8 l10 8 l10 -8 l10 8"/></g>`;
  }
  if (c.necklace) s += `<path d="M100 226 Q120 254 140 226" fill="none" stroke="#f4e3a0" stroke-width="2.4"/><circle cx="120" cy="246" r="4" fill="${c.necklace}"/>`;
  return s;
}

function head(c, female) {
  const skin = c.skin;
  const sk2 = shade(skin, -0.16);
  const g = nid('sk');
  let s = `<defs><radialGradient id="${g}" cx="45%" cy="38%" r="70%"><stop offset="0" stop-color="${shade(skin, 0.1)}"/><stop offset="1" stop-color="${sk2}"/></radialGradient></defs>`;
  s += `<path d="M104 176 L104 222 Q120 234 136 222 L136 176 Z" fill="${sk2}"/>`;
  s += `<ellipse cx="74" cy="132" rx="8" ry="14" fill="${sk2}"/><ellipse cx="166" cy="132" rx="8" ry="14" fill="${sk2}"/>`;
  if (female && c.earring) s += `<circle cx="74" cy="149" r="3.4" fill="${c.earring}"/><circle cx="166" cy="149" r="3.4" fill="${c.earring}"/>`;
  const face = female
    ? 'M78 118 C78 84 98 70 120 70 C142 70 162 84 162 118 C162 150 146 176 120 184 C94 176 78 150 78 118 Z'
    : c.round ? 'M74 118 C74 80 96 66 120 66 C144 66 166 80 166 118 C166 156 150 182 120 188 C90 182 74 156 74 118 Z'
      : 'M76 116 C76 82 96 68 120 68 C144 68 164 82 164 116 C164 150 152 176 120 186 C88 176 76 150 76 116 Z';
  s += `<path d="${face}" fill="url(#${g})"/>`;
  // 年長：法令紋、魚尾紋
  if (c.old) s += `<path d="M98 150 Q102 162 100 170 M142 150 Q138 162 140 170" stroke="${shade(skin, -0.3)}" stroke-width="1.4" fill="none"/><path d="M84 126 l-6 -2 M84 130 l-6 1 M156 126 l6 -2 M156 130 l6 1" stroke="${shade(skin, -0.3)}" stroke-width="1.2"/>`;
  s += `<ellipse cx="95" cy="146" rx="10" ry="6" fill="#ff7a8a" opacity="${female ? 0.28 : 0.12}"/><ellipse cx="145" cy="146" rx="10" ry="6" fill="#ff7a8a" opacity="${female ? 0.28 : 0.12}"/>`;
  // 眉
  const bc = c.old ? '#8a8a8a' : c.hair;
  const brows = female
    ? ['M90 110 Q101 104 113 108 Q101 107 90 111 Z', 'M150 110 Q139 104 127 108 Q139 107 150 111 Z']
    : c.brow === 'thick' ? ['M86 110 Q100 100 114 106 L113 112 Q100 108 87 115 Z', 'M154 110 Q140 100 126 106 L127 112 Q140 108 153 115 Z']
      : ['M89 110 Q100 105 112 107 L112 111 Q100 109 89 113 Z', 'M151 110 Q140 105 128 107 L128 111 Q140 109 151 113 Z'];
  s += `<path d="${brows[0]}" fill="${bc}"/><path d="${brows[1]}" fill="${bc}"/>`;
  // 眼：笑眼或一般
  const eye = (cx, dir) => {
    if (c.smileEyes) return `<path d="M${cx - 9} 126 Q${cx} 116 ${cx + 9} 126" fill="none" stroke="#2a1a10" stroke-width="2.6" stroke-linecap="round"/>`;
    const shape = `M${cx - 11} 125 Q${cx} 116 ${cx + 11} 125 Q${cx} 131 ${cx - 11} 125 Z`;
    let e = `<path d="${shape}" fill="#fffaf2"/><circle cx="${cx}" cy="124.5" r="4.8" fill="#3a2414"/><circle cx="${cx}" cy="124.5" r="2.3" fill="#000"/><circle cx="${cx + 1.6}" cy="122.8" r="1.4" fill="#fff"/>`;
    e += `<path d="${shape}" fill="none" stroke="#2a1a10" stroke-width="${female ? 2 : 1.6}"/>`;
    if (female) e += `<path d="M${cx + dir * 9} 121 l${dir * 5} -3" stroke="#2a1a10" stroke-width="1.6"/>`;
    return e;
  };
  s += eye(100, -1) + eye(140, 1);
  s += `<path d="M120 128 Q117 146 114 150 Q120 154 126 150" fill="none" stroke="${shade(skin, -0.35)}" stroke-width="1.8" stroke-linecap="round"/>`;
  // 嘴：微笑
  if (female) s += `<path d="M108 162 Q120 172 132 162 Q120 166 108 162 Z" fill="${c.lip || '#c8323a'}"/>`;
  else if (c.grin) s += `<path d="M106 160 Q120 176 134 160 Z" fill="#7a2a20"/><path d="M109 161 Q120 166 131 161" stroke="#fff" stroke-width="3"/>`;
  else s += `<path d="M106 162 Q120 172 134 162" fill="none" stroke="#6a2a20" stroke-width="2.6" stroke-linecap="round"/>`;
  // 鬍子
  if (c.beard === 'mustache') s += `<path d="M104 156 Q120 150 136 156 Q128 159 120 157 Q112 159 104 156 Z" fill="${bc}"/>`;
  if (c.beard === 'stubble') s += `<path d="M86 150 Q90 182 120 188 Q150 182 154 150 Q140 176 120 178 Q100 176 86 150 Z" fill="${bc}" opacity="0.25"/>`;
  if (c.beard === 'goatee') s += `<path d="M112 172 Q120 196 128 172 Q120 178 112 172 Z" fill="${bc}"/><path d="M106 156 Q120 151 134 156 Q128 159 120 158 Q112 159 106 156 Z" fill="${bc}"/>`;
  // 眼鏡
  if (c.glasses === 'round') s += `<g fill="none" stroke="#2a2a2a" stroke-width="2.6"><circle cx="100" cy="125" r="13"/><circle cx="140" cy="125" r="13"/><path d="M113 124 Q120 120 127 124 M87 122 L76 118 M153 122 L164 118"/></g>`;
  if (c.glasses === 'square') s += `<g fill="${c.old ? 'none' : 'rgba(255,255,255,0.08)'}" stroke="#3a2a1a" stroke-width="2.8"><rect x="85" y="115" width="30" height="20" rx="5"/><rect x="125" y="115" width="30" height="20" rx="5"/><path d="M115 124 h10 M85 121 L76 118 M155 121 L164 118" fill="none"/></g>`;
  if (c.glasses === 'sun') s += `<g><rect x="84" y="114" width="31" height="20" rx="8" fill="#141414"/><rect x="125" y="114" width="31" height="20" rx="8" fill="#141414"/><path d="M115 120 h10 M84 120 L76 117 M156 120 L164 117" stroke="#141414" stroke-width="3"/><path d="M90 118 l8 0" stroke="#fff" stroke-width="2" opacity="0.5"/></g>`;
  return s;
}

function hairBack(c, female) {
  if (!female) return '';
  const hc = c.hair;
  switch (c.style) {
    case 'long': return `<path d="M70 110 C60 180 66 240 78 252 L162 252 C174 240 180 180 170 110 Z" fill="${hc}"/>`;
    case 'wavy': return `<path d="M70 110 C56 170 62 230 72 246 Q84 256 96 244 L144 244 Q156 256 168 246 C178 230 184 170 170 110 Z" fill="${hc}"/>`;
    case 'bob': return `<path d="M70 112 C64 150 68 178 80 190 L160 190 C172 178 176 150 170 112 Z" fill="${hc}"/>`;
    case 'pony': return `<path d="M160 90 C196 100 200 170 176 212 C186 168 178 124 156 110 Z" fill="${hc}"/>`;
    default: return '';
  }
}

function hairFront(c, female) {
  const hc = c.hair;
  if (!female) {
    switch (c.style) {
      case 'bald': return `<path d="M76 112 C74 104 76 98 80 94 L82 112 Z M164 112 C166 104 164 98 160 94 L158 112 Z" fill="${hc}" opacity="0.8"/>`;
      case 'buzz': return `<path d="M76 112 C72 72 96 58 120 58 C144 58 168 72 164 112 C158 94 144 86 120 86 C96 86 82 94 76 112 Z" fill="${hc}" opacity="0.85"/>`;
      case 'side': return `<path d="M74 118 C68 70 96 50 122 52 C150 54 172 74 166 116 C160 92 150 82 136 80 C116 86 96 80 84 92 C80 100 76 108 74 118 Z" fill="${hc}"/><path d="M96 66 Q120 58 150 70" stroke="${shade(hc, 0.3)}" stroke-width="2" fill="none"/>`;
      case 'slick': return `<path d="M74 116 C70 64 98 46 122 48 C148 50 172 70 166 116 C162 90 150 80 120 80 C92 80 80 92 74 116 Z" fill="${hc}"/><path d="M90 66 Q120 54 152 66 M94 74 Q122 64 150 76" stroke="${shade(hc, 0.35)}" stroke-width="1.6" fill="none"/>`;
      case 'curly': {
        let s = `<path d="M74 116 C70 72 96 56 120 56 C144 56 170 72 166 116 C160 94 144 86 120 86 C96 86 80 94 74 116 Z" fill="${hc}"/>`;
        for (let i = 0; i < 11; i++) s += `<circle cx="${80 + i * 8}" cy="${68 - Math.sin((i / 10) * Math.PI) * 14}" r="9" fill="${hc}"/>`;
        return s;
      }
      case 'spiky': return `<path d="M74 116 C70 76 92 60 120 60 C148 60 170 76 166 116 C160 94 144 88 120 88 C96 88 80 94 74 116 Z" fill="${hc}"/><path d="M82 76 L86 48 L98 68 L106 40 L116 64 L126 38 L134 64 L146 44 L150 70 L162 56 L160 82 Z" fill="${hc}"/>`;
      case 'cap': return `<path d="M72 106 C70 66 96 50 120 50 C144 50 170 66 168 106 Z" fill="${c.trim}"/><path d="M72 104 Q120 92 168 104 L188 112 Q120 100 72 110 Z" fill="${shade(c.trim, -0.3)}"/><circle cx="120" cy="52" r="4" fill="${shade(c.trim, -0.3)}"/><path d="M76 108 C76 116 78 120 80 122 M164 108 C164 116 162 120 160 122" stroke="${hc}" stroke-width="5"/>`;
      case 'gray': return `<path d="M74 116 C70 72 96 58 120 58 C144 58 170 72 166 116 C160 96 146 88 120 88 C94 88 80 96 74 116 Z" fill="#b8b8b8"/><path d="M90 70 Q120 62 150 72" stroke="#e0e0e0" stroke-width="2" fill="none"/>`;
      default: return `<path d="M74 116 C70 70 96 56 120 56 C144 56 170 70 166 116 C160 94 146 86 120 86 C94 86 80 94 74 116 Z" fill="${hc}"/>`;
    }
  }
  const fringe = `<path d="M76 120 C70 70 96 56 120 56 C144 56 170 70 164 120 C156 94 136 86 122 92 L120 82 L118 92 C104 86 84 94 76 120 Z" fill="${hc}"/>`;
  switch (c.style) {
    case 'bangs': return `<path d="M74 122 C68 70 96 54 120 54 C144 54 172 70 166 122 C164 108 160 100 156 98 L84 98 C80 100 76 108 74 122 Z" fill="${hc}"/>`;
    case 'bun': return fringe + `<circle cx="120" cy="50" r="20" fill="${hc}"/><path d="M104 56 Q120 62 136 56" stroke="${c.trim}" stroke-width="4" fill="none"/>`;
    case 'short': return `<path d="M76 124 C68 70 96 54 122 54 C150 56 172 74 164 120 C160 100 150 90 130 86 C110 92 92 88 82 100 C78 108 76 116 76 124 Z" fill="${hc}"/>`;
    case 'perm': {
      let s = fringe;
      for (let i = 0; i < 9; i++) s += `<circle cx="${78 + i * 10.5}" cy="${66 - Math.sin((i / 8) * Math.PI) * 12}" r="10" fill="${hc}"/>`;
      for (const [x, y] of [[72, 100], [168, 100], [70, 124], [170, 124]]) s += `<circle cx="${x}" cy="${y}" r="9" fill="${hc}"/>`;
      return s;
    }
    case 'pony': return fringe + `<path d="M150 70 q10 -4 14 4" stroke="${c.trim}" stroke-width="5" fill="none"/>`;
    case 'hairband': return fringe + `<path d="M80 92 Q120 60 160 92" stroke="${c.trim}" stroke-width="7" fill="none" stroke-linecap="round"/>`;
    default: return fringe + (c.clip ? `<path d="M140 76 l14 -6" stroke="${c.trim}" stroke-width="5" stroke-linecap="round"/>` : '');
  }
}

// 道具：麻將牌、茶杯、扇子
function prop(c) {
  if (c.prop === 'tile') return `<g transform="translate(176 232) rotate(-12)"><rect x="-15" y="-20" width="30" height="40" rx="5" fill="#0f7a45"/><rect x="-15" y="-20" width="30" height="34" rx="5" fill="#f6f0e1" stroke="#c8bfa8"/><text x="0" y="-2" font-size="24" font-family="DFKai-SB, KaiTi, serif" font-weight="900" fill="${c.tileChar === '發' ? '#0f7a3a' : '#c8102e'}" text-anchor="middle" dominant-baseline="central">${c.tileChar || '中'}</text></g>`;
  if (c.prop === 'tea') return `<g transform="translate(180 250)"><path d="M-14 -12 h28 l-3 22 h-22 Z" fill="#f4f0e6" stroke="#8a7a5a" stroke-width="2"/><path d="M14 -6 q10 2 6 12 q-3 4 -8 2" fill="none" stroke="#8a7a5a" stroke-width="2"/><path d="M-4 -20 q4 -6 0 -12 M4 -20 q4 -6 0 -12" stroke="#fff" stroke-width="1.5" opacity="0.5" fill="none"/></g>`;
  if (c.prop === 'fan') return `<g transform="translate(184 240) rotate(-20)"><path d="M0 20 L-30 -18 A40 40 0 0 1 30 -18 Z" fill="#f4ecd8" stroke="#a83232" stroke-width="2"/><text x="0" y="-6" font-size="14" font-family="DFKai-SB, KaiTi, serif" fill="#a83232" text-anchor="middle">自摸</text></g>`;
  return '';
}

function badge(label, group) {
  const font = `font-family="'Microsoft JhengHei', 'PingFang TC', sans-serif" font-weight="700"`;
  let s = `<g><rect x="10" y="${H - 38}" width="${Math.max(70, label.length * 20 + 20)}" height="28" rx="14" fill="#10221a" stroke="#e8b84a" stroke-width="1.5" opacity="0.92"/><text x="${10 + Math.max(70, label.length * 20 + 20) / 2}" y="${H - 18.5}" font-size="17" ${font} fill="#ffe7a8" text-anchor="middle">${label}</text></g>`;
  if (group === 'advisor') s += `<g><rect x="${W - 64}" y="${H - 38}" width="54" height="28" rx="14" fill="#b3161f" stroke="#f3d27a" stroke-width="1.5"/><text x="${W - 37}" y="${H - 18.5}" font-size="16" ${font} fill="#fff7e6" text-anchor="middle">軍師</text></g>`;
  return s;
}

function portrait(label, c, group, female) {
  uid = 0;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;
  s += `<clipPath id="clip"><rect width="${W}" height="${H}" rx="18"/></clipPath><g clip-path="url(#clip)">`;
  s += background(c);
  s += hairBack(c, female);
  s += body(c, female);
  s += head(c, female);
  s += hairFront(c, female);
  s += prop(c);
  s += badge(label, group);
  s += `</g><rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="17" fill="none" stroke="#e8b84a" stroke-width="3"/></svg>`;
  return s;
}

const M_STYLES = ['short', 'side', 'slick', 'buzz', 'curly', 'spiky', 'cap', 'bald', 'gray'];
const F_STYLES = ['long', 'bob', 'pony', 'bun', 'wavy', 'bangs', 'short', 'perm', 'hairband'];
const M_OUT = ['shirt', 'polo', 'suit', 'aloha', 'hoodie', 'tee', 'vest', 'sweater'];
const F_OUT = ['blouse', 'qipao', 'cardigan', 'tee', 'sweater', 'hoodie', 'shirt', 'vest'];
const TEE = ['♠', '♥', 'NT', 'A', 'K', '7NT'];

function make(names, prefix, group, female, advisor, seed) {
  const r = rnd(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  return names.map((label, i) => {
    const old = advisor ? i % 3 !== 1 : (female ? ['秀英', '玉蘭', '麗華', '惠美'] : ['正雄', '永福', '振興', '耀東']).includes(label);
    const c = {
      skin: SKINS[(i * 7 + seed) % SKINS.length],
      hair: old ? (r() < 0.6 ? '#9a9a9a' : '#3a3a3a') : HAIRS[(i * 3 + seed) % HAIRS.length],
      style: female ? (old && r() < 0.6 ? 'perm' : F_STYLES[(i + seed) % F_STYLES.length]) : (old ? (r() < 0.5 ? 'gray' : pick(['bald', 'slick', 'short'])) : M_STYLES[(i * 5 + seed) % M_STYLES.length]),
      outfit: female ? F_OUT[(i * 3 + seed) % F_OUT.length] : advisor ? pick(['suit', 'vest', 'shirt', 'aloha', 'polo']) : M_OUT[(i * 3 + seed) % M_OUT.length],
      cloth: CLOTH[(i * 4 + seed) % CLOTH.length],
      trim: CLOTH[(i * 4 + seed + 5) % CLOTH.length],
      bg: BGS[(i + seed) % BGS.length],
      glasses: advisor ? pick(['round', 'square', 'none', 'square', 'sun']) : pick(['none', 'none', 'none', 'round', 'square', 'sun']),
      brow: pick(['thick', 'thin']),
      beard: female ? '' : pick(['', '', 'mustache', 'stubble', 'goatee']),
      smileEyes: r() < 0.25,
      grin: r() < 0.35,
      round: r() < 0.3,
      old,
      earring: female && r() < 0.6 ? pick(['#e8c86a', '#7ac0d8', '#e86a8a', '#ffffff']) : '',
      necklace: female && r() < 0.35 ? pick(['#e84a6a', '#4aa0e8', '#7ac08a']) : '',
      lip: pick(['#c8323a', '#d8506a', '#b8282a', '#e0607a']),
      clip: r() < 0.4,
      teeText: pick(TEE),
      prop: advisor ? pick(['tile', 'tea', 'fan', 'tile']) : r() < 0.25 ? 'tile' : '',
      tileChar: pick(['♠', '♥', '♦', '♣']),
    };
    if (c.glasses === 'sun' && old) c.glasses = 'square';
    const pid = `${prefix}${String(i + 1).padStart(2, '0')}`;
    fs.writeFileSync(path.join(OUT, pid + '.svg'), portrait(label, c, group, female), 'utf8');
    return { id: pid, group, gender: female ? 'f' : 'm', label: advisor ? label : label };
  });
}

const meta = [
  ...make(M_NAMES, 'm', 'male', false, false, 11),
  ...make(F_NAMES, 'f', 'female', true, false, 23),
  ...make(AM_NAMES, 'am', 'advisor', false, true, 37),
  ...make(AF_NAMES, 'af', 'advisor', true, true, 41),
];
fs.writeFileSync(path.join(OUT, 'portraits.json'), JSON.stringify(meta, null, 1), 'utf8');
const sheet = `<!doctype html><meta charset="utf-8"><body style="background:#10221a;color:#eee;font-family:sans-serif;margin:10px">` +
  ['male', 'female', 'advisor'].map((g) => `<h3>${g}</h3><div style="display:grid;grid-template-columns:repeat(10,120px);gap:8px">` + meta.filter((m) => m.group === g).map((m) => `<div style="text-align:center"><img src="${m.id}.svg" width="120"><br>${m.label}</div>`).join('') + '</div>').join('') + '</body>';
fs.writeFileSync(path.join(OUT, '_sheet.html'), sheet, 'utf8');
console.log('產生', meta.length, '張頭像 →', OUT);
