// 3D 牌室：橋牌桌、吊燈、地毯、牌椅與立體紙牌。
// 所有牌都用「目標位置」驅動：layout() 算出每張牌該在哪裡，loop() 平滑移動過去，所以任何狀態都能直接重畫，不會卡動畫。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { cardCanvas } from './cards.js';
import { suitOf, rankOf, sortHand } from './rules.js';

const CW = 8.4, CH = 11.76, THICK = 0.1;   // 牌寬、牌高、厚度
const L = 62;                              // 桌面半寬
const TABLE_H = 0;                         // 桌面高度（y）

function roundedShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
const SHAPE = roundedShape(CW, CH, 0.55);
const EDGE_GEO = new THREE.ExtrudeGeometry(SHAPE, { depth: THICK, bevelEnabled: false, curveSegments: 6 });
EDGE_GEO.translate(0, 0, -THICK / 2);
const FACE_GEO = (() => {
  const g = new THREE.ShapeGeometry(SHAPE, 6);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / CW + 0.5, p.getY(i) / CH + 0.5);
  return g;
})();
const MAT_EDGE = new THREE.MeshStandardMaterial({ color: 0xf2ecdc, roughness: 0.6 });

function texOf(cv) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
const faceMats = new Map();
function faceMat(c) {
  if (!faceMats.has(c)) faceMats.set(c, new THREE.MeshStandardMaterial({ map: texOf(cardCanvas(c)), roughness: 0.42, metalness: 0.02 }));
  return faceMats.get(c);
}
let backMat = null;
const getBackMat = () => (backMat ||= new THREE.MeshStandardMaterial({ map: texOf(cardCanvas(null)), roughness: 0.42, metalness: 0.02 }));
const HL = new THREE.Color(0xffe27a), HINT = new THREE.Color(0x8cffb4), DIM = new THREE.Color(0x777777), WHITE = new THREE.Color(0xffffff);

function makeCard(id) {
  const g = new THREE.Group();
  const edge = new THREE.Mesh(EDGE_GEO, MAT_EDGE);
  edge.castShadow = true;
  const back = new THREE.Mesh(FACE_GEO, getBackMat());
  back.position.z = -THICK / 2 - 0.002;
  back.rotation.y = Math.PI;
  g.add(edge, back);
  if (id != null) {
    const mat = faceMat(id).clone();
    const face = new THREE.Mesh(FACE_GEO, mat);
    face.position.z = THICK / 2 + 0.002;
    g.add(face);
    g.userData.face = face;
  }
  g.userData.id = id;
  g.userData.tp = new THREE.Vector3();
  g.userData.tq = new THREE.Quaternion();
  g.visible = false;
  return g;
}

const Q_FLAT_UP = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const eulerQ = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));

// 視角中的相對位置 k：0 下（我）、1 左（下家）、2 上（對家）、3 右（上家）
const SEAT_POS = [[0, 1], [-1, 0], [0, -1], [1, 0]]; // [x, z] 方向

export class Table3D {
  constructor(el, { onCardClick, onHover, mobile = false, touch = false } = {}) {
    this.el = el;
    this.mobile = mobile;
    this.touch = mobile || touch;
    this.onCardClick = onCardClick;
    this.onHover = onHover;
    this.cards = new Map();      // id → Group
    this.backs = [[], [], [], []];
    this.viewSeat = 2;
    this.view = null;
    this.playable = new Set();
    this.hint = -1;
    this.hover = -1;
    this.viewMode = 'tilt';
    this.openAll = false;
    this.pickList = [];
    this.lastT = 0;
    this.initScene();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    this.bindPointer();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(el);
  }

  initScene() {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.el.append(r.domElement);
    this.renderer = r;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a120c);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(36, 1, 1, 1200);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.minDistance = 90; this.controls.maxDistance = 300;
    this.controls.maxPolarAngle = Math.PI * 0.44;
    this.controls.enablePan = false;
    if (this.touch) this.controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.setView('tilt');

    scene.add(new THREE.HemisphereLight(0xffeedd, 0x2a1a10, 0.75));
    const lamp = new THREE.SpotLight(0xfff0d8, 26000, 420, 0.75, 0.55, 1.9);
    lamp.position.set(0, 190, 12);
    lamp.target.position.set(0, 0, 0);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(2048, 2048);
    lamp.shadow.bias = -0.0004;
    lamp.shadow.camera.near = 60;
    lamp.shadow.camera.far = 320;
    scene.add(lamp, lamp.target);
    const fill = new THREE.DirectionalLight(0xffe2c0, 0.4);
    fill.position.set(-70, 110, 120);
    scene.add(fill);

    this.buildRoom(scene);
    this.buildTable(scene);
    this.buildMarkers(scene);
  }

  buildTable(scene) {
    const R = 7; // 圓角
    // 絨布桌面
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1024;
    const c = cv.getContext('2d');
    const grd = c.createRadialGradient(512, 512, 80, 512, 512, 720);
    grd.addColorStop(0, '#1f8056'); grd.addColorStop(1, '#0e4c33');
    c.fillStyle = grd; c.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 26000; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.045})`; c.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2); }
    c.strokeStyle = 'rgba(255,226,150,.24)'; c.lineWidth = 5;
    c.strokeRect(70, 70, 884, 884);
    c.strokeStyle = 'rgba(255,226,150,.13)'; c.lineWidth = 2; c.strokeRect(84, 84, 856, 856);
    // 中央羅盤（出牌區）
    c.save(); c.translate(512, 512);
    c.strokeStyle = 'rgba(255,226,150,.2)'; c.lineWidth = 3;
    c.beginPath(); c.arc(0, 0, 196, 0, 7); c.stroke();
    c.restore();
    const felt = new THREE.CanvasTexture(cv);
    felt.colorSpace = THREE.SRGBColorSpace;
    felt.anisotropy = 8;
    const shape = roundedShape(L * 2, L * 2, R);
    const top = new THREE.Mesh(new THREE.ShapeGeometry(shape, 12), new THREE.MeshStandardMaterial({ map: felt, roughness: 0.95 }));
    const uv = top.geometry.attributes.uv, pos = top.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (L * 2) + 0.5, pos.getY(i) / (L * 2) + 0.5);
    top.rotation.x = -Math.PI / 2;
    top.position.y = TABLE_H;
    top.receiveShadow = true;
    scene.add(top);
    // 木質桌緣（有圓角的外框）
    const rim = roundedShape(L * 2 + 12, L * 2 + 12, R + 5);
    rim.holes.push(roundedShape(L * 2, L * 2, R));
    const rimGeo = new THREE.ExtrudeGeometry(rim, { depth: 4.5, bevelEnabled: true, bevelThickness: 1.1, bevelSize: 1.1, bevelSegments: 4, curveSegments: 12 });
    const woodTex = this.woodTexture('#6a3a1c', '#3f2110');
    woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
    woodTex.repeat.set(0.06, 0.06);
    const wood = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.38, metalness: 0.05 });
    const rimMesh = new THREE.Mesh(rimGeo, wood);
    rimMesh.rotation.x = -Math.PI / 2;
    rimMesh.position.y = -3.4;
    rimMesh.castShadow = true; rimMesh.receiveShadow = true;
    scene.add(rimMesh);
    // 桌腳
    const legMat = new THREE.MeshStandardMaterial({ color: 0x38200f, roughness: 0.5 });
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 2.2, 66, 16), legMat);
      leg.position.set(x * (L - 8), -38, z * (L - 8));
      leg.castShadow = true;
      scene.add(leg);
    }
    // 椅子
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x6d1f24, roughness: 0.7 });
    const chairWood = new THREE.MeshStandardMaterial({ color: 0x4a2a14, roughness: 0.45 });
    for (let k = 1; k < 4; k++) {
      const g = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(46, 6, 40), seatMat);
      seat.position.set(0, -22, 34);
      const back = new THREE.Mesh(new THREE.BoxGeometry(44, 56, 5), seatMat);
      back.position.set(0, 8, 54);
      back.rotation.x = -0.08;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(48, 60, 3), chairWood);
      frame.position.set(0, 8, 56.5);
      frame.rotation.x = -0.08;
      g.add(seat, back, frame);
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      g.position.set(0, 0, L + 6);
      const holder = new THREE.Group();
      holder.add(g);
      holder.rotation.y = (k * Math.PI) / 2;
      scene.add(holder);
    }
  }

  woodTexture(a, b) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 512;
    const c = cv.getContext('2d');
    c.fillStyle = a; c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 240; i++) {
      c.strokeStyle = b + Math.floor(20 + Math.random() * 80).toString(16).padStart(2, '0');
      c.lineWidth = Math.random() * 3;
      c.beginPath();
      let y = Math.random() * 512;
      c.moveTo(0, y);
      for (let x = 0; x <= 512; x += 32) { y += (Math.random() - 0.5) * 6; c.lineTo(x, y); }
      c.stroke();
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  buildRoom(scene) {
    const floorY = -71;
    // 木地板
    const ft = this.woodTexture('#5a3a22', '#2c1a0e');
    ft.wrapS = ft.wrapT = THREE.RepeatWrapping;
    ft.repeat.set(6, 6);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.55 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = floorY;
    floor.receiveShadow = true;
    scene.add(floor);
    // 地毯
    const cv = document.createElement('canvas');
    cv.width = cv.height = 512;
    const c = cv.getContext('2d');
    c.fillStyle = '#5a1a1e'; c.fillRect(0, 0, 512, 512);
    c.strokeStyle = '#d4a84a'; c.lineWidth = 8; c.strokeRect(24, 24, 464, 464);
    c.strokeStyle = 'rgba(212,168,74,.6)'; c.lineWidth = 3; c.strokeRect(42, 42, 428, 428);
    c.fillStyle = 'rgba(212,168,74,.28)';
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { c.save(); c.translate(70 + i * 53, 70 + j * 53); c.rotate(Math.PI / 4); c.fillRect(-9, -9, 18, 18); c.restore(); }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(330, 330), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    rug.rotation.x = -Math.PI / 2; rug.position.y = floorY + 0.3;
    rug.receiveShadow = true;
    scene.add(rug);
    // 牆面（有護牆板）
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3b4a3f, roughness: 0.85 });
    const panel = new THREE.MeshStandardMaterial({ color: 0x4a2c16, roughness: 0.5 });
    for (let k = 0; k < 4; k++) {
      const g = new THREE.Group();
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(900, 420), wallMat);
      wall.position.set(0, 139, -300);
      const wain = new THREE.Mesh(new THREE.BoxGeometry(900, 95, 4), panel);
      wain.position.set(0, floorY + 47, -298);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(900, 5, 8), panel);
      rail.position.set(0, floorY + 97, -296);
      g.add(wall, wain, rail);
      // 牆上掛畫：四種花色
      const pic = document.createElement('canvas');
      pic.width = 256; pic.height = 320;
      const pc = pic.getContext('2d');
      pc.fillStyle = '#f2ead6'; pc.fillRect(0, 0, 256, 320);
      pc.fillStyle = k % 2 ? '#c8102e' : '#16181f';
      pc.font = '190px "Segoe UI Symbol",serif'; pc.textAlign = 'center'; pc.textBaseline = 'middle';
      pc.fillText('♠♥♦♣'[k], 128, 160);
      const pt = new THREE.CanvasTexture(pic);
      pt.colorSpace = THREE.SRGBColorSpace;
      const framed = new THREE.Mesh(new THREE.BoxGeometry(92, 112, 3), new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: 0.5, roughness: 0.4 }));
      framed.position.set(0, 96, -296);
      const art = new THREE.Mesh(new THREE.PlaneGeometry(80, 100), new THREE.MeshStandardMaterial({ map: pt, roughness: 0.7 }));
      art.position.set(0, 96, -294);
      g.add(framed, art);
      g.rotation.y = (k * Math.PI) / 2;
      scene.add(g);
    }
    // 吊燈
    const shade = new THREE.Mesh(new THREE.ConeGeometry(38, 24, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x1d5a3e, roughness: 0.4, side: THREE.DoubleSide, metalness: 0.25 }));
    shade.position.set(0, 212, 12);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff2d0 }));
    bulb.position.set(0, 204, 12);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 130), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    cord.position.set(0, 288, 12);
    scene.add(shade, bulb, cord);
  }

  buildMarkers(scene) {
    // 輪到誰：桌面上的光暈
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 64;
    const c = cv.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, 'rgba(255,226,122,0)'); g.addColorStop(1, 'rgba(255,226,122,.75)');
    c.fillStyle = g; c.fillRect(0, 0, 256, 64);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    this.turnGlow = new THREE.Mesh(new THREE.PlaneGeometry(L * 1.7, 8), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
    this.turnGlow.rotation.x = -Math.PI / 2;
    this.turnGlow.position.y = 0.05;
    this.turnGlow.visible = false;
    scene.add(this.turnGlow);
  }

  setView(v) {
    this.viewMode = v;
    const p = this.mobile ? [0, 170, 92] : v === 'top' ? [0, 208, 40] : v === 'low' ? [0, 96, 160] : [0, 158, 112];
    this.camera.position.set(...p);
    this.controls.target.set(0, 0, this.mobile ? 13 : v === 'low' ? 10 : 6);
    this.controls.update();
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    // 視窗窄時拉遠，桌子四邊都要看得到
    this.camera.fov = w / h < 1.25 ? 36 + (1.25 - w / h) * 34 : 36;
    this.camera.updateProjectionMatrix();
  }

  // ---------------- 牌物件 ----------------
  cardObj(id) {
    let o = this.cards.get(id);
    if (!o) { o = makeCard(id); this.cards.set(id, o); this.scene.add(o); }
    return o;
  }
  backObj(seat, i) {
    let o = this.backs[seat][i];
    if (!o) { o = makeCard(null); this.backs[seat][i] = o; this.scene.add(o); }
    return o;
  }

  relPos(seat) { return (seat - this.viewSeat + 4) % 4; }

  // 桌邊某座位的基準方向
  spawnPoint(seat) {
    const [x, z] = SEAT_POS[this.relPos(seat)];
    return new THREE.Vector3(x * (L + 6), 7, z * (L + 6));
  }

  // 主函式：依牌局狀態排好每張牌
  // view: Board.view()；open: 是否四家全攤（AI 對 AI、重播）
  layout(view, { viewSeat = 2, open = false, deal = false } = {}) {
    this.view = view;
    this.viewSeat = viewSeat;
    this.openAll = open;
    const used = new Set();
    this.pickList = [];
    const usedBacks = [0, 0, 0, 0];
    if (!view) { this.hideAll(used, usedBacks); return; }

    const place = (o, p, q, stagger = 0) => {
      const u = o.userData;
      const wasVisible = o.visible;
      u.tp.copy(p); u.tq.copy(q);
      u.delay = stagger;
      if (!wasVisible) {
        o.visible = true;
        const sp = u.spawn || p;
        o.position.copy(sp);
        o.quaternion.copy(q);
      }
    };

    for (let s = 0; s < 4; s++) {
      const cards = view.hands[s];
      const k = this.relPos(s);
      const faceUp = cards != null;
      if (k === 0 && faceUp) this.layoutMine(cards, place, used, deal, s);
      else if (faceUp && (open || s === (view.contract ? (view.contract.declarer + 2) % 4 : -1) || view.phase === 'done')) this.layoutOpen(cards, k, place, used, s);
      else this.layoutBacks(s, k, cards ? cards.length : view.counts[s], place, usedBacks, deal);
    }

    // 本墩的牌
    const pts = [[0, 10], [-11, 0], [0, -10], [11, 0]];
    view.trick.forEach((t, i) => {
      const k = this.relPos(t.seat);
      const o = this.cardObj(t.card);
      used.add(t.card);
      o.userData.spawn = o.visible ? null : this.spawnPoint(t.seat);
      const rot = ((t.card * 37) % 11 - 5) * 0.012;
      const q = eulerQ(-Math.PI / 2, 0, rot);
      place(o, new THREE.Vector3(pts[k][0], 0.15 + i * 0.13, pts[k][1]), q);
      this.setTint(o, null);
      o.userData.lift = 0;
    });

    // 已完成的墩：蓋在桌角
    const myTeam = viewSeat & 1;
    const cnt = [0, 0];
    view.tricks.forEach((t) => {
      const mine = (t.winner & 1) === myTeam ? 0 : 1;
      const n = cnt[mine]++;
      const base = mine === 0 ? new THREE.Vector3(L - 16 - n * 3.2, 0, L - 11) : new THREE.Vector3(L - 11, 0, -L + 16 + n * 3.2);
      const q = mine === 0 ? eulerQ(Math.PI / 2, 0, Math.PI) : eulerQ(Math.PI / 2, Math.PI / 2, Math.PI);
      t.cards.forEach((c, i) => {
        const o = this.cardObj(c.card);
        used.add(c.card);
        o.userData.spawn = o.visible ? null : new THREE.Vector3(0, 2, 0);
        place(o, base.clone().setY(0.1 + i * 0.03 + (n % 2 ? 0.05 : 0)), q);
        this.setTint(o, null);
        o.userData.lift = 0;
      });
    });

    // 輪到誰
    if (view.phase === 'done' || view.turn == null || view.turn < 0) this.turnGlow.visible = false;
    else {
      const k = this.relPos(view.turn);
      const [x, z] = SEAT_POS[k];
      this.turnGlow.visible = true;
      this.turnGlow.position.set(x * (L - 3), 0.05, z * (L - 3));
      this.turnGlow.rotation.z = [0, -Math.PI / 2, Math.PI, Math.PI / 2][k];
    }
    this.hideAll(used, usedBacks);
  }

  hideAll(used, usedBacks) {
    for (const [id, o] of this.cards) if (!used.has(id)) { o.visible = false; o.userData.spawn = null; }
    for (let s = 0; s < 4; s++) for (let i = usedBacks[s]; i < this.backs[s].length; i++) { const o = this.backs[s][i]; if (o) o.visible = false; }
  }

  setTint(o, color) {
    const f = o.userData.face;
    if (f) f.material.color.copy(color || WHITE);
  }

  // 自己的手牌：站立扇形，朝向攝影機
  layoutMine(cards, place, used, deal, seat) {
    const list = sortForDisplay(cards, this.view);
    const n = list.length;
    const spacing = this.mobile ? Math.min(11, 136 / Math.max(n, 1)) : Math.min(6.1, 84 / Math.max(n, 1));
    const centre = (n - 1) / 2;
    list.forEach((c, i) => {
      const o = this.cardObj(c);
      used.add(c);
      o.userData.spawn = o.visible ? null : deal ? new THREE.Vector3(0, 3, 0) : this.spawnPoint(seat);
      const dx = i - centre;
      const x = dx * spacing;
      const arc = dx * dx * 0.022;
      const lifted = this.hover === c ? 3.2 : this.playable.has(c) ? 0.9 : 0;
      const y = 11.5 - arc * 0.7 + lifted;
      const z = 61 + arc * 0.6 - i * 0.012;
      const yaw = -dx * 0.006, roll = -dx * 0.028;
      const tilt = -0.92;
      const p = new THREE.Vector3(x, y, z + (this.hover === c ? -2 : 0));
      place(o, p, eulerQ(tilt, yaw, roll), deal ? i * 0.03 : 0);
      this.setTint(o, this.hint === c ? HINT : (this.playable.size && !this.playable.has(c) ? DIM : null));
      this.pickList.push(o);
    });
  }

  // 攤開的手牌（明手、或全攤）：依位置擺在桌上
  layoutOpen(cards, k, place, used, seat) {
    const by = [[], [], [], []];
    for (const c of sortHand(cards)) by[suitOf(c)].push(c);
    const trumpFirst = this.view.contract && this.view.contract.strain !== 'N' ? 'SHDC'.indexOf(this.view.contract.strain) : -1;
    const order = [...new Set([trumpFirst, 0, 1, 3, 2].filter((x) => x >= 0))];
    const rows = order.map((s) => by[s]);
    const q = Q_FLAT_UP;
    const put = (c, x, z, y) => {
      const o = this.cardObj(c);
      used.add(c);
      o.userData.spawn = o.visible ? null : this.spawnPoint(seat);
      place(o, new THREE.Vector3(x, y, z), q);
      this.setTint(o, this.hint === c ? HINT : this.playable.has(c) ? null : (this.playable.size ? DIM : null));
      if (this.hover === c) o.userData.tp.y += 1.2;
      this.pickList.push(o);
    };
    if (k === 2) {
      // 上方：四欄往桌心垂，索引露出
      const colW = 9.6;
      rows.forEach((col, ci) => col.forEach((c, i) => put(c, (ci - (rows.length - 1) / 2) * colW, -L + 7.5 + i * 3.1, 0.1 + i * 0.03)));
    } else if (k === 0) {
      const colW = 9.6;
      rows.forEach((col, ci) => col.forEach((c, i) => put(c, (ci - (rows.length - 1) / 2) * colW, L - 7.5 - (col.length - 1 - i) * 3.1, 0.1 + i * 0.03)));
    } else {
      // 左右：四列橫放
      const sx = k === 1 ? -1 : 1;
      rows.forEach((row, ri) => {
        const rowZ = (ri - (rows.length - 1) / 2) * 13;
        // 往右疊，左上角的點數才露得出來
        const x0 = sx < 0 ? -(L - 8) : L - 8 - (row.length - 1) * 3.1;
        row.forEach((c, i) => put(c, x0 + i * 3.1, rowZ, 0.1 + i * 0.03));
      });
    }
  }

  // 蓋著的手牌：斜立的扇形
  layoutBacks(seat, k, n, place, usedBacks, deal) {
    const [dx, dz] = SEAT_POS[k];
    const spacing = 3.1;
    for (let i = 0; i < n; i++) {
      const o = this.backObj(seat, i);
      usedBacks[seat] = Math.max(usedBacks[seat], i + 1);
      const off = (i - (n - 1) / 2);
      o.userData.spawn = o.visible ? null : deal ? new THREE.Vector3(0, 3, 0) : this.spawnPoint(seat);
      const arc = off * off * 0.03;
      const yawBase = [0, -Math.PI / 2, Math.PI, Math.PI / 2][k];
      const p = new THREE.Vector3(dx * (L - 2 - arc * 0.4) + (dz ? off * spacing : 0), 7.2 - arc * 0.25, dz * (L - 2 - arc * 0.4) + (dx ? -dx * off * spacing : 0));
      // 牌面朝向該座位、往後仰，桌邊看到的是牌背
      const hold = eulerQ(1.15, yawBase, off * 0.03);
      place(o, p, hold, deal ? i * 0.03 : 0);
    }
  }

  setPlayable(set) {
    this.playable = set || new Set();
    if (this.view) this.relayout();
  }
  setHint(c) { this.hint = c; if (this.view) this.relayout(); }
  relayout() { this.layout(this.view, { viewSeat: this.viewSeat, open: this.openAll }); }

  bindPointer() {
    const el = this.renderer.domElement;
    const pick = (e) => {
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, this.camera);
      const hits = ray.intersectObjects(this.pickList, true);
      for (const hit of hits) {
        let o = hit.object;
        while (o && o.userData.id === undefined) o = o.parent;
        if (o && o.userData.id != null && this.playable.has(o.userData.id)) return o.userData.id;
      }
      return -1;
    };
    el.addEventListener('pointermove', (e) => {
      if (this.touch) return;
      const id = pick(e);
      if (id !== this.hover) { this.hover = id; el.style.cursor = id >= 0 ? 'pointer' : ''; if (this.view) this.relayout(); }
    });
    el.addEventListener('pointerleave', () => { if (this.hover >= 0) { this.hover = -1; if (this.view) this.relayout(); } });
    el.addEventListener('click', (e) => {
      const id = pick(e);
      if (id < 0) { if (this.touch && this.hover >= 0) { this.hover = -1; this.relayout(); } return; }
      // 觸控的牌很密：第一下浮起來看清楚，再點一次才打出
      if (this.touch && this.hover !== id) { this.hover = id; this.relayout(); return; }
      this.hover = -1;
      if (this.onCardClick) this.onCardClick(id);
    });
  }

  loop(t) {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (t - this.lastT) / 1000 || 0);
    this.lastT = t;
    const k = 1 - Math.exp(-dt * 11);
    const step = (o) => {
      if (!o || !o.visible) return;
      const u = o.userData;
      if (u.delay > 0) { u.delay -= dt; return; }
      const d = o.position.distanceTo(u.tp);
      o.position.lerp(u.tp, k);
      // 飛行時略微抬高，才有拋物線感
      if (d > 3) o.position.y += Math.min(d * 0.02, 0.45);
      o.quaternion.slerp(u.tq, k);
    };
    for (const o of this.cards.values()) step(o);
    for (const list of this.backs) for (const o of list) step(o);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

// 手牌顯示順序：黑紅交錯，王牌放最左
export function sortForDisplay(cards, view) {
  const order = [0, 1, 3, 2]; // ♠♥♣♦
  const tr = view && view.contract && view.contract.strain !== 'N' ? 'SHDC'.indexOf(view.contract.strain) : -1;
  let o = order;
  if (tr >= 0) {
    const i = order.indexOf(tr);
    o = [...order.slice(i), ...order.slice(0, i)];
  }
  return [...cards].sort((a, b) => o.indexOf(suitOf(a)) - o.indexOf(suitOf(b)) || rankOf(a) - rankOf(b));
}
